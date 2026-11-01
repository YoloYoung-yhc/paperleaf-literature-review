import {XMLParser} from 'fast-xml-parser';
import {setTimeout as delay} from 'node:timers/promises';
import {publicJSON,safeRequest} from './network';
import type {Paper,ReviewInput} from './types';
import type {RetrievalResult} from './search';
const clean=(s:unknown)=>typeof s==='string'?s.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim():'';
const array=(v:any):any[]=>v===undefined?[]:Array.isArray(v)?v:[v];
export type CatalogIO={json:typeof publicJSON;text:typeof safeRequest};
const defaultIO:CatalogIO={json:publicJSON,text:safeRequest};
function usable(p:Paper,input:ReviewInput){return p.title&&p.abstract.length>100&&p.year>=input.fromYear&&p.year<=input.toYear;}
let arxivTail:Promise<unknown>=Promise.resolve();let lastArxivStart=0;
const cache=new Map<string,{expires:number;papers:Paper[]}>();
// arXiv's legacy API requires a single connection and at least 3 s between requests.
async function arxivRequest(url:string,io:CatalogIO){
 if(io!==defaultIO)return io.text(url,{allowQuery:true,timeout:30000,maxBytes:3_000_000});
 const pending=arxivTail.then(async()=>{await delay(Math.max(0,3000-(Date.now()-lastArxivStart)));lastArxivStart=Date.now();return io.text(url,{allowQuery:true,timeout:30000,maxBytes:3_000_000});});arxivTail=pending.catch(()=>{});return pending;
}
export async function searchArxiv(queries:string[],input:ReviewInput,io:CatalogIO=defaultIO):Promise<RetrievalResult>{
 try{
  const u=new URL('https://export.arxiv.org/api/query');const terms=queries.slice(0,3).map(q=>`all:"${q.replace(/["\\]/g,' ')}"`);u.searchParams.set('search_query',`(${terms.join(' OR ')}) AND submittedDate:[${input.fromYear}01010000 TO ${input.toYear}12312359]`);u.searchParams.set('max_results','40');u.searchParams.set('sortBy','relevance');
  const key=u.toString(),cached=cache.get(key);if(cached&&cached.expires>Date.now())return {papers:structuredClone(cached.papers),warnings:[],successfulRequests:1,failedRequests:0};
  const r=await arxivRequest(key,io);if(r.status!==200)throw new Error('arXiv unavailable');const d=new XMLParser({ignoreAttributes:false,processEntities:false}).parse(r.text);if(!d.feed)throw new Error('Invalid arXiv feed');
  const papers:Paper[]=array(d.feed.entry).map(w=>{const id=clean(w.id).split('/abs/')[1]||'';const doi=clean(w['arxiv:doi']);return {id:'',title:clean(w.title),authors:array(w.author).map(a=>clean(a.name)).filter(Boolean),year:Number(String(w.published||'').slice(0,4)),journal:clean(w['arxiv:journal_ref'])||'arXiv',doi:doi||undefined,url:`https://arxiv.org/abs/${id}`,arxivId:id.replace(/v\d+$/,''),abstract:clean(w.summary),source:'arXiv（预印本）'};}).filter(p=>!!p.arxivId&&usable(p,input));
  if(io===defaultIO){if(cache.size>200)cache.clear();cache.set(key,{expires:Date.now()+10*60*1000,papers:structuredClone(papers)});}
  return {papers,warnings:[],successfulRequests:1,failedRequests:0};
 }catch{return {papers:[],warnings:['arXiv 暂时不可用，其他文献来源继续检索。'],successfulRequests:0,failedRequests:1};}
}
export async function searchSemanticScholar(queries:string[],input:ReviewInput,io:CatalogIO=defaultIO):Promise<RetrievalResult>{
 try{
  const u=new URL('https://api.semanticscholar.org/graph/v1/paper/search/bulk');u.searchParams.set('query',queries.slice(0,3).map(q=>`"${q.replace(/["|+]/g,' ')}"`).join(' | '));u.searchParams.set('year',`${input.fromYear}:${input.toYear}`);u.searchParams.set('fields','title,abstract,authors,year,venue,url,externalIds');
  const headers=process.env.SEMANTIC_SCHOLAR_API_KEY?{'x-api-key':process.env.SEMANTIC_SCHOLAR_API_KEY}:undefined;
  const d=await io.json(u.toString(),headers);if(!Array.isArray(d.data))throw new Error('Invalid Semantic Scholar response');
  const papers:Paper[]=d.data.slice(0,100).map((w:any)=>({id:'',title:clean(w.title),abstract:clean(w.abstract),authors:(w.authors||[]).map((a:any)=>clean(a.name)).filter(Boolean),year:Number(w.year),journal:clean(w.venue),doi:clean(w.externalIds?.DOI)||undefined,arxivId:clean(w.externalIds?.ArXiv).replace(/v\d+$/,'')||undefined,url:w.externalIds?.DOI?`https://doi.org/${w.externalIds.DOI}`:`https://www.semanticscholar.org/paper/${encodeURIComponent(w.paperId)}`,source:'Semantic Scholar'})).filter((p:Paper)=>usable(p,input));
  return {papers,warnings:[],successfulRequests:1,failedRequests:0};
 }catch{return {papers:[],warnings:['Semantic Scholar 暂时不可用或限流，其他文献来源继续检索。'],successfulRequests:0,failedRequests:1};}
}
export async function searchBohrium(queries:string[],input:ReviewInput,key:string,io:CatalogIO=defaultIO):Promise<RetrievalResult>{
 if(!key)return {papers:[],warnings:[],successfulRequests:0,failedRequests:0};
 try{
  const r=await io.text('https://open.bohrium.com/openapi/v2/paper/rag/pass/keyword',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({words:queries.slice(0,3),question:input.topic,type:0,startTime:`${input.fromYear}-01-01`,endTime:`${input.toYear}-12-31`,pageSize:40}),timeout:60000,maxBytes:5_000_000});
  if(r.status!==200)throw new Error('Bohrium unavailable');let d;try{d=JSON.parse(r.text);}catch{d=JSON.parse(r.text.split('\n').find(line=>line.trim())||'');}if(d.code!==0||!Array.isArray(d.data))throw new Error('Bohrium returned error');
  const papers:Paper[]=d.data.map((w:any)=>{const date=String(w.coverDateStart||'');const year=/^\d{4}-/.test(date)?Number(date.slice(0,4)):Number.isFinite(Number(date))?new Date(Number(date)).getUTCFullYear():0;return {id:'',title:clean(w.enName)||clean(w.zhName),abstract:clean(w.enAbstract)||clean(w.zhAbstract),authors:array(w.authors).map((a:any)=>clean(typeof a==='string'?a:a.name||a.enName)).filter(Boolean),year,journal:clean(w.publicationEnName),doi:clean(w.doi),url:`https://doi.org/${clean(w.doi)}`,source:'Bohrium（玻尔）'};}).filter((p:Paper)=>!!p.doi&&usable(p,input));
  return {papers,warnings:[],successfulRequests:1,failedRequests:0};
 }catch{return {papers:[],warnings:['玻尔检索未成功，请检查独立 Access Key、接口权限或额度；其他来源继续检索。'],successfulRequests:0,failedRequests:1};}
}
