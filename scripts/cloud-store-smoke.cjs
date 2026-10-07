/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Redis integration check. */
// Run with node --env-file=.env.local. Uses and deletes only a random test key.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
function load(file){const out=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const result={exports:{}};vm.runInThisContext(`(function(require,module,exports){${out}\n})`)(name=>name==='server-only'?{}:load(path.resolve(path.dirname(file),name+'.ts')),result,result.exports);return result.exports;}
(async()=>{
 const {readCloud,writeCloud,resetCloud}=load('app/lib/cloud-store.ts');
 const id='sync-test-'+randomUUID();const key='record-cabinet:library:'+id;
 const url=process.env.UPSTASH_REDIS_REST_URL||process.env.KV_REST_API_URL,token=process.env.UPSTASH_REDIS_REST_TOKEN||process.env.KV_REST_API_TOKEN;
 if(!url||!token)throw Error('Redis credentials unavailable');
 try{
  const first=await readCloud(id);assert.equal(first.revision,0);
  const results=await Promise.all([writeCloud(id,0,first.library),writeCloud(id,0,first.library)]);
  assert.deepEqual(results.sort((a,b)=>a-b),[-1,1]);
  await resetCloud(id,false);assert.equal(await writeCloud(id,1,first.library),-1);
  const deleted=await readCloud(id);assert.equal(deleted.enabled,false);assert.equal(deleted.library.albums.length,0);
  assert.equal(await writeCloud(id,deleted.revision,first.library),-1);
  await resetCloud(id,true);const enabled=await readCloud(id);assert.equal(enabled.enabled,true);
  assert.ok(await writeCloud(id,enabled.revision,first.library)>enabled.revision);
  console.log('PASS: real Redis atomic conflict rejection, deletion, stale-write blocking, explicit resume. No Spotify requests.');
 }finally{
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(['DEL',key])});
  const result=await response.json();if(!response.ok||result.error)throw Error('Test-key cleanup failed');
 }
})().catch(()=>{console.error('Cloud storage integration check failed; no credentials were logged.');process.exitCode=1;});
