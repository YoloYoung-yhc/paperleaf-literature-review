import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchWithExpansion,freshQueries} from '../lib/search';
import {retrieve,dedupe} from '../lib/literature';
import type {Paper,ReviewInput} from '../lib/types';
const input:ReviewInput={topic:'AI force fields',language:'zh',words:3000,count:5,fromYear:2021,toYear:2026,requirements:''};
const paper=(n:number):Paper=>({id:'',title:`Potential study ${n}`,authors:[],year:2024,journal:'Journal',doi:`10.1/${n}`,url:`https://example.com/${n}`,abstract:'A '.repeat(80),source:'fixture'});
test('automatically broadens sparse queries, merges duplicates and preserves dates',async()=>{
 const queries:string[][]=[];let expansions=0;const rounds:number[]=[];
 const result=await searchWithExpansion({queries:['AI force fields physics applications'],broadQueries:['machine learning potentials','interatomic potentials'],biomedical:false,input,
 retrieve:async(q,_bio,dates)=>{queries.push(q);assert.equal(dates.fromYear,2021);assert.equal(dates.toYear,2026);return {papers:queries.length===1?[paper(1)]:[paper(1),...Array.from({length:10},(_,i)=>paper(i+2))],warnings:[]};},
 expand:async()=>{expansions++;return [];},onRound:async r=>{rounds.push(r);}});
 assert.deepEqual(queries,[['AI force fields physics applications'],['machine learning potentials','interatomic potentials']]);assert.equal(result.papers.length,11);assert.equal(result.rounds,2);assert.equal(expansions,0);assert.deepEqual(rounds,[1,2]);
});
test('uses feedback to generate new terms and stops after three rounds',async()=>{
 let calls=0;const used:string[][]=[];
 const result=await searchWithExpansion({queries:['initial terms'],biomedical:false,input,retrieve:async()=>{calls++;return {papers:[paper(calls)],warnings:[]};},expand:async(previous,_titles,round)=>{used.push(previous);return [`synonym ${round}`,previous[0]];},onRound:async()=>{}});
 assert.equal(calls,3);assert.equal(result.rounds,3);assert.equal(result.papers.length,3);assert.deepEqual(result.queries,['initial terms','synonym 2','synonym 3']);assert.equal(used[1].length,2);
});
test('stops early when enough papers exist and never changes date constraints',async()=>{
 const result=await searchWithExpansion({queries:['core concept'],biomedical:false,input,retrieve:async()=>({papers:Array.from({length:12},(_,i)=>paper(i)),warnings:[]}),expand:async()=>{throw new Error('must not call model');},onRound:async()=>{}});assert.equal(result.rounds,1);assert.equal(result.papers.length,12);
});
test('database failure is not misreported as poor keywords or retried as expansion',async()=>{
 let expanded=false;const result=await searchWithExpansion({queries:['core'],biomedical:false,input,retrieve:async()=>({papers:[],warnings:['service unavailable'],successfulRequests:0,failedRequests:1}),expand:async()=>{expanded=true;return ['other'];},onRound:async()=>{}});assert.equal(result.unavailable,true);assert.equal(expanded,false);assert.deepEqual(result.warnings,['service unavailable']);
});
test('keeps existing papers when optional expansion fails',async()=>{
 const result=await searchWithExpansion({queries:['core'],biomedical:false,input,retrieve:async()=>({papers:[paper(1),paper(2),paper(3)],warnings:[]}),expand:async()=>{throw new Error('model unavailable');},onRound:async()=>{}});assert.equal(result.papers.length,3);assert.ok(result.warnings.some(w=>w.includes('扩展暂未完成')));
});
test('normalizes duplicate search phrases and does not collapse different Chinese titles',()=>{assert.deepEqual(freshQueries([' Interatomic   Potentials ','interatomic potentials','new term'],['interatomic potentials']),['new term']);assert.equal(dedupe([{...paper(1),title:'人工智能'},{...paper(2),title:'分子模拟'}]).length,2);});
test('retrieval reports success/failure separately and passes each short query to OpenAlex',async()=>{
 const seen:string[]=[];const result=await retrieve(['machine learning potentials','interatomic potentials'],false,input,async url=>{const u=new URL(url);if(u.hostname==='api.crossref.org')return {message:{items:[]}};seen.push(u.searchParams.get('search')!);assert.ok(u.searchParams.get('filter')?.includes('2021-01-01'));if(seen.length===1)throw new Error('quota');return {results:[{title:'Interatomic potentials',publication_year:2024,id:'https://openalex.org/W1',abstract_inverted_index:{Study:Array.from({length:50},(_,i)=>i)}}]};},{additional:false});assert.equal(result.successfulRequests,3);assert.equal(result.failedRequests,1);assert.equal(result.papers.length,1);assert.deepEqual(seen,['machine learning potentials','interatomic potentials']);
});

test('Crossref fallback supplies real abstracts when OpenAlex is rate limited',async()=>{
 const result=await retrieve(['interatomic potentials'],false,input,async url=>{const u=new URL(url);if(u.hostname==='api.openalex.org')throw new Error('rate limited');assert.equal(u.searchParams.get('query'),'interatomic potentials');assert.ok(u.searchParams.get('filter')?.includes('has-abstract:true'));return {message:{items:[{DOI:'10.1/real',title:['Machine learning potentials'],abstract:'<jats:p>'+('Real abstract text. '.repeat(12))+'</jats:p>',published:{'date-parts':[[2024]]},author:[{given:'A',family:'Author'}],'container-title':['Journal']},{DOI:'10.1/old',title:['Old study'],abstract:'Abstract '.repeat(30),published:{'date-parts':[[2000]]}}]}};},{additional:false});assert.equal(result.papers.length,1);assert.equal(result.papers[0].source,'Crossref');assert.equal(result.papers[0].year,2024);assert.equal(result.papers[0].url,'https://doi.org/10.1/real');assert.equal(result.successfulRequests,1);assert.equal(result.failedRequests,1);
});
