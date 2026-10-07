import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
function load(file, overrides={}) {
 const out=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const result={exports:{}};
 vm.runInThisContext(`(function(require,module,exports){${out}\n})`)(name=>name in overrides?overrides[name]:load(path.resolve(path.dirname(file),name+'.ts'),overrides),result,result.exports);
 return result.exports;
}
const {emptyCloudLibrary,mergeCloudLibrary,parseCloudLibrary}=load('app/lib/cloud-library.ts');
const album=(id,title=id)=>({id:`spotify:${id}`,source:'spotify',title,artist:'Artist',artists:[],year:'2026',genres:[],genre:'Uncategorized',color:'moss',note:'',catalogNumber:'',artworkUrl:null,externalUrl:null,playback:{kind:'spotify',uri:`spotify:album:${id}`},tracks:[]});
const library=(...albums)=>({...emptyCloudLibrary(),albums});
test('first device union and stale device sync preserve records and cloud edits',()=>{
 assert.deepEqual(mergeCloudLibrary(library(album('phone')),emptyCloudLibrary(),library(album('web'))).albums.map(a=>a.id),['spotify:web','spotify:phone']);
 const base=library(album('a'));
 const result=mergeCloudLibrary(base,base,library(album('a','Cloud edit'),album('b')));
 assert.equal(result.albums[0].title,'Cloud edit');assert.equal(result.albums.length,2);
 assert.equal(mergeCloudLibrary(library(album('a','Offline edit')),base,library(album('a','Cloud edit'))).albums[0].title,'Offline edit');
});
test('separate bin assignments and system rename survive concurrent edits',()=>{
 const base=emptyCloudLibrary();base.organization={systems:[{id:'s',name:'Room',bins:[{id:'one',label:'One'},{id:'two',label:'Two'}],assignments:{a:'one',b:'one'}}],systemId:'s',arrangement:'custom'};
 const phone=structuredClone(base),web=structuredClone(base);
 phone.organization.systems[0].assignments.a='two';web.organization.systems[0].assignments.b='two';web.organization.systems[0].name='New name';
 const result=mergeCloudLibrary(phone,base,web).organization.systems[0];
 assert.deepEqual(result.assignments,{a:'two',b:'two'});assert.equal(result.name,'New name');
});
test('deleted systems are not resurrected by an unchanged second device',()=>{
 const base=emptyCloudLibrary();base.organization.systems=[{id:'s',name:'Old',bins:[],assignments:{}}];
 assert.equal(mergeCloudLibrary(base,base,emptyCloudLibrary()).organization.systems.length,0);
});
test('fresh export imports reuse cloud track details without losing personal edits',()=>{
 const pending=album('a');
 const complete={...pending,artworkUrl:'https://i.scdn.co/image/cover',tracks:[{id:'one',title:'One',duration:180,number:1,disc:1}]};
 assert.deepEqual(mergeCloudLibrary(library(pending),emptyCloudLibrary(),library(complete)).albums[0],complete);
 const edited={...pending,note:'Keep this',genres:['Jazz'],genre:'Jazz',genresEdited:true};
 const merged=mergeCloudLibrary(library(edited),library(pending),library(complete)).albums[0];
 assert.deepEqual(merged.tracks,complete.tracks);assert.equal(merged.note,'Keep this');assert.equal(merged.genre,'Jazz');
});
test('cloud validation excludes demos and strips unexpected private fields',()=>{
 const record={...album('a'),accessToken:'never-store'};
 assert.equal('accessToken' in parseCloudLibrary(library(record)).albums[0],false);
 assert.throws(()=>parseCloudLibrary(library({...record,playback:{kind:'spotify',uri:'spotify:album:other'}})));
});
test('sync route isolates accounts, requires origin, validates payload and uses CAS conflicts',async()=>{
 let session={accountId:'owner'};const calls=[];
 const route=load('app/api/library/sync/route.ts',{
  '../../../lib/spotify-session':{getSession:async()=>session,accountMatches:(s,r)=>s.accountId===r.headers.get('x-record-cabinet-account'),config:()=>({origin:'https://app.test'})},
  '../../../lib/cloud-store':{readCloud:async id=>{calls.push(id);return {revision:0,enabled:true,library:emptyCloudLibrary()};},writeCloud:async(id)=>{calls.push(id);return -1;},resetCloud:async(id)=>{calls.push(id);return 1;}},
 });
 const request=(method,body,headers={})=>new Request('https://app.test/api/library/sync',{method,headers:{'x-record-cabinet-account':'owner',origin:'https://app.test',...headers},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await route.GET(request('GET'))).status,200);assert.deepEqual(calls,['owner']);
 assert.equal((await route.GET(request('GET',null,{'x-record-cabinet-account':'other'}))).status,409);
 assert.equal((await route.PUT(request('PUT',{revision:0,library:emptyCloudLibrary()},{origin:'https://evil.test'}))).status,403);
 assert.equal((await route.PUT(request('PUT',{revision:0,library:library(album('a'))}))).status,412);
 assert.equal((await route.PUT(request('PUT',{revision:0,library:{albums:'invalid'}}))).status,400);
 assert.equal((await route.DELETE(request('DELETE'))).status,200);
 session=null;assert.equal((await route.GET(request('GET'))).status,401);
});
test('concurrent note and genre changes to the same album both survive',()=>{
 const base=library({...album('a'),tracks:[{id:'one',title:'One',duration:180,number:1,disc:1}]});
 const phone=structuredClone(base),web=structuredClone(base);
 phone.albums[0].note='Sunday morning';
 Object.assign(web.albums[0],{genres:['Jazz'],genre:'Jazz',genresEdited:true});
 for(const result of [mergeCloudLibrary(phone,base,web),mergeCloudLibrary(web,base,phone)]){
  assert.equal(result.albums[0].note,'Sunday morning');
  assert.deepEqual(result.albums[0].genres,['Jazz']);
  assert.equal(result.albums[0].genresEdited,true);
 }
});
test('loading album details preserves a genre edited concurrently on another device',()=>{
 const base=library(album('a')),phone=structuredClone(base),web=structuredClone(base);
 phone.albums[0].tracks=[{id:'one',title:'One',duration:180,number:1,disc:1}];
 Object.assign(web.albums[0],{genres:['Jazz'],genre:'Jazz',genresEdited:true});
 const result=mergeCloudLibrary(phone,base,web).albums[0];
 assert.equal(result.tracks.length,1);assert.equal(result.genre,'Jazz');
});
test('manual genre corrections on either device take precedence over automatic classification',()=>{
 const original={...album('a'),tracks:[{id:'one',title:'One',duration:180,number:1,disc:1}]};
 const base=library(original),automatic=library({...original,genres:['Jazz'],genre:'Jazz'});
 for(const genres of [[],['Pop']]){
  const manual=library({...original,genres,genre:genres.join(' / ')||'Uncategorized',genresEdited:true});
  for(const merged of [mergeCloudLibrary(automatic,base,manual),mergeCloudLibrary(manual,base,automatic)]){
   assert.deepEqual(merged.albums[0].genres,genres);assert.equal(merged.albums[0].genresEdited,true);
  }
 }
});

test('genre bin preferences survive cloud validation and merge independently of arrangement',()=>{
 const base=library(album('a')),phone=structuredClone(base),web=structuredClone(base);
 phone.organization.genreBinCount=3;web.organization.arrangement='genre';
 const merged=mergeCloudLibrary(phone,base,web);
 assert.equal(merged.organization.genreBinCount,3);assert.equal(merged.organization.arrangement,'genre');
 assert.equal(parseCloudLibrary(merged).organization.genreBinCount,3);
 const next=structuredClone(merged);next.organization.genreBinCount=0;
 assert.equal(mergeCloudLibrary(merged,merged,next).organization.genreBinCount,0);
 const {parseOrganization}=load('app/lib/collection-backup.ts');
 assert.equal(parseOrganization({...base.organization,genreBinCount:999}).genreBinCount,0);
 assert.equal(parseOrganization(base.organization).genreBinCount,undefined);
});
