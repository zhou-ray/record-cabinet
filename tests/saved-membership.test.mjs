import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compiled = {exports:{}};
const source=ts.transpileModule(fs.readFileSync('app/lib/saved-membership.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInThisContext(`(function(module,exports){${source}\n})`)(compiled,compiled.exports);
const {checkSavedMembership,eligibleSavedAlbums,nextMembershipBatch,membershipStatus,mergeMembership,MEMBERSHIP_TTL_MS}=compiled.exports;
const account='a'.repeat(64), now=100000;
const album=id=>({id:`spotify:${id}`,source:'spotify',playback:{kind:'spotify',uri:`spotify:album:${id}`}});
const row=(id,saved=true,checkedAt=now)=>({albumId:`spotify:${id}`,saved,checkedAt,source:'spotify-library-contains'});
test('eligibility never infers saved membership from imports, provider or track likes',()=>{
 const albums=[{...album('a'),importOrigin:{source:'saved'}},album('b'),{...album('c'),source:'manual'}, {...album('d'),source:'mock'}, {...album('e'),playback:{kind:'spotify-pending',trackUri:'spotify:track:e'}}];
 assert.deepEqual(eligibleSavedAlbums(albums,[],now),[]);
 assert.deepEqual(eligibleSavedAlbums([...albums,album('a')],['a','b','c','d','e'].map(id=>row(id,id!=='b')),now).map(a=>a.id),['spotify:a']);
 assert.deepEqual(nextMembershipBatch(albums,[],now),['spotify:a','spotify:b']);
});
test('membership expires conservatively and batch planning skips fresh positive and negative checks',()=>{
 assert.equal(membershipStatus('spotify:a',[row('a')],now+MEMBERSHIP_TTL_MS-1),'saved');
 assert.equal(membershipStatus('spotify:a',[row('a')],now+MEMBERSHIP_TTL_MS),'unknown');
 assert.equal(membershipStatus('spotify:a',[row('a')],now-1),'unknown');
 const albums=Array.from({length:100},(_,i)=>album(String(i)));
 const batch=nextMembershipBatch(albums,[row('0'),row('1',false)],now);
 assert.equal(batch.length,40);assert.equal(batch[0],'spotify:2');
 assert.deepEqual(mergeMembership([row('a',false,200)],[row('a',true,100)]),[row('a',false,200)]);
 assert.deepEqual(mergeMembership([row('a',false,200)],[row('a',true,200)]),[row('a',false,200)]);
});
test('provider membership rejects malformed, failed and cancelled responses without negative guesses',async()=>{
 let calls=0;
 const valid=await checkSavedMembership(['spotify:a','spotify:a','spotify:b'],account,async()=>{calls++;return [true,false];},undefined,()=>now);
 assert.equal(calls,1);assert.deepEqual(valid.records,[row('a'),row('b',false)]);
 for(const data of [[],[true],[true,false,true],['true',false],null])await assert.rejects(checkSavedMembership(['spotify:a','spotify:b'],account,async()=>data));
 await assert.rejects(checkSavedMembership(['spotify:a'],account,async()=>{throw Error('429');}));
 const controller=new AbortController();
 await assert.rejects(checkSavedMembership(['spotify:a'],account,async()=>{controller.abort();return [true];},controller.signal));
});
