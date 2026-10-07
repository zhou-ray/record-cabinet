import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
function load(file,deps={},fetch=()=>{throw Error('Live requests forbidden');}){
 const result={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInThisContext(`(function(require,module,exports,fetch){${code}\n})`)(name=>name in deps?deps[name]:load(path.resolve(path.dirname(file),name+'.ts'),deps,fetch),result,result.exports,fetch);
 return result.exports;
}
const {findArtistGenres,findAutomaticGenres,trustedGenres,genreTitle}=load('app/lib/auto-genres.ts');
const id='11111111-1111-1111-1111-111111111111',artistId='22222222-2222-2222-2222-222222222222';
const release={id,title:'Blue',score:100,'artist-credit':[{artist:{id:artistId,name:'Artist'}}]};
test('an exact album and artist match uses album genres, ignoring non-genre tags',async()=>{
 const calls=[];
 const result=await findAutomaticGenres('Blue (Deluxe Edition)','Artist',async path=>{
  calls.push(path);return path.includes('?query=')?{'release-groups':[release]}:{id,genres:[{name:'jazz',count:5},{name:'albums i own',count:100}]};
 },()=>100);
 assert.deepEqual(result,{genres:['Jazz'],source:'album',checkedAt:100});assert.equal(calls.length,2);
 assert.equal(genreTitle('Blue - 2020 Remastered'),'Blue');
});
test('wrong album artists are rejected and ambiguous artist names remain unclassified',async()=>{
 let calls=0;
 const result=await findAutomaticGenres('Blue','Artist',async path=>{
  calls++;if(path.startsWith('release-group'))return {'release-groups':[{...release,'artist-credit':[{artist:{id:artistId,name:'Someone Else'}}]}]};
  return {artists:[{id:artistId,name:'Artist',score:100},{id,name:'Artist',score:100}]};
 });
 assert.deepEqual(result.genres,[]);assert.equal(result.source,'none');assert.equal(calls,2);
});
test('missing album tags fall back to the matched artist without another artist search',async()=>{
 const calls=[];
 const result=await findAutomaticGenres('Blue','Artist',async path=>{
  calls.push(path);return path.includes('?query=')?{'release-groups':[release]}:path.startsWith('release-group')?{id,genres:[]}:{id:artistId,genres:[{name:'indie rock',count:2}]};
 });
 assert.deepEqual(result.genres,['Rock']);assert.equal(result.source,'artist');assert.equal(calls.length,3);
});
test('failed or malformed lookups propagate without producing a negative cache entry',async()=>{
 await assert.rejects(findAutomaticGenres('Blue','Artist',async()=>{throw Error('Unavailable');}),/Unavailable/);
 await assert.rejects(findAutomaticGenres('Blue','Artist',async()=>({})),/Incomplete/);
 assert.deepEqual(trustedGenres({genres:[{name:'pop',count:-1},{name:'favorites',count:100}]}),[]);
 const result=await findAutomaticGenres('Blue','Various Artists',async()=>assert.fail('No lookup for compilations'));
 assert.deepEqual(result.genres,[]);
});
test('genre endpoint enforces account, origin and input without contacting Spotify',async()=>{
 let session=null,calls=0,match=true;
 const route=load('app/api/genres/route.ts',{
  '../../lib/spotify-session':{getSession:async()=>session,accountMatches:()=>match,config:()=>({origin:'https://app.test'})},
  '../../lib/auto-genres':{findAutomaticGenres:async()=>{calls++;return {genres:['Jazz'],source:'album',checkedAt:100};}},
  '../../lib/musicbrainz':{GenreCooldown:class extends Error{}},
  '../../lib/apple-genres':{},
 });
 const request=(body,origin='https://app.test')=>new Request('https://app.test/api/genres',{method:'POST',headers:{origin},body:JSON.stringify(body)});
 assert.equal((await route.POST(request({title:'Blue',artist:'Artist'}))).status,401);
 session={accountId:'test'};match=false;
 assert.equal((await route.POST(request({title:'Blue',artist:'Artist'}))).status,409);match=true;
 assert.equal((await route.POST(request({title:'Blue',artist:'Artist'},'https://elsewhere.test'))).status,403);
 assert.equal((await route.POST(request({title:'Blue'}))).status,400);
 assert.equal(calls,0);
 assert.equal((await route.POST(request({title:'Blue',artist:'Artist'}))).status,200);assert.equal(calls,1);
});
test('public metadata cache avoids requests; shared pacing waits; upstream failures are not cached',async()=>{
 let cached=JSON.stringify({genres:[]}),requests=0,delay=1200;const commands=[],waits=[];
 const api=load('app/lib/musicbrainz.ts',{
  'server-only':{},'node:crypto':{createHash},
  './cloud-store':{command:async args=>{commands.push(args);if(args[0]==='GET')return cached;if(args[0]==='EVAL'){const value=delay;delay=0;return value;}return 'OK';}},
  './spotify-requests':{abortableDelay:async ms=>waits.push(ms)},
 },async()=>{requests++;return Response.json({error:'unavailable'},{status:503});});
 assert.deepEqual(await api.musicbrainzRequest('artist/?query=a',new AbortController().signal),{genres:[]});assert.equal(requests,0);
 cached=null;await assert.rejects(api.musicbrainzRequest('artist/?query=a',new AbortController().signal),/needs a pause/);
 assert.equal(requests,1);assert.deepEqual(waits,[1200]);
 assert.equal(commands.filter(c=>c[0]==='SET'&&c[1].includes(':v1:')).length,0);
 const aborted=new AbortController();aborted.abort();await assert.rejects(api.musicbrainzRequest('artist/?query=b',aborted.signal));assert.equal(requests,1);
});

test('fast artist lookup uses search tags in one request and refuses ambiguous names',async()=>{
 let calls=0;
 const result=await findArtistGenres('Artist',async path=>{
  calls++;assert.ok(path.startsWith('artist/?'));
  return {artists:[{id:artistId,name:'Artist',score:100,tags:[{name:'jazz',count:4}]}]};
 });
 assert.equal(calls,1);assert.deepEqual(result.genres,['Jazz']);assert.equal(result.source,'artist');
 assert.deepEqual((await findArtistGenres('Artist',async()=>({artists:[{id:artistId,name:'Artist',score:100},{id,name:'Artist',score:100}]}))).genres,[]);
});
test('fast lookup fetches artist details only when search tags cannot classify it',async()=>{
 let calls=0;
 const result=await findArtistGenres('Artist',async path=>{calls++;return path.includes('?query=')?{artists:[{id:artistId,name:'Artist',score:100}]}:{id:artistId,genres:[{name:'rock',count:3}]};});
 assert.equal(calls,2);assert.deepEqual(result.genres,['Rock']);
 await assert.rejects(findArtistGenres('Artist',async()=>({})),/Incomplete/);
});

test('shared MusicBrainz cooldown returns immediately instead of waiting past the server timeout',async()=>{
 const api=load('app/lib/musicbrainz.ts',{
  'server-only':{},'node:crypto':{createHash},
  './cloud-store':{command:async args=>args[0]==='GET'?null:58000},
  './spotify-requests':{abortableDelay:async()=>assert.fail('Cooldown must be returned to the browser')},
 });
 await assert.rejects(api.musicbrainzRequest('artist/?query=a',new AbortController().signal),error=>error instanceof api.GenreCooldown&&error.retryAfter===58);
});
test('genre client shows countdown, retries the same lookup, and cancels during a pause',async()=>{
 const client=load('app/lib/genre-request.ts');
 const messages=[],body={title:'Blue',artist:'Artist',mode:'artist'};
 let calls=0;
 const result=await client.requestGenreLookup(async()=>++calls===1?Response.json({retryAfter:0.001},{status:429}):Response.json({genres:['Jazz'],source:'artist',checkedAt:100}),body,new AbortController().signal,text=>messages.push(text));
 assert.equal(calls,2);assert.deepEqual(result.genres,['Jazz']);assert.ok(messages.some(text=>text.includes('resuming automatically')));
 const abort=new AbortController();let stoppedCalls=0;
 await assert.rejects(client.requestGenreLookup(async()=>{stoppedCalls++;return Response.json({retryAfter:60},{status:429});},body,abort.signal,text=>{if(text.includes('resuming automatically'))abort.abort();}));
 assert.equal(stoppedCalls,1);
});

const {findAlbumGenres,libraryArtistGenres,genreProgress,genreLookupKey}=load('app/lib/auto-genres.ts');
const {organizeGenres}=load('app/lib/genre-organizer.ts');
const rec=(id,artist=id,extra={})=>({id,source:'spotify',title:id,artist,artists:[{id:artist,name:artist}],genres:[],...extra});
function organizerFixture(albums,cache={}) {
 const values=structuredClone(albums),lookups=structuredClone(cache),updates=[];
 const storage={load:async()=>({albums:values}),loadAutoGenres:async()=>({...lookups}),loadGenres:async()=>({}),applyAutoGenres:async(id,key,result,artistKey,replaceGenres)=>{
  lookups[key]=result;if(artistKey)lookups[artistKey]=result;
  const record=values.find(a=>a.id===id);if(!record||record.genresEdited||(record.genres.length&&!replaceGenres)||!result.genres.length)return null;
  record.genres=result.genres;return record;
 }};
 return {values,lookups,run:request=>organizeGenres({storage,request,signal:new AbortController().signal,retryUnmatched:false,onCache:()=>{},onUpdate:a=>updates.push(a.id),onStatus:()=>{}}),storage,updates};
}
const lookup=(genres=[],source='none')=>({genres,source,checkedAt:Date.now()});
test('Apple is checked for each album before any fallback',async()=>{
 const f=organizerFixture([rec('a','same'),rec('b','different'),rec('c','same')]),calls=[];
 await f.run(async q=>{calls.push(q.title+':'+q.mode);return q.title==='b'?lookup(['Rock'],'artist'):q.mode==='apple'?lookup(['Jazz'],'apple'):lookup();});
 assert.deepEqual(calls,['a:apple','b:apple','c:apple']);
 assert.deepEqual(f.values.map(a=>a.genres),[['Jazz'],['Rock'],['Jazz']]);
 assert.equal(f.lookups['artist:v1:same'],undefined);
});
test('old misses get a second pass immediately; completed misses can be retried on demand',async()=>{
 const record=rec('old'),f=organizerFixture([record],{[genreLookupKey(record)]:lookup()});let calls=[];
 await f.run(async q=>{calls.push(q.mode);return lookup();});
 assert.deepEqual(calls,['apple','apple','album']);
 assert.deepEqual(genreProgress(f.values,f.lookups),{waiting:0,unmatched:1,failed:0});
 calls=[];await f.run(async()=>assert.fail('Completed misses stay cached on normal runs'));
 await organizeGenres({storage:f.storage,request:async q=>{calls.push(q.mode);return q.mode==='apple'?lookup(['Pop'],'apple'):lookup();},signal:new AbortController().signal,retryUnmatched:true,onCache:()=>{},onUpdate:()=>{},onStatus:()=>{}});
 assert.deepEqual(calls,['apple']);assert.deepEqual(f.values[0].genres,['Pop']);
});
test('failed MusicBrainz fallback resumes without repeating Apple',async()=>{
 const f=organizerFixture([rec('a')]);
 await assert.rejects(f.run(async q=>{if(q.mode==='album')throw Error('Offline');return lookup();}),/Offline/);
 assert.deepEqual(genreProgress(f.values,f.lookups),{waiting:0,unmatched:0,failed:1});
 const calls=[];await f.run(async q=>{calls.push(q.mode);return lookup(['Jazz'],'apple');});
 assert.deepEqual(calls,['album']);assert.deepEqual(f.values[0].genres,['Jazz']);
});
test('library artist reuse requires matching IDs and agreement across solo albums',async()=>{
 const albums=[rec('one','artist',{genres:['Jazz']}),rec('two','artist',{genres:['Jazz','Pop']}),rec('three','artist'),rec('cleared','artist',{genresEdited:true}),rec('other','other-id',{genres:['Rock']})];
 assert.deepEqual(libraryArtistGenres(albums).get('artist'),['Jazz']);
 assert.equal(libraryArtistGenres(albums).has('other-id'),false);
 const f=organizerFixture(albums);await f.run(async q=>{assert.equal(q.mode,'apple');return lookup(['Pop'],'apple');});
 assert.deepEqual(f.values.find(a=>a.id==='three').genres,['Pop']);assert.deepEqual(f.values.find(a=>a.id==='cleared').genres,[]);
 assert.equal(libraryArtistGenres([...albums,rec('contradiction','artist',{genres:['Rock']})]).has('artist'),false);
});
test('album fallback matches compilation credits and rejects ambiguous releases',async()=>{
 const release={id,title:'Collection',score:100,'artist-credit':[{artist:{id:artistId,name:'Various Artists'}}]};
 const result=await findAlbumGenres('Collection',['Various Artists'],async path=>path.includes('?query=')?{'release-groups':[release]}:{id,genres:[{name:'jazz',count:2}]});
 assert.deepEqual(result.genres,['Jazz']);
 assert.deepEqual((await findAlbumGenres('Collection',['Various Artists'],async()=>({'release-groups':[release,release]}))).genres,[]);
});
test('Apple catalog requires matching album and artist, rejects conflicting editions and caches public responses',async()=>{
 const row={wrapperType:'collection',collectionType:'Album',collectionName:'Blue',artistName:'Artist',primaryGenreName:'Jazz'};
 const api=load('app/lib/apple-genres.ts',{'server-only':{},'node:crypto':{createHash},'./cloud-store':{command:async()=>JSON.stringify({results:[row]})},'./musicbrainz':{GenreCooldown:class extends Error{}}});
 assert.deepEqual(api.matchAppleGenres({results:[row]},'Blue',['Artist']),['Jazz']);
 assert.deepEqual(api.matchAppleGenres({results:[row]},'Blue',['Someone else']),[]);
 assert.deepEqual(api.matchAppleGenres({results:[row,{...row,primaryGenreName:'Rock'}]},'Blue',['Artist']),[]);
 assert.deepEqual(api.matchAppleGenres({results:[{...row,primaryGenreName:'Alternative'}]},'Blue',['Artist']),['Alternative']);
 assert.deepEqual((await api.findAppleGenres('Blue',['Artist'],new AbortController().signal)).genres,['Jazz']);
});
test('Apple pacing blocks uncached requests and surfaces a provider-specific countdown',async()=>{
 class Cooldown extends Error {constructor(seconds,provider){super('pause');this.retryAfter=seconds;this.provider=provider;}}
 const api=load('app/lib/apple-genres.ts',{'server-only':{},'node:crypto':{createHash},'./cloud-store':{command:async args=>args[0]==='GET'?null:3100},'./musicbrainz':{GenreCooldown:Cooldown}});
 await assert.rejects(api.findAppleGenres('Blue',['Artist'],new AbortController().signal),error=>error.retryAfter===4&&error.provider==='Apple catalog');
 const route=load('app/api/genres/route.ts',{
  '../../lib/spotify-session':{getSession:async()=>({accountId:'test'}),accountMatches:()=>true,config:()=>({origin:'https://app.test'})},
  '../../lib/auto-genres':{},'../../lib/musicbrainz':{GenreCooldown:Cooldown},
  '../../lib/apple-genres':{findAppleGenres:async()=>{throw new Cooldown(4,'Apple catalog');}},
 });
 const response=await route.POST(new Request('https://app.test/api/genres',{method:'POST',headers:{origin:'https://app.test'},body:JSON.stringify({title:'Blue',artist:'Artist',artists:['Artist'],mode:'apple'})}));
 assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'4');assert.equal((await response.json()).provider,'Apple catalog');
});
test('album matches apply to another saved edition without repeating the lookup',async()=>{
 const f=organizerFixture([rec('a','Artist',{title:'Blue'}),rec('b','Artist',{title:'Blue (Deluxe Edition)'})]);const calls=[];
 await f.run(async q=>{calls.push(q.mode);return q.mode==='album'?lookup(['Jazz'],'album'):lookup();});
 assert.deepEqual(calls,['apple','apple','album']);assert.deepEqual(f.values.map(a=>a.genres),[['Jazz'],['Jazz']]);
});

