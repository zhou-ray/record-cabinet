import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
function load(file){const mod={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('module','exports','require',code)(mod,mod.exports,name=>load(path.resolve(path.dirname(file),name+'.ts')));return mod.exports;}
const {checkedDiscoveryFeedback,mergeDiscoveryFeedback,applyDiscoveryFeedback}=load('app/lib/discovery-feedback.ts');
const {generateDiscovery}=load('app/lib/discovery-generator.ts');
const {createPersonalizationExport}=load('app/lib/personalization-export.ts');
const account='a'.repeat(64),now=100000;
const feedback={userId:account,albumId:'spotify:a',bin:'wander',snapshotId:'set',action:'remove',timestamp:now};
test('feedback is allowlisted, account scoped, idempotent and latest per album/bin',()=>{
 assert.deepEqual(checkedDiscoveryFeedback({...feedback,token:'secret'},account),feedback);
 let rows=mergeDiscoveryFeedback([],feedback,account);rows=mergeDiscoveryFeedback(rows,feedback,account);assert.equal(rows.length,1);
 const move={...feedback,action:'move',timestamp:now+1,destination:{systemId:'my-system',binId:'my-bin'}};
 rows=mergeDiscoveryFeedback(rows,move,account);assert.deepEqual(rows,[move]);assert.deepEqual(mergeDiscoveryFeedback(rows,feedback,account),rows);
 assert.throws(()=>checkedDiscoveryFeedback({...feedback,userId:'b'.repeat(64)},account));
 assert.throws(()=>checkedDiscoveryFeedback({...feedback,action:'move'},account));
 assert.throws(()=>mergeDiscoveryFeedback(rows,{...move,destination:{systemId:'different',binId:'bin'}},account));
});
test('removal touches only the source bin, without refilling or mutating input',()=>{
 const snapshot={id:'set',accountId:account,bins:[{type:'wander',albumIds:['spotify:a','spotify:b']},{type:'digging',albumIds:['spotify:c']}]};
 const result=applyDiscoveryFeedback(snapshot,feedback);assert.deepEqual(result.bins[0].albumIds,['spotify:b']);assert.deepEqual(result.bins[1],snapshot.bins[1]);assert.equal(snapshot.bins[0].albumIds.length,2);
 assert.throws(()=>applyDiscoveryFeedback({...snapshot,id:'new'},feedback));
});
test('future generation excludes only the relevant bin, not the album globally',()=>{
 const albums=['a','b','c','d'].map(id=>({id:`spotify:${id}`,source:'spotify',artist:'Artist',artists:[],playback:{kind:'spotify',uri:`spotify:album:${id}`}}));
 const input={id:'new',accountId:account,now,albums,membership:albums.map(a=>({albumId:a.id,saved:true,checkedAt:now,source:'spotify-library-contains'})),events:[],behavioral:true,random:()=>.5};
 const removals=albums.map(a=>({...feedback,albumId:a.id}));
 const output=generateDiscovery({...input,feedback:removals});assert.equal(output.bins[1].albumIds.length,0);assert.ok(output.bins[2].albumIds.length>0);
 assert.deepEqual(generateDiscovery({...input,feedback:removals.map(r=>({...r,userId:'b'.repeat(64)}))}),generateDiscovery(input));
 assert.deepEqual(generateDiscovery({...input,feedback:removals.map(r=>({...r,timestamp:now+1}))}),generateDiscovery(input));
});
test('feedback export includes decisions and destinations without account/unknown fields',()=>{
 const move={...feedback,action:'move',destination:{systemId:'system',binId:'bin',token:'secret'}};
 const result=createPersonalizationExport({accountId:account,exportedAt:now,albums:[],organization:{arrangement:'artist',systemId:'',systems:[]},events:[],sessions:[],feedback:[move]});
 assert.equal(result.generatedBins.feedback[0].action,'move');assert.deepEqual(result.generatedBins.feedback[0].destination,{systemId:'system',binId:'bin'});assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes(account));
});

test('filing keeps the current snapshot and does not exclude future assignments',()=>{
 const filed={...feedback,action:'file',destination:{systemId:'system',binId:'bin'}};
 assert.deepEqual(checkedDiscoveryFeedback(filed,account),filed);
 const snapshot={id:'set',accountId:account,bins:[{type:'wander',albumIds:['spotify:a']}]};
 assert.equal(applyDiscoveryFeedback(snapshot,filed),snapshot);
 const albums=['a','b','c','d'].map(id=>({id:`spotify:${id}`,source:'spotify',artist:'Artist',artists:[],playback:{kind:'spotify',uri:`spotify:album:${id}`}}));
 const input={id:'new',accountId:account,now,albums,membership:albums.map(a=>({albumId:a.id,saved:true,checkedAt:now,source:'spotify-library-contains'})),events:[],behavioral:true,random:()=>.5};
 assert.deepEqual(generateDiscovery({...input,feedback:[filed]}),generateDiscovery(input));
 assert.throws(()=>checkedDiscoveryFeedback({...filed,destination:undefined},account));
});
