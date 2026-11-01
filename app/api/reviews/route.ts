import {createSchema} from '@/lib/validation';
import {startJob,rateLimit} from '@/lib/jobs';
import {validateEndpoint} from '@/lib/network';
import {checkOrigin,clientKey,readJSON,errorResponse} from '@/lib/http';
export const runtime='nodejs';
export async function POST(req:Request){try{checkOrigin(req);rateLimit('create:'+clientKey(req),3);const {provider,input}=createSchema.parse(await readJSON(req));await validateEndpoint(provider.baseUrl);const job=await startJob(input,provider);return Response.json(job,{status:202});}catch(e){return errorResponse(e);}}
