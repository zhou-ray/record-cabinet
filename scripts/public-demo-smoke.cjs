/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser check. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:3193';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    for (const width of [390, 1400]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      const page = await context.newPage(), errors = [], providerCalls = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (/api\.spotify\.com|sdk\.scdn\.co/.test(request.url())) providerCalls.push(request.url()); });
      await page.goto(origin + '/?demo=1');
      const invitation = page.getByRole('region', { name: 'Tour invitation' });
      await invitation.waitFor();
      if (width === 390) await invitation.getByRole('button', { name: 'Skip', exact: true }).click();
      else {
        await invitation.getByRole('button', { name: 'Start tour', exact: true }).click();
        await page.getByRole('region', { name: 'Cabinet tutorial' }).waitFor();
        await page.getByRole('button', { name: 'Close tutorial', exact: true }).click();
      }
      await page.reload();
      await page.getByRole('button', { name: 'Try the demo', exact: true }).waitFor();
      assert.equal(await invitation.count(), 0, 'Start and Skip both persist across reloads');
      await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
      await page.getByRole('button', { name: 'Open All records, 60 records', exact: true }).click();
      const tabs = page.getByRole('navigation', { name: 'Bin dividers' });
      await tabs.getByRole('button').first().waitFor();
      assert.equal(await tabs.getByRole('button').count(), 2);
      await page.screenshot({ path: `docs/images/demo-${width}.png`, fullPage: true });
      await tabs.getByRole('button').first().click();
      await page.waitForTimeout(700);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.reload();
      await page.getByRole('button', { name: 'Open All records, 60 records', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Library & settings', exact: true }).first().click();
      await page.getByRole('button', { name: 'How to use the cabinet', exact: true }).click();
      await page.getByRole('heading', { name: 'Choose a bin', exact: true }).waitFor();
      assert.deepEqual(providerCalls, []);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS: 60-record no-login demo, dividers, reload, no provider requests, ${width}px`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
