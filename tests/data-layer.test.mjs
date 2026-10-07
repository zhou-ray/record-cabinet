import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function load(file) {
  const filename = path.resolve(__dirname, '..', file);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText;
  const compiled = { exports: {} };
  const evaluate = vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename });
  evaluate((name) => name.startsWith('.') ? load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(filename), name + '.ts'))) : (() => { throw new Error(`Unexpected import ${name}`); })(), compiled, compiled.exports);
  return compiled.exports;
}
const { mockLibrary } = load('app/data/mock.ts');
const { getBins } = load('app/catalog.ts');
const { createSpotifyLibrary, normalizeSpotifyAlbum } = load('app/data/spotify.ts');
const track = (id, disc, number) => ({ id, name: id || 'Unavailable', disc_number: disc, track_number: number, duration_ms: 120500 });
const album = { id: 'abc', name: 'Example', uri: 'spotify:album:abc', artists: [{ id: 'a', name: 'Artist A' }, { id: 'b', name: 'Artist B' }], tracks: { items: [track('t1', 1, 1)], next: null } };

test('mock provider preserves 15 playable albums and returns independent snapshots', async () => {
  const first = await mockLibrary.getAlbums();
  assert.equal(first.length, 15);
  for (const item of first) assert.ok(fs.existsSync(path.join(__dirname, '../public', item.playback.url)));
  first[0].title = 'Changed';
  assert.equal((await mockLibrary.getAlbums())[0].title, 'Sunroom');
  assert.equal(new Set(getBins(first, 'artist').flatMap(bin => bin.albums.map(album => album.id))).size, 15);
});
test('normalization handles missing artwork, genres, dates and multi-disc ordering', () => {
  const value = normalizeSpotifyAlbum(album, [track(null, 2, 1), track('t1', 1, 1)]);
  assert.equal(value.artworkUrl, null);
  assert.equal(value.year, 'Unknown year');
  assert.equal(value.genre, 'Uncategorized');
  assert.equal(value.tracks[0].duration, 120.5);
  assert.equal(value.tracks[0].id, 'spotify:t1');
  assert.equal(value.tracks[1].id, 'spotify:abc:2:1');
  assert.deepEqual(value.playback, { kind: 'spotify', uri: album.uri });
});
test('grouping handles collaborations, duplicates, empty shelves and unknown genres', () => {
  const value = normalizeSpotifyAlbum(album);
  assert.equal(getBins([value, value], 'artist').length, 1);
  assert.ok(getBins([value, value], 'artist').every(bin => bin.albums.length === 1));
  assert.equal(getBins([value], 'genre')[0].label, 'Uncategorized');
  assert.deepEqual(getBins([], 'artist'), []);
});
test('provider follows both pagination levels and deduplicates saved albums', async () => {
  const calls = [];
  const nextAlbums = 'https://api.spotify.com/v1/me/albums?offset=1';
  const nextTracks = 'https://api.spotify.com/v1/albums/abc/tracks?offset=1';
  const provider = createSpotifyLibrary(async (url) => {
    calls.push(url);
    if (url === nextAlbums) return { items: [{ album }, { album: null }], next: null };
    if (url === nextTracks) return { items: [track('t2', 2, 1)], next: null };
    return { items: [{ album: { ...album, tracks: { ...album.tracks, next: nextTracks } } }], next: nextAlbums };
  });
  const result = await provider.getAlbums();
  assert.equal(result.length, 1);
  assert.equal(result[0].tracks.length, 2);
  assert.equal(calls.length, 3);
});
test('provider rejects foreign pagination URLs and propagates authorization errors', async () => {
  const unsafe = createSpotifyLibrary(async () => ({ items: [], next: 'https://example.com/steal' }));
  await assert.rejects(unsafe.getAlbums(), /Invalid Spotify pagination/);
  const failure = new Error('Unauthorized');
  await assert.rejects(createSpotifyLibrary(async () => { throw failure; }).getAlbums(), /Unauthorized/);
});
test('provider forwards abort signals to requests', async () => {
  const controller = new AbortController();
  const provider = createSpotifyLibrary(async (_, signal) => {
    assert.equal(signal, controller.signal);
    return { items: [], next: null };
  });
  assert.deepEqual(await provider.getAlbums(controller.signal), []);
});
test('import reports each album before later track pages finish', async () => {
  const events = [];
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const second = { ...album, id: 'second', tracks: { items: [], next: 'https://api.spotify.com/v1/albums/second/tracks' } };
  const provider = createSpotifyLibrary(async url => {
    if (url.includes('/albums/second/tracks')) { await waiting; return { items: [track('second-track', 1, 1)], next: null }; }
    return { items: [{ album }, { album: second }], next: null };
  }, progress => events.push(progress));
  const result = provider.getAlbums();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(events.filter(event => event.album).length, 1);
  assert.equal(events.at(-1).loaded, 1);
  assert.equal(events.at(-1).total, 2);
  release();
  await result;
  assert.equal(events.at(-1).loaded, 2);
});
test('first-page albums arrive before subsequent saved-album pages respond', async () => {
  const events = [];
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const provider = createSpotifyLibrary(async url => {
    if (url.includes('offset=50')) { await waiting; return { items: [], next: null, total: 1 }; }
    return { items: [{ album }], next: 'https://api.spotify.com/v1/me/albums?offset=50', total: 1 };
  }, progress => events.push(progress));
  const result = provider.getAlbums();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(events.find(event => event.album)?.album.id, 'spotify:abc');
  release();
  await result;
});

test('alphabetical bins allow twelve while genre grouping stays configurable and records deduplicate', () => {
  const records = Array.from({ length: 40 }, (_, i) => normalizeSpotifyAlbum({ ...album, id: `a${i}`, artists: [{ id: `artist${i}`, name: `${String.fromCharCode(65 + i % 26)} Artist ${i}` }] }));
  for (const arrangement of ['artist', 'genre']) {
    const bins = getBins(records.map((item, i) => ({ ...item, genres: [`Genre ${i}`] })), arrangement, undefined, 6);
    assert.equal(bins.length, arrangement === "artist" ? 12 : 6);
    assert.equal(new Set(bins.flatMap(bin => bin.albums.map(album => album.id))).size, 40);
  }
  assert.equal(getBins([...records, ...records], 'all')[0].albums.length, 40);
});
test('custom systems keep unassigned records visible and deleted bins return records to Unfiled', () => {
  const record = normalizeSpotifyAlbum(album);
  const system = { id: 'mine', name: 'Moods', bins: [{ id: 'quiet', label: 'Quiet mornings' }], assignments: { [record.id]: 'quiet' } };
  assert.equal(getBins([record], 'custom', system)[0].albums.length, 1);
  assert.equal(getBins([record], 'custom', { ...system, bins: [] })[0].label, 'Unfiled');
  assert.equal(getBins([record], 'custom')[0].albums.length, 1);
});
test('playlist and liked imports fetch complete albums once across pages and skip non-music', async () => {
  for (const source of ['liked', 'playlist:example']) {
    const calls = [];
    const events = [];
    const next = source === 'liked' ? 'https://api.spotify.com/v1/me/tracks?offset=50' : 'https://api.spotify.com/v1/playlists/example/items?offset=50';
    const nextTracks = 'https://api.spotify.com/v1/albums/abc/tracks?offset=1';
    const music = { type: 'track', album: { id: 'abc' } };
    const provider = createSpotifyLibrary(async url => {
      calls.push(url);
      if (url === nextTracks) return { items: [track('t2', 1, 2)], next: null };
      if (url === 'https://api.spotify.com/v1/albums/abc') return { ...album, tracks: { ...album.tracks, next: nextTracks } };
      if (url === next) return { items: [{ track: music }], next: null };
      return { items: [{ item: music }, { track: music }, { track: null }, { item: { type: 'episode' } }, { is_local: true, track: { ...music, album: { id: 'local' } } }], next };
    }, event => events.push(event), source);
    const result = await provider.getAlbums();
    assert.equal(result.length, 1);
    assert.equal(result[0].tracks.length, 2);
    assert.equal(calls.filter(url => url === 'https://api.spotify.com/v1/albums/abc').length, 1);
    assert.ok(calls[0].includes(source === 'liked' ? '/me/tracks' : '/playlists/example/items'));
    assert.equal(events.at(-1).total, 1);
  }
});

