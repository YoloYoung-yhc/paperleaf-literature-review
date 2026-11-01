import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chat,testConnection,OutputTruncatedError} from '../lib/provider';
import type {safeRequest} from '../lib/network';
const provider={baseUrl:'https://example.com/v1',apiKey:'fixture-key',model:'fixture'};
const response=(finish:string,content:string|null,reasoning?:string)=>({status:200,text:JSON.stringify({choices:[{finish_reason:finish,message:{content,reasoning_content:reasoning}}]})});
test('writing never sends site-controlled token caps, even with a legacy budget',async()=>{
 for(const budget of [800,5000,10000,50000]){
  assert.equal(await chat(provider,'JSON only','test',budget,async(_u,o)=>{const body=JSON.parse(o!.body!);assert.equal('max_tokens' in body,false);assert.equal('max_completion_tokens' in body,false);assert.equal('max_output_tokens' in body,false);return response('stop','{"ok":true}');}),'{"ok":true}');
 }
});
test('provider truncation is typed and never accepted or retried unchanged',async()=>{
 let calls=0;const transport:typeof safeRequest=async()=>{calls++;return response('length','{"incomplete":','thinking');};
 await assert.rejects(()=>chat(provider,'JSON only','test',4000,transport),OutputTruncatedError);assert.equal(calls,1);
});
test('authentication failures are not retried',async()=>{
 let calls=0;await assert.rejects(()=>chat(provider,'x','x',4000,async()=>{calls++;return {status:401,text:'denied'};}),/认证失败/);assert.equal(calls,1);
});
test('connection probe stays tiny and accepts reasoning budget exhaustion',async()=>{
 let calls=0;await testConnection(provider,async(_u,o)=>{calls++;assert.equal(JSON.parse(o!.body!).max_tokens,64);return response('length',null,'thinking');});assert.equal(calls,1);
});
test('never accepts reasoning-only content as a completed review response',async()=>{
 await assert.rejects(()=>chat(provider,'x','x',4000,async()=>response('stop',null,'thinking')),/没有返回正文/);
});
