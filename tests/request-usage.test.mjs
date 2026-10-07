import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const testModule={exports:{}};
vm.runInThisContext(`(function(module,exports){${ts.transpileModule(fs.readFileSync('app/lib/request-usage.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText}\n})`)(testModule,testModule.exports);
const {observeRequestUsage,parseUsage}=testModule.exports;
test('usage counts cumulative streamed attempts once without changing split UTF-8 payloads',async()=>{
 const payload=[{type:'usage',usage:{import:1}},{type:'progress',album:{title:'Écho'}},{type:'usage',usage:{import:2}},{type:'complete',usage:{import:2}}].map(JSON.stringify).join('\n');
 const bytes=new TextEncoder().encode(payload),counts=[];
 const response=new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}}),{headers:{'content-type':'application/x-ndjson'}});
 assert.equal(await observeRequestUsage(response,value=>counts.push(value)).text(),payload);
 assert.equal(counts.reduce((total,value)=>total+value.import,0),2);
 assert.deepEqual(parseUsage({import:-1,metadata:Infinity,search:3.5,playback:2,token:'private'}),{import:0,metadata:0,search:0,playback:2});
});
test('JSON usage headers include failures and metric exceptions never disrupt responses',async()=>{
 const counts=[];const response=Response.json({error:'limited'},{status:429,headers:{'X-Spotify-Usage':JSON.stringify({playback:2})}});
 const observed=observeRequestUsage(response,value=>counts.push(value));
 assert.equal(observed.status,429);assert.deepEqual(await observed.json(),{error:'limited'});assert.equal(counts[0].playback,2);
 const safe=observeRequestUsage(Response.json({accepted:true},{headers:{'X-Spotify-Usage':'{"search":1}'}}),()=>{throw Error('Disk full');});
 assert.deepEqual(await safe.json(),{accepted:true});
});
test('cancelling an observed import still cancels the upstream request',async()=>{
 let cancelled=false;
 const original=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"type":"usage","usage":{"metadata":1}}\n'));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/x-ndjson'}});
 const counts=[],reader=observeRequestUsage(original,v=>counts.push(v)).body.getReader();
 await reader.read();await reader.cancel();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(cancelled,true);assert.equal(counts[0].metadata,1);
});
