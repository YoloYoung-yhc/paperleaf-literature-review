import { providerSchema } from '@/lib/validation';
import {testConnection} from '@/lib/provider';
import {checkOrigin,clientKey,readJSON,errorResponse} from '@/lib/http';
import {rateLimit} from '@/lib/jobs';
export const runtime='nodejs';
export async function POST(req:Request){try{checkOrigin(req);rateLimit('test:'+clientKey(req),10);const p=providerSchema.parse(await readJSON(req));await testConnection(p);return Response.json({ok:true});}catch(e){return errorResponse(e);}}
