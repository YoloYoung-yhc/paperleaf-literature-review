import type {Provider} from './types';
import { safeRequest } from './network';
import { UserError } from './validation';
type Transport=typeof safeRequest;
async function completion(p:Provider,system:string,prompt:string,maxTokens:number|undefined,transport:Transport){
 let endpoint=p.baseUrl.replace(/\/+$/,''); if(!endpoint.endsWith('/chat/completions'))endpoint+='/chat/completions';
 const r=await transport(endpoint,{method:'POST',headers:{Authorization:`Bearer ${p.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:p.model,messages:[{role:'system',content:system},{role:'user',content:prompt}],...(maxTokens===undefined?{}:{max_tokens:maxTokens})}),timeout:180000});
 if(r.status===401||r.status===403)throw new UserError('API 认证失败，请检查 Key、模型权限和接口地址。');
 if(r.status===429)throw new UserError('模型接口限流或余额不足，请检查账户后重试。');
 if(r.status!==200)throw new UserError(`模型接口请求失败（${r.status}），请检查地址、模型名及服务商支持的输出额度。`);
 let data;try{data=JSON.parse(r.text);}catch{throw new UserError('模型接口返回的内容不是有效 JSON。');}
 const choice=data.choices?.[0];
 if(!choice||typeof choice.message!=='object'||!choice.message)throw new UserError('模型接口未返回有效的 Chat Completions 响应。');
 return choice as {finish_reason?:string;message:{content?:string|null;reasoning_content?:string|null}};
}
// Writing requests omit both token-limit fields: the provider chooses its default.
// Never pass truncated JSON to downstream stages; callers can split the work.
export class OutputTruncatedError extends UserError {
 constructor(message='模型服务达到了单次输出或上下文限制。网站未设置输出 token 上限；正在处理的内容需要拆小。'){super(message,502);}
}
export async function chat(p:Provider,system:string,prompt:string,_legacyBudget=4000,transport:Transport=safeRequest):Promise<string>{
 const c=await completion(p,system,prompt,undefined,transport);
 if(c.finish_reason==='length')throw new OutputTruncatedError();
 if(c.finish_reason==='content_filter')throw new UserError('模型服务未返回内容，可能触发了服务商的内容过滤。请调整题目后重试。');
 const text=c.message.content;
 if(typeof text!=='string'||!text.trim())throw new UserError('模型只返回了思考过程或空内容，没有返回正文。请选用非推理模式或其他模型。');
 return text;
}
// A connectivity probe checks authentication and protocol, not writing quality.
// Reasoning-only output at a tiny probe budget still proves the API is reachable.
export async function testConnection(p:Provider,transport:Transport=safeRequest):Promise<void>{
 const c=await completion(p,'Reply briefly.','Reply with OK.',64,transport);
 if(c.finish_reason==='length')return;
 if(c.message.content?.trim()||c.message.reasoning_content?.trim())return;
 throw new UserError('接口已返回响应，但没有可用内容，请检查模型名称与权限。');
}
export function parseJSON(text:string):unknown { try {return JSON.parse(text.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,''));} catch {throw new UserError('模型没有按约定返回内容，请重试或更换模型。');} }
