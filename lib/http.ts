import {UserError,publicError} from './validation';
export function clientKey(req:Request){return process.env.TRUST_PROXY==='true'?req.headers.get('x-forwarded-for')?.split(',')[0].trim()||'shared':'shared';}
export async function readJSON(req:Request){if(Number(req.headers.get('content-length')||0)>16000)throw new UserError('请求内容过长。',413);const reader=req.body?.getReader();if(!reader)throw new UserError('请求内容为空。');let size=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16000){await reader.cancel();throw new UserError('请求内容过长。',413);}chunks.push(value);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new UserError('请求格式不正确。');}}
export function checkOrigin(req:Request){
 const origin=req.headers.get('origin');if(!origin)return;
 const reject=()=>{throw new UserError('请从本站页面提交请求。',403);};
 try{
  const supplied=new URL(origin);
  if(!['http:','https:'].includes(supplied.protocol)||supplied.username||supplied.password||supplied.origin!==origin)return reject();
  if(process.env.APP_ORIGIN){if(supplied.origin!==new URL(process.env.APP_ORIGIN).origin)return reject();return;}
  // Next.js standalone may normalize req.url to localhost although the browser
  // requested 127.0.0.1. Host is the actual HTTP destination; do not compare
  // against the framework's internal URL or trust forwarded hosts.
  const requestURL=new URL(req.url);
  const host=req.headers.get('host')||requestURL.host;
  if(!/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d{1,5})?$/i.test(host))return reject();
  let protocol=requestURL.protocol;
  if(process.env.TRUST_PROXY==='true'){
   const forwarded=req.headers.get('x-forwarded-proto');
   if(forwarded==='https'||forwarded==='http')protocol=forwarded+':';
  }
  const expected=new URL(protocol+'//'+host).origin;
  if(supplied.origin!==expected)return reject();
 }catch{return reject();}
}
export function bearer(req:Request){return req.headers.get('authorization')?.replace(/^Bearer /,'')||'';}
export function errorResponse(e:unknown){return Response.json({error:publicError(e)},{status:e instanceof UserError?e.status:400});}