test('baroque pop is Pop, chamber pop is Pop, and weak unrelated tags are excluded',()=>{
 const {broadGenres}=load('app/lib/genres.ts');
 assert.deepEqual(broadGenres(['baroque pop']),['Pop']);assert.deepEqual(broadGenres(['chamber pop']),['Pop']);
 assert.deepEqual(broadGenres(['baroque']),['Classical']);
 assert.deepEqual(trustedGenres({tags:[{name:'indie rock',count:19},{name:'baroque pop',count:3},{name:'classical',count:1}]}),['Rock']);
});
test('recheck corrects automatic labels using Apple and leaves misses and manual choices intact',async()=>{
 const f=organizerFixture([rec('wrong','Arctic Monkeys',{genres:['Classical']}),rec('manual','Artist',{genres:['Jazz'],genresEdited:true}),rec('miss','Artist',{genres:['Rock']})]);
 const calls=[];await organizeGenres({storage:f.storage,signal:new AbortController().signal,retryUnmatched:false,recheckAutomatic:true,request:async q=>{calls.push(q.title+':'+q.mode);return q.title==='wrong'?lookup(['Alternative'],'apple'):lookup();},onCache:()=>{},onUpdate:()=>{},onStatus:()=>{}});
 assert.deepEqual(calls,['wrong:apple','miss:apple']);assert.deepEqual(f.values.map(a=>a.genres),[['Alternative'],['Jazz'],['Rock']]);
});

