import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync('app/lib/engagement.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const compiled = { exports: {} };
vm.runInThisContext(`(function(module,exports){${source}\n})`)(compiled, compiled.exports);
const { createPlaybackAccumulator, startPlaybackSession, checkedSession, sessionEvents, inspection, engagementAlbumId } = compiled.exports;
const account = 'a'.repeat(64), albumId = 'spotify:abc';
const initial = () => startPlaybackSession('session-1', account, albumId, 100, 1000);
const sample = (seconds, position = seconds, playing = true) => ({ albumId, playing, positionSeconds: position, monotonicMs: seconds * 1000, timestamp: 1000 + seconds * 1000 });

test('engagement identities reject guests, unknown duration and demo/unresolved audio', () => {
  assert.throws(() => inspection('x', 'guest', albumId, 1000));
  for (const duration of [0, NaN, Infinity, -1]) assert.throws(() => startPlaybackSession('s', account, albumId, duration, 1000));
  for (const source of ['mock', 'manual']) assert.equal(engagementAlbumId({ source, id: albumId, playback: { kind: 'spotify', uri: 'spotify:album:abc' } }), null);
  assert.equal(engagementAlbumId({ source: 'spotify-export', id: 'export:x', playback: { kind: 'spotify-pending', trackUri: 'spotify:track:x' } }), null);
  assert.equal(engagementAlbumId({ source: 'spotify-export', id: 'export:x', playback: { kind: 'spotify', uri: 'spotify:album:abc' } }), albumId);
});
test('verified coverage crosses 75 percent once and retains actual duration', () => {
  const accumulator = createPlaybackAccumulator(initial());
  for (let seconds = 0; seconds <= 90; seconds += 15) accumulator.observe(sample(seconds));
  const session = accumulator.snapshot();
  assert.equal(session.listenedSeconds, 90);
  assert.equal(session.completionRatio, .9);
  assert.equal(session.completedAt, 76000);
  assert.deepEqual(session.covered, [[0, 90]]);
  assert.deepEqual(sessionEvents(session).map(e => e.type), ['album_play_started', 'album_completed']);
  accumulator.observe(sample(90));
  assert.equal(accumulator.snapshot().completedAt, 76000);
  assert.equal(accumulator.end(92000).endedAt, 92000);
  assert.deepEqual(accumulator.observe(sample(100)), accumulator.snapshot());
});
test('pause and duplicate/out-of-order observations do not add listening', () => {
  const a = createPlaybackAccumulator(initial());
  a.observe(sample(0)); a.observe(sample(10, 10, false));
  a.observe(sample(20, 10, false)); a.observe(sample(30, 10)); a.observe(sample(40, 20));
  const before = a.snapshot();
  a.observe(sample(40, 25)); a.observe(sample(39, 26));
  assert.equal(a.snapshot().listenedSeconds, 20);
  assert.equal(a.snapshot().completedAt, null);
  assert.deepEqual(a.snapshot(), before);
});
test('forward/backward seeks and repeated sections cannot manufacture completion', () => {
  const a = createPlaybackAccumulator(initial());
  a.observe(sample(0)); a.observe(sample(10, 90));
  assert.equal(a.snapshot().listenedSeconds, 0);
  a.interrupt(); a.observe(sample(20, 0)); a.observe(sample(30, 10));
  a.observe(sample(40, 0)); a.observe(sample(50, 10));
  assert.equal(a.snapshot().listenedSeconds, 20);
  assert.equal(a.snapshot().completionRatio, .1);
  assert.equal(a.snapshot().completedAt, null);
});
test('device loss, mismatched album, stale gaps and reloads break continuity', () => {
  const a = createPlaybackAccumulator(initial());
  a.observe(sample(0)); a.observe(sample(10)); a.interrupt(); a.observe(sample(20));
  a.observe({ ...sample(25), albumId: 'spotify:other' }); a.observe(sample(30));
  a.observe(sample(70)); a.observe(sample(80));
  assert.equal(a.snapshot().listenedSeconds, 20);
  const recovered = createPlaybackAccumulator(a.snapshot());
  recovered.observe(sample(100, 90));
  assert.equal(recovered.snapshot().listenedSeconds, 20);
  recovered.observe(sample(110, 100));
  assert.equal(recovered.snapshot().listenedSeconds, 30);
});
test('invalid observations never poison or advance a session', () => {
  const a = createPlaybackAccumulator(initial()); a.observe(sample(0));
  for (const value of [NaN, Infinity, -1, 101]) a.observe(sample(10, value));
  assert.equal(a.snapshot().listenedSeconds, 0);
  assert.equal(a.snapshot().revision, 1);
  const result = a.snapshot(); result.covered.push([0, 90]);
  assert.deepEqual(a.snapshot().covered, []);
});
test('session validation excludes arbitrary metadata and rejects forged coverage', () => {
  const base = initial();
  assert.equal('accessToken' in checkedSession({ ...base, accessToken: 'do-not-store' }, account), false);
  assert.throws(() => checkedSession(base, 'b'.repeat(64)));
  assert.throws(() => checkedSession({ ...base, covered: [[0, 80]], completionRatio: .8, listenedSeconds: 80 }, account));
  assert.throws(() => checkedSession({ ...base, completionRatio: NaN }, account));
  assert.throws(() => checkedSession({ ...base, covered: [[0, 10], [5, 15]] }, account));
});
