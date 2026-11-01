import { XMLParser } from 'fast-xml-parser';
import { publicJSON, safeRequest } from './network';
import type {Paper, ReviewInput} from './types';
import type {RetrievalResult} from './search';
import {searchArxiv,searchSemanticScholar,searchBohrium} from './catalogs';
let openAlexBlockedUntil=0;
export function restoreAbstract(index:Record<string,number[]>|null|undefined):string { if(!index)return ''; const words:string[]=[];for(const [word,positions]of Object.entries(index))for(const pos of positions)if(pos<20000)words[pos]=word;return words.join(' ').trim(); }
export function plainXML(xml:string):string { return xml.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#\d+;/g,' ').replace(/\s+/g,' ').trim(); }
export function dedupe(papers:Paper[]):Paper[]{
 const result:Paper[]=[];const title=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 for(const original of papers){const p={...original};const old=result.find(x=>(p.doi&&x.doi&&p.doi.toLowerCase()===x.doi.toLowerCase())||(p.arxivId&&x.arxivId&&p.arxivId===x.arxivId)||(title(p.title)&&title(p.title)===title(x.title)));
  if(old){if(!old.abstract)old.abstract=p.abstract;if(p.pmcid)old.pmcid=p.pmcid;if(!old.doi&&p.doi)old.doi=p.doi;if(!old.arxivId&&p.arxivId)old.arxivId=p.arxivId;old.sources=[...new Set([...(old.sources||[old.source]),...(p.sources||[p.source])])];old.source=old.sources.join(' / ');}
  else{p.sources=p.sources||[p.source];result.push(p);}
 }return result;
}
// Round-robin source results so the model's bounded candidate pool represents all sources.
export function balancedPapers(papers:Paper[]):Paper[]{const groups=new Map<string,Paper[]>();for(const p of papers){const group=groups.get(p.source)||[];group.push(p);groups.set(p.source,group);}const result:Paper[]=[];const buckets=[...groups.values()];for(let i=0;buckets.some(b=>i<b.length);i++)for(const b of buckets)if(b[i])result.push(b[i]);return result;}
export async function retrieve(queries:string[],biomedical:boolean,input:ReviewInput,fetchJSON:typeof publicJSON=publicJSON,options:{bohrApiKey?:string;additional?:boolean}={}):Promise<RetrievalResult>{
 const operations=[retrieveCore(queries,biomedical,input,fetchJSON)];
 if(options.additional!==false){operations.push(searchArxiv(queries,input),searchSemanticScholar(queries,input));const key=options.bohrApiKey||process.env.BOHR_ACCESS_KEY;if(key)operations.push(searchBohrium(queries,input,key));}
 const results=await Promise.allSettled(operations);const papers:Paper[]=[];const warnings:string[]=[];let successfulRequests=0,failedRequests=0;
 for(const result of results){if(result.status==='fulfilled'){papers.push(...result.value.papers);warnings.push(...result.value.warnings);successfulRequests+=result.value.successfulRequests||0;failedRequests+=result.value.failedRequests||0;}else{failedRequests++;warnings.push('部分文献来源暂时不可用，已保留其他来源。');}}
 return {papers:dedupe(balancedPapers(papers)),warnings:[...new Set(warnings)],successfulRequests,failedRequests};
}
async function retrieveCore(queries:string[],biomedical:boolean,input:ReviewInput, fetchJSON:typeof publicJSON=publicJSON):Promise<RetrievalResult>{
 const papers:Paper[]=[];const warnings:string[]=[];let successfulRequests=0,failedRequests=0;
 for(const query of queries.slice(0,3)){
  if(fetchJSON===publicJSON&&Date.now()<openAlexBlockedUntil){failedRequests++;warnings.push('OpenAlex 暂时限流，已尝试备用文献来源。');continue;}
  const u=new URL('https://api.openalex.org/works');u.searchParams.set('search',query);u.searchParams.set('filter',`from_publication_date:${input.fromYear}-01-01,to_publication_date:${input.toYear}-12-31`);u.searchParams.set('per-page','40');if(process.env.OPENALEX_API_KEY)u.searchParams.set('api_key',process.env.OPENALEX_API_KEY);
  try { const d=await fetchJSON(u.toString());successfulRequests++;for(const w of d.results||[]){if(!w.title)continue; const doi=w.doi?.replace(/^https?:\/\/doi.org\//,'');papers.push({id:'',title:w.title,authors:(w.authorships||[]).map((a:any)=>a.author?.display_name).filter(Boolean).slice(0,20),year:w.publication_year,journal:w.primary_location?.source?.display_name||'',doi,url:doi?`https://doi.org/${doi}`:w.id,abstract:restoreAbstract(w.abstract_inverted_index),source:'OpenAlex'});} }catch(error){failedRequests++;if(fetchJSON===publicJSON&&(error as {status?:number}).status===429)openAlexBlockedUntil=Date.now()+10*60*1000;warnings.push('OpenAlex 部分检索失败，已尝试备用文献来源。');}
 }
 if(biomedical){for(const q of queries.slice(0,2)){
  const u=new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');u.searchParams.set('query',`(${q}) AND SRC:MED AND FIRST_PDATE:[${input.fromYear}-01-01 TO ${input.toYear}-12-31]`);u.searchParams.set('format','json');u.searchParams.set('resultType','core');u.searchParams.set('pageSize','30');
  try{const d=await fetchJSON(u.toString());successfulRequests++;for(const w of d.resultList?.result||[])papers.push({id:'',title:plainXML(w.title||''),authors:(w.authorList?.author||[]).map((a:any)=>a.fullName).filter(Boolean),year:Number(w.pubYear),journal:w.journalInfo?.journal?.title||'',doi:w.doi,url:`https://pubmed.ncbi.nlm.nih.gov/${w.id}/`,abstract:plainXML(w.abstractText||''),source:'PubMed · Europe PMC',pmcid:w.isOpenAccess==='Y'?w.pmcid:undefined});}catch{failedRequests++;warnings.push('PubMed 补充检索暂时不可用，已保留其他来源。');}
 }}
 // Crossref supplies publisher-deposited metadata and abstracts without a user key.
 {
  warnings.push('已联合检索 Crossref；仅采用真实文献及摘要。');
  for(const query of queries.slice(0,2)){
   const u=new URL('https://api.crossref.org/works');u.searchParams.set('query',query);u.searchParams.set('filter',`from-pub-date:${input.fromYear}-01-01,until-pub-date:${input.toYear}-12-31,has-abstract:true`);u.searchParams.set('rows','40');
   try{const d=await fetchJSON(u.toString());if(!Array.isArray(d.message?.items))throw new Error('Invalid Crossref response');successfulRequests++;
    for(const w of d.message.items){const title=plainXML(w.title?.[0]||'');const abstract=plainXML(w.abstract||'');if(!title||!w.DOI||abstract.length<=100)continue;const year=w.published?.['date-parts']?.[0]?.[0]||w['published-print']?.['date-parts']?.[0]?.[0]||w['published-online']?.['date-parts']?.[0]?.[0];if(!year||year<input.fromYear||year>input.toYear)continue;papers.push({id:'',title,abstract,year,authors:(w.author||[]).map((a:any)=>[a.given,a.family].filter(Boolean).join(' ')).filter(Boolean).slice(0,20),journal:w['container-title']?.[0]||'',doi:w.DOI,url:`https://doi.org/${w.DOI}`,source:'Crossref'});}
   }catch{failedRequests++;warnings.push('Crossref 备用检索暂时不可用。');}
  }
 }
 return {papers:papers.filter(p=>p.abstract.length>100),warnings:[...new Set(warnings)],successfulRequests,failedRequests};
}
export async function enhanceFullText(paper:Paper):Promise<void>{
 try{
 if(!paper.pmcid&&paper.doi){const u=new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');u.searchParams.set('query',`DOI:"${paper.doi}" AND OPEN_ACCESS:Y`);u.searchParams.set('format','json');const d=await publicJSON(u.toString());paper.pmcid=d.resultList?.result?.find((w:any)=>w.isOpenAccess==='Y')?.pmcid;}
 if(!paper.pmcid||!/^PMC\d+$/.test(paper.pmcid))return;
 const url=`https://www.ebi.ac.uk/europepmc/webservices/rest/${paper.pmcid}/fullTextXML`;const r=await safeRequest(url,{maxBytes:4_000_000,timeout:20000});if(r.status!==200)return;
 // Validate XML before extracting the article body. Reference lists are deliberately excluded.
 const parser=new XMLParser({ignoreAttributes:true,processEntities:false});parser.parse(r.text);
 const body=r.text.match(/<body[\s>][\s\S]*?<\/body>/)?.[0];if(body){paper.fullText=plainXML(body).slice(0,18000);paper.fullTextUrl=url;}
 }catch{/* Full text is optional: keep the real abstract. */}
}
