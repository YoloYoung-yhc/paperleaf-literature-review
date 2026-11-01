import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchArxiv,searchSemanticScholar,searchBohrium,type CatalogIO} from '../lib/catalogs';
import {balancedPapers,dedupe} from '../lib/literature';
import {providerSchema} from '../lib/validation';
import type {ReviewInput,Paper} from '../lib/types';
const input:ReviewInput={topic:'machine learning potentials',language:'zh',words:3000,count:15,fromYear:2021,toYear:2026,requirements:''};
const abstract='An actual original research abstract about machine learning potentials. '.repeat(4);
const noJSON:CatalogIO['json']=async()=>{throw new Error('unexpected request');};
test('arXiv maps Atom metadata, keeps date bounds, labels preprints and links to records',async()=>{
 const result=await searchArxiv(['machine learning potentials'],input,{json:noJSON,text:async(url)=>{const u=new URL(url);assert.ok(u.searchParams.get('search_query')?.includes('202101010000'));return {status:200,text:`<feed xmlns:arxiv="http://arxiv.org/schemas/atom"><entry><id>http://arxiv.org/abs/2401.12345v2</id><title>Potentials</title><published>2024-01-02</published><summary>${abstract}</summary><author><name>A Author</name></author><arxiv:doi>10.1234/potentials</arxiv:doi></entry><entry><id>http://arxiv.org/abs/2001.12345</id><title>Old</title><published>2020-01-02</published><summary>${abstract}</summary></entry></feed>`};}});
 assert.equal(result.papers.length,1);assert.equal(result.papers[0].arxivId,'2401.12345');assert.equal(result.papers[0].doi,'10.1234/potentials');assert.equal(result.papers[0].url,'https://arxiv.org/abs/2401.12345v2');assert.match(result.papers[0].source,/预印本/);assert.deepEqual(result.papers[0].authors,['A Author']);
});
test('Semantic Scholar maps DOI, authors and original abstracts; missing abstracts are excluded',async()=>{
 const result=await searchSemanticScholar(['interatomic potentials'],input,{text:async()=>{throw new Error('unexpected request');},json:async url=>{const u=new URL(url);assert.equal(u.searchParams.get('year'),'2021:2026');return {data:[{paperId:'s1',title:'Potentials',year:2024,abstract,authors:[{name:'A Author'}],venue:'Journal',externalIds:{DOI:'10.1234/potential',ArXiv:'2401.12345'}},{paperId:'s2',title:'No abstract',year:2024,abstract:null}]};}});
 assert.equal(result.papers.length,1);assert.equal(result.papers[0].source,'Semantic Scholar');assert.equal(result.papers[0].doi,'10.1234/potential');
});
test('Bohrium requires its own key, uses fixed official endpoint and never puts credentials in results',async()=>{
 const secret='bohr-fixture-not-real';const result=await searchBohrium(['force fields','machine learning'],input,secret,{json:noJSON,text:async(url,options)=>{assert.equal(url,'https://open.bohrium.com/openapi/v2/paper/rag/pass/keyword');assert.equal(options?.headers?.Authorization,`Bearer ${secret}`);assert.equal(url.includes(secret),false);const body=JSON.parse(options!.body!);assert.equal(body.startTime,'2021-01-01');assert.equal(body.type,0);return {status:200,text:JSON.stringify({code:0,data:[{enName:'Potentials',enAbstract:abstract,doi:'10.1234/bohr',authors:['A Author'],coverDateStart:'2024-02-01',publicationEnName:'Journal'}]})+'\n'+JSON.stringify({trace:'fixture'})};}});
 assert.equal(result.papers.length,1);assert.equal(result.papers[0].source,'Bohrium（玻尔）');assert.ok(!JSON.stringify(result).includes(secret));assert.equal(providerSchema.safeParse({baseUrl:'https://example.com',apiKey:'model-key',model:'model',bohrApiKey:'bad\nkey'}).success,false);
});
test('optional sources fail independently and missing Bohrium credentials make no request',async()=>{
 const io:CatalogIO={json:async()=>{throw new Error('unavailable');},text:async()=>{throw new Error('unavailable');}};
 for(const result of await Promise.all([searchArxiv(['q'],input,io),searchSemanticScholar(['q'],input,io),searchBohrium(['q'],input,'fixture',io)])){assert.equal(result.failedRequests,1);assert.equal(result.papers.length,0);assert.ok(result.warnings.length);}
 assert.equal((await searchBohrium(['q'],input,'',io)).failedRequests,0);
});
test('source balancing prevents large databases crowding out specialist records; duplicates preserve provenance',()=>{
 const p=(title:string,source:string,doi?:string):Paper=>({id:'',title,source,doi,authors:[],year:2024,journal:'',url:'https://example.org',abstract});
 const merged=dedupe(balancedPapers([p('Same','OpenAlex','10.1234/a'),p('Other','OpenAlex'),p('Third','OpenAlex'),p('Same','Crossref','10.1234/a'),p('Preprint','arXiv（预印本）'),p('Bohrium record','Bohrium（玻尔）')]));
 assert.equal(merged.length,5);assert.ok(merged.slice(0,3).some(x=>x.source.includes('arXiv')));assert.deepEqual(merged[0].sources,['OpenAlex','Crossref']);
});
