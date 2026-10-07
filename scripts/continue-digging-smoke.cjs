/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser regression. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:3145';
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try { for(const width of [390,1400]) {
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:process.env.REDUCED_MOTION === "1" ? "reduce" : "no-preference"}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/spotify/**',r=>{assert.ok(r.request().url().endsWith('/account'));return r.fulfill({json:{accountId:'guest'}});});
  await page.goto(origin);await page.getByRole('button',{name:'Try the demo',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:/Continue digging/}).count(),0);
  await page.getByRole('button',{name:'Open All records, 15 records',exact:true}).click();
  const surface=page.locator('[class*=touchSurface]');
  await surface.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(350);const label=await surface.getAttribute('aria-label');
  await surface.click();await page.waitForFunction(()=>!document.querySelector('button[title="Play this album"]').disabled);
  await page.getByRole('button',{name:'Record Cabinet shelf',exact:true}).click();
  await page.getByRole('button',{name:/Continue digging/}).waitFor();
  await page.reload();await page.getByRole('button',{name:/Continue digging/}).click();
  await page.getByRole('heading',{name:'All records',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('button[title="Play this album"]').disabled);
  assert.equal(await surface.getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('[class*=activeBack]').count(),1);
  assert.equal(await surface.getAttribute('aria-label'),label.replace('Show back cover and tracks of','Show front cover of'));
  assert.equal(await page.getByRole('region',{name:'Record player',exact:true}).count(),0,'Resume never starts playback');
  await page.getByRole('button',{name:/^Show front cover of /}).press('Escape');await page.locator('#album-details').waitFor({state:'detached'});
  await page.reload();await page.getByRole('button',{name:/Continue digging/}).click();
  assert.equal(await surface.getAttribute('aria-expanded'),'false');assert.equal(await surface.getAttribute('aria-label'),label);
  assert.deepEqual(errors,[]);await context.close();console.log('PASS '+width+': remembered album, back/front state, reload, no autoplay or Spotify requests');
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
