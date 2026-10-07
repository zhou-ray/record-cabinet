import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file) { const result={exports:{}};const out=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInThisContext(`(function(module,exports){${out}\n})`)(result,result.exports);return result.exports; }
test('diagnostics retain safe references and statuses, never raw errors, URLs or account data',()=>{
 const d=load('app/lib/beta-diagnostics.ts');
 for(let i=0;i<15;i++)d.recordDiagnostic('import',429,'private-token person@example.com album-name https://secret.test Reference: 31c38538.');
 d.setDiagnosticSync('Paused');
 const output=d.createDiagnosticReport({connected:true,storageReady:true,storageError:false,importing:false,authError:'person@example.com',accountId:'private-account'}, {userAgent:'Mozilla Macintosh Chrome/130.0 Safari/537.36 Edg/131.0 private-token',width:390,height:844,online:true});
 const report=JSON.parse(output);
 assert.equal(report.browser,'Edge 131');assert.equal(report.sync,'Paused');assert.equal(report.signInResult,'None');assert.equal(report.recentErrors.length,10);assert.equal(report.recentErrors[0].reference,'31c38538');
 for(const secret of ['private-token','person@example.com','album-name','secret.test','private-account'])assert.equal(output.includes(secret),false);
 assert.equal(d.diagnosticArea('/api/spotify/library?album=secret'),'import');assert.equal(d.diagnosticArea('/unrelated'),null);
});
test('sign-in explanations distinguish invitation, session and quota problems',()=>{
 const {spotifySignInMessage:message}=load('app/lib/spotify-sign-in-message.ts');
 assert.match(message('not-invited'),/Users Management/);assert.match(message('expired'),/session expired/);assert.match(message('quota'),/reconnecting will not reset/);assert.doesNotMatch(message('unavailable'),/quota|allowance/);assert.equal(message('mobile-setup'),'');assert.equal(message(''),'');
});

test('playback history is bounded and rejects private fields and unrecognized events',()=>{
 const d=load('app/lib/beta-diagnostics.ts');
 for(let i=0;i<50;i++)d.recordPlaybackEvent(i%2?'settings-view':'records-view');
 d.recordPlaybackEvent('private album title');
 d.setPlaybackSnapshot({source:'spotify',playing:true,busy:false,ended:false,positionSeconds:15.9,durationSeconds:240,album:'Secret album',token:'secret-token'});
 const report=JSON.parse(d.createDiagnosticReport({connected:true,storageReady:true,storageError:false,importing:false,authError:''},{userAgent:'',width:390,height:800,online:true}));
 assert.equal(report.playbackHistory.length,40);assert.equal(report.player.positionSeconds,15);
 assert.equal(report.playbackHistory.at(-1).event,'playing');assert.equal(report.player.playing,true);
 assert.doesNotMatch(JSON.stringify(report),/Secret album|secret-token|private album/);
});