test('playlist imports reject unsafe pagination and propagate denied access', async () => {
  const unsafe = createSpotifyLibrary(async () => ({ items: [], next: 'https://example.com/steal' }), undefined, 'liked');
  await assert.rejects(unsafe.getAlbums(), /Invalid Spotify pagination/);
  const denied = createSpotifyLibrary(async () => { throw new Error('403'); }, undefined, 'playlist:example');
  await assert.rejects(denied.getAlbums(), /403/);
});

 test('artist ranges keep shared initials together and allow different record counts', () => {
  const records = ['Alice', 'Amelia', 'Björk', 'David', 'Zoë', '123 Band', 'Élodie'].map((name, i) => normalizeSpotifyAlbum({ ...album, id: `range${i}`, artists: [{ id: `artist${i}`, name }] }));
  const bins = getBins(records, 'artist');
  assert.deepEqual(bins.map(bin => bin.label), ['#', 'A', 'B', 'D', 'E', 'Z']);
  assert.deepEqual(bins.map(bin => bin.albums.length), [1, 2, 1, 1, 1, 1]);
});

const { binNameError, fileAlbums, removeBin, shouldReturnRecord } = load('app/lib/bin-organization.ts');
test('bin setup requires distinct named bins and allows room to add bins later', () => {
  assert.equal(binNameError(['Mornings']), null);
  assert.equal(binNameError(['Mornings', 'Evenings', 'Favorites']), null);
  assert.ok(binNameError(['Mornings', ' mornings ']));
  assert.ok(binNameError(['Mornings', ' ']));
  assert.ok(binNameError(Array.from({ length: 6 }, (_, i) => `Bin ${i}`)));
});
test('bulk filing and album-page refiling preserve records across named bins and Unfiled', () => {
  const records = ['a', 'b', 'c'].map(id => normalizeSpotifyAlbum({ ...album, id }));
  const original = { id: 'system', name: 'Moods', bins: [{ id: 'morning', label: 'Morning' }, { id: 'night', label: 'Night' }], assignments: {} };
  const filed = fileAlbums(original, [records[0].id, records[1].id], 'morning');
  assert.deepEqual(original.assignments, {});
  const refiled = fileAlbums(filed, [records[0].id], 'night');
  assert.equal(getBins(records, 'custom', refiled).find(bin => bin.id === 'morning').albums.length, 1);
  assert.equal(getBins(records, 'custom', refiled).find(bin => bin.id === 'night').albums.length, 1);
  assert.equal(getBins(records, 'custom', refiled).find(bin => bin.id === 'unfiled').albums.length, 1);
  const unfiled = fileAlbums(refiled, [records[0].id], '');
  assert.equal(getBins(records, 'custom', unfiled).find(bin => bin.id === 'unfiled').albums.length, 2);
  assert.equal(fileAlbums(refiled, [records[0].id], 'missing'), refiled);
});
test('removing a custom bin unfiles its records while leaving other bins intact', () => {
  const system = { id: 'system', name: 'Moods', bins: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], assignments: { first: 'a', second: 'b' } };
  const next = removeBin(system, 'a');
  assert.deepEqual(next.assignments, { second: 'b' });
  assert.deepEqual(next.bins, [{ id: 'b', label: 'B' }]);
  assert.deepEqual(system.assignments, { first: 'a', second: 'b' });
});
test('downward swipe returns a pulled record; taps, horizontal drags, upward swipes, and cancellation do not', () => {
  assert.equal(shouldReturnRecord(8, 80, 0, false), true);
  assert.equal(shouldReturnRecord(4, 24, 700, false), true);
  assert.equal(shouldReturnRecord(0, 3, 700, false), false);
  assert.equal(shouldReturnRecord(100, 60, 700, false), false);
  assert.equal(shouldReturnRecord(0, -80, -700, false), false);
  assert.equal(shouldReturnRecord(0, 100, 700, true), false);
});

test('playlist and liked imports skip saved album details across pages but still find new albums', async () => {
  for (const source of ['liked', 'playlist:example']) {
    const calls = [];
    const events = [];
    const next = source === 'liked' ? 'https://api.spotify.com/v1/me/tracks?offset=50' : 'https://api.spotify.com/v1/playlists/example/items?offset=50';
    const entry = id => ({ track: { type: 'track', album: { id } } });
    const provider = createSpotifyLibrary(async url => {
      calls.push(url);
      if (url === next) return { items: [entry('abc'), entry('new')], next: null };
      if (url.endsWith('/albums/new')) return { ...album, id: 'new' };
      if (url.includes('/albums/')) throw new Error('Fetched an already-saved album');
      return { items: [entry('abc'), entry('abc')], next };
    }, event => events.push(event), source, ['spotify:abc']);
    const imported = await provider.getAlbums();
    assert.deepEqual(imported.map(item => item.id), ['spotify:new']);
    assert.equal(calls.length, 3);
    assert.equal(events.at(-1).loaded, 1);
    assert.equal(events.at(-1).skipped, 1);
    assert.equal(events.at(-1).total, 2);
  }
});
test('saved album imports skip track pagination for albums already in the collection', async () => {
  const calls = [];
  const events = [];
  const provider = createSpotifyLibrary(async url => {
    calls.push(url);
    if (url !== 'https://api.spotify.com/v1/me/albums?limit=50') throw new Error('Refetched cached tracks');
    return { items: [{ album: { ...album, tracks: { ...album.tracks, next: 'https://api.spotify.com/v1/albums/abc/tracks?offset=50' } } }, { album }], next: null };
  }, event => events.push(event), 'saved', ['spotify:abc']);
  assert.deepEqual(await provider.getAlbums(), []);
  assert.equal(calls.length, 1);
  assert.equal(events.at(-1).skipped, 1);
  assert.equal(events.at(-1).loaded, 0);
});
test('retrying an interrupted playlist fetches only unfinished albums', async () => {
  const savedIds = [];
  const entries = { items: ['abc', 'new'].map(id => ({ item: { type: 'track', album: { id } } })), next: null };
  const first = createSpotifyLibrary(async url => {
    if (url.endsWith('/albums/abc')) return album;
    if (url.endsWith('/albums/new')) throw new Error('Interrupted');
    return entries;
  }, event => { if (event.album) savedIds.push(event.album.id); }, 'liked');
  await assert.rejects(first.getAlbums(), /Interrupted/);
  assert.deepEqual(savedIds, ['spotify:abc']);
  const calls = [];
  const retry = createSpotifyLibrary(async url => {
    calls.push(url);
    if (url.endsWith('/albums/new')) return { ...album, id: 'new' };
    if (url.endsWith('/albums/abc')) throw new Error('Downloaded completed album again');
    return entries;
  }, undefined, 'liked', savedIds);
  assert.deepEqual((await retry.getAlbums()).map(item => item.id), ['spotify:new']);
  assert.equal(calls.length, 2);
});

