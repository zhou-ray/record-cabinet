import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// A transaction-level IndexedDB double: commits are atomic, and each module
// instance opens fresh connections against the same durable backing stores.
function database() {
  const stores = new Map();
  let initialized = false;
  let failWrite = false;
  return {
    failNextWrite() { failWrite = true; },
    open() {
      const request = {};
      const db = {
        close() {},
        createObjectStore(name) { stores.set(name, new Map()); },
        transaction(names, mode) {
          const snapshot = new Map(names.map(name => [name, new Map(stores.get(name))]));
          let aborted = false;
          const tx = {
            objectStore(name) {
              const store = snapshot.get(name);
              return {
                getAll() { const request = { result: structuredClone([...store.values()]) }; queueMicrotask(() => request.onsuccess?.()); return request; },
                get(key) { const request = { result: structuredClone(store.get(key)) }; queueMicrotask(() => request.onsuccess?.()); return request; },
                clear() { store.clear(); },
                put(value, key) { store.set(key ?? value.id, structuredClone(value)); },
              };
            },
            abort() { aborted = true; },
          };
          queueMicrotask(() => queueMicrotask(() => {
            if (aborted || (mode === 'readwrite' && failWrite)) {
              failWrite = false;
              tx.error = new Error('QuotaExceededError');
              tx.onabort();
            } else {
              if (mode === 'readwrite') for (const [name, values] of snapshot) stores.set(name, values);
              tx.oncomplete();
            }
          }));
          return tx;
        },
      };
      queueMicrotask(() => {
        request.result = db;
        if (!initialized) { initialized = true; request.onupgradeneeded(); }
        request.onsuccess();
      });
      return request;
    },
  };
}
function loadHelper(file) {
 const result={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(name=>loadHelper(path.resolve(path.dirname(file),name+'.ts')),result,result.exports);
 return result.exports;
}
function load(indexedDB) {
  const output = ts.transpileModule(fs.readFileSync('app/lib/library-storage.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const helper = { exports: {} };
  const helperCode = ts.transpileModule(fs.readFileSync('app/lib/manual-genres.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInThisContext(`(function(module,exports){${helperCode}\n})`)(helper, helper.exports);
  const exportHelper = { exports: {} };
  const exportCode = ts.transpileModule(fs.readFileSync('app/lib/spotify-export.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInThisContext(`(function(module,exports){${exportCode}\n})`)(exportHelper, exportHelper.exports);
  const cloud = { exports: {} };
  const cloudCode = ts.transpileModule(fs.readFileSync('app/lib/cloud-library.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInThisContext(`(function(module,exports,require){${cloudCode}\n})`)(cloud,cloud.exports,name=>name === './spotify-export' ? exportHelper.exports : {});
  const compiled = { exports: {} };
  vm.runInThisContext(`(function(module,exports,indexedDB,require){${output}\n})`)(compiled, compiled.exports, indexedDB, name => name === "./saved-membership" ? loadHelper("app/lib/saved-membership.ts") : name === "./auto-genres" ? loadHelper("app/lib/auto-genres.ts") : name === "./spotify-export" ? exportHelper.exports : name === "./cloud-library" ? cloud.exports : helper.exports);
  return compiled.exports;
}
const album = (id, title = id) => ({ id: `spotify:${id}`, source: 'spotify', title, playback: {kind:'spotify',uri:`spotify:album:${id}`}, tracks: [{ id: `track:${id}`, title: 'Track' }] });

test('partially imported albums and playlist source survive a fresh page instance', async () => {
  const db = database();
  const first = load(db).libraryStorage;
  await first.saveSource('playlist:example');
  await first.saveAlbum(album('a'));
  await first.saveAlbum(album('b'));
  // No completion event: simulate stopping, failure, or reload halfway through.
  const nextPage = load(db).libraryStorage;
  const recovered = await nextPage.load();
  assert.deepEqual(recovered.albums.map(item => item.id), ['spotify:a', 'spotify:b']);
  assert.equal(recovered.source, 'playlist:example');
  assert.equal(recovered.albums[0].tracks.length, 1);
});
test('retry updates duplicate albums and preserves other imported sources', async () => {
  const { libraryStorage: store, mergeAlbums } = load(database());
  await store.saveAlbum(album('playlist-only'));
  await store.saveAlbum(album('saved'));
  await store.saveSource('saved');
  await store.saveAlbum(album('saved', 'Updated title'));
  const recovered = await store.load();
  assert.equal(recovered.albums.length, 2);
  assert.equal(recovered.albums.find(item => item.id === 'spotify:saved').title, 'Updated title');
  assert.equal(mergeAlbums(recovered.albums, []).length, 2);
  assert.equal(mergeAlbums(recovered.albums, [album('saved')]).length, 2);
});
test('failed disk writes preserve the existing collection and report failure', async () => {
  const db = database();
  const store = load(db).libraryStorage;
  await store.saveAlbum(album('existing'));
  db.failNextWrite();
  await assert.rejects(store.saveAlbum(album('new')), /QuotaExceeded/);
  assert.deepEqual((await store.load()).albums.map(item => item.id), ['spotify:existing']);
});
test('restoration merges newer in-memory imports without replacing the shelf', () => {
  const { mergeAlbums } = load(database());
  const recovered = mergeAlbums([album('a', 'Old'), album('b')], [album('a', 'New'), album('c')]);
  assert.deepEqual(recovered.map(item => item.id), ['spotify:a', 'spotify:b', 'spotify:c']);
  assert.equal(recovered[0].title, 'New');
});
test('empty storage and invalid source settings restore safely', async () => {
  const store = load(database()).libraryStorage;
  assert.deepEqual(await store.load(), { albums: [], source: 'saved' });
  await store.saveSource('https://example.com');
  assert.equal((await store.load()).source, 'saved');
});

test('album and resume position commit together and roll back together on disk failure', async () => {
  const db = database(); const store = load(db).libraryStorage;
  const checkpoint = {source:'liked',pageUrl:'https://api.spotify.com/v1/me/tracks?offset=50',index:3};
  await store.saveProgress('liked',checkpoint,album('a'));
  assert.deepEqual((await load(db).libraryStorage.loadCheckpoints()).liked,checkpoint);
  db.failNextWrite();
  await assert.rejects(store.saveProgress('liked',{...checkpoint,index:4},album('b')));
  assert.equal((await store.loadCheckpoints()).liked.index,3);
  assert.deepEqual((await store.load()).albums.map(a=>a.id),['spotify:a']);
  await store.saveProgress('saved',null);
  assert.equal((await store.loadCheckpoints()).liked.index,3);
  assert.equal((await store.loadCheckpoints()).saved,null);
});
test('bulk backup restore is atomic and retains unrelated albums',async()=>{
 const db=database();const store=load(db).libraryStorage;
 await store.saveAlbum(album('a')); db.failNextWrite();
 await assert.rejects(store.restoreAlbums([album('b'),album('c')]));
 assert.equal((await store.load()).albums.length,1);
 await store.restoreAlbums([album('b'),album('c')]); assert.equal((await store.load()).albums.length,3);
});

test('artist genre cache survives reload and incremental saves retain other artists',async()=>{
 const db=database();const store=load(db).libraryStorage;
 await store.saveGenres({'spotify:a':{genres:['jazz'],checkedAt:10}});
 await store.saveGenres({'spotify:b':{genres:[],checkedAt:20}});
 assert.deepEqual(await load(db).libraryStorage.loadGenres(),{'spotify:a':{genres:['jazz'],checkedAt:10},'spotify:b':{genres:[],checkedAt:20}});
});

test('genre edits and artist defaults commit together, preserve metadata and roll back together', async () => {
 const db=database(), store=load(db).libraryStorage;
 const record={...album('a'),artist:'Artist',artists:[{id:'spotify:artist',name:'Artist'}],genres:[],genre:'Uncategorized'};
 await store.restoreAlbums([record,{...record,id:'spotify:b'},{...record,id:'spotify:c',genres:['Rock']}]);
 const updates=await store.editGenres(['spotify:a'],['Jazz'],'replace','spotify:artist');
 assert.equal(updates.length,2);assert.deepEqual(updates[0].tracks,record.tracks);
 assert.deepEqual((await store.prepareAlbumGenres({...record,id:'new'})).genres,['Jazz']);
 db.failNextWrite();await assert.rejects(store.editGenres(['spotify:a'],['Pop'],'replace','spotify:artist'));
 assert.deepEqual((await store.load()).albums.find(a=>a.id==='spotify:a').genres,['Jazz']);
 assert.deepEqual((await store.prepareAlbumGenres({...record,id:'new'})).genres,['Jazz']);
 assert.deepEqual((await store.load()).albums.find(a=>a.id==='spotify:c').genres,['Rock']);
});

test('account libraries keep albums, sources, defaults, and checkpoints separate; deletion is scoped', async () => {
  const databases = new Map();
  const indexed = { open(name) { if (!databases.has(name)) databases.set(name, database()); return databases.get(name).open(); } };
  const { createLibraryStorage } = load(indexed);
  const a = createLibraryStorage('alice'), b = createLibraryStorage('bob');
  await a.saveAlbum(album('a')); await b.saveAlbum(album('b'));
  await a.saveSource('liked'); await a.saveProgress('liked', { source:'liked', pageUrl:'https://api.spotify.com/v1/me/tracks?limit=50', index:3 });
  assert.deepEqual((await b.load()).albums.map(x=>x.id), ['spotify:b']);
  assert.equal((await b.load()).source, 'saved');
  assert.deepEqual(await b.loadCheckpoints(), {});
  await a.clear();
  assert.deepEqual((await a.load()).albums, []);
  assert.deepEqual(await a.loadCheckpoints(), {});
  assert.deepEqual((await b.load()).albums.map(x=>x.id), ['spotify:b']);
});

test('each import reads a fresh atomic snapshot of persisted albums and progress',async()=>{
 const db=database();const first=load(db).libraryStorage,other=load(db).libraryStorage;
 await first.saveAlbum(album('existing'));
 const checkpoint={source:'liked',pageUrl:'https://api.spotify.com/v1/me/tracks?offset=100&limit=50',index:4};
 await other.saveProgress('liked',checkpoint,album('otherTab'));
 const saved=await first.loadImportState('liked');
 assert.deepEqual(saved.knownAlbumIds,['spotify:existing','spotify:otherTab']);assert.deepEqual(saved.checkpoint,checkpoint);
 db.failNextWrite();await assert.rejects(first.saveProgress('liked',{...checkpoint,index:5},album('unsaved')));
 assert.deepEqual(await first.loadImportState('liked'),saved,'Failed writes must not mark an album as imported or advance position');
});


test('cloud application preserves imports and edits committed during the network request',async()=>{
 const store=load(database()).libraryStorage;
 await store.saveAlbum(album('a'));const observed=await store.loadCloudState();
 await store.saveAlbum(album('a','Edited during sync'));await store.saveAlbum(album('c'));
 const remote={albums:[album('a','Remote'),album('b')],organization:{systems:[],systemId:'',arrangement:'artist'}};
 const result=await store.applyCloud(remote,observed.albums);
 assert.equal(result.find(a=>a.id==='spotify:a').title,'Edited during sync');
 assert.deepEqual(result.map(a=>a.id).sort(),['spotify:a','spotify:b','spotify:c']);
 assert.deepEqual((await store.loadCloudState()).base,remote);
});

test('a local edit during sync retains unrelated remote fields across subsequent syncs',async()=>{
 const store=load(database()).libraryStorage;
 const initial={...album('a'),note:'',genres:[],genre:'Uncategorized'};
 await store.saveAlbum(initial);const observed=await store.loadCloudState();
 await store.saveAlbum({...initial,note:'Phone note'});
 const remote={albums:[{...initial,genres:['Jazz'],genre:'Jazz',genresEdited:true}],organization:{systems:[],systemId:'',arrangement:'artist'}};
 const result=await store.applyCloud(remote,observed.albums);
 assert.equal(result[0].note,'Phone note');assert.equal(result[0].genre,'Jazz');
 const next=await store.loadCloudState();
 const again=await store.applyCloud(remote,next.albums);
 assert.equal(again[0].genre,'Jazz');
});

test('automatic genres save progress atomically and preserve concurrent manual edits and clears',async()=>{
 const db=database(),store=load(db).libraryStorage;
 const {genreLookupKey}=loadHelper('app/lib/auto-genres.ts');
 const record={...album('a'),artist:'Artist',artists:[],genres:[],genre:'Uncategorized'};
 const key=genreLookupKey(record),lookup={genres:['Jazz'],source:'album',checkedAt:100};
 await store.saveAlbum(record);
 await store.editGenres([record.id],[],'replace');
 assert.equal(await store.applyAutoGenres(record.id,key,lookup),null);
 assert.deepEqual((await store.load()).albums[0].genres,[]);
 assert.deepEqual((await store.loadAutoGenres())[key],lookup);
 await store.saveAlbum(record);db.failNextWrite();
 await assert.rejects(store.applyAutoGenres(record.id,key,{...lookup,checkedAt:200}));
 assert.equal((await store.loadAutoGenres())[key].checkedAt,100);
 assert.deepEqual((await store.load()).albums[0].genres,[]);
 const updated=await store.applyAutoGenres(record.id,key,lookup);
 assert.deepEqual(updated.genres,['Jazz']);assert.equal(updated.genresEdited,undefined);
});
test('automatic genre results cannot apply to an album whose matching metadata changed',async()=>{
 const store=load(database()).libraryStorage,{genreLookupKey}=loadHelper('app/lib/auto-genres.ts');
 const record={...album('a'),artist:'Artist',artists:[],genres:[],genre:'Uncategorized'};
 await store.saveAlbum({...record,title:'Different title'});
 assert.equal(await store.applyAutoGenres(record.id,genreLookupKey(record),{genres:['Jazz'],source:'album',checkedAt:100}),null);
});
test('artist genre cache survives reload and rolls back with failed album writes',async()=>{
 const db=database(),store=load(db).libraryStorage;
 const {genreLookupKey,genreArtistKey}=loadHelper('app/lib/auto-genres.ts');
 const record={...album('a'),artist:'Artist',artists:[],genres:[],genre:'Uncategorized'};
 const lookup={genres:['Jazz'],source:'artist',checkedAt:100};
 await store.saveAlbum(record);
 await store.applyAutoGenres(record.id,genreLookupKey(record),lookup,genreArtistKey(record));
 assert.deepEqual((await load(db).libraryStorage.loadAutoGenres())[genreArtistKey(record)],lookup);
 db.failNextWrite();
 await assert.rejects(store.applyAutoGenres(record.id,genreLookupKey(record),{...lookup,checkedAt:200},genreArtistKey(record)));
 assert.equal((await store.loadAutoGenres())[genreArtistKey(record)].checkedAt,100);
});
test('Apple recheck replaces automatic labels but preserves intervening edits and misses',async()=>{
 const store=load(database()).libraryStorage,{genreLookupKey}=loadHelper('app/lib/auto-genres.ts');
 const record={...album('a'),artist:'Artist',artists:[],genres:['Classical'],genre:'Classical'};
 const result={genres:['Alternative'],source:'apple',checkedAt:100};
 await store.saveAlbum(record);
 assert.deepEqual((await store.applyAutoGenres(record.id,genreLookupKey(record),result,undefined,['Classical'])).genres,['Alternative']);
 assert.equal(await store.applyAutoGenres(record.id,genreLookupKey(record),result,undefined,['Classical']),null);
 await store.editGenres([record.id],['Jazz'],'replace');
 assert.equal(await store.applyAutoGenres(record.id,genreLookupKey(record),result,undefined,['Jazz']),null);
 assert.deepEqual((await store.load()).albums[0].genres,['Jazz']);
});

test('playlist completion receipts survive reload, fail atomically, and cannot skip missing records',async()=>{
 const db=database(),store=load(db).libraryStorage;
 await store.saveAlbum(album('a'));
 await store.savePlaylistSnapshot('playlist:p','v1');
 assert.equal((await load(db).libraryStorage.loadImportState('playlist:p')).completedSnapshot,'v1');
 db.failNextWrite();await assert.rejects(store.savePlaylistSnapshot('playlist:p','v2'));
 assert.equal((await store.loadImportState('playlist:p')).completedSnapshot,'v1');
 await new Promise(resolve=>{const request=db.open();request.onsuccess=()=>{const tx=request.result.transaction(['albums'],'readwrite');tx.objectStore('albums').clear();tx.oncomplete=resolve;};});
 assert.equal((await store.loadImportState('playlist:p')).completedSnapshot,undefined);
});

test('import genre queue commits with records, resumes after reload, and preserves later arrivals',async()=>{
 const db=database(),store=load(db).libraryStorage;
 await store.saveProgress('liked',null,album('a'));
 assert.deepEqual(await load(db).libraryStorage.loadGenreImportQueue(),{ids:['spotify:a'],paused:false});
 db.failNextWrite();await assert.rejects(store.saveProgress('liked',null,album('failed')));
 assert.deepEqual((await store.loadGenreImportQueue()).ids,['spotify:a']);
 await store.addExportAlbums([album('export'),{...album('manual'),genresEdited:true},{...album('known'),genres:['Rock']}]);
 await store.pauseGenreImports(true);
 assert.equal((await load(db).libraryStorage.loadGenreImportQueue()).paused,true);
 await store.finishGenreImports(['spotify:a']);
 assert.deepEqual((await store.loadGenreImportQueue()).ids,['spotify:export']);
 await store.pauseGenreImports(false);assert.equal((await store.loadGenreImportQueue()).paused,false);
});

test('daily usage persists without changing library data and rolls back failed writes',async()=>{
 const db=database(),store=load(db).libraryStorage;
 await store.saveAlbum(album('kept'));
 await store.recordRequestUsage({import:3,metadata:1,search:0,playback:0},'2026-09-28');
 await store.recordRequestUsage({import:0,metadata:0,search:1,playback:2},'2026-09-28');
 assert.deepEqual(await load(db).libraryStorage.loadRequestUsage(),{'2026-09-28':{import:3,metadata:1,search:1,playback:2}});
 db.failNextWrite();await assert.rejects(store.recordRequestUsage({import:100,metadata:0,search:0,playback:0},'2026-09-28'));
 assert.equal((await store.loadRequestUsage())['2026-09-28'].import,3);assert.equal((await store.load()).albums.length,1);
 await store.finishListeningGuide();assert.equal(await load(db).libraryStorage.loadListeningGuide(),true);
});

test('first addition date survives duplicate imports and metadata saves', async()=>{
 const store=load(database()).libraryStorage;
 await store.saveAlbum({...album('dated'),addedAt:1000});
 await store.saveAlbum({...album('dated','Updated'),addedAt:9000});
 assert.equal((await store.load()).albums[0].addedAt,1000);
 await store.saveProgress('saved',null,{...album('dated'),importOrigin:{source:'saved',addedAt:20000}});
 assert.equal((await store.load()).albums[0].addedAt,1000);
 await store.saveAlbum(album('new'));
 assert.ok((await store.load()).albums.find(a=>a.id==='spotify:new').addedAt>0);
});

test('membership persists separately, rejects mixed accounts and late observations, and clears with the library', async () => {
 const factory = database(); const account = 'a'.repeat(64);
 const store = load(factory).createLibraryStorage(account);
 await store.saveAlbum(album('a'));
 const original = await store.load();
 const batch = (saved, checkedAt) => ({accountId:account,records:[{albumId:'spotify:a',saved,checkedAt,source:'spotify-library-contains'}]});
 await store.saveMembership(batch(true,100));
 await store.saveMembership(batch(false,200));
 await store.saveMembership(batch(true,100));
 assert.equal((await load(factory).createLibraryStorage(account).loadMembership())[0].saved,false);
 assert.deepEqual(await store.load(),original,'membership never mutates collection data');
 assert.throws(()=>store.saveMembership({...batch(true,300),accountId:'b'.repeat(64)}));
 factory.failNextWrite();
 await assert.rejects(store.saveMembership(batch(true,300)));
 assert.equal((await store.loadMembership())[0].checkedAt,200);
 await store.clear(); assert.deepEqual(await store.loadMembership(),[]);
});
