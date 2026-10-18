import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
function load(file) {
  const compiled = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('module', 'exports', 'require', code)(compiled, compiled.exports, name => load(path.resolve(path.dirname(file), name + '.ts')));
  return compiled.exports;
}
const { assignDiscoverySnapshot: assign, checkedDiscoverySnapshot: check, visibleDiscoveryBins: visible, DISCOVERY_LIFETIME: ttl } = load('app/lib/discovery-snapshot.ts');
const { createPersonalizationExport } = load('app/lib/personalization-export.ts');
const accountId = 'a'.repeat(64), now = 10000;
function fixture(count = 100) {
  const albums = Array.from({length: count}, (_, i) => ({id: `spotify:a${i}`, source: 'spotify', playback: {kind: 'spotify', uri: `spotify:album:a${i}`}}));
  return {id: 'snapshot', accountId, now, albums, membership: albums.map(a => ({albumId: a.id, saved: true, checkedAt: now, source: 'spotify-library-contains'})), candidates: {wander: albums.map(a => a.id), digging: albums.map(a => a.id)}};
}
test('assignment caps bins, excludes overlap and unverified albums, and does not manufacture favorites', () => {
  const input = fixture(), before = structuredClone(input);
  input.candidates.wander.unshift('spotify:outside');
  input.membership[0].saved = false;
  const result = assign(input);
  assert.deepEqual(result.bins.map(b => b.albumIds.length), [0, 20, 20]);
  const ids = result.bins.flatMap(b => b.albumIds);
  assert.equal(new Set(ids).size, 40);
  assert.ok(!ids.includes('spotify:outside') && !ids.includes('spotify:a0'));
  assert.equal(result.expiresAt, now + ttl);
  assert.deepEqual(input.albums, before.albums);
  assert.deepEqual(assign(fixture(3)).bins.map(b => b.albumIds.length), [0, 2, 1]);
  assert.deepEqual(assign(fixture(0)).bins.map(b => b.albumIds.length), [0, 0, 0]);
});
test('filtered browsing preserves stored order, never refills, and fails closed at expiry', () => {
  const input = fixture(10), snapshot = assign(input), before = structuredClone(snapshot);
  input.membership[0].saved = false;
  input.membership[2].checkedAt = now + 1;
  const bins = visible(snapshot, input.albums, input.membership, now);
  assert.deepEqual(bins[1].albumIds, ['spotify:a4', 'spotify:a6', 'spotify:a8']);
  assert.deepEqual(snapshot, before);
  assert.ok(visible(snapshot, input.albums, input.membership, now + ttl).every(b => !b.albumIds.length));
  assert.ok(visible(snapshot, input.albums, input.membership, now - 1).every(b => !b.albumIds.length));
});
test('snapshot validation rejects foreign, oversized, overlapping and malformed data and strips unknown metadata', () => {
  const valid = assign(fixture());
  assert.deepEqual(check({...valid, token: 'secret'}, accountId), valid);
  for (const edit of [s => s.accountId = 'b'.repeat(64), s => s.expiresAt++, s => s.bins.reverse(), s => s.bins[1].albumIds.push('spotify:extra'), s => s.bins[2].albumIds[0] = s.bins[1].albumIds[0]]) {
    const bad = structuredClone(valid); edit(bad); assert.throws(() => check(bad, accountId));
  }
});
test('personalization export includes an allowlisted latest snapshot without account identity', () => {
  const discovery = assign(fixture(2));
  const data = createPersonalizationExport({accountId, exportedAt: now, albums: [], events: [], sessions: [], organization: {arrangement: 'artist', systems: [], systemId: ''}, discovery: {...discovery, token: 'secret'}});
  assert.equal(data.generatedBins.history[0].id, discovery.id);
  assert.equal(data.generatedBins.history[0].expiresAt, new Date(now + ttl).toISOString());
  assert.ok(!JSON.stringify(data).includes(accountId));
  assert.ok(!JSON.stringify(data).includes('secret'));
});
