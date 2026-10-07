import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync('app/lib/turntable.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const compiled = { exports: {} };
vm.runInThisContext(`(function(module,exports){${source}\n})`)(compiled, compiled.exports);
const { ARM, clampPosition, pointToPosition, positionToAngle, playbackPosition } = compiled.exports;
function point(angle) { const radians = angle * Math.PI / 180; return [ARM.x - Math.sin(radians) * 330, ARM.y + Math.cos(radians) * 330]; }

test('needle position maps from outer groove through center to the inner groove', () => {
  for (const progress of [0, 30, 60, 90, 120]) {
    const angle = positionToAngle(progress, 120);
    assert.ok(Math.abs(pointToPosition(...point(angle), 120) - progress) < 0.00001);
  }
  assert.equal(positionToAngle(0, 120), ARM.outerAngle);
  assert.equal(positionToAngle(120, 120), ARM.innerAngle);
});
test('dragging past the playable grooves stays inside the track', () => {
  assert.equal(pointToPosition(...point(0), 120), 0);
  assert.equal(pointToPosition(...point(80), 120), 120);
  assert.equal(clampPosition(NaN, 120), 0);
  assert.equal(clampPosition(80, 0), 0);
});
test('local needle clock advances only during playback and never invents a next track', () => {
  assert.equal(playbackPosition(10, 120, true, 1000, 6000), 15);
  assert.equal(playbackPosition(10, 120, false, 1000, 6000), 10);
  assert.equal(playbackPosition(119, 120, true, 1000, 6000), 120);
  assert.equal(playbackPosition(10, 120, true, 6000, 1000), 10);
  assert.equal(playbackPosition(10, 120, true, 0, 6000), 10);
});
