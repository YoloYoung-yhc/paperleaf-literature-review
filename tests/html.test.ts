import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLocalAPI} from '../standalone/local-api';
import {safeRequest} from '../standalone/network';
import type {Provider} from '../lib/types';
const input={topic:'Teaching research',language:'zh',words:3000,count:5,fromYear:2021,toYear:2026,requirements:''};
test('single HTML embeds all app code, styles and export dependencies',async()=>{
 const html=await readFile('Paperleaf-Literature-Review.html','utf8');assert.ok(html.startsWith('<!doctype html>'));assert.ok(html.includes('paperleafLocalFetch'));assert.ok(html.includes('免费单文件文献综述工具'));assert.ok(!/<script[^>]+src\s*=|<link[^>]+(?:stylesheet|modulepreload)/i.test(html));assert.ok(!/node:dns|node:net|from "undici"/.test(html));
});
test('browser-only task completes, exports real DOCX, isolates access and never persists keys',async()=>{
 const storage=new Map<string,string>();let captured:Provider|undefined;
 const api=createLocalAPI({storage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{storage.set(k,v);}},run:async(job,p,save)=>{captured=p;job.papers=[{id:'P1',title:'Fixture paper',authors:['Author'],year:2024,journal:'Journal',url:'https://example.org/paper',abstract:'An abstract '.repeat(20),source:'Fixture'}];job.review={title:'A review',abstract:'A summary',keywords:['Teaching'],sections:[{title:'Introduction',paragraphs:[{text:'A supported statement.',citations:['P1']}]}]};await save();}});
 const start=await api('/api/reviews',{method:'POST',body:JSON.stringify({input,provider:{baseUrl:'https://example.org/v1',apiKey:'DO-NOT-PERSIST-MODEL-KEY',model:'fixture',bohrApiKey:'DO-NOT-PERSIST-BOHR-KEY'}})});assert.equal(start.status,202);const {id,token}=await start.json();
 await new Promise(resolve=>setTimeout(resolve,30));const headers={Authorization:`Bearer ${token}`};const job=await (await api(`/api/reviews/${id}`,{headers})).json();assert.equal(job.status,'completed');assert.equal('tokenHash' in job,false);
 assert.equal((await api(`/api/reviews/${id}`,{headers:{Authorization:'Bearer wrong'}})).status,404);
 const doc=await api(`/api/reviews/${id}/download`,{headers});assert.equal(doc.status,200);const bytes=new Uint8Array(await doc.arrayBuffer());assert.equal(String.fromCharCode(...bytes.slice(0,2)),'PK');assert.equal(captured?.apiKey,'');assert.equal(captured?.bohrApiKey,'');assert.ok(!JSON.stringify([...storage.values()]).includes('DO-NOT-PERSIST'));
 const restored=createLocalAPI({storage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{storage.set(k,v);}}});assert.equal((await (await restored(`/api/reviews/${id}`,{headers})).json()).status,'completed');
});
test('a refresh cannot pretend that an interrupted browser task is still executing',async()=>{
 const saved={job:{id:'abc',status:'running',expiresAt:Date.now()+10000},token:'token'};const api=createLocalAPI({storage:{getItem:()=>JSON.stringify(saved),setItem:()=>{}}});const response=await (await api('/api/reviews/abc',{headers:{Authorization:'Bearer token'}})).json();assert.equal(response.status,'failed');assert.match(response.error,/中断/);
});
test('browser model transport uses direct CORS requests and reports failures without proxying keys',async()=>{
 const calls:string[]=[];const request=mock.method(globalThis,'fetch',async(url:RequestInfo|URL,options?:RequestInit)=>{calls.push(String(url));assert.equal(options?.credentials,'omit');assert.equal(options?.redirect,'error');return new Response('{"ok":true}',{status:200});});
 try{assert.equal((await safeRequest('https://example.org/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer fixture'},body:'{}'})).status,200);assert.deepEqual(calls,['https://example.org/v1/chat/completions']);await assert.rejects(()=>safeRequest('http://example.org'),/HTTPS/);}finally{request.mock.restore();}
 const failure=mock.method(globalThis,'fetch',async()=>{throw new TypeError('Failed to fetch');});try{await assert.rejects(()=>safeRequest('https://example.org'),/CORS/);}finally{failure.mock.restore();}
});
