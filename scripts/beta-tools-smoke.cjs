/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser regression. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:3114';
(async () => {
 const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
 try {
  for (const width of [390, 1400]) {
   const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
   const page = await context.newPage(), errors = [], calls = [];
   page.on('pageerror', error => errors.push(error.message));
   await page.route('https://**/*spotify*', route => route.abort());
   await page.route('**/api/spotify/**', route => { calls.push(route.request().url()); return route.fulfill({ json: { accountId: 'guest' } }); });
   await page.route('**/api/library/sync', route => route.fulfill({ status: 503, json: { error: 'Offline test' } }));
   await page.goto(origin);
   const welcome = page.getByRole('region', { name: 'Welcome to Record Cabinet' });
   await welcome.getByRole('button', { name: 'Try the demo', exact: true }).waitFor();
   assert.equal(await welcome.getByRole('link', { name: 'Connect Spotify', exact: true }).getAttribute('href'), '/api/spotify/login');
   await welcome.getByRole('button', { name: 'Try the demo', exact: true }).click();
   await welcome.waitFor({ state: 'detached' });
   await page.reload();
   assert.equal(await page.getByRole('button', { name: 'Report a problem', exact: true }).isVisible(), false);
   await page.getByRole('link', { name: 'Library & settings', exact: true }).click();
   await page.getByRole('heading', { name: 'Library & settings', exact: true }).waitFor();
   await page.getByRole('button', { name: 'Report a problem', exact: true }).click();
   assert.equal(await welcome.count(), 0);
   await page.getByLabel('What happened?', { exact: true }).fill('The sleeve was hard to flip.');
   const preview = page.getByLabel('Report preview', { exact: true });
   assert.match(await preview.inputValue(), /The sleeve was hard to flip/);
   assert.match(await preview.inputValue(), /App version: beta-/);
   assert.doesNotMatch(await preview.inputValue(), /"playbackHistory"/);
   await page.getByRole("checkbox", { name: "Include browser and playback diagnostics" }).check();
   assert.match(await preview.inputValue(), /"playbackHistory"/);
   const downloadPromise = page.waitForEvent('download');
   await page.getByRole('button', { name: 'Download report', exact: true }).click();
   assert.equal((await downloadPromise).suggestedFilename(), 'record-cabinet-problem.txt');
   await page.getByRole('button', { name: 'Copy report', exact: true }).click();
   await page.getByText('Copied. Share the report with the project maintainer.', { exact: true }).waitFor();
   assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await preview.inputValue());
   await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('Unavailable'); } } }));
   await page.getByRole('button', { name: 'Copy report', exact: true }).click();
   await page.getByText('Copy is unavailable here. Select and copy the report above.', { exact: true }).waitFor();
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   assert.ok(calls.every(url => url.endsWith('/account')), 'Guest testing must not call Spotify APIs');
   assert.deepEqual(errors, []);
   await page.getByRole('link', { name: '← Back to records', exact: true }).click();
   await page.getByRole('link', { name: 'Library & settings', exact: true }).waitFor();
   assert.equal(await page.getByRole('button', { name: 'Report a problem', exact: true }).isVisible(), false);
   await page.goto(origin + '/settings');
   await page.getByRole('heading', { name: 'Library & settings', exact: true }).waitFor();
   await context.close();
   console.log(`PASS: welcome, persistent dismissal, checklist, version, report preview/copy/fallback at ${width}px`);
  }
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
