import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import type {Job,Provider,ReviewInput,PublicJob} from './types';
import {pipeline} from './generation';
import { ZodError } from 'zod';
import {UserError,publicError} from './validation';
const dir=path.resolve(process.env.DATA_DIR||'data');const ttl=24*60*60*1000;
const shared=globalThis as typeof globalThis & {paperleafState?:{active:Set<string>;slots:number;rates:Map<string,number[]>;lastSweep:number}};
const state:NonNullable<typeof shared.paperleafState>=shared.paperleafState??={active:new Set(),slots:0,rates:new Map(),lastSweep:0};
export function rateLimit(key:string,max=6,window=60000){const now=Date.now();if(state.rates.size>5000)for(const [k,v]of state.rates)if(!v.some(t=>t>now-3600000))state.rates.delete(k);const recent=(state.rates.get(key)||[]).filter(t=>t>now-window);if(recent.length>=max)throw new UserError('请求较频繁，请稍等一分钟后重试。',429);recent.push(now);state.rates.set(key,recent);}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function saveJob(job:Job){await mkdir(dir,{recursive:true,mode:0o700});const file=path.join(dir,`${job.id}.json`);const temp=file+'.'+randomBytes(6).toString('hex')+'.tmp';await writeFile(temp,JSON.stringify(job),{mode:0o600});await rename(temp,file);}
export async function cleanup(){if(Date.now()-state.lastSweep<60000)return;state.lastSweep=Date.now();await mkdir(dir,{recursive:true,mode:0o700});for(const file of await readdir(dir)){if(!/^[a-f0-9]{32}\.json$/.test(file))continue;try{const j=JSON.parse(await readFile(path.join(dir,file),'utf8')) as Job;if(j.expiresAt<Date.now()&&!state.active.has(j.id))await unlink(path.join(dir,file));}catch{/* Ignore unrelated/incomplete entries. */}}}
export async function getJob(id:string,token:string):Promise<Job>{await cleanup();if(!/^[a-f0-9]{32}$/.test(id)||!token)throw new UserError('任务不存在或访问凭证已失效。',404);let j:Job;try{j=JSON.parse(await readFile(path.join(dir,`${id}.json`),'utf8'));}catch{throw new UserError('任务不存在或已过期，请重新生成。',404);}const digest=Buffer.from(hash(token));const expected=Buffer.from(j.tokenHash);if(digest.length!==expected.length||!timingSafeEqual(digest,expected))throw new UserError('任务不存在或访问凭证已失效。',404);if(j.expiresAt<Date.now())throw new UserError('任务已过期，请重新生成。',410);if(j.status==='running'&&!state.active.has(id)){j.status='failed';j.error='服务重启导致生成中断，请重新提交任务。';j.stage='生成中断';await saveJob(j);}return j;}
export function publicJob(j:Job):PublicJob{const {tokenHash:_,...rest}=j;return rest;}
export async function startJob(input:ReviewInput,provider:Provider){await cleanup();rateLimit('global:jobs',20,3600000);const max=Math.max(1,Math.min(4,Number(process.env.MAX_CONCURRENT)||2));if(state.slots>=max)throw new UserError('当前生成任务较多，请稍后再试。',429);state.slots++;
 const id=randomBytes(16).toString('hex'),token=randomBytes(32).toString('hex');const job:Job={id,tokenHash:hash(token),input,status:'running',stage:'任务已开始',progress:3,createdAt:Date.now(),expiresAt:Date.now()+ttl,papers:[],evidence:[],warnings:[]};state.active.add(id);
 try{await saveJob(job);}catch{state.active.delete(id);state.slots--;throw new UserError('无法保存任务，请检查服务器存储。',503);}
 setImmediate(async()=>{try{await pipeline(job,provider,()=>saveJob(job));job.status='completed';job.progress=100;job.stage='综述已完成';}catch(error){job.status='failed';job.stage='生成未完成';job.error=error instanceof ZodError?'模型返回的内容不完整或格式不符，请更换模型或重试。':publicError(error);}finally{provider.apiKey='';provider.bohrApiKey='';try{await saveJob(job);}catch{ /* Keep credentials out of failure logs; polling reports interruption. */ }finally{state.active.delete(id);state.slots--;}}});return {id,token};
}

const sweeper=setInterval(()=>{void cleanup().catch(()=>{});},60000);sweeper.unref();
