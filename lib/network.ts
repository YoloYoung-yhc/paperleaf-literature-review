import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, request } from 'undici';
import { UserError } from './validation';
export function isPublicIP(ip:string):boolean { try { let a=ipaddr.parse(ip.replace(/^\[|\]$/g,'')); if(a.kind()==='ipv6' && (a as ipaddr.IPv6).isIPv4MappedAddress()) a=(a as ipaddr.IPv6).toIPv4Address(); return a.range()==='unicast'; } catch {return false;} }
export async function validateEndpoint(raw:string, allowQuery=false) {
 const url=new URL(raw); if(url.protocol!=='https:'||url.username||url.password||url.hash||(!allowQuery && url.search)||(url.port && url.port!=='443')) throw new UserError('接口地址须为公网 HTTPS 地址，不能含账号、查询参数或自定义端口。');
 const hostname=url.hostname.replace(/^\[|\]$/g,'');
 const addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await lookup(hostname,{all:true}).catch(()=>{throw new UserError('无法解析接口域名，请检查 Base URL。');});
 if(!addresses.length || addresses.some(a=>!isPublicIP(a.address))) throw new UserError('接口地址必须指向公网，不能使用本机或内网地址。');
 return {url,addresses};
}
// DNS pinning prevents a second DNS lookup from redirecting an authenticated request into a private network.
export async function safeRequest(raw:string, options:{method?:'GET'|'POST';headers?:Record<string,string>;body?:string;maxBytes?:number;timeout?:number;allowQuery?:boolean}={}) {
 const {url,addresses}=await validateEndpoint(raw,options.allowQuery); const pinned=addresses[0];
 const agent=new Agent({connect:{lookup:((_host:unknown,opts:unknown,cb:unknown)=>{const callback=cb as (...args:unknown[])=>void; if((opts as {all?:boolean}).all) callback(null,[pinned]); else callback(null,pinned.address,pinned.family);}) as never}});
 try { const res=await request(url,{dispatcher:agent,method:options.method||'GET',headers:options.headers,body:options.body,signal:AbortSignal.timeout(options.timeout||60000)});
 let size=0; const chunks:Buffer[]=[]; for await(const chunk of res.body){size+=chunk.length;if(size>(options.maxBytes||2_000_000)){res.body.destroy();throw new UserError('接口响应过大，请缩小任务后重试。');}chunks.push(Buffer.from(chunk));}
 return {status:res.statusCode,text:Buffer.concat(chunks).toString('utf8')};
 } catch(e) { if(e instanceof UserError)throw e; throw new UserError('连接超时或网络异常，请检查 API 地址，稍后重试。'); } finally {await agent.close();}
}
export async function publicJSON(url:string,headers?:Record<string,string>):Promise<any> { const r=await safeRequest(url,{timeout:30000,maxBytes:5_000_000,allowQuery:true,headers}); if(r.status!==200)throw new UserError('文献服务暂时不可用或额度不足，请稍后重试。',r.status); try{return JSON.parse(r.text);}catch{throw new UserError('文献服务返回了无法读取的数据。');} }