test('catalog title cleanup handles editions and EPs without confusing live or remix albums',()=>{
 for(const title of ['Blue [Deluxe Edition] - EP','Blue (2011 Remastered Version)','Blue (Bonus Track Version)','Blue (Legacy Edition)','Blue - Single'])assert.equal(genreTitle(title),'Blue');
 for(const title of ['Blue (Live)','Blue (Acoustic)','Blue (Remixes)',"Blue (Taylor’s Version)"])assert.equal(genreTitle(title),title);
});
test('fresh rechecks bypass old Apple results and report changed, unchanged and unmatched accurately',async()=>{
 const wrong=rec('wrong','Arctic Monkeys',{genres:['Classical']}),same=rec('same','Lana Del Rey',{genres:['Alternative']}),miss=rec('miss','Unknown',{genres:['Electronic']});
 const f=organizerFixture([wrong,same,miss],{[genreLookupKey(wrong)]:{...lookup(['Classical'],'apple'),strategy:2,phase:'complete'}}),calls=[],outcomes=[];
 const result=await organizeGenres({storage:f.storage,signal:new AbortController().signal,retryUnmatched:false,recheckAutomatic:true,request:async q=>{calls.push(q);return q.title==='miss'?lookup():lookup(['Alternative'],'apple');},onCache:()=>{},onUpdate:()=>{},onStatus:()=>{},onResult:value=>outcomes.push(value)});
 assert.equal(calls.length,3);assert.ok(calls.every(q=>Number.isFinite(q.refreshAfter)));assert.equal(new Set(calls.map(q=>q.refreshAfter)).size,1);
 assert.equal(result.changed,1);assert.equal(result.unchanged,1);assert.equal(result.unmatched,1);
 assert.deepEqual(outcomes.map(o=>o.status),['changed','unchanged','unmatched']);assert.deepEqual(outcomes[0].before,['Classical']);assert.deepEqual(outcomes[0].after,['Alternative']);
});
test('Apple fallback tries broader searches and another storefront, preserving refreshed pages across cooldown retries',async()=>{
 class Cooldown extends Error{}
 const cache=new Map(),urls=[];let gate=0;
 const row={wrapperType:'collection',collectionType:'Album',collectionName:'Blue',artistName:'Artist',primaryGenreName:'Alternative'};
 const api=load('app/lib/apple-genres.ts',{'server-only':{},'node:crypto':{createHash},'./musicbrainz':{GenreCooldown:Cooldown},'./cloud-store':{command:async args=>{
  if(args[0]==='GET')return cache.get(args[1])??null;
  if(args[0]==='SET'){cache.set(args[1],args[2]);return 'OK';}
  gate++;return gate===2?3100:0;
 }}},async url=>{urls.push(url);return Response.json({results:new URL(url).searchParams.get('country')==='GB'?[row]:[]});});
 const stamp=Date.now()-1,signal=new AbortController().signal;
 await assert.rejects(api.findAppleGenres('Blue',['Artist'],signal,stamp),Cooldown);
 const result=await api.findAppleGenres('Blue',['Artist'],signal,stamp);
 assert.deepEqual(result.genres,['Alternative']);assert.equal(urls.length,3);
 assert.deepEqual(urls.map(url=>new URL(url).searchParams.get('country')),['US','US','GB']);
 assert.equal(new URL(urls[1]).searchParams.get('term'),'Blue');
});
test('refresh bypasses stale Apple catalog cache, then reuses newly fetched data for the same run',async()=>{
 const row={wrapperType:'collection',collectionType:'Album',collectionName:'Blue',artistName:'Artist',primaryGenreName:'Alternative'};
 let cached=JSON.stringify({data:{results:[{...row,primaryGenreName:'Classical'}]},fetchedAt:1}),calls=0;
 const api=load('app/lib/apple-genres.ts',{'server-only':{},'node:crypto':{createHash},'./musicbrainz':{GenreCooldown:class extends Error{}},'./cloud-store':{command:async args=>{if(args[0]==='GET')return cached;if(args[0]==='SET'){cached=args[2];return 'OK';}return 0;}}},async()=>{calls++;return Response.json({results:[row]});});
 const signal=new AbortController().signal,stamp=Date.now()-1;
 assert.deepEqual((await api.findAppleGenres('Blue',['Artist'],signal,stamp)).genres,['Alternative']);
 await api.findAppleGenres('Blue',['Artist'],signal,stamp);assert.equal(calls,1);
});

