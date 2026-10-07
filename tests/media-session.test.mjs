import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const result={exports:{}};
const source=ts.transpileModule(fs.readFileSync('app/lib/media-session.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInThisContext(`(function(module,exports){${source}\n})`)(result,result.exports);
const {installMediaControls,updateSystemPosition}=result.exports;
test('system transport respects allowed actions, uses album positions and clears handlers',()=>{
 const handlers={},calls=[];let allowed=true;
 const session={setActionHandler:(action,fn)=>{handlers[action]=fn;}};
 const cleanup=installMediaControls(session,{play:()=>calls.push('play'),pause:()=>calls.push('pause'),seek:n=>calls.push(n),position:()=>100,canPlay:()=>allowed,canPause:()=>allowed,canSeek:()=>allowed});
 handlers.play();handlers.pause();handlers.seekto({seekTime:180});handlers.seekbackward({seekOffset:15});handlers.seekforward({});
 assert.deepEqual(calls,['play','pause',180,85,110]);assert.equal(handlers.nexttrack,null);assert.equal(handlers.previoustrack,null);
 allowed=false;handlers.play();handlers.pause();handlers.seekto({seekTime:5});assert.equal(calls.length,5);
 cleanup();assert.ok(Object.values(handlers).every(value=>value===null));
});
test('partial Media Session support does not break controls and invalid positions are cleared',()=>{
 const handlers={},positions=[];
 const session={setActionHandler:(action,fn)=>{if(action.startsWith('seek'))throw Error('Unsupported');handlers[action]=fn;},setPositionState:value=>positions.push(value)};
 assert.doesNotThrow(()=>installMediaControls(session,{play(){},pause(){},seek(){},position:()=>0,canPlay:()=>true,canPause:()=>true,canSeek:()=>true})());
 updateSystemPosition(session,100,200);assert.equal(positions.at(-1).position,100);
 updateSystemPosition(session,100,-20);assert.equal(positions.at(-1).position,0);
 updateSystemPosition(session,NaN,0);assert.equal(positions.at(-1),undefined);
 assert.doesNotThrow(()=>updateSystemPosition({setPositionState(){throw Error('Unsupported');}},100,20));
});
