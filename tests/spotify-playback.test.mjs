/* eslint-disable @typescript-eslint/no-this-alias -- SDK double retains the constructed player. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { NextResponse } from 'next/server.js';
function load(file, dependencies = {}, fetch = () => { throw new Error('Live requests forbidden in tests'); }, window) {
  if (file === 'app/use-spotify-player.ts') dependencies['./lib/beta-diagnostics'] = { recordPlaybackEvent() {} };
  if (file === 'app/use-spotify-player.ts') dependencies['./account-context'] = { useAccount: () => ({ apiFetch: fetch }) };
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports,fetch,window){${output}\n})`)(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`);
    return dependencies[name];
  }, compiled, compiled.exports, fetch, window);
  return compiled.exports;
}
const playback = load('app/lib/spotify-playback.ts');
const requests = load('app/lib/spotify-requests.ts');
const { parsePlaybackCommand, playbackRequest, normalizePlayback } = playback;
function route(fetch, options = {}) {
  globalThis.spotifyRequestGate = { nextRequestAt: 0, blockedUntil: options.blockedUntil ?? 0 };
  return load('app/api/spotify/player/route.ts', {
    'next/server': { NextResponse },
    '../../../lib/spotify-playback': playback,
    '../../../lib/spotify-errors': load('app/lib/spotify-errors.ts', { './spotify-requests': requests }),
    '../../../lib/spotify-shared-gate': {
      acquireSpotifySlot: async () => { if (globalThis.spotifyRequestGate.blockedUntil > Date.now()) throw new requests.SpotifyError(429, '90'); },
      recordSpotifyLimit: async () => { globalThis.spotifyRequestGate.blockedUntil = Date.now() + 91000; },
    },
    '../../../lib/spotify-requests': { ...requests, abortableDelay: async () => { globalThis.spotifyRequestGate.nextRequestAt = 0; } },
    '../../../lib/spotify-session': {
      accountMatches: () => !options.accountChanged,
      getSession: async () => options.disconnected ? null : { accessToken: 'secret', refreshToken: 'refresh', expiresAt: options.expired ? 0 : Date.now() + 3600000 },
      config: () => ({ clientId: 'client', origin: 'http://127.0.0.1:3000' }),
      tokenRequest: options.refresh ?? (async () => ({ accessToken: 'refreshed-secret', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 })),
      putCookie: options.putCookie ?? (async () => {}), SESSION: 'session',
    },
  }, fetch);
}
const post = body => new Request('http://127.0.0.1:3000/api/spotify/player', { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000' }, body: JSON.stringify(body) });

test('album and track selection preserve full album context and zero-based offset', () => {
  const command = parsePlaybackCommand({ action: 'play', albumUri: 'spotify:album:abc', trackIndex: 3, deviceId: 'speaker-1' });
  const request = playbackRequest(command);
  assert.equal(request.path, '/me/player/play?device_id=speaker-1');
  assert.deepEqual(JSON.parse(request.body), { context_uri: 'spotify:album:abc', offset: { position: 3 }, position_ms: 0 });
  assert.equal(playbackRequest(parsePlaybackCommand({ action: 'resume' })).body, undefined);
  assert.equal(playbackRequest(parsePlaybackCommand({ action: 'pause' })).path, '/me/player/pause');
  assert.equal(playbackRequest(parsePlaybackCommand({ action: 'seek', positionMs: 12000 })).path, '/me/player/seek?position_ms=12000');
});
test('invalid URLs, track offsets, positions, devices, and unsupported commands are rejected', () => {
  for (const body of [null, { action: 'delete' }, { action: 'play', albumUri: 'https://example.com', trackIndex: 0 }, { action: 'play', albumUri: 'spotify:album:abc', trackIndex: -1 }, { action: 'play', albumUri: 'spotify:album:abc', trackIndex: 0.5 }, { action: 'seek', positionMs: -1 }, { action: 'pause', deviceId: '&token=leak' }]) assert.throws(() => parsePlaybackCommand(body));
});
test('playback normalization handles empty devices, current track, and Spotify restrictions', () => {
  assert.equal(normalizePlayback(null).playing, false);
  const state = normalizePlayback({ is_playing: true, progress_ms: 12000, device: { id: 'device', name: 'Phone', is_restricted: true }, item: { name: 'Track', uri: 'spotify:track:a', duration_ms: 200000, album: { uri: 'spotify:album:b' } }, actions: { disallows: { seeking: true } } });
  assert.equal(state.progress, 12);
  assert.equal(state.duration, 200);
  assert.equal(state.device.restricted, true);
  assert.equal(state.disallowed.seeking, true);
});
test('server sends authenticated playback command and handles Spotify 204 without JSON parsing', async () => {
  const calls = [];
  const api = route(async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 204 }); });
  const response = await api.POST(post({ action: 'play', albumUri: 'spotify:album:abc', trackIndex: 1 }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: true });
  assert.equal(calls[0].url, 'https://api.spotify.com/v1/me/player/play');
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret');
  assert.equal(JSON.parse(calls[0].init.body).offset.position, 1);
});
test('device discovery removes null IDs and exposes restricted devices without secrets', async () => {
  const api = route(async () => Response.json({ devices: [{ id: null }, { id: 'd', name: 'Speaker', is_restricted: true }] }));
  const response = await api.GET(new Request('http://127.0.0.1:3000/api/spotify/player?view=devices'));
  assert.deepEqual((await response.json()).devices, [{ id: 'd', name: 'Speaker', type: 'device', active: false, restricted: true }]);
});
test('missing devices, Premium restrictions, and missing permissions produce actionable errors', async () => {
  for (const [status, reason, pattern] of [[404, 'NO_ACTIVE_DEVICE', /browser player/], [403, 'PREMIUM_REQUIRED', /Premium/], [403, '', /invite-only/]]) {
    const api = route(async () => Response.json({ error: { reason } }, { status }));
    const response = await api.POST(post({ action: 'pause' }));
    assert.equal(response.status, status);
    assert.match((await response.json()).error, pattern);
  }
});
test('playback rate limits update shared cooldown without automatically retrying commands', async () => {
  let calls = 0;
  const api = route(async () => { calls++; return Response.json({}, { status: 429, headers: { 'Retry-After': '90' } }); });
  const requestedAt = Date.now();
  const response = await api.POST(post({ action: 'pause' }));
  assert.equal(response.status, 429);
  assert.ok((await response.json()).retryAt >= requestedAt + 90000);
  const second = await api.POST(post({ action: 'resume' }));
  assert.equal(second.status, 429);
  assert.equal(calls, 1);
});
test('expired and rejected tokens refresh server-side, but failed refresh asks for reconnection', async () => {
  let cookieSaved = false;
  let calls = 0;
  const api = route(async (_url, init) => {
    calls++;
    if (calls === 1) return Response.json({}, { status: 401 });
    assert.equal(init.headers.Authorization, 'Bearer refreshed-secret');
    return new Response(null, { status: 204 });
  }, { putCookie: async () => { cookieSaved = true; } });
  assert.equal((await api.POST(post({ action: 'pause' }))).status, 200);
  assert.equal(calls, 2); assert.equal(cookieSaved, true);
  const failed = route(async () => { throw new Error('Must not send'); }, { expired: true, refresh: async () => { throw new Error('Expired'); } });
  const response = await failed.POST(post({ action: 'resume' }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).reconnect, true);
});
test('unauthorized, cross-origin, and malformed requests never call Spotify', async () => {
  const api = route(async () => { throw new Error('Must not send'); }, { disconnected: true });
  assert.equal((await api.POST(post({ action: 'pause' }))).status, 401);
  assert.equal((await api.POST(post({ action: 'unknown' }))).status, 400);
  const cross = new Request('http://127.0.0.1:3000/api/spotify/player', { method: 'POST', headers: { Origin: 'https://example.com' }, body: JSON.stringify({ action: 'pause' }) });
  assert.equal((await api.POST(cross)).status, 403);
});
test('uncertain network failures do not replay playback commands', async () => {
  let calls = 0;
  const api = route(async () => { calls++; throw new Error('Timeout'); });
  const response = await api.POST(post({ action: 'play', albumUri: 'spotify:album:abc', trackIndex: 0 }));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Check playback/);
  assert.equal(calls, 1);
});

test('browser transfer and ordered album cues generate the correct requests', () => {
  assert.deepEqual(playbackRequest(parsePlaybackCommand({action: 'transfer', deviceId: 'browser'})), {path: '/me/player', body: JSON.stringify({device_ids: ['browser'], play: false})});
  assert.throws(() => parsePlaybackCommand({action: 'transfer'}));
  assert.equal(playbackRequest(parsePlaybackCommand({action: 'shuffle-off', deviceId: 'browser'})).path, '/me/player/shuffle?device_id=browser&state=false');
  assert.equal(playbackRequest(parsePlaybackCommand({action: 'repeat-off'})).path, '/me/player/repeat?state=off');
  assert.equal(JSON.parse(playbackRequest(parsePlaybackCommand({action: 'play', albumUri: 'spotify:album:a', trackIndex: 1, positionMs: 70000})).body).position_ms, 70000);
});
const timeline = load('app/lib/album-timeline.ts');
const album = {tracks: [{id: 'spotify:a', duration: 100}, {id: 'spotify:b', duration: 120}]};
test('album needle crosses track boundaries without resetting', () => {
  assert.equal(timeline.albumDuration(album), 220);
  assert.deepEqual(timeline.albumCue(album, 170), {trackIndex: 1, positionMs: 70000, position: 170});
  assert.deepEqual(timeline.albumCue(album, 100), {trackIndex: 1, positionMs: 0, position: 100});
  assert.equal(timeline.albumProgress(album, 'spotify:track:b', 20), 120);
  assert.equal(timeline.albumProgress(album, 'spotify:track:other', 20), null);
  assert.equal(timeline.albumCue(album, -1).position, 0);
  assert.equal(timeline.albumCue(album, 999).positionMs, 119999);
  assert.equal(timeline.albumCue({tracks: [{duration: 0}, ...album.tracks]}, 20).trackIndex, 1);
});
test('SDK token route returns only access token, guards streaming scope, and preserves refreshed scope', async () => {
  let session = {accessToken:'access',refreshToken:'private-refresh',expiresAt:Date.now()+3600000,scope:'streaming user-read-private'};
  let saved;
  const api=load('app/api/spotify/player/token/route.ts', {'next/server':{NextResponse},'../../../../lib/spotify-session':{
    accountMatches:()=>true,getSession:async()=>session,config:()=>({clientId:'client'}),SESSION:'session',putCookie:async(_name,value)=>{saved=value},
    tokenRequest:async()=>({accessToken:'new-access',refreshToken:'private-refresh',expiresAt:Date.now()+3600000})
  }});
  let response=await api.GET();
  assert.match(response.headers.get('cache-control'),/no-store/);
  assert.deepEqual(Object.keys(await response.json()).sort(),['accessToken','expiresAt']);
  session.expiresAt=0;response=await api.GET();assert.equal((await response.json()).accessToken,'new-access');assert.equal(saved.scope,session.scope);
  session.scope='user-library-read';assert.equal((await api.GET()).status,403);
  session=null;assert.equal((await api.GET()).status,401);
});

test('browser SDK handles expired sign-in, account errors, lost device, and teardown without live Spotify',async()=>{
 for(const mode of ['expired','premium','ready']){
  let player;let disconnected=0;const errors=[];const states=[];
  const window={Spotify:{Player:class{
   constructor(options){this.options=options;this.listeners={};player=this;}
   addListener(name,callback){this.listeners[name]=callback;return true;}
   async connect(){if(mode==='premium')queueMicrotask(()=>this.listeners.account_error({}));else this.options.getOAuthToken(()=>this.listeners.ready({device_id:'browser'}));return true;}
   disconnect(){disconnected++;}
  }}};
  const sdk=load('app/lib/spotify-browser.ts',{},async()=>mode==='expired'?Response.json({error:'Reconnect Spotify'},{status:401}):Response.json({accessToken:'temporary'}),window);
  const controller=new AbortController();
  const pending=sdk.connectBrowserPlayer(state=>states.push(state),(...error)=>errors.push(error),controller.signal);
  if(mode==='ready'){
   const connected=await pending;assert.equal(connected.deviceId,'browser');
   player.listeners.player_state_changed(null);assert.deepEqual(states,[null]);
   player.listeners.not_ready();assert.equal(errors.at(-1)[2],true);
   player.listeners.autoplay_failed();assert.match(errors.at(-1)[0],/another tap/);
   controller.abort();assert.equal(disconnected,1);
  }else{await assert.rejects(pending,mode==='expired'?/Reconnect/:/Premium/);assert.equal(disconnected,1);if(mode==='expired')assert.ok(errors.some(error=>error[1]===true));controller.abort();}
 }
});

// A small hook runner lets us exercise command races without contacting Spotify.
function playerHarness() {
  const slots = []; let cursor = 0; let api; let onState; let onError;
  let connections = 0;
  const calls = []; let responder = () => Response.json({ accepted: true });
  let pauseFails = false; let pauses = 0; let sdkState = null; let volumeFails = false; const volumes = [];
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect() {}, useEffectEvent(fn) { return fn; },
  };
  const device = { deviceId: 'browser', player: { getCurrentState: async () => sdkState, activateElement: async () => {}, pause: async () => { pauses++; if (pauseFails) throw new Error('Pause failed'); sdkState = { ...(sdkState || { position: 0, duration: 100000, track_window: { current_track: { uri: 'spotify:track:a', name: 'Track', album: { uri: 'spotify:album:record' } } } }), paused: true }; }, setVolume: async value => { volumes.push(value); if (volumeFails) throw new Error('Volume unavailable'); }, resume: async () => {}, disconnect() {} } };
  const hook = load('app/use-spotify-player.ts', {
    react, './lib/album-timeline': timeline, './lib/pause-player': load('app/lib/pause-player.ts'),
    './lib/album-stop': load('app/lib/album-stop.ts', { './album-timeline': timeline }),
    './lib/turntable': load('app/lib/turntable.ts'),
    './lib/turntable': load('app/lib/turntable.ts'),
    './lib/spotify-browser': { connectBrowserPlayer: async (state, error) => { connections++; onState = state; onError = error; return device; } },
  }, async (_url, init) => { const body = JSON.parse(init.body); calls.push(body); return responder(body); });
  return {
    render() { cursor = 0; api = hook.useSpotifyPlayer(); return api; },
    respond(fn) { responder = fn; }, calls, get connections() { return connections; },
    disconnect() { onError("Disconnected", false, true); },
    state(value) { sdkState = value; onState(value); }, error() { onError('Playback needs another tap.', false, false); },
    failPause(value) { pauseFails = value; }, get pauses() { return pauses; },
    failVolume(value) { volumeFails = value; }, volumes,
  };
}
const playable = { ...album, id: 'spotify:record', playback: { kind: 'spotify', uri: 'spotify:album:record' } };
test('volume uses the SDK without REST calls and restores confirmed volume on failure', async () => {
  const h = playerHarness(); await h.render().start(playable); const count = h.calls.length;
  assert.equal(await h.render().setVolume(.35), true); assert.equal(h.render().volume,.35); assert.deepEqual(h.volumes,[.35]);
  h.failVolume(true); assert.equal(await h.render().setVolume(.9),false);assert.equal(h.render().volume,.35);assert.match(h.render().error,/Volume could not change/);
  assert.equal(h.calls.length,count);assert.equal(h.render().state.playing,true);
  assert.equal(await h.render().setVolume(NaN),false);assert.equal(h.volumes.length,2);
});
test('restart reuses the connected album and sends a single play command at its beginning', async () => {
  const h = playerHarness(); await h.render().start(playable); const count=h.calls.length;
  assert.equal(await h.render().restart(),true);
  assert.equal(h.calls.length,count+1);assert.deepEqual(h.calls.at(-1),{action:'play',albumUri:'spotify:album:record',trackIndex:0,positionMs:0,deviceId:'browser'});
  assert.equal(h.render().position,0);assert.equal(h.render().ended,false);
  h.respond(()=>Response.json({error:'Quota pause',retryAt:Date.now()+60000},{status:429}));
  assert.equal(await h.render().restart(),false);const failedCount=h.calls.length;
  assert.equal(await h.render().restart(),false);assert.equal(h.calls.length,failedCount);
  assert.equal(await h.render().setVolume(.2),true,'SDK volume remains available during a REST cooldown');
});
test('failed album changes clear previous playback and ignore stale SDK events during setup', async () => {
  const h = playerHarness(); await h.render().start(playable);
  assert.equal(h.render().state.playing, true);
  h.respond(() => {
    h.state({ paused: false, position: 30000, duration: 100000, track_window: { current_track: { uri: 'spotify:track:a', name: 'Old track', album: { uri: 'spotify:album:record' } } } });
    return Response.json({ error: 'Unavailable' }, { status: 503 });
  });
  assert.equal(await h.render().start({ ...playable, id: 'other' }), false);
  assert.equal(h.render().state, null); assert.equal(h.render().position, 0);
});
test('SDK playback errors cannot be overwritten by a successful play response', async () => {
  const h = playerHarness();
  h.respond(body => { if (body.action === 'play') h.error(); return Response.json({ accepted: true }); });
  assert.equal(await h.render().start(playable), false);
  assert.equal(h.render().state, null);
  assert.match(h.render().error, /interrupted/);
});
test('cooldown still allows browser pause and ejection without REST requests; failed pause preserves record', async () => {
  const h = playerHarness(); await h.render().start(playable);
  h.respond(() => Response.json({ error: 'Quota', retryAt: Date.now() + 60000 }, { status: 429 }));
  await h.render().start(playable);
  const count = h.calls.length;
  assert.equal(await h.render().pause(), true);
  h.failPause(true); assert.equal(await h.render().eject(), false);
  assert.equal(h.render().album.id, playable.id);
  h.failPause(false); assert.equal(await h.render().eject(), true);
  assert.equal(h.render().album, null); assert.equal(h.render().state, null);
  assert.equal(h.calls.length, count); assert.equal(h.pauses, 3);
});

test('album stop permits internal transitions, cancels on pause, and verifies the final deadline once', async () => {
  const { createAlbumStop } = load('app/lib/album-stop.ts', { './album-timeline': timeline });
  let callback; let delay; let ends = 0; let actual;
  const stop = createAlbumStop(() => ends++, (fn, ms) => { callback = fn; delay = ms; return 1; }, () => { callback = undefined; }, async () => actual);
  const state = (uri, position, paused = false) => ({ paused, position, duration: 120000, track_window: { current_track: { uri } } });
  stop.reset(playable);
  stop.observe(state('spotify:track:a', 119000)); assert.equal(callback, undefined); assert.equal(ends, 0);
  stop.observe(state('spotify:track:b', 90000)); assert.equal(delay, 30000);
  stop.observe(state('spotify:track:b', 91000, true)); assert.equal(callback, undefined);
  stop.observe(state('spotify:track:b', 119900)); assert.equal(delay, 100);
  actual=state('spotify:track:b',120000); callback(); await Promise.resolve(); assert.equal(ends, 1);
  stop.observe(state('spotify:track:recommendation', 0)); assert.equal(ends, 1);
  stop.reset(playable); stop.observe(state('spotify:track:b', 60000)); assert.equal(delay, 60000);
  stop.reset(null); assert.equal(callback, undefined);
});
test('an out-of-album Spotify recommendation is stopped even when a background deadline was delayed', () => {
  const { createAlbumStop } = load('app/lib/album-stop.ts', { './album-timeline': timeline });
  let ends = 0;
  const stop = createAlbumStop(() => ends++);
  stop.reset(playable);
  stop.observe({ paused: false, position: 119000, duration: 120000, track_window: { current_track: { uri: 'spotify:track:b' } } });
  stop.observe({ paused: false, position: 0, duration: 100000, track_window: { current_track: { uri: 'spotify:track:recommended' } } });
  assert.equal(ends, 1);
});
test('album completion pauses the SDK without REST requests and keeps the sleeve at the end', async () => {
  const h = playerHarness(); await h.render().start(playable); const count = h.calls.length;
  h.state({ paused: false, position: 119000, duration: 120000, track_window: { current_track: { uri: 'spotify:track:b', name: 'Last', album: { uri: 'spotify:album:record' } } } });
  h.state({ paused: false, position: 0, duration: 100000, track_window: { current_track: { uri: 'spotify:track:recommended', name: 'Recommendation', album: { uri: 'spotify:album:other' } } } });
  await Promise.resolve();
  assert.equal(h.pauses, 1); assert.equal(h.calls.length, count);
  assert.equal(h.render().position, 220); assert.equal(h.render().state.playing, false);
  assert.equal(h.render().album.id, playable.id);
});

test('relinked track IDs map to the album; unmatched startup events do not finish it', () => {
 const record={...playable,tracks:[{id:'spotify:original',title:'Song',duration:100}]};
 const state={paused:false,position:10000,duration:100000,track_window:{current_track:{uri:'spotify:track:replacement',linked_from:{uri:'spotify:track:original'},name:'Song',album:{uri:'spotify:album:other'}}}};
 assert.equal(timeline.playbackTrackIndex(record,state),0);
 delete state.track_window.current_track.linked_from;
 state.context={uri:'spotify:album:record'};
 assert.equal(timeline.playbackTrackIndex(record,state),0);
 state.context={uri:'spotify:album:other'};
 assert.equal(timeline.playbackTrackIndex(record,state),-1);
 let ends=0;const guard=load('app/lib/album-stop.ts',{'./album-timeline':timeline}).createAlbumStop(()=>ends++);
 guard.reset(record);guard.observe(state);assert.equal(ends,0);guard.reset(null);
});
test('buffering or stale estimated time cannot stop a final track early', async () => {
 let callback, ends=0;
 const state={paused:false,position:30000,duration:120000,track_window:{current_track:{uri:'spotify:track:b'}}};
 const guard=load('app/lib/album-stop.ts',{'./album-timeline':timeline}).createAlbumStop(()=>ends++,fn=>{callback=fn;return 1;},()=>{},async()=>state);
 guard.reset(playable);guard.observe(state);callback();await Promise.resolve();assert.equal(ends,0);
 state.position=120000;callback();await Promise.resolve();assert.equal(ends,1);
 guard.reset(null);
});
test('unknown playback remains pausable and a valid playing event recovers the old completed state', async () => {
 const h=playerHarness();await h.render().start(playable);
 const value=(uri,position,duration)=>({paused:false,position,duration,track_window:{current_track:{uri,name:'Track',album:{uri:'spotify:album:other'}}}});
 h.state(value('spotify:track:replacement',20000,100000));
 assert.equal(h.render().ended,false);assert.equal(h.render().state.playing,true);
 await h.render().pause();assert.equal(h.pauses,1);
 await h.render().resume();
 h.state(value('spotify:track:b',119000,120000));h.state(value('spotify:track:recommendation',0,100000));
 assert.equal(h.render().ended,true);
 h.state(value('spotify:track:a',20000,100000));
 assert.equal(h.render().ended,false);assert.equal(h.render().state.playing,true);assert.equal(h.render().position,20);
 await h.render().eject();
});

test('scrub release holds its target through delayed commands and stale SDK events', async () => {
 const h=playerHarness();await h.render().start(playable);
 const state=(uri,position)=>({paused:false,position,duration:120000,track_window:{current_track:{uri,name:'Track',album:{uri:'spotify:album:record'}}}});
 h.state(state('spotify:track:a',20000));
 let release;h.respond(()=>new Promise(resolve=>{release=()=>resolve(Response.json({accepted:true}));}));
 const pending=h.render().seek(150);
 assert.equal(h.render().position,150,'Immediately reflects release, before Spotify responds');
 await new Promise(resolve=>setImmediate(resolve));
 h.state(state('spotify:track:a',22000));assert.equal(h.render().position,150);
 release();await pending;
 h.state(state('spotify:track:a',23000));assert.equal(h.render().position,150);
 h.state(state('spotify:track:b',50500));assert.equal(h.render().position,150.5);
 await h.render().eject();
});
test('failed scrub restores confirmed playback instead of leaving a false needle position', async () => {
 const h=playerHarness();await h.render().start(playable);
 h.state({paused:false,position:20000,duration:100000,track_window:{current_track:{uri:'spotify:track:a',name:'Track',album:{uri:'spotify:album:record'}}}});
 h.respond(()=>Response.json({error:'Seek rejected'},{status:503}));
 assert.equal(await h.render().seek(150),false);
 assert.equal(h.render().position,20);assert.match(h.render().error,/Seek rejected/);
 await h.render().eject();
});

test('stale account playback commands never reach Spotify', async () => {
  let calls=0;
  const api=route(async()=>{calls++;return Response.json({});},{accountChanged:true});
  assert.equal((await api.POST(post({action:'pause'}))).status,409);
  assert.equal(calls,0);
});

test('pause confirms SDK state and falls back once for no-op, rejected or stalled SDK calls', async () => {
 const {pausePlayer}=load('app/lib/pause-player.ts');
 let fallbacks=0;
 const fallback=async()=>{fallbacks++;};
 const confirmed={paused:true};
 assert.equal(await pausePlayer({pause:async()=>{},getCurrentState:async()=>confirmed},fallback,10),confirmed);
 assert.equal(fallbacks,0);
 for(const pause of [async()=>{},async()=>{throw Error('Failed');},()=>new Promise(()=>{})]){
   assert.equal(await pausePlayer({pause,getCurrentState:async()=>({paused:false})},fallback,10),null);
 }
 assert.equal(fallbacks,3);
 await assert.rejects(pausePlayer({pause:async()=>{},getCurrentState:async()=>null},async()=>{throw Error('Quota');},10),/Quota/);
});

test('unavailable tracks are excluded from the needle timeline without changing Spotify offsets',()=>{
 const record={...playable,tracks:[{id:'spotify:grey1',duration:90,playable:false},{id:'spotify:a',duration:100},{id:'spotify:grey2',duration:40,playable:false},{id:'spotify:b',duration:120},{id:'spotify:grey3',duration:80,playable:false}]};
 assert.equal(timeline.albumDuration(record),220);
 assert.deepEqual(timeline.albumCue(record,0),{trackIndex:1,positionMs:0,position:0});
 assert.deepEqual(timeline.albumCue(record,130),{trackIndex:3,positionMs:30000,position:130});
 assert.equal(timeline.albumProgress(record,'spotify:track:b',30),130);
 assert.equal(timeline.lastPlayableTrackIndex(record),3);
 assert.equal(timeline.albumCue({tracks:record.tracks.map(t=>({...t,playable:false}))},10).trackIndex,-1);
});
test('play skips unavailable opening tracks and rejects an entirely unavailable album without requests',async()=>{
 const h=playerHarness();
 assert.equal(await h.render().start({...playable,tracks:playable.tracks.map(t=>({...t,playable:false}))}),false);assert.equal(h.calls.length,0);assert.match(h.render().error,/no playable tracks/);
 const record={...playable,tracks:[{...playable.tracks[0],playable:false},playable.tracks[1]]};
 assert.equal(await h.render().start(record),true);assert.equal(h.calls.at(-1).trackIndex,1);assert.equal(h.render().position,0);await h.render().eject();
});
test('only explicit track-unavailable errors skip forward, with bounded attempts',async()=>{
 const h=playerHarness();h.respond(body=>body.action==='play'&&body.trackIndex===0?Response.json({reason:'TRACK_NOT_PLAYABLE',error:'Unavailable'},{status:403}):Response.json({accepted:true}));
 assert.equal(await h.render().start(playable),true);assert.deepEqual(h.calls.filter(c=>c.action==='play').map(c=>c.trackIndex),[0,1]);assert.equal(h.render().album.tracks[0].playable,false);await h.render().eject();
 const failed=playerHarness();failed.respond(body=>body.action==='play'?Response.json({error:'No response'},{status:503}):Response.json({accepted:true}));
 assert.equal(await failed.render().start(playable),false);assert.equal(failed.calls.filter(c=>c.action==='play').length,1);
 const many=playerHarness();many.respond(body=>body.action==='play'?Response.json({reason:'TRACK_NOT_PLAYABLE',error:'Unavailable'},{status:403}):Response.json({accepted:true}));
 await many.render().start({...playable,tracks:Array.from({length:10},(_,i)=>({...playable.tracks[0],id:'spotify:t'+i}))});
 assert.equal(many.calls.filter(c=>c.action==='play').length,3);
});
test('end guard stops after last playable song even when the album ends with greyed tracks',()=>{
 let ends=0;const guard=load('app/lib/album-stop.ts',{'./album-timeline':timeline}).createAlbumStop(()=>ends++);
 const record={...playable,tracks:[playable.tracks[0],{...playable.tracks[1],playable:false}]};guard.reset(record);
 const state={paused:false,position:99500,duration:100000,track_window:{current_track:{uri:'spotify:track:a',name:'A',album:{uri:'spotify:album:record'}}}};
 guard.observe(state);guard.observe({...state,paused:true,position:0});assert.equal(ends,1);
});
test('relinked imported tracks recognize the original URI from Spotify playback',()=>{
 const record={...playable,tracks:[{...playable.tracks[0],id:'spotify:replacement',linkedFrom:'spotify:original'}]};
 assert.equal(timeline.playbackTrackIndex(record,{paused:false,position:1,duration:100000,track_window:{current_track:{uri:'spotify:track:original',name:'Original',album:{uri:'spotify:album:other'}}}}),0);
});

test('missing Spotify device reconnects once and repeated device failures stay bounded',async()=>{
 const h=playerHarness();let missing=true;
 h.respond(()=>{if(missing){missing=false;return Response.json({error:'Device missing',reason:'NO_ACTIVE_DEVICE'},{status:404});}return Response.json({accepted:true});});
 assert.equal(await h.render().start(playable),true);assert.equal(h.connections,2);assert.equal(h.render().state.playing,true);
 await h.render().eject();
 const broken=playerHarness();broken.respond(()=>Response.json({error:'Device missing'},{status:404}));
 assert.equal(await broken.render().start(playable),false);assert.equal(broken.connections,2);assert.equal(broken.calls.length,2);assert.equal(broken.render().state,null);
 const uncertain=playerHarness();uncertain.respond(()=>{throw new Error('Network timeout');});
 assert.equal(await uncertain.render().start(playable),false);assert.equal(uncertain.connections,1);assert.equal(uncertain.calls.length,1);
});
test('Play after device loss reconnects and restores the record at its last position',async()=>{
 const h=playerHarness();await h.render().start(playable);
 h.state({paused:false,position:42000,duration:100000,track_window:{current_track:{uri:'spotify:track:a',name:'Track',album:{uri:'spotify:album:record'}}}});
 h.disconnect();assert.equal(h.render().state,null);
 assert.equal(await h.render().resume(),true);assert.equal(h.connections,2);assert.equal(h.calls.at(-1).action,'play');assert.equal(h.calls.at(-1).positionMs,42000);assert.equal(h.render().state.playing,true);
 await h.render().eject();
});