test('quick pass reaches later easy albums before deep searches and resumes saved quick misses',async()=>{
 const f=organizerFixture([rec('hard'),rec('easy'),rec('manual','Artist',{genresEdited:true})]);
 const calls=[],statuses=[];const abort=new AbortController();
 await assert.rejects(organizeGenres({storage:f.storage,signal:abort.signal,retryUnmatched:false,
 request:async q=>{calls.push(`${q.title}:${q.depth??q.mode}`);return q.title==='easy'?lookup(['Pop'],'apple'):lookup();},
 onCache:()=>{},onUpdate:()=>{},onStatus:status=>{statuses.push(status);if(status.startsWith('Deep'))abort.abort();}}));
 assert.deepEqual(calls,['hard:quick','easy:quick']);assert.deepEqual(f.values[1].genres,['Pop']);
 assert.equal(f.lookups[genreLookupKey(f.values[0])].phase,'quick');
 calls.length=0;
 await f.run(async q=>{calls.push(`${q.title}:${q.depth??q.mode}`);return q.mode==='album'?lookup(['Rock'],'album'):lookup();});
 assert.deepEqual(calls,['hard:deep','hard:album']);assert.deepEqual(f.values[0].genres,['Rock']);
 assert.ok(statuses[0].startsWith('Quick'));assert.deepEqual(f.values[2].genres,[]);
});