test('batch checkpoint resumes within a page without loading completed albums again', async () => {
 const entries=['a','b','c'].map(id=>({track:{album:{id}}})); const calls=[];let checkpoint;
 const request=async url=>{calls.push(url);return url.includes('/albums/')?{...album,id:url.split('/').at(-1)}:{items:entries,next:null};};
 const first=await createSpotifyLibrary(request,event=>{checkpoint=event.checkpoint},'liked',[],{batchSize:2}).getAlbums();
 assert.deepEqual(first.map(a=>a.id),['spotify:a','spotify:b']);assert.equal(checkpoint.index,2);
 calls.length=0;
 const next=await createSpotifyLibrary(request,event=>{checkpoint=event.checkpoint},'liked',first.map(a=>a.id),{batchSize:2,checkpoint}).getAlbums();
 assert.deepEqual(next.map(a=>a.id),['spotify:c']);assert.equal(calls.length,2);assert.equal(checkpoint,null);
});
test('completed source pages are not fetched again, including duplicate-only batches',async()=>{
 let checkpoint; const calls=[];
 const request=async url=>{calls.push(url); const offset=Number(new URL(url).searchParams.get('offset')||0);return {items:[{album}],next:offset<100?`https://api.spotify.com/v1/me/albums?offset=${offset+50}`:null};};
 await createSpotifyLibrary(request,event=>{checkpoint=event.checkpoint},'saved',['spotify:abc'],{maxPages:2}).getAlbums();
 assert.equal(calls.length,2);assert.ok(checkpoint.pageUrl.endsWith('offset=100'));
 calls.length=0;await createSpotifyLibrary(request,undefined,'saved',['spotify:abc'],{checkpoint}).getAlbums();assert.deepEqual(calls,['https://api.spotify.com/v1/me/albums?offset=100']);
});
test('an interrupted album leaves checkpoint before that album and resumes there',async()=>{
 let checkpoint;const request=async url=>{if(url.endsWith('/albums/b'))throw new Error('QUOTA_EXCEEDED');if(url.endsWith('/albums/a'))return {...album,id:'a'};return {items:['a','b'].map(id=>({track:{album:{id}}})),next:null};};
 await assert.rejects(createSpotifyLibrary(request,event=>{checkpoint=event.checkpoint},'liked').getAlbums(),/QUOTA/);
 assert.equal(checkpoint.index,1);
 const calls=[];await createSpotifyLibrary(async url=>{calls.push(url);return url.endsWith('/albums/b')?{...album,id:'b'}:{items:['a','b'].map(id=>({track:{album:{id}}})),next:null};},undefined,'liked',['spotify:a'],{checkpoint}).getAlbums();
 assert.equal(calls.some(url=>url.endsWith('/albums/a')),false);
});
test('checkpoints reject another source, foreign URLs, and invalid positions before requests',async()=>{
 const {parseImportCheckpoint}=load('app/data/spotify.ts');
 for(const checkpoint of [{source:'saved',pageUrl:'https://api.spotify.com/v1/me/albums',index:0},{source:'liked',pageUrl:'https://evil.test/v1/me/tracks',index:0},{source:'liked',pageUrl:'https://api.spotify.com/v1/me/tracks',index:-1},{source:'liked',pageUrl:'https://api.spotify.com/v1/me/tracks?token=secret',index:0}]) assert.throws(()=>parseImportCheckpoint(checkpoint,'liked'));
});
test('backup validation round-trips album metadata and strips unknown fields',async()=>{
 const {parseBackup}=load('app/lib/collection-backup.ts');
 const albums=await mockLibrary.getAlbums();
 const backup={format:'record-cabinet',version:1,albums:[{...albums[0],accessToken:'never-export'},normalizeSpotifyAlbum(album)],organization:{systems:[],systemId:'',arrangement:'all'}};
 const parsed=parseBackup(backup);assert.equal(parsed.albums.length,2);assert.equal('accessToken' in parsed.albums[0],false);assert.equal(parsed.organization.arrangement,'all');
 for(const bad of [{...backup,version:2},{...backup,albums:[{...albums[0],playback:{kind:'local',url:'https://evil.test/audio.wav'}}]},{...backup,albums:[{...albums[0],tracks:[{...albums[0].tracks[0],duration:-1}]}]}])assert.throws(()=>parseBackup(bad));
});
test('restoring conflicting systems retains current bins and repeated restore is idempotent',()=>{
 const {mergeOrganization}=load('app/lib/collection-backup.ts');
 const original={id:'sys',name:'Mine',bins:[{id:'b',label:'Morning'}],assignments:{'spotify:a':'b'}};
 const current={systems:[original],systemId:'sys',arrangement:'custom'};
 const incoming={...current,systems:[{...original,name:'Backup'}]};
 const merged=mergeOrganization(current,incoming,()=> 'copy');assert.equal(merged.systems.length,2);assert.deepEqual(merged.systems[0],original);assert.equal(merged.systems[1].id,'copy');
 // Exact original backup is recognized even when its restored display name differs.
 const repeated=mergeOrganization(merged,incoming,()=> 'copy2');assert.equal(repeated.systems.length,2);
});
test('reordering bins preserves every album assignment and respects shelf edges',()=>{
 const {reorderBin}=load('app/lib/bin-organization.ts');const system={id:'s',name:'Bins',bins:[{id:'a',label:'A'},{id:'b',label:'B'}],assignments:{record:'a'}};
 const next=reorderBin(system,'b',-1);assert.deepEqual(next.bins.map(b=>b.id),['b','a']);assert.deepEqual(next.assignments,system.assignments);assert.equal(reorderBin(system,'a',-1),system);assert.equal(reorderBin(system,'missing',1),system);
});

test('manual records normalize details, support tracklists, and survive backup validation',()=>{
 const {createManualAlbum,matchingAlbum}=load('app/lib/manual-album.ts');
 const input={title:'  Blue Train ',artist:' John Coltrane ',year:'1957',genre:'Jazz',tracks:'Blue Train\n\nMoment’s Notice\r\n',note:' A favorite ',color:'moss'};
 const record=createManualAlbum(input,'test-id');
 assert.equal(record.title,'Blue Train');assert.equal(record.source,'manual');assert.equal(record.playback.kind,'none');assert.equal(record.tracks.length,2);assert.equal(record.tracks[1].number,2);
 assert.equal(matchingAlbum([record],'blue  train','JOHN COLTRANE'),record);
 assert.equal(matchingAlbum([record],'Blue Train (Mono)','John Coltrane'),undefined);
 const {parseBackup}=load('app/lib/collection-backup.ts');
 assert.deepEqual(parseBackup({format:'record-cabinet',version:1,albums:[record],organization:{systems:[],systemId:'',arrangement:'artist'}}).albums,[record]);
 assert.throws(()=>createManualAlbum({...input,title:' '},'id'),/title and artist/);
 assert.throws(()=>createManualAlbum({...input,year:'57'},'id'),/four-digit/);
 assert.equal(createManualAlbum({...input,year:'',tracks:''},'id').tracks.length,0);
});

