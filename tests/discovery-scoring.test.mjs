import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
function load(file){const mod={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('module','exports','require',code)(mod,mod.exports,name=>load(path.resolve(path.dirname(file),name+'.ts')));return mod.exports;}
const {scoreDiscovery}=load('app/lib/discovery-scoring.ts');
const {generateDiscovery}=load('app/lib/discovery-generator.ts');
const {checkedDiscoverySnapshot}=load('app/lib/discovery-snapshot.ts');
const day=86400000,now=200*day,accountId='a'.repeat(64);
const album=i=>({id:`spotify:a${i}`,source:'spotify',artist:'Artist',artists:[{id:'artist',name:'Artist'}],playback:{kind:'spotify',uri:`spotify:album:a${i}`}});
function fixture(n=60){const albums=Array.from({length:n},(_,i)=>album(i));return{id:'test',accountId,now,albums,membership:albums.map(a=>({albumId:a.id,saved:true,checkedAt:now,source:'spotify-library-contains'})),events:[],behavioral:true,random:()=>.5};}
const event=(type,n,age=40,albumId='spotify:a0')=>({type,id:`${type}:${n}`,sessionId:`s${n}`,albumId,userId:accountId,timestamp:now-age*day});
const session=(overrides={})=>({version:1,id:'s0',userId:accountId,albumId:'spotify:a0',startedAt:now-40*day,updatedAt:now-40*day+100000,endedAt:null,listenedSeconds:50,albumDurationSeconds:100,covered:[[0,50]],completionRatio:.5,completedAt:null,revision:1,...overrides});
test('bounded interpretable scores include inspections, frequency, verified duration and recency',()=>{
 const f=fixture(2);f.events=[event('album_inspected',1),event('album_play_started',0)];f.sessions=[session(),session({revision:2,listenedSeconds:60,covered:[[0,60]],completionRatio:.6})];
 const [a,b]=scoreDiscovery(f);assert.equal(a.inspections,1);assert.equal(a.plays,1);assert.equal(a.listening,.6);assert.ok(a.behavior>b.behavior);assert.ok(a.digging<b.digging);
 const recent=scoreDiscovery({...f,sessions:[],events:[event('album_inspected',1,0),event('album_play_started',0,0)]})[0];
 const old=scoreDiscovery({...f,sessions:[]})[0];assert.ok(recent.wander<old.wander);assert.ok(recent.digging<old.digging);
});
test('duplicate/foreign/future/invalid observations do not inflate evidence',()=>{
 const f=fixture(1),e=event('album_completed',1);
 const normal=scoreDiscovery({...f,events:[e],sessions:[session()]});
 const duplicate=scoreDiscovery({...f,events:[e,e,{...e,id:'another'},event('album_completed',2,-1),{...e,id:'foreign',userId:'b'.repeat(64)}],sessions:[session(),session(),session({id:'bad',listenedSeconds:NaN}),session({id:'foreign',userId:'b'.repeat(64)}),session({id:'future',updatedAt:now+1})]});
 assert.deepEqual(duplicate,normal);assert.equal(normal[0].forgottenEligible,false);
});
test('personal membership is optional, bounded and does not infer meaning from labels',()=>{
 const f=fixture(2),system={id:'s',name:'anything',bins:[{id:'b',label:'Dislike?'}],assignments:{'spotify:a0':'b','spotify:a1':'missing'}};
 const base=scoreDiscovery(f),filed=scoreDiscovery({...f,systems:[system,system]});
 assert.equal(filed[0].personalBin,true);assert.equal(filed[1].personalBin,false);assert.ok(filed[0].wander>base[0].wander);assert.equal(filed[0].forgottenEligible,false);assert.equal(filed[0].digging,base[0].digging);
 assert.deepEqual(filed,scoreDiscovery({...f,systems:[{...system,bins:[{id:'b',label:'Favorites'}]}]}));
});
test('weights are configurable and invalid configurations fail explicitly',()=>{
 const f={...fixture(1),events:[event('album_inspected',1)]};
 assert.ok(scoreDiscovery({...f,weights:{inspection:2}})[0].behavior>scoreDiscovery(f)[0].behavior);
 for(const weights of [{play:-1},{completion:NaN},{halfLifeDays:0},{forgottenDays:0},{minimumCompletions:0},{minimumCompletions:1.5}])assert.throws(()=>scoreDiscovery({...f,weights}));
});
test('forgotten ranks historical engagement and enforces quiet period',()=>{
 const f=fixture();f.events=[event('album_completed',1),event('album_completed',2),event('album_completed',3,40,'spotify:a1'),event('album_completed',4,40,'spotify:a1'),event('album_completed',5,40,'spotify:a1')];
 const bins=generateDiscovery(f).bins;assert.equal(bins[0].albumIds[0],'spotify:a1');
 f.events.push(event('album_inspected',9,1,'spotify:a1'));assert.deepEqual(generateDiscovery(f).bins[0].albumIds,['spotify:a0']);
});
test('Wander responds to behavior while Digging keeps underexplored records and membership exclusion',()=>{
 const f=fixture();f.events=[event('album_play_started',0,30,'spotify:a59')];let inspected;
 const result=generateDiscovery({...f,inspect:rows=>{inspected=rows;}});
 assert.equal(result.version,'behavioral-1');assert.equal(result.bins[1].albumIds[0],'spotify:a59');assert.ok(!result.bins[2].albumIds.includes('spotify:a59'));assert.equal(inspected.length,60);
 f.membership[59].saved=false;assert.ok(!generateDiscovery(f).bins.flatMap(b=>b.albumIds).includes('spotify:a59'));
});
test('no-history selection preserves cold-start diversity, caps, small-library behavior and no overlap',()=>{
 for(const n of [0,1,3,60,100]){
  const f=fixture(n);f.albums=f.albums.map((a,i)=>({...a,artists:[{id:`artist${i%10}`,name:`Artist ${i%10}`}]}));
  const cold=generateDiscovery({...f,behavioral:false}),ranked=generateDiscovery(f);
  assert.deepEqual(ranked.bins,cold.bins);const ids=ranked.bins.flatMap(b=>b.albumIds);assert.equal(new Set(ids).size,ids.length);assert.ok(ranked.bins.every(b=>b.albumIds.length<=20));
  for(const version of ['framework-1','cold-start-1','behavioral-1'])assert.equal(checkedDiscoverySnapshot({...ranked,version},accountId).version,version);
 }
});
