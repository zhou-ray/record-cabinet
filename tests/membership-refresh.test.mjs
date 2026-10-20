import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function load(name){const compiled={exports:{}};const code=ts.transpileModule(fs.readFileSync(`app/lib/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(dep=>load(dep.slice(2)),compiled,compiled.exports);return compiled.exports;}
const {createMembershipRefresh}=load('membership-refresh');
const {mergeMembership}=load('saved-membership');
const accountId='a'.repeat(64),now=100000;
const album=id=>({id:`spotify:${id}`,source:'spotify',playback:{kind:'spotify',uri:`spotify:album:${id}`}});
function harness(count=81,options={}){
 let records=[],response,epoch=0,failSave=false,loads=0;const calls=[],progress=[];
 const storage={load:async()=>{loads++;return{albums:Array.from({length:count},(_,i)=>album(i))};},loadMembership:async()=>records,
 membershipWriter:async()=>{const captured=epoch;return{save:async(batch,signal)=>{signal.throwIfAborted();if(failSave||captured!==epoch)throw Error('Storage unavailable');records=mergeMembership(records,batch.records);}};}};
 const apiFetch=async(_url,init)=>{const ids=JSON.parse(init.body).membershipAlbumIds;calls.push(ids);return response?response(ids):Response.json({accountId,records:ids.map(albumId=>({albumId,saved:!albumId.endsWith(':1'),checkedAt:now,source:'spotify-library-contains'}))});};
 const runner=createMembershipRefresh({accountId,storage,apiFetch,progress:p=>progress.push(p),now:()=>now,...options});
 return{runner,calls,progress,storage,apiFetch,records:()=>records,loads:()=>loads,respond:fn=>{response=fn;},failSave:()=>{failSave=true;},clear:()=>{epoch++;records=[];}};
}
test('explicit refresh is sequential, capped, resumable and avoids fresh positive and negative checks',async()=>{
 const h=harness(161);assert.equal(h.calls.length,0);
 const first=h.runner.start();assert.equal(h.runner.start(),first);await first;
 assert.deepEqual(h.calls.map(ids=>ids.length),[40,40,40]);assert.equal(h.progress.at(-1).status,'partial');assert.equal(h.records().length,120);
 await h.runner.start();assert.deepEqual(h.calls.map(ids=>ids.length),[40,40,40,40,1]);assert.equal(h.progress.at(-1).status,'complete');assert.equal(h.progress.at(-1).saved,160);
 await h.runner.start();assert.equal(h.calls.length,5);
});
test('cancel ignores a late successful response and explicit resume starts from committed batches',async()=>{
 const h=harness();let resolve;h.respond(()=>new Promise(r=>{resolve=r;}));
 const pending=h.runner.start();while(!resolve)await new Promise(r=>setImmediate(r));
 h.runner.cancel();resolve(Response.json({accountId,records:[]}));await pending;
 assert.equal(h.records().length,0);assert.equal(h.progress.at(-1).status,'cancelled');
 h.respond(null);await h.runner.start();assert.equal(h.records().length,81);
});
test('failed or malformed responses preserve completed progress and never retry automatically',async()=>{
 for(const mode of ['429','network','partial','foreign','future','wrong-id']){
  const h=harness();let n=0;
  h.respond(ids=>{n++;if(n===1)return Response.json({accountId,records:ids.map(albumId=>({albumId,saved:true,checkedAt:now,source:'spotify-library-contains'}))});
   if(mode==='network')throw Error('Network failed');if(mode==='429')return new Response('',{status:429});
   return Response.json({accountId:mode==='foreign'?'b'.repeat(64):accountId,records:(mode==='partial'?ids.slice(1):ids).map(albumId=>({albumId:mode==='wrong-id'?albumId+'X':albumId,saved:true,checkedAt:mode==='future'?now+1000:now,source:'spotify-library-contains'}))});});
  await h.runner.start();assert.equal(h.calls.length,2,mode);assert.equal(h.records().length,40,mode);assert.equal(h.progress.at(-1).status,'error',mode);
 }
});
test('disposal and deletion prevent late completion from writing or publishing stale state',async()=>{
 for(const action of ['dispose','clear']){
  const h=harness();let resolve;h.respond(ids=>new Promise(r=>{resolve=()=>r(Response.json({accountId,records:ids.map(albumId=>({albumId,saved:true,checkedAt:now,source:'spotify-library-contains'}))}));}));
  const pending=h.runner.start();while(!resolve)await new Promise(r=>setImmediate(r));
  const count=h.progress.length;if(action==='dispose')h.runner.dispose();else h.clear();resolve();await pending;
  assert.equal(h.records().length,0);if(action==='dispose'){assert.equal(h.progress.length,count);await h.runner.start();assert.equal(h.calls.length,1);}else assert.equal(h.progress.at(-1).status,'error');
 }
});
test('storage failure, empty collection and guest identity never manufacture completion or extra requests',async()=>{
 const h=harness();h.failSave();await h.runner.start();assert.equal(h.progress.at(-1).status,'error');assert.equal(h.calls.length,1);assert.equal(h.records().length,0);
 const empty=harness(0);await empty.runner.start();assert.equal(empty.progress.at(-1).status,'complete');assert.equal(empty.calls.length,0);
 const guest=createMembershipRefresh({accountId:'guest',storage:h.storage,apiFetch:h.apiFetch,progress:()=>{}});const before=h.loads();await guest.start();assert.equal(h.loads(),before);
});

test('continuous preparation finishes all batches with pacing and reuses checkpoints',async()=>{
 const h=harness(161,{continuous:true,pauseMs:5});
 await h.runner.start();
 assert.deepEqual(h.calls.map(ids=>ids.length),[40,40,40,40,1]);
 assert.equal(h.progress.at(-1).status,'complete');
 await h.runner.start();assert.equal(h.calls.length,5);
});
test('cancel during pacing stops before another request and resume uses saved checks',async()=>{
 const h=harness(81,{continuous:true,pauseMs:50});
 const run=h.runner.start();
 while(h.records().length<40)await new Promise(r=>setImmediate(r));
 h.runner.cancel();await run;
 assert.equal(h.calls.length,1);assert.equal(h.progress.at(-1).status,'cancelled');
 await h.runner.start();assert.deepEqual(h.calls.map(ids=>ids.length),[40,40,1]);
});