test('Spotify album links accept shared links and reject other sources before lookup',()=>{
 const {spotifyAlbumId}=load('app/lib/spotify-album-link.ts');
 for(const link of ['spotify:album:abc123','https://open.spotify.com/album/abc123?si=test','https://open.spotify.com/intl-de/album/abc123']) assert.equal(spotifyAlbumId(link),'abc123');
 for(const link of ['https://example.com/album/abc','https://open.spotify.com/track/abc','https://open.spotify.com/playlist/abc','http://open.spotify.com/album/abc','https://open.spotify.com.evil.test/album/abc'])assert.throws(()=>spotifyAlbumId(link));
});
test('single album lookup loads complete track metadata without scanning the library',async()=>{
 const {loadSpotifyAlbum}=load('app/data/spotify.ts');const calls=[];
 const record=await loadSpotifyAlbum(async url=>{calls.push(url);return url.endsWith('/albums/abc')?{...album,tracks:{items:[track('one',1,1)],next:'https://api.spotify.com/v1/albums/abc/tracks?offset=1'}}:{items:[track('two',2,1)],next:null};},'abc');
 assert.equal(calls.length,2);assert.equal(record.tracks.length,2);assert.equal(record.playback.uri,'spotify:album:abc');
 await assert.rejects(loadSpotifyAlbum(async()=>({...album,tracks:{items:[],next:'https://evil.test/tracks'}}),'abc'),/Invalid Spotify pagination/);
});

test('genre tags collapse into broad useful shelves and preserve unknown tags',()=>{
 const {broadGenres}=load('app/lib/genres.ts');
 assert.deepEqual(broadGenres(['bebop','jazz','alternative rock','neo soul','deep house','hip-hop']),['Jazz','Rock','Soul & R&B','Electronic','Hip-Hop']);
 assert.deepEqual(broadGenres(['','uncategorized']),[]);
 assert.deepEqual(broadGenres(['bluegrass','baroque','bossa nova','dancehall']),['Folk & Country','Classical','Latin','Reggae']);
 assert.deepEqual(broadGenres(['experimental']),['Experimental']);
});
test('genre resolution caches artist tags including empty results and retries failed lookups',async()=>{
 const {createGenreResolver,GENRE_CACHE_AGE}=load('app/lib/genres.ts');let calls=0;let now=100;const cache={};
 const resolve=createGenreResolver(async()=>{calls++;return {genres:['indie rock']};},cache,()=>now);
 await resolve('spotify:a');await resolve('spotify:a');assert.equal(calls,1);
 now+=GENRE_CACHE_AGE;await resolve('spotify:a');assert.equal(calls,2);
 const empty=createGenreResolver(async()=>{calls++;return {genres:[]};},cache,()=>now);
 await empty('spotify:b');await empty('spotify:b');assert.equal(calls,3);
 const failure=createGenreResolver(async()=>{throw new Error('429');},cache,()=>now);
 await assert.rejects(failure('spotify:c'),/429/);assert.equal(cache['spotify:c'],undefined);
});
test('cached artist tags fill all matching missing albums without changing existing genre labels',()=>{
 const {applyArtistGenres,missingGenreArtists}=load('app/lib/genres.ts');
 const one=normalizeSpotifyAlbum(album);const two={...one,id:'spotify:other'};
 const cache={'spotify:a':{genres:['jazz fusion'],checkedAt:Date.now()},'spotify:b':{genres:[],checkedAt:Date.now()}};
 assert.equal(applyArtistGenres(one,cache).genre,'Jazz');assert.equal(applyArtistGenres(two,cache).genre,'Jazz');
 const labeled={...one,genres:['Rock'],genre:'Rock'};assert.equal(applyArtistGenres(labeled,cache),labeled);
 assert.deepEqual(missingGenreArtists([one,two],{}),['spotify:a','spotify:b']);assert.deepEqual(missingGenreArtists([one,two],cache),[]);
 assert.equal(applyArtistGenres(one,{}),one);
});
test('album metadata takes precedence over artist tags during normalization',()=>{
 assert.deepEqual(normalizeSpotifyAlbum({...album,genres:['jazz'],artists:[{id:'a',name:'Artist',genres:['rock']}]}).genres,['Jazz']);
 assert.deepEqual(normalizeSpotifyAlbum({...album,genres:[],artists:[{id:'a',name:'Artist',genres:['neo soul']}]}).genres,['Soul & R&B']);
});

test('manual genres support multiple labels, preserve artist overrides, and apply future defaults', () => {
 const g=load('app/lib/manual-genres.ts');
 const record={id:'a',artists:[{id:'spotify:artist',name:'Artist'}],artist:'Artist',genres:[],genre:'Uncategorized'};
 assert.deepEqual(g.genreLabels([' Jazz ','jazz','Experimental  pop']),['Jazz','Experimental pop']);
 const records=[record,{...record,id:'b',genres:['Rock']},{...record,id:'c',genresEdited:true}];
 const edited=g.editGenres(records,['a'],['Jazz','Soul & R&B'],'replace','spotify:artist');
 assert.deepEqual(edited.map(a=>a.id),['a']);
 assert.deepEqual(g.editGenres(records,['b'],['Jazz'],'add')[0].genres,['Rock','Jazz']);
 assert.deepEqual(g.editGenres(records,['b'],[],'replace')[0].genres,[]);
 assert.deepEqual(g.applyGenreDefaults(record,{'spotify:artist':['Jazz']}).genres,['Jazz']);
 assert.equal(g.applyGenreDefaults(records[2],{'spotify:artist':['Jazz']}),records[2]);
 assert.throws(()=>g.genreLabels(['a'.repeat(61)]));
});

test('null library and playlist entries do not stop imports or lose the following album', async () => {
  for (const source of ['saved', 'liked', 'playlist:example']) {
    const events = [], calls = [];
    const result = await createSpotifyLibrary(async url => {
      calls.push(url);
      if (url.includes('/v1/albums/')) return album;
      return { items: [null, source === 'saved' ? {album} : {track:{type:'track',album:{id:album.id}}}], next:null };
    }, event => events.push(event), source).getAlbums();
    assert.equal(result.length,1);
    assert.equal(result[0].id,'spotify:abc');
    assert.equal(events.at(-1).checkpoint,null);
    assert.equal(calls.length,source==='saved'?1:2);
  }
});
test('saved album summaries fetch missing track data once and skip already imported IDs', async () => {
  const {tracks, ...summary}=album;
  const calls=[];
  const request=async url=>{calls.push(url);return url.includes('/v1/albums/')?album:{items:[{album:summary},{album:summary}],next:null};};
  const albums=await createSpotifyLibrary(request).getAlbums();
  assert.equal(albums.length,1);assert.equal(albums[0].tracks.length,tracks.items.length);assert.equal(calls.length,2);
  calls.length=0;
  assert.deepEqual(await createSpotifyLibrary(request,undefined,'saved',['spotify:abc']).getAlbums(),[]);
  assert.equal(calls.length,1);
});
test('invalid album pages report a typed error without moving past the unfinished album', async () => {
  const events=[];
  const provider=createSpotifyLibrary(async url=>url.includes('/v1/albums/')?{...album,tracks:null}:{items:[{album:{...album,tracks:null}}],next:null},event=>events.push(event));
  await assert.rejects(provider.getAlbums(),error=>error.code==='INVALID_PAGE');
  assert.equal(events.at(-1).checkpoint.index,0);
  assert.ok(events.every(event=>!event.album));
});

