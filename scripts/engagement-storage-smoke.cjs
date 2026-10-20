/* eslint-disable @typescript-eslint/no-require-imports -- Standalone real IndexedDB verification. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const ts = require('typescript');
const sources = Object.fromEntries(['saved-membership', 'discovery-snapshot', 'engagement', 'engagement-storage'].map(name => [name, ts.transpileModule(fs.readFileSync(`app/lib/${name}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText]));
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const context = await browser.newContext();
    await context.route('http://engagement.test/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Isolated storage test</title>' }));
    await context.addInitScript(({ sources }) => {
      const modules = {};
      for (const [name, code] of Object.entries(sources)) {
        const compiled = { exports: {} };
        new Function('module', 'exports', 'require', code)(compiled, compiled.exports, dependency => modules[dependency.slice(2)]);
        modules[name] = compiled.exports;
      }
      window.engagementTestModules = modules;
    }, { sources });
    const page = await context.newPage();
    await page.goto('http://engagement.test/');
    const result = await page.evaluate(async () => {
      const { inspection, startPlaybackSession, createPlaybackAccumulator } = window.engagementTestModules.engagement;
      const { createEngagementStorage } = window.engagementTestModules['engagement-storage'];
      const check = (value, message) => { if (!value) throw new Error(message); };
      const rejects = async (task, message) => { let rejected = false; try { await task(); } catch { rejected = true; } check(rejected, message); };
      const eventWrites = [];
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, ...args) {
        if (this.name === 'events') eventWrites.push(value.id);
        return originalPut.call(this, value, ...args);
      };
      const user = 'a'.repeat(64), other = 'b'.repeat(64), albumId = 'spotify:abc';
      const writable = async (user, factory) => { const repo = createEngagementStorage(user, factory); return { ...repo, ...await repo.writer() }; };
      const store = await writable(user), peer = await writable(user), otherStore = await writable(other);
      await rejects(() => createEngagementStorage('guest'), 'guest denied');
      const inspect = inspection('inspect-1', user, albumId, 1000);
      await Promise.all([store.recordInspection(inspect), peer.recordInspection(inspect)]);
      await rejects(() => store.recordInspection({ ...inspect, albumId: 'spotify:other' }), 'duplicate identity conflict rejected');
      await rejects(() => otherStore.recordInspection(inspect), 'account mismatch denied');
      await store.recordInspection({ ...inspection('inspect-2', user, albumId, 1100), accessToken: 'must-not-persist' });
      const accumulator = createPlaybackAccumulator(startPlaybackSession('s1', user, albumId, 100, 1000));
      const initial = accumulator.snapshot();
      await store.saveSession(initial);
      for (let s = 0; s <= 90; s += 15) accumulator.observe({ albumId, playing: true, positionSeconds: s, monotonicMs: s * 1000, timestamp: 1000 + s * 1000 });
      const advanced = accumulator.snapshot();
      await Promise.all([store.saveSession(advanced), peer.saveSession(initial), peer.saveSession(advanced)]);
      await rejects(() => store.saveSession({ ...advanced, listenedSeconds: 95 }), 'same-revision divergence rejected');
      await rejects(() => otherStore.saveSession(advanced), 'session scope checked');
      check((await otherStore.load()).events.length === 0, 'accounts isolated');
      let saved = await peer.load();
      check(saved.events.length === 4, 'two inspections, one start, one completion');
      check(saved.sessions[0].listenedSeconds === 90, 'late writes do not undo progress');
      check(!JSON.stringify(saved).includes('must-not-persist'), 'unknown metadata excluded');
      // Abort after the summary write, proving summary and events share one transaction.
      const faultyFactory = { open(...args) {
        const request = indexedDB.open(...args);
        request.addEventListener('success', () => {
          const db = request.result, transaction = db.transaction.bind(db);
          db.transaction = (...args) => {
            const tx = transaction(...args), objectStore = tx.objectStore.bind(tx);
            tx.objectStore = name => {
              const target = objectStore(name);
              if (name === 'events') target.put = () => { throw new Error('Injected write failure'); };
              return target;
            };
            return tx;
          };
        });
        return request;
      } };
      await rejects(async () => (await writable(user, faultyFactory)).saveSession(startPlaybackSession('failed', user, albumId, 100, 1000)), 'write failure rejects');
      saved = await store.load();
      check(saved.sessions.length === 1 && saved.events.length === 4, 'failed transaction rolls back summary and events');
      await store.saveSession(accumulator.end(92000));
      check(eventWrites.filter(id => id === 'playback:s1:started').length === 1, 'checkpoints must not rewrite start events');
      check(eventWrites.filter(id => id === 'playback:s1:completed').length === 1, 'checkpoints must not rewrite completion events');
      IDBObjectStore.prototype.put = originalPut;
      return { count: saved.events.length };
    });
    if (result.count !== 4) throw new Error('Unexpected event count');
    await page.reload();
    await page.evaluate(async () => {
      const { createEngagementStorage } = window.engagementTestModules['engagement-storage'];
      const saved = await createEngagementStorage('a'.repeat(64)).load();
      if (saved.sessions.length !== 1 || saved.sessions[0].listenedSeconds !== 90 || saved.sessions[0].endedAt !== 92000 || saved.events.length !== 4) throw new Error('Reload recovery failed');
    });
    await page.evaluate(async () => {
      const { createEngagementStorage } = window.engagementTestModules['engagement-storage'];
      const { inspection } = window.engagementTestModules.engagement;
      const user = 'a'.repeat(64), other = 'b'.repeat(64), firstRepo = createEngagementStorage(user), secondRepo = createEngagementStorage(other);
      const first = { ...firstRepo, ...await firstRepo.writer() }, second = { ...secondRepo, ...await secondRepo.writer() };
      await second.recordInspection(inspection('retained', other, 'spotify:abc', Date.now()));
      await first.prune(Date.now());
      if ((await first.load()).events.length || (await first.load()).sessions.length) throw new Error('Old history was not pruned');
      await first.recordInspection(inspection('new', user, 'spotify:abc', Date.now()));
      await first.clear();
      if ((await first.load()).events.length || (await second.load()).events.length !== 1) throw new Error('Account-scoped clear failed');
    });
    await page.evaluate(async () => {
      const { createEngagementStorage } = window.engagementTestModules['engagement-storage'];
      const { inspection, startPlaybackSession } = window.engagementTestModules.engagement;
      const user = 'c'.repeat(64), name = `record-cabinet-engagement:${user}`;
      const check = (value, message) => { if (!value) throw Error(message); };
      const rejects = async task => { try { await task(); } catch (error) { return error.name; } throw Error('Expected rejection'); };
      // Simulate an old build that cannot close its v1 database yet.
      const legacy = await new Promise(resolve => { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => { r.result.createObjectStore('events', { keyPath: 'id' }); r.result.createObjectStore('sessions', { keyPath: 'id' }); }; r.onsuccess = () => resolve(r.result); });
      await new Promise(resolve => { const tx = legacy.transaction('events', 'readwrite'); tx.objectStore('events').put(inspection('legacy', user, 'spotify:abc', 1000)); tx.oncomplete = resolve; });
      const repo = createEngagementStorage(user);
      await rejects(() => repo.reset());
      legacy.close();
      check((await repo.load()).events[0].id === 'legacy', 'blocked reset must not clear history later');
      check(await repo.generation() === 0, 'migration preserves initial generation');
      await rejects(() => new Promise((resolve, reject) => { const r = indexedDB.open(name, 1); r.onsuccess = () => { r.result.close(); resolve(); }; r.onerror = () => reject(r.error); }));
      const writer = await repo.writer(), session = startPlaybackSession('old', user, 'spotify:abc', 100, 1000);
      await writer.saveSession(session);
      const faulty = { open(...args) {
        const request = indexedDB.open(...args);
        request.addEventListener('success', () => {
          const db = request.result, transaction = db.transaction.bind(db);
          db.transaction = (...args) => {
            const tx = transaction(...args), objectStore = tx.objectStore.bind(tx);
            tx.objectStore = name => { const store = objectStore(name); if (name === 'sessions') store.clear = () => { throw Error('Injected reset failure'); }; return store; };
            return tx;
          };
        }); return request;
      } };
      await rejects(() => createEngagementStorage(user, faulty).reset());
      let saved = await repo.load();
      check(saved.generation === 0 && saved.events.length === 2 && saved.sessions.length === 1, 'failed reset rolls back marker AND both stores');
      await writer.recordInspection(inspection('still-valid', user, 'spotify:abc', 1001));
      await Promise.allSettled([writer.recordInspection(inspection('racing', user, 'spotify:abc', 1002)), repo.reset(), writer.saveSession(session)]);
      saved = await repo.load();
      check(saved.generation === 1 && saved.events.length === 0 && saved.sessions.length === 0, 'reset fences racing writes atomically');
      check(await rejects(() => writer.saveSession(session)) === 'HistoryResetError', 'old session retry fenced');
      check(await rejects(() => writer.recordInspection(inspection('late', user, 'spotify:abc', 1003))) === 'HistoryResetError', 'old inspection retry fenced');
      const fresh = await repo.writer();
      await fresh.recordInspection(inspection('fresh', user, 'spotify:abc', 1004));
      check((await repo.load()).events[0].id === 'fresh', 'new generation accepts fresh interaction');
      await Promise.all([repo.reset(), repo.reset()]);
      check(await repo.generation() === 3 && (await repo.load()).events.length === 0, 'repeated/concurrent resets serialize');
      window.suspendedWriter = await repo.writer();
    });
    const peerPage = await context.newPage(); await peerPage.goto('http://engagement.test/peer');
    await peerPage.evaluate(async () => { await window.engagementTestModules['engagement-storage'].createEngagementStorage('c'.repeat(64)).reset(); });
    await page.evaluate(async () => {
      let rejected = false;
      try { await window.suspendedWriter.recordInspection(window.engagementTestModules.engagement.inspection('suspended', 'c'.repeat(64), 'spotify:abc', 2000)); } catch (error) { rejected = error.name === 'HistoryResetError'; }
      if (!rejected) throw Error('Tab without reset notification resurrected history');
      const other = await window.engagementTestModules['engagement-storage'].createEngagementStorage('b'.repeat(64)).load();
      if (other.events.length !== 1) throw Error('Reset affected another account');
    });
    await page.evaluate(async () => {
      const { createEngagementStorage } = window.engagementTestModules['engagement-storage'];
      const { DISCOVERY_LIFETIME: ttl } = window.engagementTestModules['discovery-snapshot'];
      const user = 'd'.repeat(64), repo = createEngagementStorage(user), writer = await repo.writer();
      const snapshot = { id: 'first', accountId: user, generatedAt: 1000, expiresAt: 1000 + ttl, version: 'framework-1', bins: [
        {type: 'forgotten', albumIds: []}, {type: 'wander', albumIds: ['spotify:one']}, {type: 'digging', albumIds: ['spotify:two']},
      ] };
      const check = (ok, message) => { if (!ok) throw Error(message); };
      const peer = await createEngagementStorage(user).writer();
      const results = await Promise.all([writer.saveDiscovery(snapshot, 1000), peer.saveDiscovery({...snapshot, id: 'competing'}, 1000)]);
      check(results[0].id === results[1].id, 'concurrent generation must converge');
      const saved = await repo.load();
      check(saved.discovery.id === results[0].id && saved.events.length === 0, 'snapshot persisted without synthetic history');
      check((await createEngagementStorage('e'.repeat(64)).load()).discovery === null, 'snapshot account isolation');
      const replacement = {...snapshot, version: 'cold-start-1', id: 'replacement', generatedAt: 1000 + ttl, expiresAt: 1000 + 2 * ttl};
      check((await writer.saveDiscovery(replacement, 1000 + ttl)).id === 'replacement', 'expiry permits replacement');
      check((await writer.saveDiscovery(snapshot, 1000)).id === 'replacement', 'late older generation cannot overwrite newer');
      window.discoveryWriter = writer;
      window.discoveryFixture = replacement;
    });
    await page.reload();
    await page.evaluate(async () => {
      const repo = window.engagementTestModules['engagement-storage'].createEngagementStorage('d'.repeat(64));
      const snapshot = (await repo.load()).discovery;
      if (snapshot?.id !== 'replacement') throw Error('snapshot lost on reload');
      window.discoveryWriter = await repo.writer(); window.discoveryFixture = snapshot;
    });
    await peerPage.evaluate(async () => {
      await window.engagementTestModules['engagement-storage'].createEngagementStorage('d'.repeat(64)).reset();
    });
    await page.evaluate(async () => {
      let rejected = false;
      try { await window.discoveryWriter.saveDiscovery(window.discoveryFixture, window.discoveryFixture.generatedAt); }
      catch (error) { rejected = error.name === 'HistoryResetError'; }
      const repo = window.engagementTestModules['engagement-storage'].createEngagementStorage('d'.repeat(64));
      if (!rejected || (await repo.load()).discovery !== null) throw Error('reset resurrected discovery snapshot');
      const writer = await repo.writer();
      await writer.saveDiscovery(window.discoveryFixture, window.discoveryFixture.generatedAt);
      await repo.clear();
      if ((await repo.load()).discovery !== null) throw Error('local deletion retained snapshot');
    });
    await peerPage.close();
    console.log('PASS: real IndexedDB account isolation, idempotent/concurrent writes, stale checkpoint protection, atomic rollback, metadata exclusion, reload recovery, reset migration/blocking/rollback, generation fencing, suspended-tab protection, discovery reload/concurrency/expiry/reset');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
