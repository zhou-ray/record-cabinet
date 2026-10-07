import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
function load(file){const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const result={exports:{}};vm.runInThisContext(`(function(require,module,exports){${output}\n})`)(name=>load(path.resolve(path.dirname(file),name+'.ts')),result,result.exports);return result.exports;}
const {readSpotifyExport,exportAlbums,hydratedAlbum,needsAlbumDetails,spotifyLibraryId}=load('app/lib/spotify-export.ts');
const {parseBackup}=load('app/lib/collection-backup.ts');
const {loadAlbumDetails}=load('app/lib/load-album-details.ts');
const saved={album:'Record',artist:'Artist',uri:'spotify:album:abc'};
const song={album:'Record',artist:'Artist',track:'Song',uri:'spotify:track:song'};
const full=()=>({id:'spotify:abc',source:'spotify',title:'Record',artist:'Artist',artists:[{id:'spotify:artist',name:'Artist'}],year:'2026',genres:['Rock'],genre:'Rock',color:'moss',note:'',catalogNumber:'',artworkUrl:'https://example.com/cover.jpg',externalUrl:'https://open.spotify.com/album/abc',playback:{kind:'spotify',uri:'spotify:album:abc'},tracks:[{id:'spotify:song',title:'Song',duration:180,number:1,disc:1}]});
test('saved albums, liked songs and playlists read only music fields and reject unsupported data',async()=>{
 const sections=readSpotifyExport({albums:[saved],tracks:[song,{artist:'X',album:'Local',uri:'spotify:local:x'}],email:'private@example.com'});
 assert.equal(sections.length,2);assert.equal(sections[1].skipped,1);
 assert.equal(JSON.stringify(sections).includes('private'),false);
 const playlists=readSpotifyExport({playlists:[{name:'Favorites',items:[{track:{albumName:'Record',artistName:'Artist',trackUri:'spotify:track:song'}},{episode:{name:'Podcast'}}]}]});
 assert.equal(playlists[0].entries.length,1);assert.equal(playlists[0].skipped,1);
 assert.throws(()=>readSpotifyExport({email:'private@example.com'}),/YourLibrary/);
 const result=await exportAlbums([...sections[1].entries,...sections[0].entries,...playlists[0].entries],[]);
 assert.equal(result.length,1);assert.equal(result[0].id,'spotify:abc');assert.equal(result[0].tracks.length,0);assert.equal(needsAlbumDetails(result[0]),true);
});
test('track-only exports deduplicate deterministically, and never replace existing complete albums',async()=>{
 const entries=readSpotifyExport({tracks:[song,{...song,uri:'spotify:track:other'}]}).flatMap(s=>s.entries);
 const a=await exportAlbums(entries,[]),b=await exportAlbums([...entries].reverse(),[]);
 assert.equal(a.length,1);assert.equal(a[0].id,b[0].id);assert.equal(a[0].playback.kind,'spotify-pending');
 assert.equal((await exportAlbums(entries,[full()])).length,0);
 assert.equal((await exportAlbums(entries,a)).length,0);
});
test('pending records survive backup/cloud validation and hydration preserves identity and personal edits',async()=>{
 const [pending]=await exportAlbums(readSpotifyExport({tracks:[song]})[0].entries,[]);
 const restore=album=>parseBackup({format:'record-cabinet',version:1,albums:[album],organization:{systems:[],systemId:'',arrangement:'artist'}}).albums[0];
 assert.deepEqual(restore(pending),pending);
 const complete=hydratedAlbum({...pending,genres:['Jazz'],genre:'Jazz',genresEdited:true,note:'Keep me'},full());
 assert.equal(complete.id,pending.id);assert.equal(complete.note,'Keep me');assert.equal(complete.genre,'Jazz');
 assert.equal(needsAlbumDetails(complete),false);assert.equal(spotifyLibraryId(complete),'spotify:abc');assert.deepEqual(restore(complete),complete);
 assert.throws(()=>restore({...pending,playback:{kind:'spotify-pending',trackUri:'https://evil.test'}}));
});
test('on-demand loader requests one chosen album, handles a final line without newline and uses completed data without requests',async()=>{
 const [pending]=await exportAlbums([{title:'Record',artist:'Artist',uri:'spotify:album:abc'}],[]);
 const calls=[];const request=async(url,init)=>{calls.push(JSON.parse(init.body));return new Response(JSON.stringify({type:'progress',album:full()})+'\n'+JSON.stringify({type:'complete'}));};
 const ready=await loadAlbumDetails(pending,request,new AbortController().signal);
 assert.deepEqual(calls,[{albumLink:'spotify:album:abc'}]);assert.equal(ready.tracks.length,1);
 assert.equal(await loadAlbumDetails(ready,()=>{throw Error('No request expected');},new AbortController().signal),ready);
});
test('on-demand loader stops on completion even if stream remains open, and quota errors keep the pending record',async()=>{
 const [pending]=await exportAlbums(readSpotifyExport({tracks:[song]})[0].entries,[]);
 let cancelled=false;
 const request=async(_url,init)=>{assert.deepEqual(JSON.parse(init.body),{trackUri:'spotify:track:song'});return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify({type:'progress',album:full()})+'\n'+JSON.stringify({type:'complete'})+'\n'));},cancel(){cancelled=true;}}));};
 await loadAlbumDetails(pending,request,new AbortController().signal);assert.equal(cancelled,true);
 await assert.rejects(loadAlbumDetails(pending,async()=>new Response(JSON.stringify({type:'error',message:'Spotify needs a pause'})+'\n'),new AbortController().signal),/pause/);
 assert.equal(pending.playback.kind,'spotify-pending');assert.equal(pending.tracks.length,0);
});
