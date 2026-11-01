import type {Paper,ReviewInput} from './types';
import {dedupe} from './literature';
export type RetrievalResult={papers:Paper[];warnings:string[];successfulRequests?:number;failedRequests?:number};
type SearchOptions={queries:string[];broadQueries?:string[];biomedical:boolean;input:ReviewInput;retrieve:(queries:string[],biomedical:boolean,input:ReviewInput)=>Promise<RetrievalResult>;expand:(used:string[],titles:string[],round:number)=>Promise<string[]>;onRound:(round:number,queries:string[])=>Promise<void>};
export function freshQueries(queries:string[],used:string[]=[]):string[]{const seen=new Set(used.map(q=>q.trim().replace(/\s+/g,' ').toLowerCase()));const result:string[]=[];for(const query of queries){const clean=query.trim().replace(/\s+/g,' ').slice(0,200);if(clean.length<2||seen.has(clean.toLowerCase()))continue;seen.add(clean.toLowerCase());result.push(clean);if(result.length===3)break;}return result;}
// At most three rounds / nine phrases. User-selected dates remain hard bounds.
export async function searchWithExpansion(options:SearchOptions){
 let papers:Paper[]=[];const warnings:string[]=[];const used:string[]=[];let rounds=0;let unavailable=false;
 const target=Math.max(10,options.input.count*2);
 for(let round=1;round<=3;round++){
  let queries=round===1?freshQueries(options.queries):round===2?freshQueries(options.broadQueries||[],used):[];
  if(round>1&&!queries.length){try{queries=freshQueries(await options.expand([...used],papers.slice(0,8).map(p=>p.title),round),used);}catch{warnings.push('关键词自动扩展暂未完成，已保留现有检索结果。');break;}}
  if(!queries.length)break;
  used.push(...queries);rounds=round;await options.onRound(round,queries);
  const result=await options.retrieve(queries,options.biomedical,options.input);warnings.push(...result.warnings);papers=dedupe([...papers,...result.papers]);
  // Distinguish an unavailable database from a successful query with few hits.
  if(result.successfulRequests===0&&(result.failedRequests||0)>0){unavailable=true;break;}
  if(papers.length>=target)break;
 }
 return {papers,warnings:[...new Set(warnings)],queries:used,rounds,unavailable};
}
