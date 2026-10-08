import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
function load(file) {
  const compiled = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext(`(function(module,exports,require){${code}\n})`)(compiled, compiled.exports, name => load(path.resolve(path.dirname(file), name + '.ts')));
  return compiled.exports;
}
const { createEngagementTracker } = load('app/lib/engagement-tracker.ts');
const album = { id: 'spotify:album', source: 'spotify', playback: { kind: 'spotify', uri: 'spotify:album:album' }, tracks: [{ id: 'spotify:track', duration: 100 }] };
const state = (seconds, paused = false) => ({ paused, position: seconds * 1000, duration: 100000, track_window: { current_track: { uri: 'spotify:track:track', album: { uri: 'spotify:album:album' } } } });
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let seconds = 0, id = 0, errors = 0, fail = false, locked = false;
  const sessions = new Map(), inspections = new Map();
  const make = () => createEngagementTracker({ userId: 'a'.repeat(64), now: () => 1000 + seconds * 1000, monotonic: () => seconds * 1000, id: () => `session-${++id}`,
    store: { async saveSession(value) { if (fail) throw Error('disk full'); sessions.set(value.id, structuredClone(value)); }, async recordInspection(value) { inspections.set(value.id, structuredClone(value)); } },
    acquire: async () => { if (locked) return null; locked = true; return () => { locked = false; }; }, error: () => { errors++; },
  });
  return { make, sessions, inspections, at: value => { seconds = value; }, fail: value => { fail = value; }, errors: () => errors };
}
test('tracker requires explicit start and confirmed matching playback; paused resume keeps one session', async () => {
  const f = fixture(), tracker = f.make();
  tracker.observe(album, state(0)); await tick(); assert.equal(f.sessions.size, 0);
  tracker.begin(album); tracker.observe(album, state(0, true)); await tick(); assert.equal(f.sessions.size, 0);
  tracker.observe(album, state(0)); await tick(); tracker.observe(album, state(0)); await tick();
  for (let s = 15; s <= 75; s += 15) { f.at(s); tracker.observe(album, state(s)); await tick(); }
  tracker.observe(album, state(75, true)); await tick();
  tracker.resume(album);
  f.at(90); tracker.observe(album, state(75)); await tick(); tracker.observe(album, state(75)); await tick();
  f.at(105); tracker.observe(album, state(90)); await tick();
  assert.equal(f.sessions.size, 1);
  const saved = [...f.sessions.values()][0];
  assert.equal(saved.listenedSeconds, 90); assert.equal(saved.completedAt, 76000);
  await tracker.dispose(); assert.equal([...f.sessions.values()][0].endedAt, 106000);
});
test('ownership excludes a second tracker, disposal releases it and demo cannot start a session', async () => {
  const f = fixture(), first = f.make(), second = f.make();
  first.begin(album); second.begin(album);
  first.observe(album, state(0)); second.observe(album, state(0)); await tick();
  first.observe(album, state(0)); second.observe(album, state(0)); await tick();
  assert.equal(f.sessions.size, 1);
  await first.dispose(); await tick();
  second.observe(album, state(0)); await tick(); second.observe(album, state(0)); await tick();
  assert.equal(f.sessions.size, 2);
  await second.dispose();
  const demo = f.make(); demo.begin({ ...album, source: 'mock' }); demo.observe({ ...album, source: 'mock' }, state(0)); await tick();
  assert.equal(f.sessions.size, 2); await demo.dispose();
});
test('storage failure retains latest checkpoint and bounded retry recovers without another start', async () => {
  const f = fixture(), tracker = f.make(); tracker.begin(album);
  tracker.observe(album, state(0)); await tick(); tracker.observe(album, state(0)); await tick();
  f.fail(true); f.at(15); tracker.observe(album, state(15)); await tick();
  assert.equal(f.errors(), 1); assert.equal([...f.sessions.values()][0].listenedSeconds, 0);
  f.fail(false); await tracker.flush();
  assert.equal([...f.sessions.values()][0].listenedSeconds, 15);
  tracker.interrupt(); f.at(20); tracker.observe(album, state(90)); await tick();
  await tracker.dispose(); assert.equal([...f.sessions.values()][0].listenedSeconds, 15);
});
test('inspection IDs deduplicate retries and late ownership cannot resurrect disposed playback', async () => {
  const f = fixture(), tracker = f.make();
  tracker.inspect(album, 'interaction', 1000); tracker.inspect(album, 'interaction', 1000); await tick(); await tracker.flush();
  assert.equal(f.inspections.size, 1);
  tracker.begin(album); tracker.observe(album, state(0)); await tracker.dispose(); await tick();
  tracker.observe(album, state(10)); assert.equal(f.sessions.size, 0);
});


test('disposing a failed writer does not recreate deleted history on a later retry', async () => {
  const f = fixture(), tracker = f.make(); tracker.begin(album);
  tracker.observe(album, state(0)); await tick(); tracker.observe(album, state(0)); await tick();
  f.fail(true); f.at(15); tracker.observe(album, state(15)); await tick();
  await tracker.dispose(); f.sessions.clear(); f.fail(false);
  await tracker.flush(); tracker.observe(album, state(20)); await tick();
  assert.equal(f.sessions.size, 0);
});


test('explicit resume rearms a failed start without inventing playback before confirmation', async () => {
  const f = fixture(), tracker = f.make();
  tracker.begin(album); tracker.end(); tracker.resume(album);
  assert.equal(f.sessions.size, 0);
  tracker.observe(album, state(0)); await tick(); tracker.observe(album, state(0)); await tick();
  assert.equal(f.sessions.size, 1);
  await tracker.dispose();
});
