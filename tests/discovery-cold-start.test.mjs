import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
function load(file) {
 const compiled={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('module','exports','require',code)(compiled,compiled.exports,name=>load(path.resolve(path.dirname(file),name+'.ts')));
 return compiled.exports;
}
const {generateDiscovery}=load('app/lib/discovery-generator.ts');
const {checkedDiscoverySnapshot,visibleDiscoveryBins}=load('app/lib/discovery-snapshot.ts');
const accountId='a'.repeat(64),now=100*86400000;
const random=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
function fixture(groups) {
 const albums=groups.flatMap((count,g)=>Array.from({length:count},(_,i)=>({id:`spotify:g${g}a${i}`,source:'spotify',artist:`Artist ${g}`,artists:[{id:`artist${g}`,name:`Artist ${g}`}],playback:{kind:'spotify',uri:`spotify:album:g${g}a${i}`}})));
 return {id:'cold',accountId,now,albums,membership:albums.map(a=>({albumId:a.id,saved:true,checkedAt:now,source:'spotify-library-contains'})),events:[],random:random(7)};
}
const ids=s=>s.bins.flatMap(b=>b.albumIds);
const event=(albumId,type,i,timestamp=now-86400000)=>({id:`${albumId}:${type}:${i}`,albumId,type,sessionId:`s${i}`,timestamp,userId:accountId});
test('cold start balances a dominant artist, uses only saved records and varies across seeds',()=>{
 const f=fixture([100,...Array(19).fill(1)]),before=structuredClone({...f,random:null});
 const sets=[];
 for(let seed=1;seed<=20;seed++){
  const s=generateDiscovery({...f,random:random(seed)});
  assert.equal(s.version,'cold-start-1');assert.deepEqual(s.bins.map(b=>b.albumIds.length),[0,20,20]);
  assert.equal(new Set(s.bins[1].albumIds.map(id=>id.split('a')[0])).size,20,'each artist represented once where possible');
  assert.equal(new Set(ids(s)).size,40);sets.push(s.bins[1].albumIds.join());
 }
 assert.ok(new Set(sets).size>1);assert.deepEqual({...f,random:null},before);
 f.membership[0].saved=false;f.membership[1].checkedAt=now-7*86400000;f.membership[2].checkedAt=now+1;
 const filtered=generateDiscovery(f);assert.ok(ids(filtered).every(id=>!f.albums.slice(0,3).some(a=>a.id===id)));
});
test('small, empty and single-artist libraries fill honestly without duplicates',()=>{
 for(const count of [0,1,2,3,10,39,40,100]){
  const f=fixture([count]),s=generateDiscovery(f);
  assert.equal(s.bins[0].albumIds.length,0);
  assert.equal(new Set(ids(s)).size,Math.min(count,40));
  assert.ok(s.bins.every(b=>b.albumIds.length<=20));
  if(count>=2)assert.ok(s.bins[1].albumIds.length&&s.bins[2].albumIds.length);
 }
});
test('Digging prioritizes untouched, then inspected-only, then fewer plays among unassigned records',()=>{
 const f=fixture([100]);
 for(let i=20;i<100;i++){
  const id=f.albums[i].id;
  for(let j=0;j<(i<50?1:3);j++)f.events.push(event(id,'album_inspected',j));
  if(i>=70)for(let j=0;j<(i<85?1:4);j++)f.events.push(event(id,'album_play_started',j));
 }
 const s=generateDiscovery(f),wander=new Set(s.bins[1].albumIds);
 const rank=id=>{const i=f.albums.findIndex(a=>a.id===id);return i<20?0:i<50?1:i<70?2:i<85?3:4;};
 const ranks=s.bins[2].albumIds.map(rank);assert.deepEqual(ranks,[...ranks].sort((a,b)=>a-b));
 const skipped=f.albums.filter(a=>!wander.has(a.id)&&!s.bins[2].albumIds.includes(a.id));
 assert.ok(skipped.every(a=>rank(a.id)>=Math.max(...ranks)));
 // With a thin unexplored pool, Wander must leave space for Digging.
 const thin=fixture([10]);thin.events=thin.albums.slice(1).map((a,i)=>event(a.id,'album_completed',i));
 assert.deepEqual(generateDiscovery(thin).bins[2].albumIds,[thin.albums[0].id]);
});
test('sparse, duplicate, foreign and recent history do not manufacture forgotten favorites',()=>{
 const f=fixture([80]);const id=f.albums[0].id,old=now-40*86400000;
 const complete=event(id,'album_completed',1,old);
 f.events=[complete,complete,{...event(id,'album_completed',2,old),userId:'b'.repeat(64)}];
 assert.equal(generateDiscovery(f).bins[0].albumIds.length,0);
 f.events.push(event(id,'album_completed',2,old));assert.deepEqual(generateDiscovery(f).bins[0].albumIds,[id]);
 f.events.push(event(id,'album_inspected',1,now));assert.equal(generateDiscovery(f).bins[0].albumIds.length,0);
 // Favorites overflow remains available to Wander, never disappears from all pools.
 f.events=f.albums.flatMap((a,i)=>[event(a.id,'album_completed',i*2,old),event(a.id,'album_completed',i*2+1,old)]);
 assert.deepEqual(generateDiscovery(f).bins.map(b=>b.albumIds.length),[20,20,0]);
});
test('primary artist IDs, missing metadata and old snapshots remain supported',()=>{
 const f=fixture([10,10,10,10]);
 f.albums.forEach(a=>a.artists.push({id:'shared-credit',name:'Shared collaborator'}));
 const s=generateDiscovery(f);assert.equal(new Set(s.bins[1].albumIds.map(id=>id.split('a')[0])).size,4);
 const old={...s,version:'framework-1'};assert.deepEqual(checkedDiscoverySnapshot(old,accountId),old);
 assert.deepEqual(visibleDiscoveryBins(old,f.albums,f.membership,now),old.bins);
 f.albums.forEach(a=>{a.artists=[];a.artist='';});assert.equal(ids(generateDiscovery(f)).length,40);
});
