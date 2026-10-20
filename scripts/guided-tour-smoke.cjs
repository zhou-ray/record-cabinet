/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser check. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try { for(const width of [390,1400]) {
  const context = await browser.newContext({viewport:{width,height:900},reducedMotion:width === 390 ? 'reduce' : 'no-preference'});
  const page = await context.newPage(), errors=[], provider=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/api\.spotify\.com|sdk\.scdn\.co|\/api\/spotify\/library/.test(r.url()))provider.push(r.url());});
  await page.goto(process.env.TEST_ORIGIN || 'http://127.0.0.1:3194');
  await page.getByRole('button',{name:'Start tour',exact:true}).click();
  const hint = page.getByRole('complementary',{name:'Cabinet tutorial'});
  await hint.getByText('Open a demo bin',{exact:true}).waitFor();
  await page.locator('[data-tour-target="bin"]:not(:disabled)').first().click();
  await hint.getByText('Dig to the next record',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Next album',exact:true}).click();
  await hint.getByText('Tap the sleeve to flip it',{exact:true}).waitFor();
  await page.locator('[data-tour-target="sleeve"]').click();
  await hint.getByText('Tap the vinyl to play',{exact:true}).waitFor();
  await page.locator('[data-tour-target="vinyl"]').click();
  await hint.getByText('Move the arm to explore',{exact:true}).waitFor();
  const arm = page.getByRole('slider',{name:'Tonearm position',exact:true});
  await arm.focus();await page.keyboard.press('ArrowRight');
  await hint.getByText('You’re ready to dig',{exact:true}).waitFor();
  await hint.getByRole('button',{name:'Finish tour',exact:true}).click();
  assert.equal(await hint.count(),0);
  await page.reload();
  assert.equal(await page.getByRole('region',{name:'Tour invitation'}).count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(provider,[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await context.close();console.log(`PASS: complete interactive demo tour and real local audio, ${width}px`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
