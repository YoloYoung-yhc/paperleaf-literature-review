import { z } from 'zod';
export const providerSchema=z.object({baseUrl:z.string().url().max(300),apiKey:z.string().trim().min(1).max(1000).refine(v=>!/[\r\n]/.test(v)),model:z.string().trim().min(1).max(150),bohrApiKey:z.string().trim().max(1000).refine(v=>!/[\r\n]/.test(v)).optional()});
export const inputSchema=z.object({topic:z.string().trim().min(2,'请输入至少两个字符的研究题目').max(500),language:z.enum(['zh','en']).default('zh'),words:z.number().int().min(1000).max(6000).default(3000),count:z.number().int().min(5).max(25).default(15),fromYear:z.number().int().min(1900).max(2100),toYear:z.number().int().min(1900).max(2100),requirements:z.string().max(2000).default('')}).refine(v=>v.fromYear<=v.toYear,{message:'起始年份不能晚于结束年份'});
export const createSchema=z.object({provider:providerSchema,input:inputSchema});
export class UserError extends Error { constructor(message:string,public status=400){super(message);} }
export function publicError(error:unknown):string { if(error instanceof UserError) return error.message; if(error instanceof z.ZodError) return error.issues[0]?.message || '输入格式不正确'; return '服务暂时未能完成，请稍后重试。'; }
