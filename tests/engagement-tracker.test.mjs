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


test('inspecting another album during playback never changes the playback session', async () => {
  const f = fixture(), tracker = f.make();
  const browsed = { ...album, id: 'spotify:other', playback: { kind: 'spotify', uri: 'spotify:album:other' } };
  tracker.begin(album); tracker.observe(album, state(0)); await tick(); tracker.observe(album, state(0)); await tick();
  const started = [...f.sessions.values()][0];
  tracker.inspect(browsed, 'browse-other'); await tick();
  f.at(15); tracker.observe(album, state(15)); await tick();
  assert.equal(f.sessions.size, 1);
  const current = [...f.sessions.values()][0];
  assert.equal(current.id, started.id); assert.equal(current.startedAt, started.startedAt);
  assert.equal(current.albumId, album.id); assert.equal(current.listenedSeconds, 15);
  assert.equal([...f.inspections.values()][0].albumId, browsed.id);
  await tracker.dispose();
});

test('inspection queued during a playback save is persisted without waiting for another checkpoint', async () => {
  let finishSave;
  const blocked = new Promise(resolve => { finishSave = resolve; });
  const sessions = new Map(), inspections = [];
  const tracker = createEngagementTracker({
    userId: 'a'.repeat(64), now: () => 1000, monotonic: () => 0, id: () => 'playing-session',
    acquire: async () => () => {}, error: () => assert.fail('unexpected storage error'),
    store: {
      async saveSession(value) { await blocked; sessions.set(value.id, value); },
      async recordInspection(value) { inspections.push(value); },
    },
  });
  tracker.begin(album); tracker.observe(album, state(0)); await tick();
  tracker.observe(album, state(0));
  const browsed = { ...album, id: 'spotify:browsed', playback: { kind: 'spotify', uri: 'spotify:album:browsed' } };
  tracker.inspect(browsed, 'opened-sleeve');
  const saving = tracker.flush();
  finishSave(); await saving;
  assert.equal(sessions.size, 1);
  assert.equal(inspections.length, 1, 'opening the sleeve must not remain queued behind playback');
  assert.equal(inspections[0].type, 'album_inspected');
  assert.equal(inspections[0].albumId, browsed.id);
  assert.equal([...sessions.values()][0].albumId, album.id);
  await tracker.dispose();
});

test('reset discards failed pending checkpoints and releases ownership without finalizing old history', async () => {
  const f = fixture(), tracker = f.make();
  tracker.begin(album); tracker.observe(album, state(0)); await tick(); tracker.observe(album, state(0)); await tick();
  f.fail(true); f.at(15); tracker.observe(album, state(15)); await tick();
  tracker.discard(); f.sessions.clear(); f.fail(false);
  await tracker.flush(); await tracker.dispose(); tracker.observe(album, state(30)); tracker.inspect(album, 'late');
  assert.equal(f.sessions.size, 0); assert.equal(f.inspections.size, 0);
  const fresh = f.make(); fresh.begin(album); fresh.observe(album, state(30)); await tick(); fresh.observe(album, state(30)); await tick();
  assert.equal(f.sessions.size, 1, 'reset releases the old playback lock');
  await fresh.dispose();
});

test('a stale generation rejection permanently discards its writer rather than retrying old behavior', async () => {
  let writes = 0, invalidated = 0, unlocked = 0;
  const tracker = createEngagementTracker({ userId: 'a'.repeat(64), now: () => 1000, monotonic: () => 0, id: () => 'stale',
    acquire: async () => () => { unlocked++; }, error: () => assert.fail('reset is not a transient disk error'), invalidated: () => { invalidated++; },
    store: { async saveSession() { writes++; const error = new Error('reset'); error.name = 'HistoryResetError'; throw error; }, async recordInspection() { assert.fail('discarded inspection'); } },
  });
  tracker.begin(album); tracker.observe(album, state(0)); await tick(); tracker.observe(album, state(0)); await tick();
  await tracker.flush(); tracker.observe(album, state(10)); tracker.inspect(album, 'late'); await tracker.dispose();
  assert.equal(writes, 1); assert.equal(invalidated, 1); assert.equal(unlocked, 1); assert.equal(tracker.hasPlayback(), false);
});