test('playlist page boundaries accept Spotify market/type parameters and old tracks links', async () => {
  const events=[],calls=[];
  const next='https://api.spotify.com/v1/playlists/example/tracks?offset=50&limit=50&market=US&additional_types=track%2Cepisode';
  const result=await createSpotifyLibrary(async url=>{
    calls.push(url);
    if(url.includes('/v1/albums/'))return {...album,id:url.split('/').at(-1)};
    const second=new URL(url).searchParams.has('offset');
    return {items:[{item:{type:'track',album:{id:second?'second':'first'}}}],next:second?null:next};
  },event=>events.push(event),'playlist:example').getAlbums();
  assert.deepEqual(result.map(a=>a.id),['spotify:first','spotify:second']);
  assert.ok(calls.some(url=>url.includes('/items?offset=50') && !url.includes('market=')));
  assert.ok(events.some(e=>e.checkpoint?.pageUrl.includes('/items?offset=50')));
});
test('resume accepts existing compatible checkpoints without loosening source or host restrictions', () => {
  const {parseImportCheckpoint}=load('app/data/spotify.ts');
  const make=pageUrl=>({source:'playlist:example',pageUrl,index:3});
  const parsed=parseImportCheckpoint(make('https://api.spotify.com/v1/playlists/example/tracks?offset=100&limit=50&additional_types=track%2Cepisode'),'playlist:example');
  assert.equal(parsed.index,3);assert.match(parsed.pageUrl,/example\/items/);
  for(const url of ['https://example.com/v1/playlists/example/items?offset=100','https://api.spotify.com/v1/playlists/other/items?offset=100','https://api.spotify.com/v1/playlists/example/items?offset=1&offset=9','https://api.spotify.com/v1/playlists/example/items?access_token=private']) {
    assert.throws(()=>parseImportCheckpoint(make(url),'playlist:example'),e=>e.code==='INVALID_PAGINATION');
  }
});
test('rescanning duplicate-only pages never fetches album or track details',async()=>{
  const calls=[];let checkpoint;
  const request=async url=>{
    calls.push(url);assert.ok(!url.includes('/v1/albums/'),'No per-album request for a saved record');
    return {items:[{item:{type:'track',album:{id:'abc'}}},{item:{type:'track',album:{id:'abc'}}}],next:null};
  };
  const records=await createSpotifyLibrary(request,e=>{checkpoint=e.checkpoint;},'playlist:example',['spotify:abc']).getAlbums();
  assert.equal(records.length,0);assert.equal(calls.length,1);assert.equal(checkpoint,null);
});

test('a bad next-page link cannot discard a fully loaded album or cause it to be downloaded again',async()=>{
 const ids=[];let checkpoint;let detailCalls=0;
 const request=async url=>{if(url.includes('/v1/albums/')){detailCalls++;return album;}return {items:[{track:{album:{id:'abc'}}}],next:'https://example.com/unsafe'};};
 const save=e=>{checkpoint=e.checkpoint;if(e.album)ids.push(e.album.id);};
 await assert.rejects(createSpotifyLibrary(request,save,'liked').getAlbums(),e=>e.code==='INVALID_PAGINATION');
 assert.deepEqual(ids,['spotify:abc']);assert.equal(checkpoint.index,1);
 await assert.rejects(createSpotifyLibrary(request,save,'liked',ids,{checkpoint}).getAlbums(),e=>e.code==='INVALID_PAGINATION');
 assert.equal(detailCalls,1);
});


test('liked-song next links rebuild pagination without forwarding endpoint defaults', async () => {
 const calls=[]; let checkpoint;
 const next='https://api.spotify.com/v1/me/tracks?offset=50&limit=50&market=&additional_types=track&locale=en-US';
 await createSpotifyLibrary(async url=>{
   calls.push(url);
   return {items:[],next:calls.length===1?next:null};
 },event=>{checkpoint=event.checkpoint;},'liked').getAlbums();
 assert.deepEqual(calls,['https://api.spotify.com/v1/me/tracks?limit=50','https://api.spotify.com/v1/me/tracks?offset=50&limit=50']);
 assert.equal(checkpoint,null);
});
test('rebuilt next links still reject foreign sources and ambiguous pagination',()=>{
 const {nextImportCheckpoint}=load('app/data/spotify.ts');
 for (const link of [
  'https://evil.test/v1/me/tracks?offset=50&limit=50',
  'https://api.spotify.com/v1/me/albums?offset=50&limit=50',
  'https://api.spotify.com/v1/me/tracks?offset=50&offset=100&limit=50',
  'https://api.spotify.com/v1/me/tracks?offset=-1&limit=50',
  'https://api.spotify.com/v1/me/tracks?offset=50&limit=0',
  'https://api.spotify.com/v1/me/tracks?limit=50',
 ]) assert.throws(()=>nextImportCheckpoint(link,'liked'),e=>e.code==='INVALID_PAGINATION');
});

test('random records cover the collection without repeats and avoid cycle-boundary repeats',()=>{
 const {createRecordShuffle}=load('app/lib/record-shuffle.ts');
 const draw=createRecordShuffle(()=>0.5);
 const ids=['a','b','c','d','e'];
 const first=ids.map(()=>draw(ids));
 const second=ids.map(()=>draw(ids));
 assert.equal(new Set(first).size,ids.length);
 assert.equal(new Set(second).size,ids.length);
 assert.notEqual(first.at(-1),second[0]);
});
test('random records handle current selection, additions, removals and empty collections',()=>{
 const {createRecordShuffle}=load('app/lib/record-shuffle.ts');
 const draw=createRecordShuffle(()=>0);
 assert.equal(draw(['a','b','c'],'a'),'b');
 assert.equal(draw(['a','b','c'],'b'),'c');
 assert.equal(draw(['a','b','c','d'],'c'),'d');
 assert.equal(draw(['a']),'a');
 assert.equal(draw([]),undefined);
 assert.equal(draw(['z','z']),'z');
});

test('record gestures settle at the release position, including long flicks and interruptions',()=>{
 const {recordReleaseTarget}=load('app/lib/bin-gesture.ts');
 assert.equal(recordReleaseTarget(3.2,900,15),4,'Long flick must not return to record 1');
 assert.equal(recordReleaseTarget(8.1,-900,15),7,'Backward flick follows current position');
 assert.equal(recordReleaseTarget(4.7,0,15),5,'Paused drag settles at nearest sleeve');
 assert.equal(recordReleaseTarget(4.7,900,15,true),5,'Cancellation keeps progress without momentum');
 assert.equal(recordReleaseTarget(-0.3,-900,15),0);
 assert.equal(recordReleaseTarget(14.3,900,15),14);
 assert.equal(recordReleaseTarget(0,900,1),0);
 assert.equal(recordReleaseTarget(14.6,0,15,false,true),15);
 assert.equal(recordReleaseTarget(-0.6,0,15,false,true),-1);
 assert.equal(recordReleaseTarget(-0.6,0,1,false,true),0);
});


