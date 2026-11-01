import ipaddr from 'ipaddr.js';
import {UserError} from '../lib/validation';
export function isPublicIP(ip:string){try{let a=ipaddr.parse(ip.replace(/^\[|\]$/g,''));if(a.kind()==='ipv6'&&(a as ipaddr.IPv6).isIPv4MappedAddress())a=(a as ipaddr.IPv6).toIPv4Address();return a.range()==='unicast';}catch{return false;}}
export async function validateEndpoint(raw:string,allowQuery=false){
 const url=new URL(raw);const host=url.hostname.replace(/^\[|\]$/g,'');
 if(url.protocol!=='https:'||url.username||url.password||url.hash||(!allowQuery&&url.search)||(url.port&&url.port!=='443')||host==='localhost'||host.endsWith('.local')||host.endsWith('.localhost')||((ipaddr.isValid(host))&&!isPublicIP(host)))throw new UserError('请填写公网 HTTPS 接口地址，不要使用本机、内网或非标准端口。');
 return {url};
}
export async function safeRequest(raw:string,options:{method?:'GET'|'POST';headers?:Record<string,string>;body?:string;maxBytes?:number;timeout?:number;allowQuery?:boolean}={}){
 const {url}=await validateEndpoint(raw,options.allowQuery);let response:Response;
 try{response=await fetch(url,{method:options.method||'GET',headers:options.headers,body:options.body,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(options.timeout||30000)});}
 catch{throw new UserError('浏览器无法连接接口：可能是网络、超时或服务商没有开放网页跨域访问（CORS）。请检查网络，或使用允许浏览器直接调用的 API。');}
 const reader=response.body?.getReader();if(!reader)return {status:response.status,text:''};const chunks:Uint8Array[]=[];let total=0;
 while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>(options.maxBytes||2_000_000)){await reader.cancel();throw new UserError('接口响应过大，请缩小任务范围。');}chunks.push(value);}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return {status:response.status,text:new TextDecoder().decode(bytes)};
}
export async function publicJSON(url:string,headers?:Record<string,string>):Promise<any>{const r=await safeRequest(url,{headers,allowQuery:true,maxBytes:5_000_000});if(r.status!==200)throw new UserError('文献服务暂时不可用或限流。',r.status);try{return JSON.parse(r.text);}catch{throw new UserError('文献服务返回了无法解析的数据。');}}
