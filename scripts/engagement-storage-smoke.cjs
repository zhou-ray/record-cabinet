/* eslint-disable @typescript-eslint/no-require-imports -- Standalone real IndexedDB verification. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const ts = require('typescript');
const sources = Object.fromEntries(['engagement', 'engagement-storage'].map(name => [name, ts.transpileModule(fs.readFileSync(`app/lib/${name}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText]));
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
      const user = 'a'.repeat(64), other = 'b'.repeat(64), albumId = 'spotify:abc';
      const store = createEngagementStorage(user), peer = createEngagementStorage(user), otherStore = createEngagementStorage(other);
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
      await rejects(() => createEngagementStorage(user, faultyFactory).saveSession(startPlaybackSession('failed', user, albumId, 100, 1000)), 'write failure rejects');
      saved = await store.load();
      check(saved.sessions.length === 1 && saved.events.length === 4, 'failed transaction rolls back summary and events');
      await store.saveSession(accumulator.end(92000));
      return { count: saved.events.length };
    });
    if (result.count !== 4) throw new Error('Unexpected event count');
    await page.reload();
    await page.evaluate(async () => {
      const { createEngagementStorage } = window.engagementTestModules['engagement-storage'];
      const saved = await createEngagementStorage('a'.repeat(64)).load();
      if (saved.sessions.length !== 1 || saved.sessions[0].listenedSeconds !== 90 || saved.sessions[0].endedAt !== 92000 || saved.events.length !== 4) throw new Error('Reload recovery failed');
    });
    console.log('PASS: real IndexedDB account isolation, idempotent/concurrent writes, stale checkpoint protection, atomic rollback, metadata exclusion, and reload recovery');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
