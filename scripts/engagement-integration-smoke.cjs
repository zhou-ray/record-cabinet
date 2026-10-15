/* eslint-disable @typescript-eslint/no-require-imports -- Isolated mocked Spotify integration. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createCipheriv, createHash, randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:3194';
const account = 'a'.repeat(64);
function cookie() {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', createHash('sha256').update('record-cabinet-offline-test-secret-only').digest(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ value: { accountId: account, accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }, until: Date.now() + 3600000 })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
(async () => {
 const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
 try {
  for (const width of [390, 1400]) {
   const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: process.env.REDUCED_MOTION === 'true' ? 'reduce' : 'no-preference' });
   await context.addCookies([{ name: 'rc_spotify', value: cookie(), url: origin }]);
   await context.route('**/api/library/sync', route => route.fulfill({ status: 503, json: { error: 'Test: cloud disabled' } }));
   await context.route('**/api/genres**', route => route.fulfill({ status: 503, json: { error: 'Test: genres disabled' } }));
   await context.addInitScript(() => {
    window.testElapsed = 0;
    const wall = Date.now.bind(Date), mono = performance.now.bind(performance);
    Date.now = () => wall() + window.testElapsed;
    Object.defineProperty(performance, 'now', { value: () => mono() + window.testElapsed });
    window.Spotify = { Player: class {
     constructor() { this.listeners = {}; window.mockPlayer = this; }
     addListener(name, fn) { this.listeners[name] = fn; }
     async connect() { this.listeners.ready({ device_id: 'test-device' }); return true; }
     disconnect() {} async activateElement() {} async setVolume() {}
     emit(seconds, paused = false) {
      this.state = { paused, position: seconds * 1000, duration: 100000, track_window: { current_track: { uri: 'spotify:track:track', name: 'Track', album: { uri: 'spotify:album:smoke' } } } };
      this.listeners.player_state_changed(this.state);
     }
     async getCurrentState() { return this.state || null; }
     async pause() { this.emit(this.state.position / 1000, true); }
     async resume() { this.emit(this.state.position / 1000); }
     async seek(position) { this.emit(position / 1000); }
    } };
   });
   const page = await context.newPage(), errors = [];
   let failPlay = true;
   page.on('pageerror', error => errors.push(error.message));
   await context.route('**/api/spotify/**', async route => {
    const request = route.request();
    if (request.url().endsWith('/account')) return route.fulfill({ json: { accountId: account } });
    if (request.url().endsWith('/player')) {
     const body = request.postDataJSON();
     if (body.action === 'play' && failPlay) { failPlay = false; return route.fulfill({ status: 403, json: { error: 'Test playback rejected' } }); }
     if (body.action === 'play') await page.evaluate(() => window.mockPlayer.emit(0));
     return route.fulfill({ json: { accepted: true } });
    }
    return route.fulfill({ status: 503, json: { error: 'Unexpected test request' } });
   });
   await page.goto(origin + '/settings');
   await page.waitForTimeout(400);
   if (process.env.EXPECT_DISABLED === 'true') {
    assert.equal(await page.getByRole('button', { name: 'Tracking debug', exact: true }).count(), 0);
    assert.equal(await page.getByText(/This test build keeps album browsing/).count(), 0);
    assert.equal(await page.evaluate(async () => (await indexedDB.databases()).some(db => db.name?.startsWith('record-cabinet-engagement:'))), false);
    await page.getByText('Account and privacy', { exact: true }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download My Data', exact: true }).click();
    const download = await downloading, data = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    assert.deepEqual(data.events, []);
    assert.deepEqual(data.sessions, []);
    await page.evaluate(async account => {
     const db = await new Promise(resolve => { const r = indexedDB.open(`record-cabinet-engagement:${account}`); r.onsuccess = () => resolve(r.result); });
     await new Promise(resolve => { const tx = db.transaction('events', 'readwrite'); tx.objectStore('events').put({ id: 'retained-inspection', userId: account, type: 'album_inspected', albumId: 'spotify:old', timestamp: 1000 }); tx.oncomplete = resolve; }); db.close();
    }, account);
    const retainedDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download My Data', exact: true }).click();
    const retained = JSON.parse(await fs.readFile(await (await retainedDownload).path(), 'utf8'));
    assert.equal(retained.events[0].id, 'retained-inspection', 'disabled tracking still permits export of old history');
    await page.getByRole('button', { name: 'Reset Personalization History', exact: true }).click();
    await page.getByRole('button', { name: 'Reset history', exact: true }).click();
    await page.getByRole('button', { name: 'Reset history', exact: true }).waitFor({ state: 'detached' });
    const clearedDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download My Data', exact: true }).click();
    const clearedData = JSON.parse(await fs.readFile(await (await clearedDownload).path(), 'utf8'));
    assert.deepEqual(clearedData.events, []); assert.deepEqual(clearedData.sessions, []);
    assert.deepEqual(errors, []); await context.close();
    console.log(`PASS: no automatic history collection; empty/retained-history downloads and reset work with tracking disabled at ${width}px`);
    continue;
   }
   await page.evaluate(async account => {
    await new Promise((resolve, reject) => {
     const request = indexedDB.open(`record-cabinet-library:${account}`, 1);
     request.onsuccess = () => {
      const db = request.result, tx = db.transaction('albums', 'readwrite');
      tx.objectStore('albums').put({ id: 'spotify:smoke', availabilityCheckedAt: Date.now(), source: 'spotify', title: 'Test Record', artist: 'Test Artist', artists: [{ id: 'artist', name: 'Test Artist' }], year: '2026', genre: 'Jazz', genres: ['Jazz'], genresEdited: true, color: 'moss', note: '', catalogNumber: '', artworkUrl: null, externalUrl: null, playback: { kind: 'spotify', uri: 'spotify:album:smoke' }, tracks: [{ id: 'spotify:track', title: 'Track', duration: 100, disc: 1, number: 1 }] });
      const original = tx.objectStore('albums').get('spotify:smoke');
      original.onsuccess = () => tx.objectStore('albums').put({ ...original.result, id: 'spotify:browsed', title: 'Z Browsed Record', playback: { kind: 'spotify', uri: 'spotify:album:browsed' }, tracks: [{ id: 'spotify:browsedtrack', title: 'Other Track', duration: 100, disc: 1, number: 1 }] });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
     };
    });
   }, account);
   await page.reload();
   await page.getByRole('link', { name: '← Back to records', exact: true }).click();
   await page.getByRole('button', { name: 'Open All records, 2 records', exact: true }).click();
   const surface = page.locator('[class*=touchSurface]');
   await surface.click();
   const play = page.getByRole('button', { name: 'Play Test Record by tapping the vinyl', exact: true });
   await play.waitFor();
   await page.waitForFunction(() => !document.querySelector('button[title="Play this album"]').disabled);
   const read = () => page.evaluate(async account => {
    const db = await new Promise(resolve => { const request = indexedDB.open(`record-cabinet-engagement:${account}`); request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction(['events', 'sessions']);
    const read = name => new Promise(resolve => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); });
    const [events, sessions] = await Promise.all([read('events'), read('sessions')]); db.close(); return { events, sessions };
   }, account);
   await page.waitForTimeout(200);
   assert.equal((await read()).events.filter(e => e.type === 'album_inspected').length, 1);
   await page.locator('[class*=activeBack] [class*=backTitle]').click();
   await page.locator('#album-details').waitFor({ state: 'detached' });
   await surface.focus(); await page.keyboard.press('Enter');
   await page.waitForFunction(() => !document.querySelector('button[title="Play this album"]').disabled);
   await play.click();
   await page.getByText('Test playback rejected', { exact: true }).first().waitFor();
   assert.equal((await read()).sessions.length, 0, 'failed play does not create history');
   await play.click();
   await page.getByRole('button', { name: 'Pause record', exact: true }).waitFor();
   await page.evaluate(() => window.mockPlayer.emit(0)); await page.waitForTimeout(100);
   await page.evaluate(() => window.mockPlayer.emit(0)); await page.waitForTimeout(100);
   const playingSession = (await read()).sessions[0].id;
   await page.locator('[class*=activeBack] [class*=backTitle]').click();
   await page.locator('#album-details').waitFor({ state: 'detached' });
   await surface.focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100);
   await page.keyboard.press('Enter');
   await page.getByRole('region', { name: 'Full track list for Z Browsed Record', exact: true }).waitFor();
   await page.waitForFunction(() => !document.querySelector('button[title="Play this album"]').disabled);
   assert.equal(await page.evaluate(() => navigator.mediaSession.metadata?.title), 'Test Record', 'turntable remains on the playing record');
   for (let opening = 0; opening < 3; opening++) {
    await page.locator('[class*=activeBack] [class*=backTitle]').click();
    await page.locator('#album-details').waitFor({ state: 'detached' });
    await surface.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('button[title="Play this album"]').disabled);
    await page.waitForTimeout(100);
    const history = await read();
    assert.equal(history.events.filter(e => e.type === 'album_inspected' && e.albumId === 'spotify:browsed').length, opening + 2);
    assert.deepEqual(history.events.filter(e => e.type === 'album_play_started').map(e => e.sessionId), [playingSession], 'reopening sleeves cannot restart tracking of the playing record');
   }
   for (let seconds = 15; seconds <= 75; seconds += 15) {
    await page.evaluate(seconds => { window.testElapsed = seconds * 1000; window.mockPlayer.emit(seconds); }, seconds);
    await page.waitForTimeout(60);
   }
   let saved = await read();
   assert.equal(saved.events.filter(e => e.type === 'album_inspected').length, 6);
   assert.equal(saved.events.filter(e => e.type === 'album_inspected' && e.albumId === 'spotify:browsed').length, 4);
   assert.ok(saved.sessions.every(s => s.albumId === 'spotify:smoke'), 'listening belongs only to the playing album');
   assert.ok(saved.events.filter(e => e.type !== 'album_inspected').every(e => e.albumId === 'spotify:smoke'), 'browsing cannot generate play/completion events');
   assert.equal(saved.events.filter(e => e.type === 'album_play_started').length, 1);
   assert.equal(saved.events.filter(e => e.type === 'album_completed').length, 1);
   assert.ok(saved.sessions[0].listenedSeconds >= 74.99);
   await context.route(origin + '/__engagement_probe', route => route.fulfill({ contentType: 'text/html', body: '<title>Ownership probe</title>' }));
   const otherTab = await context.newPage(); await otherTab.goto(origin + '/__engagement_probe');
   const canOwn = () => otherTab.evaluate(account => navigator.locks.request(`record-cabinet-engagement:${account}`, { ifAvailable: true }, lock => !!lock), account);
   assert.equal(await canOwn(), false, 'a second tab cannot own the active session');
   await page.evaluate(() => { window.playerBeforeExport = window.mockPlayer; });
   await page.getByRole('link', { name: 'Library & settings', exact: true }).click();
   await page.getByText('Account and privacy', { exact: true }).click();
   const organizationKey = `record-cabinet-systems:${account}`;
   const org = { arrangement: 'artist', systemId: 'test-system', systems: [{ id: 'test-system', name: 'My bins', bins: [{ id: 'test-bin', label: 'Favorites' }], assignments: { 'spotify:smoke': 'test-bin' } }] };
   await page.evaluate(({ organizationKey, org }) => localStorage.setItem(organizationKey, JSON.stringify(org)), { organizationKey, org });
   await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open(`record-cabinet-engagement:${'b'.repeat(64)}`, 1); r.onupgradeneeded = () => { r.result.createObjectStore('events', { keyPath: 'id' }); r.result.createObjectStore('sessions', { keyPath: 'id' }); }; r.onsuccess = () => resolve(r.result); });
    await new Promise(resolve => { const tx = db.transaction('events', 'readwrite'); tx.objectStore('events').put({ id: 'other-account-event', userId: 'b'.repeat(64), type: 'album_inspected', albumId: 'spotify:other', timestamp: 1000 }); tx.oncomplete = resolve; }); db.close();
   });
   const beforeExport = await read(), cookiesBeforeExport = await context.cookies();
   const downloading = page.waitForEvent('download');
   await page.getByRole('button', { name: 'Download My Data', exact: true }).click();
   const download = await downloading, exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
   assert.match(download.suggestedFilename(), /^record-cabinet-my-data-.*\.json$/);
   assert.equal(exported.library.length, 2);
   assert.deepEqual(exported.events.map(e => e.id).sort(), beforeExport.events.map(e => e.id).sort());
   assert.equal(exported.sessions[0].id, playingSession);
   assert.deepEqual(exported.organization.systems[0].memberships, [{ albumId: 'spotify:smoke', binId: 'test-bin', assignedAt: null }]);
   assert.equal(JSON.stringify(exported).includes('other-account-event'), false);
   assert.equal(JSON.stringify(exported).includes(account), false);
   assert.deepEqual(await context.cookies(), cookiesBeforeExport, 'export leaves sign-in unchanged');
   assert.deepEqual((await read()).events, beforeExport.events, 'export does not modify history');
   await page.evaluate(key => localStorage.setItem(key, 'invalid organization json'), organizationKey);
   await page.getByRole('button', { name: 'Download My Data', exact: true }).click();
   await page.getByText('Your data could not be exported. Nothing was changed. Please try again.', { exact: true }).waitFor();
   assert.equal((await read()).sessions.length, 1);
   await page.evaluate(({ organizationKey, org }) => localStorage.setItem(organizationKey, JSON.stringify(org)), { organizationKey, org });
   assert.equal(await page.evaluate(() => window.playerBeforeExport === window.mockPlayer && !window.mockPlayer.state.paused), true, 'export and export failure leave audio alone');
   await page.getByText('Account and privacy', { exact: true }).click();
   await page.getByRole('link', { name: '← Back to records', exact: true }).click();
   await page.getByRole('button', { name: 'Pause record', exact: true }).click();
   await page.waitForTimeout(100);
   assert.equal(await canOwn(), true, 'pause releases ownership');
   await otherTab.close();
   await page.getByRole('link', { name: 'Library & settings', exact: true }).click();
   assert.equal(await page.getByRole('button', { name: 'Tracking debug', exact: true }).isVisible(), false);
   await page.getByText('Advanced & troubleshooting', { exact: true }).click();
   await page.getByRole('button', { name: 'Tracking debug', exact: true }).click();
   await page.waitForFunction(() => document.querySelector('#tracking-history')?.value.includes('SAVED EVENTS'));
   const tracking = await page.getByLabel('Tracking history', { exact: true }).inputValue();
   assert.match(tracking, /Tracking debugger v2/);
   assert.match(tracking, /Matched library track: spotify:track:track/);
   assert.match(tracking, /Inspected · Z Browsed Record/);
   assert.match(tracking, /Playback started · Test Record/);
   assert.match(tracking, /Session confirmed · Test Record/);
   assert.match(tracking, /Inspection requested · Z Browsed Record/);
   assert.match(tracking, /Sleeve opened · Z Browsed Record/);
   assert.equal(tracking.includes(account), false, 'debug view excludes the account identifier');
   assert.equal((await read()).sessions.length, 1, 'reading history does not restart tracking');
   await page.getByRole('link', { name: '← Back to records', exact: true }).click();
   assert.equal((await read()).sessions.length, 1);
   await page.reload();
   saved = await read();
   assert.equal(saved.events.filter(e => e.type === 'album_inspected').length, 6, 'reload does not manufacture an inspection');
   assert.equal(saved.sessions.length, 1, 'reload does not manufacture a start');
   assert.equal(saved.events.filter(e => e.type === 'album_completed').length, 1);
   await page.getByRole('link', { name: 'Library & settings', exact: true }).click();
   await page.getByText('Advanced & troubleshooting', { exact: true }).click();
   await page.getByRole('button', { name: 'Listen to local demos', exact: true }).click();
   await page.getByRole('button', { name: 'Open All records, 60 records', exact: true }).click();
   await page.locator('[class*=touchSurface]').click();
   await page.waitForFunction(() => !document.querySelector('button[title="Play this album"]').disabled);
   await page.getByRole('button', { name: /^Play .* by tapping the vinyl$/ }).click();
   await page.waitForTimeout(300);
   assert.equal((await read()).events.filter(e => e.type === 'album_inspected').length, 6, 'signed-in demo excluded');
   assert.equal((await read()).sessions.length, 1, 'local demo audio excluded');
   await page.getByRole('link', { name: 'Library & settings', exact: true }).click();
   await page.getByText('Account and privacy', { exact: true }).click();
   await page.getByRole('button', { name: 'Back to my collection', exact: true }).click();
   await page.getByRole('button', { name: 'Open All records, 2 records', exact: true }).click();
   await surface.focus(); await page.keyboard.press('Home'); await page.waitForTimeout(150);
   await page.keyboard.press('Enter');
   await play.waitFor();
   await page.waitForFunction(() => !document.querySelector('button[title="Play this album"]').disabled);
   await play.click();
   await page.getByRole('button', { name: 'Pause record', exact: true }).waitFor();
   await page.evaluate(() => window.mockPlayer.emit(0)); await page.waitForTimeout(100);
   await page.evaluate(() => { window.mockPlayer.emit(0); window.playerBeforeReset = window.mockPlayer; });
   await page.waitForTimeout(100);
   await page.getByRole('link', { name: 'Library & settings', exact: true }).click();
   const beforeReset = await read();
   const cookiesBeforeReset = await context.cookies();
   const binsBeforeReset = await page.evaluate(key => localStorage.getItem(key), organizationKey);
   await page.getByRole('button', { name: 'Reset Personalization History', exact: true }).click();
   await page.getByRole('button', { name: 'Cancel reset', exact: true }).click();
   assert.deepEqual(await read(), beforeReset, 'cancel preserves history');
   await page.evaluate(() => {
    window.originalClear = IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.clear = function () { if (this.name === 'sessions') throw new Error('test reset failure'); return window.originalClear.call(this); };
   });
   await page.getByRole('button', { name: 'Reset Personalization History', exact: true }).click();
   await page.getByRole('button', { name: 'Reset history', exact: true }).click();
   await page.getByText('History could not be reset. History has not been cleared; please try again.', { exact: true }).waitFor();
   assert.deepEqual(await read(), beforeReset, 'failed reset rolls back both stores');
   await page.evaluate(() => { IDBObjectStore.prototype.clear = window.originalClear; });
   await page.getByRole('button', { name: 'Reset history', exact: true }).click();
   await page.waitForFunction(async account => {
    const db = await new Promise(resolve => { const r = indexedDB.open(`record-cabinet-engagement:${account}`); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction(['events', 'sessions']);
    const count = name => new Promise(resolve => { const r = tx.objectStore(name).count(); r.onsuccess = () => resolve(r.result); });
    const counts = await Promise.all([count('events'), count('sessions')]); db.close(); return counts.every(n => n === 0);
   }, account);
   assert.deepEqual(await context.cookies(), cookiesBeforeReset, 'reset keeps sign-in');
   assert.equal(await page.evaluate(key => localStorage.getItem(key), organizationKey), binsBeforeReset, 'reset keeps bins');
   await page.getByRole('button', { name: 'Reset Personalization History', exact: true }).click();
   await page.getByRole('button', { name: 'Reset history', exact: true }).click();
   await page.waitForTimeout(200);
   assert.equal((await read()).events.length, 0, 'repeat reset remains empty');
   const resetPeer = await context.newPage();
   resetPeer.on('pageerror', error => errors.push(error.message));
   await resetPeer.goto(origin + '/settings');
   await resetPeer.getByText('Account and privacy', { exact: true }).click();
   await resetPeer.getByRole('button', { name: 'Reset Personalization History', exact: true }).click();
   await resetPeer.getByRole('button', { name: 'Reset history', exact: true }).click();
   await resetPeer.getByRole('button', { name: 'Reset history', exact: true }).waitFor({ state: 'detached' });
   await page.waitForTimeout(300);
   await page.evaluate(() => { window.testElapsed += 10000; window.mockPlayer.emit(10); });
   await page.waitForTimeout(150);
   assert.equal((await read()).sessions.length, 0, 'ongoing playback after cross-tab reset does not synthesize a start');
   assert.equal(await page.evaluate(() => window.playerBeforeReset === window.mockPlayer && !window.mockPlayer.state.paused), true, 'resets leave the same SDK playing');
   const afterResetDownload = resetPeer.waitForEvent('download');
   await resetPeer.getByRole('button', { name: 'Download My Data', exact: true }).click();
   const resetExport = JSON.parse(await fs.readFile(await (await afterResetDownload).path(), 'utf8'));
   assert.deepEqual(resetExport.events, []); assert.deepEqual(resetExport.sessions, []);
   assert.equal(resetExport.library.length, 2, 'reset keeps albums');
   await resetPeer.close();
   await page.getByRole('link', { name: '← Back to records', exact: true }).click();
   await page.locator('[class*=activeBack] [class*=backTitle]').click();
   await page.locator('#album-details').waitFor({ state: 'detached' });
   await surface.focus(); await page.keyboard.press('Enter');
   await page.waitForTimeout(250);
   assert.equal((await read()).events.filter(e => e.type === 'album_inspected').length, 1, 'fresh inspection starts new history');
   assert.equal((await read()).sessions.length, 0);
   await page.getByRole('button', { name: 'Pause record', exact: true }).click();
   await page.getByRole('button', { name: 'Play record', exact: true }).click();
   await page.evaluate(() => window.mockPlayer.emit(10)); await page.waitForTimeout(150);
   await page.evaluate(() => window.mockPlayer.emit(10)); await page.waitForTimeout(150);
   assert.equal((await read()).sessions.length, 1, 'explicit resume creates a fresh session');
   const freshSession = (await read()).sessions[0].id;
   assert.equal(beforeReset.sessions.some(old => old.id === freshSession), false, 'old sessions never return');
   await page.getByRole('link', { name: 'Library & settings', exact: true }).click();
   await page.getByRole('button', { name: 'Disconnect and remove local data', exact: true }).click();
   await page.getByRole('button', { name: 'Remove data and disconnect', exact: true }).click();
   await page.waitForFunction(async account => {
    const db = await new Promise(resolve => { const r = indexedDB.open(`record-cabinet-engagement:${account}`); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction(['events', 'sessions']);
    const count = name => new Promise(resolve => { const r = tx.objectStore(name).count(); r.onsuccess = () => resolve(r.result); });
    const counts = await Promise.all([count('events'), count('sessions')]); db.close(); return counts.every(n => n === 0);
   }, account);
   const cleared = await read();
   assert.equal(cleared.events.length, 0); assert.equal(cleared.sessions.length, 0);
   assert.deepEqual(errors, []);
   await context.close();
   console.log(`PASS: pointer/keyboard inspection, playback, ownership, account-scoped download, reset/cancel/rollback, cross-tab playback preservation, fresh tracking, navigation, reload and local removal at ${width}px`);
  }
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
