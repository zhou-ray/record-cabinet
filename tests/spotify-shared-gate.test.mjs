import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file, dependencies={}, context={}) {
 const result={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(`(function(require,module,exports){${code}\n})`,{...context,URL,AbortSignal,AbortController,Date,setTimeout,clearTimeout})(name=>dependencies[name],result,result.exports);
 return result.exports;
}
const requests=load('app/lib/spotify-requests.ts');
const deps={'server-only':{},'./spotify-requests':requests};
test('production missing a shared limiter fails closed',async()=>{
 const gate=load('app/lib/spotify-shared-gate.ts',deps,{process:{env:{VERCEL_ENV:'production'}},fetch:()=>assert.fail('No outbound request expected')});
 await assert.rejects(gate.acquireSpotifySlot(),e=>e.status===503 && e.reason==='LIMITER_UNAVAILABLE');
});
test('Redis failures do not fall back to an uncoordinated local gate',async()=>{
 for(const response of [Response.json({}, {status:503}),Response.json({error:'unavailable'})]) {
  const gate=load('app/lib/spotify-shared-gate.ts',deps,{process:{env:{VERCEL_ENV:'production',KV_REST_API_URL:'https://redis.example',KV_REST_API_TOKEN:'test'}},fetch:async()=>response});
  await assert.rejects(gate.acquireSpotifySlot(),e=>e.status===503);
 }
});
test('unknown quota cooldown is shared without inventing a Spotify reset timestamp',async()=>{
 const gate=load('app/lib/spotify-shared-gate.ts',deps,{process:{env:{KV_REST_API_URL:'https://redis.example',KV_REST_API_TOKEN:'test'}},fetch:async()=>Response.json({result:[3600000,1,'QUOTA_EXCEEDED_UNKNOWN',Date.now()+3600000]})});
 await assert.rejects(gate.acquireSpotifySlot(),e=>e.reason==='QUOTA_EXCEEDED' && e.retryAfter===null);
 const errors=load('app/lib/spotify-errors.ts',{'./spotify-requests':requests});
 assert.equal(errors.spotifyFailure(new requests.SpotifyError(429,null,'QUOTA_EXCEEDED')).retryAt,null);
});