test('artist bins balance a skewed collection into twelve bins without splitting any initial',()=>{
 const weights={A:10,B:10,C:5,D:5,E:5,F:5,G:5,H:5,I:5,J:5,K:5,L:5,M:5,N:5,O:5,P:5,Q:5,R:5,S:5,T:5};
 const records=Object.entries(weights).flatMap(([letter,count])=>Array.from({length:count},(_,i)=>normalizeSpotifyAlbum({...album,id:`${letter}${i}`,artists:[{id:letter,name:`${letter} Artist ${i}`}]})));
 const bins=getBins(records,'artist');
 assert.equal(bins.length,12);
 const sizes=bins.map(b=>b.albums.length);
 assert.ok(Math.max(...sizes)-Math.min(...sizes)<=5,JSON.stringify(sizes));
 assert.equal(bins.flatMap(b=>b.albums).length,records.length);
 for(const letter of Object.keys(weights))assert.equal(bins.filter(b=>b.albums.some(a=>a.artist.startsWith(letter))).length,1);
 assert.deepEqual(getBins([...records].reverse(),'artist').map(b=>b.label),bins.map(b=>b.label));
});
test('a dominant letter stays whole even when perfect balance is impossible',()=>{
 const records=Array.from({length:60},(_,i)=>normalizeSpotifyAlbum({...album,id:`heavy${i}`,artists:[{id:'a',name:'A Artist'}]}));
 for(const letter of ['B','C','D','E','F','G','H'])records.push(normalizeSpotifyAlbum({...album,id:letter,artists:[{id:letter,name:letter}]}));
 const bins=getBins(records,'artist');assert.equal(bins.length,8);
 assert.equal(bins.filter(b=>b.albums.some(a=>a.artist==='A Artist')).length,1);
 assert.equal(bins.find(b=>b.label==='A').albums.length,60);
});
test('collaborations are filed once by first album credit, never by a second artist initial',()=>{
 const duet=normalizeSpotifyAlbum({...album,id:'duet',artists:[{id:'b',name:'beabadoobee'},{id:'l',name:'Laufey'}]});
 const collection=[duet,...['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P'].map(letter=>normalizeSpotifyAlbum({...album,id:letter,artists:[{id:letter,name:letter+' artist'}]}))];
 const bins=getBins(collection,'artist');
 assert.equal(bins.flatMap(bin=>bin.albums).filter(record=>record.id===duet.id).length,1);
 const home=bins.find(bin=>bin.albums.some(record=>record.id===duet.id));
 assert.ok(home.albums.some(record=>record.id==='spotify:B'));
 assert.equal(duet.artist,'beabadoobee, Laufey');
 assert.equal(bins.flatMap(bin=>bin.albums).length,collection.length);
});
test('filing falls back to displayed artist and normalizes accented initials consistently',()=>{
 const record=normalizeSpotifyAlbum(album);
 const values=[
 {...record,id:'accent',artist:'Élodie, Zed',artists:[{id:'e',name:'Élodie'},{id:'z',name:'Zed'}]},
 {...record,id:'plain',artist:'Echo',artists:[]},
 {...record,id:'unknown',artist:'',artists:[]},
 ];
 const bins=getBins(values,'artist');
 assert.deepEqual(bins.find(bin=>bin.label==='E').albums.map(a=>a.id),['plain','accent']);
 assert.deepEqual(bins.find(bin=>bin.label==='U').albums.map(a=>a.id),['unknown']);
});

test('genre bins default to one per genre, group whole genres, and keep uncategorized separate',()=>{
 const records=Array.from({length:14},(_,i)=>({...normalizeSpotifyAlbum({...album,id:`g${i}`}),genres:[`Genre ${i%7}`]}));
 records.push({...normalizeSpotifyAlbum({...album,id:'unknown'}),genres:[]});
 records.push({...records[0],id:'spotify:multi',genres:['Genre 0','Genre 1']});
 assert.equal(getBins(records,'genre').length,8);
 for(const count of [1,2,3,6]){
  const bins=getBins(records,'genre',undefined,count);
  assert.equal(bins.length,count+1);
  assert.equal(bins.at(-1).label,'Uncategorized');
  assert.equal(new Set(bins.flatMap(b=>b.albums.map(a=>a.id))).size,records.length);
  for(const bin of bins)assert.equal(new Set(bin.albums.map(a=>a.id)).size,bin.albums.length);
  for(let g=0;g<7;g++)assert.ok(bins.some(b=>records.filter(a=>a.genres.includes(`Genre ${g}`)).every(a=>b.albums.some(item=>item.id===a.id))));
  assert.deepEqual(getBins([...records].reverse(),'genre',undefined,count),bins);
 }
 assert.deepEqual(getBins([],'genre',undefined,3),[]);
});
test('Spotify normalization retains blocked tracks, playability and relinking metadata',()=>{
 const result=normalizeSpotifyAlbum({...album,tracks:{items:[{...track('blocked',1,1),is_playable:false},{...track('replacement',1,2),is_playable:true,linked_from:{id:'original'}},{...track('restricted',1,3),restrictions:{reason:'explicit'}},track(null,1,4),track('unknown',1,5)],next:null}});
 assert.equal(result.tracks.length,5);assert.deepEqual(result.tracks.map(t=>t.playable),[false,true,false,false,undefined]);assert.equal(result.tracks[1].linkedFrom,'spotify:original');assert.ok(result.availabilityCheckedAt>0);
 const {parseBackup}=load('app/lib/collection-backup.ts');
 const parsed=parseBackup({format:'record-cabinet',version:1,albums:[result],organization:{systems:[],systemId:'',arrangement:'artist'}}).albums[0];
 assert.deepEqual(parsed.tracks,result.tracks);assert.equal(parsed.availabilityCheckedAt,result.availabilityCheckedAt);
 const {needsAvailabilityRefresh}=load('app/lib/spotify-export.ts');
 assert.equal(needsAvailabilityRefresh(result,result.availabilityCheckedAt+100),false);assert.equal(needsAvailabilityRefresh(result,result.availabilityCheckedAt+86400000),false);assert.equal(needsAvailabilityRefresh(result,result.availabilityCheckedAt+7*86400000),true);
});

test('summary imports use one page request for 50 new albums and defer incomplete tracklists', async () => {
 const calls=[], events=[];
 const items=Array.from({length:50},(_,i)=>({track:{album:{...album,id:`summary${i}`,tracks:undefined}}}));
 const records=await createSpotifyLibrary(async url=>{calls.push(url);return {items,next:null};},event=>events.push(event),'liked',[],{summaryOnly:true,batchSize:5}).getAlbums();
 assert.equal(calls.length,1);assert.equal(records.length,50);assert.equal(events.at(-1).checkpoint,null);
 assert.ok(records.every(record=>record.tracks.length===0 && !record.availabilityCheckedAt && record.playback.uri===`spotify:album:${record.id.slice(8)}`));
 const embedded=await createSpotifyLibrary(async()=>({items:[{album},{album:{...album,id:'partial',tracks:{...album.tracks,next:'https://api.spotify.com/v1/albums/partial/tracks?offset=1'}}}],next:null}),undefined,'saved',[],{summaryOnly:true}).getAlbums();
 assert.equal(embedded[0].tracks.length,1);assert.equal(embedded[1].tracks.length,0);
});

