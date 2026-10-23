import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
function load(file){const mod={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('module','exports','require',code)(mod,mod.exports,name=>load(path.resolve(path.dirname(file),name+'.ts')));return mod.exports;}
const {moveDiscoveryRecord}=load('app/lib/discovery-move.ts');
function fixture() {
 let org={arrangement:'artist',systemId:'mine',systems:[{id:'mine',name:'Mine',bins:[{id:'one',label:'One'},{id:'two',label:'Two'}],assignments:{other:'two'}}]};
 let writes=0,finishes=0;
 const input={albumId:'record',destination:{systemId:'mine',binId:'one'},read:()=>org,write:value=>{writes++;org=value;},finish:async()=>{finishes++;return 'saved';}};
 return {input,get org(){return org},get writes(){return writes},get finishes(){return finishes}};
}
test('filing persists before source removal and preserves unrelated assignments',async()=>{
 const f=fixture();f.input.finish=async()=>{assert.equal(f.org.systems[0].assignments.record,'one');return 'saved';};
 assert.deepEqual(await moveDiscoveryRecord(f.input),{status:'complete',value:'saved'});
 assert.equal(f.org.systems[0].assignments.other,'two');assert.equal(f.writes,1);
});
test('failed personal persistence never removes source',async()=>{
 const f=fixture();f.input.write=()=>{throw Error('quota');};
 await assert.rejects(moveDiscoveryRecord(f.input),/quota/);assert.equal(f.finishes,0);
 f.input.write=()=>{};await assert.rejects(moveDiscoveryRecord(f.input),/confirm filing/);assert.equal(f.finishes,0);
});
test('missing destination leaves source and organization unchanged',async()=>{
 const f=fixture();f.input.destination.binId='missing';await assert.rejects(moveDiscoveryRecord(f.input),/no longer exists/);assert.equal(f.writes,0);assert.equal(f.finishes,0);
});
test('partial move retries only removal, preserving later personal changes',async()=>{
 const f=fixture();let fail=true;
 f.input.finish=async()=>{if(fail)throw Error('storage failed');return 'saved';};
 const result=await moveDiscoveryRecord(f.input);assert.equal(result.status,'filed');assert.equal(f.org.systems[0].assignments.record,'one');
 f.org.systems[0].assignments.record='two';await assert.rejects(result.retry(),/storage failed/);
 fail=false;assert.equal(await result.retry(),'saved');assert.equal(f.writes,1);assert.equal(f.org.systems[0].assignments.record,'two');
});
