import {getJob,publicJob} from '@/lib/jobs';
import {bearer,errorResponse} from '@/lib/http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){try{return Response.json(publicJob(await getJob((await params).id,bearer(req))));}catch(e){return errorResponse(e);}}
