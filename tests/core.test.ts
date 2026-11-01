import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isPublicIP,validateEndpoint} from '../lib/network';
import {restoreAbstract,dedupe} from '../lib/literature';
import {pipeline,validQuote,validateParagraphs} from '../lib/generation';
import {checkOrigin} from '../lib/http';
import {inputSchema} from '../lib/validation';
import {wordDocument} from '../lib/export';
import type {Job,Paper} from '../lib/types';
const abstract='This study compares teaching methods and reports differences between student groups. The findings require further validation in larger samples.';
const papers:Paper[]=Array.from({length:3},(_,i)=>({id:'P'+(i+1),title:'A real fixture study '+(i+1),authors:['A. Author'],year:2024,journal:'Test journal',url:'https://example.org/'+i,abstract,doi:'10.0000/test'+i,source:'Test fixture'}));
function job(language:'zh'|'en'='zh'):Job{return {id:'a'.repeat(32),tokenHash:createHash('sha256').update('secret').digest('hex'),input:{topic:'Education research',language,words:3000,count:15,fromYear:2020,toYear:2026,requirements:''},status:'running',stage:'',progress:0,createdAt:Date.now(),expiresAt:Date.now()+3600000,papers:[],evidence:[],warnings:[]};}
function services(badCitation=false,unsupported=false){return {retrieve:async()=>({papers:structuredClone(papers),warnings:[]}),enhanceFullText:async()=>{},chat:async(_p:unknown,_s:string,prompt:string)=>{
 if(prompt.startsWith('Turn this'))return JSON.stringify({queries:['teaching methods'],biomedical:false});
 if(prompt.startsWith('Broaden this'))return JSON.stringify({queries:['teaching methods']});
 if(prompt.startsWith('Choose up'))return JSON.stringify({ids:['P1','P2','P3']});
 if(prompt.startsWith('Extract one'))return JSON.stringify({cards:papers.map(p=>({paperId:p.id,summary:'Methods differ; further validation needed.',quote:abstract,basis:'abstract'}))});
 if(prompt.startsWith('Create a SHORT'))return JSON.stringify({title:'Teaching methods',keywords:['Education'],headings:['Introduction','Comparison','Conclusion']});
 if(prompt.startsWith('Write section'))return JSON.stringify({paragraphs:[{text:'不同教学方法可能存在差异，但需要进一步验证。',citations:[badCitation?'P999':'P1']},{text:'Differences require further validation.',citations:['P2','P3']}]});
 if(prompt.startsWith('Audit each'))return JSON.stringify({unsupported:unsupported?[0]:[]});
 throw new Error('Unexpected prompt');
}};}
function unzipFile(zip:Buffer,name:string):string{let offset=0;while(offset<zip.length-46){if(zip.readUInt32LE(offset)!==0x02014b50){offset++;continue;}const len=zip.readUInt16LE(offset+28),extra=zip.readUInt16LE(offset+30),comment=zip.readUInt16LE(offset+32);if(zip.subarray(offset+46,offset+46+len).toString()===name){const local=zip.readUInt32LE(offset+42),compressed=zip.readUInt32LE(offset+20),start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);const data=zip.subarray(start,start+compressed);return zip.readUInt16LE(offset+10)===8?inflateRawSync(data).toString():data.toString();}offset+=46+len+extra+comment;}throw new Error('ZIP entry missing');}
test('blocks private, mapped, link-local and reserved addresses',async()=>{for(const ip of ['127.0.0.1','10.0.1.2','172.16.0.1','192.168.1.1','169.254.169.254','0.0.0.0','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1'])assert.equal(isPublicIP(ip),false,ip);assert.equal(isPublicIP('8.8.8.8'),true);assert.equal(isPublicIP('2606:4700:4700::1111'),true);for(const url of ['http://example.com','https://user:pass@example.com','https://127.0.0.1','https://[::1]','https://example.com:8443','https://example.com/?secret=1'])await assert.rejects(()=>validateEndpoint(url));});
test('restores abstracts and deduplicates by DOI/title',()=>{assert.equal(restoreAbstract({world:[1],Hello:[0]}),'Hello world');assert.equal(dedupe([papers[0],{...papers[0],abstract:''}]).length,1);});
test('validates limits, years, exact quotes and citation IDs',()=>{assert.equal(inputSchema.safeParse({...job().input,fromYear:2027,toYear:2020}).success,false);assert.equal(validQuote(abstract,abstract),true);assert.equal(validQuote('Invented result not in the original abstract.',abstract),false);assert.equal(validateParagraphs([{text:'X',citations:['made-up']}],new Set(['P1'])),false);});
for(const lang of ['zh','en'] as const)test(`complete ${lang} pipeline and real DOCX package`,async()=>{const j=job(lang);let saves=0;await pipeline(j,{baseUrl:'https://example.com/v1',apiKey:'NEVER-SAVE-THIS',model:'fixture'},async()=>{saves++;},services(false,true));assert.ok(saves>=6);assert.equal(j.review?.sections.length,3);assert.ok(j.review?.sections.every(s=>s.paragraphs.length===1));assert.equal(j.papers.length,2);assert.ok(j.warnings.some(w=>w.includes('实际纳入')));const buf=await wordDocument(j);assert.equal(buf.subarray(0,2).toString(),'PK');const xml=unzipFile(buf,'word/document.xml');assert.ok(xml.includes('Teaching methods'));assert.ok(xml.includes('[1]'));assert.ok(xml.includes('[2]'));assert.ok(!xml.includes('[3]'));assert.ok(!xml.includes('NEVER-SAVE-THIS'));assert.ok(unzipFile(buf,'word/_rels/document.xml.rels').includes('https://example.org/1'));});
test('rejects a fabricated citation rather than exporting it',async()=>{await assert.rejects(()=>pipeline(job(),{baseUrl:'https://example.com',apiKey:'x',model:'x'},async()=>{},services(true)),/引用/);});
test('reports insufficient literature without asking model to invent it',async()=>{const svc=services();svc.retrieve=async()=>({papers:[],warnings:[]});await assert.rejects(()=>pipeline(job(),{baseUrl:'https://example.com',apiKey:'x',model:'x'},async()=>{},svc),/不足/);});
test('task access isolation, expiry, restart and rate limits',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'paperleaf-test-'));process.env.DATA_DIR=dir;const {saveJob,getJob,rateLimit}=await import('../lib/jobs');try{const j=job();j.status='completed';await saveJob(j);assert.equal((await getJob(j.id,'secret')).status,'completed');await assert.rejects(()=>getJob(j.id,'wrong'),/凭证/);assert.ok(!(await readFile(path.join(dir,j.id+'.json'),'utf8')).includes('apiKey'));j.status='running';await saveJob(j);assert.equal((await getJob(j.id,'secret')).status,'failed');j.expiresAt=Date.now()-100;await saveJob(j);await assert.rejects(()=>getJob(j.id,'secret'),/过期/);rateLimit('test-isolated',1);assert.throws(()=>rateLimit('test-isolated',1),/频繁/);}finally{await rm(dir,{recursive:true,force:true});}});

