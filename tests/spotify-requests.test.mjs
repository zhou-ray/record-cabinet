import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { NextResponse } from 'next/server.js';

function load(file, dependencies = {}) {
  if (file.includes('/api/')) {
    dependencies['../../../lib/spotify-shared-gate'] = { acquireSpotifySlot: async () => {}, recordSpotifyLimit: async () => {} };
    dependencies['../../../lib/spotify-errors'] = load('app/lib/spotify-errors.ts', { './spotify-requests': helpers });
    if (dependencies['../../../lib/spotify-session']) dependencies['../../../lib/spotify-session'].accountMatches = () => true;
  }
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`)(name => {
    if (name.endsWith('/playlist-preview')) return load('app/lib/playlist-preview.ts');
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, result, result.exports);
  return result.exports;
}
const helpers = load('app/lib/spotify-requests.ts');
const { createSpotifyRequester, retryDelay, abortableDelay } = helpers;
const url = 'https://api.spotify.com/v1/me/albums';
const ok = () => Response.json({ items: [], next: null });
function clock() {
  let time = 100000;
  const sleeps = [];
  return { now: () => time, sleeps, sleep: async ms => { sleeps.push(ms); time += ms; } };
}

test('shared pacing spaces imports and playlist requests one second apart', async () => {
  const time = clock();
  const gate = { nextRequestAt: 0, blockedUntil: 0 };
  const calls = [];
  const send = async () => { calls.push(time.now()); return ok(); };
  const first = createSpotifyRequester(send, gate, time);
  const second = createSpotifyRequester(send, gate, time);
  await first(url); await second(url); await first(url);
  assert.deepEqual(calls, [100000, 101000, 102000]);
});
test('429 respects long Retry-After and retries the same request without restarting', async () => {
  const time = clock();
  const calls = [];
  const waits = [];
  const request = createSpotifyRequester(async requested => {
    calls.push({ url: requested, time: time.now() });
    return calls.length === 1 ? Response.json({ error: { status: 429 } }, { status: 429, headers: { 'Retry-After': '90' } }) : ok();
  }, { nextRequestAt: 0, blockedUntil: 0 }, { ...time, onWait: wait => waits.push(wait) });
  await request(url);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, calls[1].url);
  assert.ok(calls[1].time - calls[0].time >= 90000);
  assert.ok(time.sleeps.every(ms => ms <= 30000));
  assert.equal(waits[0].retryAt, 191000);
  assert.equal(waits.at(-1), null);
});
test('cooldown applies to other requesters using the same gate', async () => {
  const time = clock();
  const gate = { nextRequestAt: 0, blockedUntil: 160000 };
  const waits = [];
  let calledAt = 0;
  const request = createSpotifyRequester(async () => { calledAt = time.now(); return ok(); }, gate, { ...time, onWait: wait => waits.push(wait) });
  await request(url);
  assert.equal(calledAt, 160000);
  assert.equal(waits[0].retryAt, 160000);
});
test('repeated 429s stop after five retries and use exponential backoff', async () => {
  const time = clock();
  let calls = 0;
  const request = createSpotifyRequester(async () => { calls++; return Response.json({}, { status: 429 }); }, { nextRequestAt: 0, blockedUntil: 0 }, time);
  await assert.rejects(request(url), error => error.status === 429);
  assert.equal(calls, 6);
  assert.ok(time.now() >= 100000 + 30000 + 60000 + 120000 + 240000 + 300000);
});
test('quota exhaustion without reset time and denied access do not retry', async () => {
  for (const status of [429, 403, 401]) {
    let calls = 0;
    const request = createSpotifyRequester(async () => { calls++; return Response.json({ error: { reason: 'QUOTA_EXCEEDED' } }, { status }); }, { nextRequestAt: 0, blockedUntil: 0 }, clock());
    await assert.rejects(request(url), error => error.status === status);
    assert.equal(calls, 1);
  }
});
test('Retry-After supports seconds, dates, and missing or invalid headers', () => {
  assert.equal(retryDelay('60', 0, 0), 61000);
  assert.equal(retryDelay('Thu, 01 Jan 1970 00:02:00 GMT', 0, 60000), 61000);
  assert.equal(retryDelay(null, 0, 0), 30000);
  assert.equal(retryDelay('invalid', 1, 0), 60000);
});
test('cancelling a cooldown clears its timer and prevents the next request', async () => {
  const controller = new AbortController();
  let calls = 0;
  const request = createSpotifyRequester(async () => { calls++; return ok(); }, { nextRequestAt: 0, blockedUntil: Date.now() + 90000 });
  const pending = request(url, controller.signal);
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(calls, 0);
  assert.throws(() => abortableDelay(1000, controller.signal), error => error.name === 'AbortError');
});
test('initial Spotify rate limit is streamed as waiting, then resumes and completes', async () => {
  const time = clock();
  let calls = 0;
  const route = load('app/api/spotify/library/route.ts', {
    'next/server': { NextResponse },
    '../../../lib/genres': load('app/lib/genres.ts'),
    '../../../lib/spotify-album-link': load('app/lib/spotify-album-link.ts'),
    '../../../data/spotify': load('app/data/spotify.ts', { '../lib/genres': load('app/lib/genres.ts') }),
    '../../../lib/spotify-session': {
      getSession: async () => ({ accessToken: 'test', expiresAt: Date.now() + 3600000 }),
    },
    '../../../lib/spotify-requests': {
      ...helpers,
      createSpotifyRequester: (_send, _gate, options) => createSpotifyRequester(async () => {
        calls++;
        return calls === 1 ? Response.json({}, { status: 429, headers: { 'Retry-After': '90' } }) : ok();
      }, { nextRequestAt: 0, blockedUntil: 0 }, { ...options, ...time }),
    },
  });
  const response = await route.POST(new Request('http://localhost/api/spotify/library', { method: 'POST', body: JSON.stringify({ knownAlbumIds: [] }) }));
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson');
  assert.equal(events[0].type, 'heartbeat');
  assert.ok(events.some(event => event.type === 'waiting'));
  assert.ok(events.some(event => event.type === 'resuming'));
  assert.equal(events.at(-1).type, 'complete');
  assert.equal(calls, 2);
});

const { createImportWatch, observeImportEvent, formatRetryStatus } = load('app/lib/import-status.ts');
test('wait status includes the date for tomorrow instead of an apparently overdue time', () => {
  const tomorrow = new Date(2026, 8, 17, 12, 38, 50).getTime();
  const text = formatRetryStatus(tomorrow, 86400000);
  assert.ok(text.includes(new Date(tomorrow).toLocaleString()));
  assert.ok(text.includes('24h'));
  assert.match(formatRetryStatus(tomorrow, -60000), /pause has ended/);
});
test('heartbeats and repeated waiting events cannot hide an overdue retry', () => {
  let watch = observeImportEvent(createImportWatch(0), { type: 'waiting', retryAt: 90000 }, 0);
  for (let now = 10000; now <= 150000; now += 10000) {
    watch = observeImportEvent(watch, { type: 'heartbeat' }, now);
    watch = observeImportEvent(watch, { type: 'waiting', retryAt: 90000 }, now);
  }
  assert.equal(watch.deadline, 135000);
  assert.ok(150000 > watch.deadline);
});
test('genuine extended cooldowns update the watchdog, with server clock skew accounted for', () => {
  let watch = observeImportEvent(createImportWatch(1000), { type: 'waiting', retryAt: 190000, serverNow: 100000 }, 1000);
  assert.equal(watch.retryDeadline, 91000);
  assert.equal(watch.deadline, 136000);
  watch = observeImportEvent(watch, { type: 'waiting', retryAt: 220000, serverNow: 130000 }, 31000);
  assert.equal(watch.retryDeadline, 121000);
  assert.equal(watch.deadline, 166000);
});
test('request dispatch and progress clear stale cooldowns; heartbeats alone cannot extend them', () => {
  let watch = observeImportEvent(createImportWatch(0), { type: 'waiting', retryAt: 90000 }, 0);
  watch = observeImportEvent(watch, { type: 'requesting' }, 91000);
  assert.equal(watch.retryAt, null);
  assert.equal(watch.deadline, 151000);
  watch = observeImportEvent(watch, { type: 'heartbeat' }, 160000);
  assert.equal(watch.deadline, 151000);
  watch = observeImportEvent(watch, { type: 'progress' }, 161000);
  assert.equal(watch.retryAt, null);
  assert.equal(watch.deadline, 221000);
});
test('retry dispatch is explicitly reported after a cooldown before the response arrives', async () => {
  const time = clock();
  const events = [];
  const request = createSpotifyRequester(async () => { events.push('send'); return ok(); }, { nextRequestAt: 0, blockedUntil: 190000 }, {
    ...time, onWait: wait => events.push(wait ? 'waiting' : 'resuming'), onRequest: () => events.push('requesting'),
  });
  await request(url);
  assert.deepEqual(events.slice(-3), ['resuming', 'requesting', 'send']);
});

test('POST passes the browser collection into the importer and rejects invalid lists before requests', async () => {
  let received;
  let sessions = 0;
  const route = load('app/api/spotify/library/route.ts', {
    'next/server': { NextResponse },
    '../../../lib/genres': load('app/lib/genres.ts'),
    '../../../lib/spotify-album-link': load('app/lib/spotify-album-link.ts'),
    '../../../data/spotify': { parseImportCheckpoint: load('app/data/spotify.ts', { '../lib/genres': load('app/lib/genres.ts') }).parseImportCheckpoint, createSpotifyLibrary: (_request, progress, source, known) => {
      received = { source, known };
      return { getAlbums: async () => { progress({ loaded: 0, skipped: known.length, total: known.length }); return []; } };
    } },
    '../../../lib/spotify-session': { getSession: async () => { sessions++; return { accessToken: 'test', expiresAt: Date.now() + 3600000 }; } },
    '../../../lib/spotify-requests': helpers,
  });
  const response = await route.POST(new Request('http://localhost/api/spotify/library?source=liked', { method: 'POST', body: JSON.stringify({ knownAlbumIds: ['spotify:abc', 'spotify:abc', 'spotify:def'] }) }));
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(received, { source: 'liked', known: ['spotify:abc', 'spotify:def'] });
  assert.equal(events.find(event => event.type === 'progress').skipped, 2);
  assert.equal(events.at(-1).type, 'complete');
  for (const payload of [{}, { knownAlbumIds: 'abc' }, { knownAlbumIds: ['https://example.com'] }]) {
    const invalid = await route.POST(new Request('http://localhost/api/spotify/library', { method: 'POST', body: JSON.stringify(payload) }));
    assert.equal(invalid.status, 400);
  }
  assert.equal(sessions, 1);
});

test('optional genre requests respect cooldown and never retry a 429',async()=>{
 const clockState=clock();let calls=0;
 const gate={nextRequestAt:0,blockedUntil:0};
 const request=createSpotifyRequester(async()=>{calls++;return Response.json({error:{}},{status:429,headers:{'Retry-After':'3600'}});},gate,{...clockState,maxRetries:0,failOnCooldown:true});
 await assert.rejects(request('https://api.spotify.com/v1/artists/a'),error=>error.status===429);
 await assert.rejects(request('https://api.spotify.com/v1/artists/b'),error=>error.status===429);
 assert.equal(calls,1);assert.deepEqual(clockState.sleeps,[]);
});

test('import failures describe imports while playback retains its command warning', () => {
  const {spotifyFailure}=load('app/lib/spotify-errors.ts',{'./spotify-requests':helpers});
  for (const error of [new Error('Unexpected'),new helpers.SpotifyError(500),new helpers.SpotifyError(404)]) {
    const failure=spotifyFailure(error,'import');
    assert.doesNotMatch(failure.message,/playback|browser player|Put the record/);
    assert.match(failure.message,/Import|import|playlist|album/);
  }
  assert.match(spotifyFailure(new Error('Uncertain command')).message,/Check playback/);
});
test('read timeouts and invalid JSON are classified without retrying or consuming extra calls',async()=>{
  const {spotifyFailure}=load('app/lib/spotify-errors.ts',{'./spotify-requests':helpers});
  for(const [send,code] of [[async()=>{const e=new Error('timeout');e.name='TimeoutError';throw e;},'SPOTIFY_TIMEOUT'],[async()=>{throw new TypeError('fetch failed');},'NETWORK_ERROR'],[async()=>new Response('not JSON'),'INVALID_RESPONSE']]) {
    let calls=0;
    const request=createSpotifyRequester(async()=>{calls++;return send();},{nextRequestAt:0,blockedUntil:0},clock());
    await assert.rejects(request(url),error=>{assert.equal(error.reason,code);assert.doesNotMatch(spotifyFailure(error,'import').message,/playback/);return true;});
    assert.equal(calls,1);
  }
});

test('streamed import errors provide a matching safe diagnostic reference',async()=>{
  const diagnostics=[];const original=console.warn;
  const route=load('app/api/spotify/library/route.ts',{
    'next/server':{NextResponse},
    '../../../lib/genres':load('app/lib/genres.ts'),
    '../../../lib/spotify-album-link':load('app/lib/spotify-album-link.ts'),
    '../../../lib/spotify-session':{getSession:async()=>({accessToken:'do-not-log',expiresAt:Date.now()+3600000})},
    '../../../lib/spotify-requests':helpers,
    '../../../data/spotify':{ImportDataError:load('app/data/spotify.ts', { '../lib/genres': load('app/lib/genres.ts') }).ImportDataError,parseImportCheckpoint:()=>null,createSpotifyLibrary:()=>({getAlbums:async()=>{throw new Error('private raw response must not be logged');}})},
  });
  console.warn=(...args)=>diagnostics.push(args);
  try {
    const response=await route.POST(new Request('http://localhost/api/spotify/library',{method:'POST',body:JSON.stringify({knownAlbumIds:[]})}));
    const events=(await response.text()).trim().split('\n').map(JSON.parse);
    const error=events.at(-1);
    assert.equal(error.type,'error');assert.match(error.message,/Import interrupted/);assert.doesNotMatch(error.message,/playback/);
    assert.equal(error.reference,diagnostics[0][1].reference);
    assert.equal(error.error,error.message);
    assert.doesNotMatch(JSON.stringify(diagnostics),/do-not-log|private raw response/);
    assert.ok(!events.some(event=>event.type==='complete'));
  }finally{console.warn=original;}
});

test('saved position display distinguishes resumed imports from fresh scans',()=>{
 const {formatSavedPosition}=load('app/lib/import-status.ts');
 assert.match(formatSavedPosition({pageUrl:'https://api.spotify.com/v1/me/tracks?offset=100&limit=50',index:4}),/item 105/);
 assert.match(formatSavedPosition(null),/No saved resume position/);
 assert.match(formatSavedPosition(null),/skips saved albums/);
});
test('album search validates queries, requires a session, and uses a single cooldown-aware search',async()=>{
 let session=null,calls=[];const settings=[];
 const route=load('app/api/spotify/library/route.ts',{
  'next/server':{NextResponse},'../../../lib/genres':load('app/lib/genres.ts'),
  '../../../lib/spotify-album-link':load('app/lib/spotify-album-link.ts'),
  '../../../data/spotify':{},
  '../../../lib/spotify-session':{getSession:async()=>session,config:()=>({origin:'http://localhost'})},
  '../../../lib/spotify-requests':{...helpers,createSpotifyRequester:(_send,_gate,options)=>{
   settings.push(options);return async url=>{calls.push(url);return {albums:{items:[{id:'abc',name:'Blue',artists:[{name:'Artist'}],images:[{url:'https://i.scdn.co/image/test'}],release_date:'1959-08-17',total_tracks:5}]}};};
  }},
 });
 const request=search=>new Request('http://localhost/api/spotify/library',{method:'POST',body:JSON.stringify({search})});
 for(const query of ['', 'a', 'x'.repeat(201),123])assert.equal((await route.POST(request(query))).status,400);
 assert.equal((await route.POST(request('Blue'))).status,401);assert.equal(calls.length,0);
 session={accessToken:'mock',expiresAt:Date.now()+3600000};
 const response=await route.POST(request('Blue & Artist'));
 assert.equal(response.status,200);assert.equal(calls.length,1);
 const url=new URL(calls[0]);assert.equal(url.pathname,'/v1/search');assert.equal(url.searchParams.get('q'),'Blue & Artist');
 assert.equal(url.searchParams.get('type'),'album');assert.equal(url.searchParams.get('limit'),'10');
 assert.equal(settings.at(-1).maxRetries,0);assert.equal(settings.at(-1).failOnCooldown,true);
 const data=await response.json();assert.equal(data.results[0].year,'1959');assert.equal(data.results[0].artist,'Artist');
});

test('playlist preview reads exact identity and albums; imports require a confirmed version',async()=>{
 const calls=[];
 const route=load('app/api/spotify/library/route.ts',{
  'next/server':{NextResponse},'../../../lib/genres':load('app/lib/genres.ts'),
  '../../../lib/spotify-album-link':load('app/lib/spotify-album-link.ts'),
  '../../../data/spotify':{},
  '../../../lib/spotify-session':{getSession:async()=>({accessToken:'mock',expiresAt:Date.now()+3600000}),config:()=>({origin:'http://localhost'})},
  '../../../lib/spotify-requests':{...helpers,createSpotifyRequester:()=>async url=>{
   calls.push(url);
   return url.includes('?fields=') ? {id:'wei',name:'喂',snapshot_id:'v1'} : {href:'https://api.spotify.com/v1/playlists/wei/items',total:26,items:[{item:{album:{id:'actual',name:'真正的專輯',artists:[{name:'Artist'}]}}}]};
  }},
 });
 const request=(body,source='')=>new Request('http://localhost/api/spotify/library'+source,{method:'POST',body:JSON.stringify(body)});
 assert.equal((await route.POST(request({knownAlbumIds:[]},'?source=playlist:wei'))).status,400);
 assert.equal(calls.length,0);
 const response=await route.POST(request({previewPlaylist:'wei'}));
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{id:'wei',name:'喂',snapshotId:'v1',total:26,albums:[{id:'actual',title:'真正的專輯',artist:'Artist'}]});
 assert.equal(calls.length,2);
 assert.ok(calls.every(url=>url.startsWith('https://api.spotify.com/v1/playlists/wei')));
});

test('playlist listing follows every page, deduplicates IDs, and fails instead of returning a partial list',async()=>{
 let mode='all';const calls=[];
 const route=load('app/api/spotify/library/route.ts',{
  'next/server':{NextResponse},'../../../lib/genres':load('app/lib/genres.ts'),
  '../../../lib/spotify-album-link':load('app/lib/spotify-album-link.ts'),
  '../../../data/spotify':load('app/data/spotify.ts',{'../lib/genres':load('app/lib/genres.ts')}),
  '../../../lib/spotify-session':{getSession:async()=>({accessToken:'mock',expiresAt:Date.now()+3600000}),config:()=>({origin:'http://localhost'})},
  '../../../lib/spotify-requests':{...helpers,createSpotifyRequester:()=>async url=>{
   calls.push(url);const offset=Number(new URL(url).searchParams.get('offset')??0);
   if(offset===50 && mode==='failure')throw new Error('Network failed');
   return {items:offset===100?[{id:'p100',name:'Last'},null,{id:'p0',name:'Updated'}]:Array.from({length:50},(_,i)=>({id:'p'+(offset+i),name:'Playlist '+(offset+i)})),next:offset===100?null:mode==='unsafe'?'https://example.com/steal':mode==='loop'?'https://api.spotify.com/v1/me/playlists?offset=0':`https://api.spotify.com/v1/me/playlists?limit=50&offset=${offset+50}`};
  }},
 });
 const request=()=>new Request('http://localhost/api/spotify/library?list=playlists');
 const response=await route.GET(request());assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.playlists.length,101);assert.equal(body.playlists.at(-1).id,'p100');assert.equal(body.playlists[0].name,'Updated');assert.equal(calls.length,3);
 const warn=console.warn;console.warn=()=>{};
 try {for(mode of ['failure','unsafe','loop']){calls.length=0;const failed=await route.GET(request());assert.notEqual(failed.status,200);assert.equal((await failed.json()).playlists,undefined);assert.equal(calls.length,mode==='failure'?2:1);}}finally{console.warn=warn;}
});
