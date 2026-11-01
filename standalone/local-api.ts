import {Packer} from 'docx';
import {pipeline} from '../lib/generation';
import {testConnection} from '../lib/provider';
import {reviewDocument} from '../lib/export';
import {createSchema,providerSchema,UserError,publicError} from '../lib/validation';
import type {Job} from '../lib/types';
type StorageLike={getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void};
type Options={storage?:StorageLike;run?:typeof pipeline;probe?:typeof testConnection;document?:(job:Job)=>Promise<Blob>};
const storageKey='paperleaf-html-result';
function random(){return Array.from(crypto.getRandomValues(new Uint8Array(24)),v=>v.toString(16).padStart(2,'0')).join('');}
export function createLocalAPI(options:Options={}){
 const records=new Map<string,{job:Job;token:string}>();let active=false;
 const run=options.run||pipeline,probe=options.probe||testConnection;
 const persist=(record:{job:Job;token:string})=>{try{options.storage?.setItem(storageKey,JSON.stringify(record));}catch{/* Storage denied/full: current page still works. */}};
 try{const raw=options.storage?.getItem(storageKey);if(raw){const saved=JSON.parse(raw);if(saved.job?.expiresAt>Date.now()&&typeof saved.token==='string'){if(saved.job.status==='running'){saved.job.status='failed';saved.job.stage='浏览器任务已中断';saved.job.error='页面刷新或关闭中断了浏览器内的生成，请重新生成并保持页面打开。';persist(saved);}records.set(saved.job.id,saved);}}}catch{/* Corrupt or expired local snapshots are ignored. */}
 return async function localAPI(url:string,init?:RequestInit):Promise<Response>{
  try{
   if(url==='/api/provider/test'&&init?.method==='POST'){const p=providerSchema.parse(JSON.parse(String(init.body)));try{await probe(p);}finally{p.apiKey='';p.bohrApiKey='';}return Response.json({ok:true});}
   if(url==='/api/reviews'&&init?.method==='POST'){
    if(active)throw new UserError('当前页面已有任务正在生成，请等待完成。',429);
    const {input,provider}=createSchema.parse(JSON.parse(String(init.body)));active=true;
    const id=random(),token=random(),job:Job={id,tokenHash:'browser-only',input,status:'running',stage:'浏览器任务已开始',progress:3,createdAt:Date.now(),expiresAt:Date.now()+24*60*60*1000,papers:[],evidence:[],warnings:['单文件浏览器版：请求由你的浏览器直接发送给所选模型与文献服务，无网站后端。','请保持页面打开；刷新、关闭或手机后台休眠可能中断执行。文献接口受网络、跨域权限与额度影响。']};
    const record={job,token};records.set(id,record);persist(record);
    setTimeout(async()=>{try{await run(job,provider,async()=>persist(record));job.status='completed';job.progress=100;job.stage='综述已完成';}catch(e){job.status='failed';job.stage='生成未完成';job.error=publicError(e);}finally{provider.apiKey='';provider.bohrApiKey='';active=false;persist(record);}},0);
    return Response.json({id,token},{status:202});
   }
   const match=url.match(/^\/api\/reviews\/([a-f0-9]+)(\/download)?$/);if(!match)throw new UserError('本地功能不存在。',404);
   const record=records.get(match[1]);const token=new Headers(init?.headers).get('authorization')?.replace(/^Bearer /,'');if(!record||token!==record.token)throw new UserError('当前浏览器会话中找不到该任务，请重新生成。',404);
   if(record.job.expiresAt<Date.now())throw new UserError('本地任务已过期，请重新生成。',410);
   if(match[2]){if(record.job.status!=='completed')throw new UserError('任务尚未完成。');const blob=options.document?await options.document(record.job):await Packer.toBlob(reviewDocument(record.job));return new Response(blob,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}});}
   const {tokenHash:_,...view}=record.job;return Response.json(view);
  }catch(e){return Response.json({error:publicError(e)},{status:e instanceof UserError?e.status:400});}
 };
}