test('same-site Origin uses actual Host when Next rewrites the internal URL',()=>{
 const req=(origin:string,host='127.0.0.1:3000')=>new Request('http://localhost:3000/api/provider/test',{headers:{origin,host}});
 assert.doesNotThrow(()=>checkOrigin(req('http://127.0.0.1:3000')));
 assert.doesNotThrow(()=>checkOrigin(req('http://localhost:3000','localhost:3000')));
 for(const origin of ['http://evil.example','http://localhost:3000','null','http://127.0.0.1:3001','http://127.0.0.1:3000.evil.example','https://127.0.0.1:3000'])assert.throws(()=>checkOrigin(req(origin)),/本站/);
 assert.throws(()=>checkOrigin(new Request('http://localhost:3000',{headers:{origin:'https://evil.example',host:'127.0.0.1:3000','x-forwarded-host':'evil.example','x-forwarded-proto':'https'}})),/本站/);
});
test('explicit production origin remains pinned behind a proxy',()=>{
 const previous=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://review.example.com';
 try{
  assert.doesNotThrow(()=>checkOrigin(new Request('http://localhost:3000/api/reviews',{headers:{origin:'https://review.example.com',host:'internal:3000'}})));
  assert.throws(()=>checkOrigin(new Request('http://localhost:3000/api/reviews',{headers:{origin:'https://evil.example',host:'evil.example'}})),/本站/);
 }finally{if(previous===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previous;}
});

test('full pipeline recovers from selection truncation without repeating retrieval',async()=>{
 const {chat:providerChat}=await import('../lib/provider');
 const fixture=services();let retrievals=0,selectionCalls=0;
 const svc={...fixture,retrieve:async()=>{retrievals++;return fixture.retrieve();},chat:async(p:Parameters<typeof providerChat>[0],system:string,prompt:string,tokens=4000)=>providerChat(p,system,prompt,tokens,async(_url,options)=>{
  const body=JSON.parse(options!.body!);const requestPrompt=body.messages[1].content as string;
  if(requestPrompt.startsWith('Choose up')&&++selectionCalls===1)return {status:200,text:JSON.stringify({choices:[{finish_reason:'length',message:{content:null,reasoning_content:'fixture reasoning'}}]})};
  const content=await fixture.chat(p,system,requestPrompt);
  return {status:200,text:JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]})};
 })};
 const j=job();await pipeline(j,{baseUrl:'https://example.com',apiKey:'fixture',model:'fixture'},async()=>{},svc);
 assert.ok(j.review);assert.equal(retrievals,1);assert.equal(selectionCalls,2);
});

test('evidence uses exact sources without a model call; outline truncation falls back safely',async()=>{
 const {OutputTruncatedError}=await import('../lib/provider');const fixture=services();let evidenceCalls=0;const j=job();
 await pipeline(j,{baseUrl:'https://example.com',apiKey:'fixture',model:'fixture'},async()=>{}, {...fixture,chat:async(p,s,prompt)=>{if(prompt.startsWith('Extract one')){evidenceCalls++;throw new Error('Evidence must not require generation');}if(prompt.startsWith('Create a SHORT'))throw new OutputTruncatedError();return fixture.chat(p,s,prompt);}});
 assert.equal(evidenceCalls,0);assert.ok(j.review);assert.equal(j.review.sections.length,5);assert.ok(j.warnings.some(w=>w.includes('标准叙述性综述结构')));assert.ok(j.evidence.every(e=>validQuote(e.quote,papers.find(p=>p.id===e.paperId)!.abstract)));
});
test('truncated long chapters split into complete short parts without losing other sections',async()=>{
 const {OutputTruncatedError}=await import('../lib/provider');const fixture=services();const j=job();let splitCalls=0;
 await pipeline(j,{baseUrl:'https://example.com',apiKey:'fixture',model:'fixture'},async()=>{}, {...fixture,chat:async(p,s,prompt)=>{if(prompt.startsWith('Write section')){if(!prompt.includes('Write only ONE short paragraph'))throw new OutputTruncatedError();splitCalls++;}return fixture.chat(p,s,prompt);}});
 assert.ok(splitCalls>=6);assert.ok(j.review);assert.ok(j.review.sections.every(s=>s.paragraphs.length>0));assert.ok(j.warnings.some(w=>w.includes('自动拆成')));
});