test('automatic imported-album scope leaves unrelated uncategorized records alone',async()=>{
 const f=organizerFixture([rec('imported'),rec('existing')]),calls=[];
 await organizeGenres({storage:f.storage,signal:new AbortController().signal,retryUnmatched:false,albumIds:['imported'],request:async q=>{calls.push(q.title);return lookup(['Jazz'],'apple');},onCache:()=>{},onUpdate:()=>{},onStatus:()=>{}});
 assert.deepEqual(calls,['imported']);assert.deepEqual(f.values[1].genres,[]);
});

test('Apple quick lookup makes one search and deep lookup only requests the remaining searches',async()=>{
 const urls=[];
 const api=load('app/lib/apple-genres.ts',{'server-only':{},'node:crypto':{createHash},'./musicbrainz':{GenreCooldown:class extends Error{}},'./cloud-store':{command:async args=>args[0]==='GET'?null:0}},async url=>{urls.push(new URL(url));return Response.json({results:[]});});
 const signal=new AbortController().signal;
 await api.findAppleGenres('Blue',['Artist'],signal,undefined,'quick');
 assert.equal(urls.length,1);assert.equal(urls[0].searchParams.get('term'),'Blue Artist');
 await api.findAppleGenres('Blue',['Artist'],signal,undefined,'deep');
 assert.equal(urls.length,3);assert.equal(urls[1].searchParams.get('term'),'Blue');assert.equal(urls[2].searchParams.get('country'),'GB');
});
