import {getJob} from '@/lib/jobs';
import {bearer,errorResponse} from '@/lib/http';
import {wordDocument} from '@/lib/export';
import {UserError} from '@/lib/validation';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){try{const job=await getJob((await params).id,bearer(req));if(job.status!=='completed')throw new UserError('任务尚未完成，请稍候。');return new Response(new Uint8Array(await wordDocument(job)),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`attachment; filename="review.docx"; filename*=UTF-8''${encodeURIComponent(job.input.topic.slice(0,60)+'.docx')}`}});}catch(e){return errorResponse(e);}}
