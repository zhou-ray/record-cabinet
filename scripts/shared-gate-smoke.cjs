/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Redis-only integration check. */
// This uses a unique disposable Redis key and never contacts Spotify.
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const { parseEnv } = require('node:util');
const { randomUUID } = require('node:crypto');
const env = parseEnv(fs.readFileSync(process.argv[2], 'utf8'));
for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN']) process.env[key] = env[key];
process.env.VERCEL_ENV = 'production';
process.env.SPOTIFY_GATE_KEY = 'record-cabinet:test:' + randomUUID();
function load(file, dependencies = {}) {
 const result = { exports: {} };
 const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(name=>{if(!(name in dependencies))throw new Error(name);return dependencies[name];},result,result.exports);
 return result.exports;
}
(async()=>{
 const requests = load('app/lib/spotify-requests.ts');
 const modules = Array.from({length:3},()=>load('app/lib/spotify-shared-gate.ts',{'server-only':{},'./spotify-requests':requests}));
 try {
  const starts = await Promise.all(modules.map(async gate=>{await gate.acquireSpotifySlot();return Date.now();}));
  starts.sort((a,b)=>a-b);
  assert.ok(starts[1]-starts[0]>750 && starts[2]-starts[1]>750, 'Requests from separate module instances must be spaced');
  await modules[0].recordSpotifyLimit(Response.json({}, {status:429,headers:{'Retry-After':'90'}}));
  await assert.rejects(modules[1].acquireSpotifySlot(undefined,undefined,true),e=>e.status===429 && Number(e.retryAfter)>80);
  await modules[1].recordSpotifyLimit(Response.json({}, {status:429}), 'QUOTA_EXCEEDED');
  await assert.rejects(modules[2].acquireSpotifySlot(),e=>e.reason==='QUOTA_EXCEEDED' && e.retryAfter===null);
  console.log('Redis coordination passed: three independent requesters, shared rate cooldown, unknown-reset quota cooldown. No Spotify requests.');
 } finally {
  const response=await fetch(env.KV_REST_API_URL,{method:'POST',headers:{Authorization:`Bearer ${env.KV_REST_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(['DEL',process.env.SPOTIFY_GATE_KEY])});
  assert.ok(response.ok,'Remove disposable test key');
 }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