test('playlist snapshots skip only completed unchanged scans and restart changed offsets safely',async()=>{
 const source='playlist:example',events=[],calls=[];
 const request=async url=>{calls.push(url);return url.includes('fields=')?{snapshot_id:'v1'}:{items:[{track:{album}}],next:null};};
 await createSpotifyLibrary(request,event=>events.push(event),source,[],{summaryOnly:true,checkPlaylist:true}).getAlbums();
 assert.equal(calls.length,3);assert.equal(events.at(-1).completedSnapshot,'v1');
 calls.length=0;events.length=0;
 await createSpotifyLibrary(request,event=>events.push(event),source,['spotify:abc'],{summaryOnly:true,checkPlaylist:true,completedSnapshot:'v1'}).getAlbums();
 assert.equal(calls.length,1);assert.equal(events.at(-1).unchanged,true);
 calls.length=0;events.length=0;
 const checkpoint={source,pageUrl:'https://api.spotify.com/v1/playlists/example/items?offset=50&limit=50',index:5,snapshotId:'old'};
 await createSpotifyLibrary(request,event=>events.push(event),source,[],{summaryOnly:true,checkPlaylist:true,checkpoint}).getAlbums();
 assert.equal(calls[1],'https://api.spotify.com/v1/playlists/example/items?limit=50');
 assert.equal(events.at(-1).completedSnapshot,'v1');
 let version=0;events.length=0;
 await createSpotifyLibrary(async url=>url.includes('fields=')?{snapshot_id:`v${++version}`}:{items:[{track:{album}}],next:null},event=>events.push(event),source,[],{summaryOnly:true,checkPlaylist:true}).getAlbums();
 assert.ok(!events.some(event=>event.completedSnapshot),'Changing playlists must not be certified complete');
});

test('summary batches preserve playlist version and resume at the next page',async()=>{
 const source='playlist:example',events=[];
 await createSpotifyLibrary(async url=>url.includes('fields=')?{snapshot_id:'v1'}:{items:[{track:{album}}],next:'https://api.spotify.com/v1/playlists/example/items?offset=50&limit=50'},event=>events.push(event),source,[],{summaryOnly:true,checkPlaylist:true,batchSize:1}).getAlbums();
 const checkpoint=events.at(-1).checkpoint;
 assert.equal(checkpoint.index,0);assert.equal(checkpoint.snapshotId,'v1');assert.match(checkpoint.pageUrl,/offset=50/);
 assert.ok(!events.some(event=>event.completedSnapshot));
 const calls=[];
 await createSpotifyLibrary(async url=>{calls.push(url);return url.includes('fields=')?{snapshot_id:'v1'}:{items:[],next:null};},undefined,source,['spotify:abc'],{summaryOnly:true,checkPlaylist:true,checkpoint}).getAlbums();
 assert.equal(calls[1],checkpoint.pageUrl);
});

test('album bins use title initials, balanced whole-letter ranges, and persist through backup validation',()=>{
 const titles=['Écho','Apple','Apricot','Banana','Cherry','Date','Fig','Grape','Honey','123','Zulu'];
 const records=titles.map((title,i)=>({...normalizeSpotifyAlbum(album),id:`spotify:title${i}`,title,artist:'Same artist',artists:[{id:'same',name:'Same artist'}]}));
 const bins=getBins([...records,records[0]],'album');
 assert.equal(bins.length,10);assert.equal(bins.flatMap(bin=>bin.albums).length,records.length);
 assert.ok(bins.every(bin=>bin.id.startsWith('album:')));
 assert.equal(bins.find(bin=>bin.albums.some(record=>record.title==='Apple')),bins.find(bin=>bin.albums.some(record=>record.title==='Apricot')));
 assert.deepEqual(bins.flatMap(bin=>bin.albums.map(record=>record.title)),['123','Apple','Apricot','Banana','Cherry','Date','Écho','Fig','Grape','Honey','Zulu']);
 assert.equal(getBins(records,'artist').length,1);
 const {parseOrganization}=load('app/lib/collection-backup.ts');
 assert.equal(parseOrganization({systems:[],systemId:'',arrangement:'album'}).arrangement,'album');
});

test('continue digging follows album identity after reorganizing and ignores removed records', async () => {
 const {readDiggingPosition,resolveDiggingPosition}=load('app/lib/digging-position.ts');
 const albums=await mockLibrary.getAlbums();
 const saved={albumId:albums[4].id,binId:'deleted-bin',arrangement:'custom',systemId:'deleted-system',genreBinCount:0,opened:true,flipped:true};
 assert.equal(resolveDiggingPosition(saved,albums,[]).album.id,albums[4].id);
 assert.equal(resolveDiggingPosition(saved,[...albums].reverse(),[]).album.id,albums[4].id);
 assert.equal(resolveDiggingPosition(saved,albums.filter(a=>a.id!==saved.albumId),[]),null);
 assert.equal(readDiggingPosition('{bad'),null);
 assert.equal(readDiggingPosition(JSON.stringify({...saved,arrangement:'invalid'})),null);
 assert.deepEqual(readDiggingPosition(JSON.stringify(saved)),saved);
 assert.equal(resolveDiggingPosition({...saved,binId:'all',arrangement:'artist'},albums,[]).bin.id,'all');
});

test('both alphabetical views fold Latin names and separate non-Latin scripts from numbers',()=>{
 const names=['Élodie','E\u0301cho','Øresund','Łódź','Æther','Œuvres','Đà Nẵng','Þór','ßeta','“Björk”','１２３','東京','ひかり','カネコ','한글','Жизнь','Ωδή','أغاني','שלום','संगीत','ไทย','Հայերեն','𠀀'];
 for(const arrangement of ['artist','album']) {
  const records=names.map((name,i)=>({...normalizeSpotifyAlbum(album),id:`unicode:${i}`,title:name,artist:name,artists:[]}));
  const bins=getBins([...records,records[0]],arrangement);
  const label=name=>bins.find(bin=>bin.albums.some(a=>a.title===name)).label;
  for(const [name,initial] of [['Élodie','E'],['E\u0301cho','E'],['Øresund','O'],['Łódź','L'],['Æther','A'],['Œuvres','O'],['Đà Nẵng','D'],['Þór','T'],['ßeta','S'],['“Björk”','B']]) assert.equal(label(name),initial);
  for(const [name,group] of [['１２３','#'],['東京','漢字 / かな'],['ひかり','漢字 / かな'],['カネコ','漢字 / かな'],['𠀀','漢字 / かな'],['한글','Korean'],['Жизнь','Cyrillic'],['Ωδή','Greek'],['أغاني','Arabic'],['שלום','Hebrew'],['संगीत','Devanagari'],['ไทย','Thai'],['Հայերեն','Other scripts']])assert.equal(label(name),group);
  assert.equal(bins.flatMap(b=>b.albums).length,records.length);
  assert.deepEqual(getBins([...records].reverse(),arrangement),bins);
 }
});

