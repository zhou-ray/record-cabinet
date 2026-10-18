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
const { createPersonalizationExport } = load('app/lib/personalization-export.ts');
const { startPlaybackSession, sessionEvents, inspection } = load('app/lib/engagement.ts');
const account = 'a'.repeat(64), other = 'b'.repeat(64);
function fixture() {
  const session = startPlaybackSession('session', account, 'spotify:record', 200, 1000);
  return { accountId: account, exportedAt: 3000,
    albums: [{ id: 'spotify:record', source: 'spotify', title: '朋友', artist: 'Wakin Chau', genres: ['Pop'], addedAt: 1000, playback: { kind: 'spotify', uri: 'spotify:album:record' } }],
    events: [...sessionEvents(session), inspection('opening', account, 'spotify:record', 2000)], sessions: [session],
    organization: { arrangement: 'custom', systemId: 'sys', systems: [{ id: 'sys', name: 'My bins', bins: [{ id: 'bin', label: 'Favorites' }], assignments: { 'spotify:record': 'bin' } }] },
  };
}
test('export preserves readable history, album identities and bin memberships without inventing timestamps', () => {
  const source = fixture(), before = structuredClone(source), data = createPersonalizationExport(source);
  assert.deepEqual(source, before, 'export must not mutate live inputs');
  assert.equal(data.version, 1);
  assert.equal(data.exportedAt, '1970-01-01T00:00:03.000Z');
  assert.equal(data.library[0].title, '朋友');
  assert.equal(data.library[0].spotifyAlbumId, 'spotify:record');
  assert.equal(data.events[0].type, 'album_play_started');
  assert.equal(data.events[1].type, 'album_inspected');
  assert.equal(data.events[0].sessionId, data.sessions[0].id);
  assert.equal(data.sessions[0].startedAt, '1970-01-01T00:00:01.000Z');
  assert.deepEqual(data.organization.systems[0].memberships, [{ albumId: 'spotify:record', binId: 'bin', assignedAt: null }]);
  assert.equal(data.organization.systems[0].createdAt, null);
  assert.equal(data.generatedBins.status, 'latest-snapshot-only');
});
test('export allowlists every structure and excludes credentials, raw provider state, and account hashes', () => {
  const source = fixture();
  const secret = { accessToken: 'ACCESS_SECRET', refreshToken: 'REFRESH_SECRET', cookie: 'COOKIE_SECRET', sdk: { token: 'SDK_SECRET' } };
  for (const object of [source, source.albums[0], source.albums[0].playback, source.events[0], source.sessions[0], source.organization, source.organization.systems[0], source.organization.systems[0].bins[0]]) Object.assign(object, secret);
  source.albums[0].externalUrl = 'https://example.test/?token=URL_SECRET';
  const json = JSON.stringify(createPersonalizationExport(source), null, 2);
  for (const forbidden of ['ACCESS_SECRET', 'REFRESH_SECRET', 'COOKIE_SECRET', 'SDK_SECRET', 'URL_SECRET', account]) assert.equal(json.includes(forbidden), false);
  assert.match(json, /\n  "version": 1/);
});
test('export rejects mixed-account history, invalid events and malformed data instead of downloading a partial success', () => {
  const source = fixture();
  assert.throws(() => createPersonalizationExport({ ...source, accountId: 'guest' }));
  assert.throws(() => createPersonalizationExport({ ...source, events: [{ ...source.events[0], userId: other }] }));
  assert.throws(() => createPersonalizationExport({ ...source, sessions: [{ ...source.sessions[0], userId: other }] }));
  assert.throws(() => createPersonalizationExport({ ...source, events: [{ ...source.events[0], type: 'unknown' }] }));
  assert.throws(() => createPersonalizationExport({ ...source, events: [{ ...source.events[0], id: 'wrong-session-id' }] }));
  assert.throws(() => createPersonalizationExport({ ...source, exportedAt: NaN }));
  assert.throws(() => createPersonalizationExport({ ...source, albums: [{ ...source.albums[0], title: { accessToken: 'secret' } }] }));
  assert.throws(() => createPersonalizationExport({ ...source, organization: { ...source.organization, systems: [{}] } }));
});
test('empty history, removed albums and unresolved imports export honestly without requiring retained sessions', () => {
  const source = fixture();
  const pending = { ...source.albums[0], id: 'export:pending', source: 'spotify-export', addedAt: undefined, playback: { kind: 'spotify-pending', trackUri: 'spotify:track:track' } };
  const result = createPersonalizationExport({ ...source, albums: [pending, { ...pending, source: 'mock' }], sessions: [] });
  assert.equal(result.library.length, 1);
  assert.equal(result.library[0].spotifyAlbumId, null);
  assert.equal(result.library[0].addedAt, null);
  assert.equal(result.events.length, 2, 'retention can leave events without their sessions');
  const empty = createPersonalizationExport({ ...source, albums: [], events: [], sessions: [] });
  assert.deepEqual(empty.events, []);
  assert.deepEqual(empty.sessions, []);
});