test('Chinese playlist imports preserve exact Spotify album identities and never search titles',async()=>{
 const requested=[];
 const records=[{...album,id:'cnFirst',uri:'spotify:album:cnFirst',name:'夜曲',artists:[{id:'artistOne',name:'周杰倫'}],images:[{url:'https://covers.example/one.jpg'}]}, {...album,id:'cnSecond',uri:'spotify:album:cnSecond',name:'夜曲',artists:[{id:'artistTwo',name:'另一位歌手'}],images:[{url:'https://covers.example/two.jpg'}]}];
 const imported=await createSpotifyLibrary(async url=>{requested.push(url);return {items:records.map(record=>({item:{type:'track',album:record}})),next:null};},undefined,'playlist:Wei',[],{summaryOnly:true}).getAlbums();
 assert.equal(requested.length,1);assert.match(requested[0],/\/playlists\/Wei\/items/);
 assert.deepEqual(imported.map(a=>[a.id,a.title,a.artist,a.artworkUrl,a.playback.uri]),records.map(a=>['spotify:'+a.id,a.name,a.artists[0].name,a.images[0].url,a.uri]));
 assert.equal(imported.length,2,'Equal Chinese titles from different albums must remain distinct');
});

test('leading The is ignored for artist and album filing without changing names',()=>{
 const names=['The Beatles','the Cure','THE National','Thelonious Monk','The','“The Doors”'];
 const records=names.map((name,i)=>({...normalizeSpotifyAlbum(album),id:`the:${i}`,title:name,artist:name,artists:[]}));
 for(const mode of ['artist','album']) {
  const bins=getBins(records,mode);
  for(const [name,letter] of [['The Beatles','B'],['the Cure','C'],['THE National','N'],['Thelonious Monk','T'],['The','T'],['“The Doors”','D']])assert.ok(bins.find(bin=>bin.label===letter).albums.some(a=>a.title===name&&a.artist===name));
 }
 assert.deepEqual(getBins(records,'all')[0].albums.map(a=>a.title),['The Beatles','the Cure','“The Doors”','THE National','The','Thelonious Monk']);
});

test('playlist identity safeguards reject other sources before saving, and bind imports to previewed versions', async () => {
 const {playlistId,checkPlaylistPage}=load('app/lib/playlist-preview.ts');
 assert.equal(playlistId('https://open.spotify.com/playlist/wei?si=share'),'wei');
 assert.equal(playlistId('spotify:playlist:wei'),'wei');
 for(const link of ['https://evil.test/playlist/wei','https://open.spotify.com:123/playlist/wei','https://open.spotify.com/album/wei'])assert.throws(()=>playlistId(link));
 checkPlaylistPage({href:'https://api.spotify.com/v1/playlists/wei/items?offset=0'},'wei');
 let saved=0;
 const wrongPage=createSpotifyLibrary(async()=>({href:'https://api.spotify.com/v1/playlists/other/items',items:[{track:{album}}],next:null}),e=>{if(e.album)saved++;},'playlist:wei',[],{summaryOnly:true});
 await assert.rejects(wrongPage.getAlbums(),/different playlist/);assert.equal(saved,0);
 let calls=0;
 const changed=createSpotifyLibrary(async()=>{calls++;return {snapshot_id:'new'};},e=>{if(e.album)saved++;},'playlist:wei',[],{checkPlaylist:true,confirmedSnapshot:'old'});
 await assert.rejects(changed.getAlbums(),/changed after preview/);assert.equal(calls,1);assert.equal(saved,0);
});
test('playlist album origins survive backup parsing and later track hydration',async()=>{
 const records=await createSpotifyLibrary(async()=>({items:[{track:{id:'song',album}}],next:null}),undefined,'playlist:wei',[],{summaryOnly:true}).getAlbums();
 assert.equal(records[0].importOrigin.source,'playlist:wei');assert.equal(records[0].importOrigin.trackId,'song');
 const {parseBackup}=load('app/lib/collection-backup.ts');
 const restored=parseBackup({format:'record-cabinet',version:1,albums:records,organization:{systems:[],systemId:'',arrangement:'artist'}}).albums[0];
 assert.deepEqual(restored.importOrigin,records[0].importOrigin);
 const {hydratedAlbum}=load('app/lib/spotify-export.ts');
 assert.deepEqual(hydratedAlbum(restored,normalizeSpotifyAlbum(album,album.tracks.items)).importOrigin,records[0].importOrigin);
});

test('dividers cover records in order, keep practical artist runs together, and bound oversized runs',()=>{
 const {binDividers,binPositionKey,rememberedAlbumIndex}=load('app/lib/bin-dividers.ts');
 const records=Array.from({length:120},(_,i)=>({id:String(i),title:'Album '+i,artist:'Artist '+Math.floor(i/20),artists:[{id:'artist'+Math.floor(i/20),name:'Artist '+Math.floor(i/20)}]}));
 const sections=binDividers(records,true);
 assert.deepEqual(sections.map(s=>s.end-s.start),[20,20,20,20,20,20]);
 assert.deepEqual(sections.flatMap(s=>records.slice(s.start,s.end)),records);
 const huge=records.map(a=>({...a,artists:[{id:'same',name:'Same'}]}));
 assert.ok(binDividers(huge,true).every(s=>s.end-s.start<=25));
 assert.equal(binDividers(records.slice(0,15),false).length,1);
 assert.deepEqual(binDividers([],true),[]);
 assert.notEqual(binPositionKey('unfiled','custom','one',0),binPositionKey('unfiled','custom','two',0));
 assert.equal(binPositionKey('all','artist','',0),binPositionKey('all','genre','',5));
 assert.equal(rememberedAlbumIndex([{id:'inserted'},...records],'20'),21);
 assert.equal(rememberedAlbumIndex(records,'deleted'),0);
});

test('recent additions are newest first, bounded, and survive backup and continue digging',async()=>{
 const {recentBin}=load('app/catalog.ts');
 const {parseBackup}=load('app/lib/collection-backup.ts');
 const {resolveDiggingPosition}=load('app/lib/digging-position.ts');
 const example=(await mockLibrary.getAlbums())[0];
 const records=Array.from({length:60},(_,i)=>({...example,id:'manual:recent'+i,source:'manual',playback:{kind:'none'},addedAt:1000+i}));
 const bin=recentBin(records);
 assert.equal(bin.albums.length,50);
 assert.equal(bin.albums[0].id,'manual:recent59');
 assert.equal(bin.albums.at(-1).id,'manual:recent10');
 assert.equal(parseBackup({format:'record-cabinet',version:1,albums:records,organization:{systems:[],systemId:'',arrangement:'artist'}}).albums[0].addedAt,1000);
 assert.equal(resolveDiggingPosition({albumId:'manual:recent59',binId:'recent',arrangement:'artist',systemId:''},records,[]).bin.id,'recent');
});


test('public demo has unique sleeves and tracks using existing local audio without changing the base catalog', async () => {
  const { publicDemo } = load('app/data/public-demo.ts');
  const base = await mockLibrary.getAlbums();
  const expanded = publicDemo(base);
  assert.equal(expanded.length, 60);
  assert.equal(new Set(expanded.map(album => album.id)).size, 60);
  assert.equal(new Set(expanded.flatMap(album => album.tracks.map(track => track.id))).size, 180);
  for (const album of expanded) {
    assert.equal(album.source, 'mock');
    assert.equal(album.playback.kind, 'local');
    assert.ok(fs.existsSync(path.join(__dirname, '../public', album.playback.url)));
  }
  assert.equal(base.length, 15);
  assert.deepEqual(publicDemo([]), []);
});
