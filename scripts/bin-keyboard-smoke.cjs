/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser regression. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:3151';
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1400,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/spotify/**',r=>{assert.ok(r.request().url().endsWith('/account'));return r.fulfill({json:{accountId:'guest'}});});
 await page.goto(origin);await page.getByRole('button',{name:'Try the demo',exact:true}).click();
 await page.getByRole('button',{name:'Open All records, 15 records',exact:true}).click();
 const number=async()=>parseInt(await page.locator('[class*=recordNumber]').innerText(),10);
 const surface=page.locator('[class*=touchSurface]');
 assert.equal(await number(),1);
 // Bin heading owns focus: shortcuts must not require focusing the sleeve.
 await page.keyboard.press('ArrowLeft');assert.equal(await number(),15);
 await page.keyboard.press('ArrowRight');assert.equal(await number(),1);
 for(let i=0;i<5;i++)await page.keyboard.down('ArrowRight');await page.keyboard.up('ArrowRight');
 assert.equal(await number(),6,'Held arrows keep advancing during animation');
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>!document.querySelector('button[title="Play this album"]').disabled);
 assert.equal(await surface.getAttribute('aria-expanded'),'true');
 await page.keyboard.press('Space');await page.locator('#album-details').waitFor({state:'detached'});
 await page.keyboard.press('Space');await page.waitForFunction(()=>!document.querySelector('button[title="Play this album"]').disabled);
 await page.keyboard.press('Escape');await page.locator('#album-details').waitFor({state:'detached'});
 const current=await number();
 await page.getByRole('link',{name:'Library & settings',exact:true}).click();
 await page.getByRole('button',{name:'Report a problem',exact:true}).click();
 await page.getByLabel('What happened?',{exact:true}).fill('Keyboard');await page.keyboard.press('Space');await page.keyboard.type('test');
 assert.equal(await page.getByLabel('What happened?',{exact:true}).inputValue(),'Keyboard test');
 await page.getByRole('heading',{name:'Library & settings',exact:true}).click();await page.keyboard.press('ArrowRight');await page.keyboard.press('Space');
 await page.getByRole('link',{name:'← Back to records',exact:true}).click();assert.equal(await number(),current);assert.equal(await surface.getAttribute('aria-expanded'),'false');
 await page.getByRole('button',{name:'Next album',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await number(),current+1,'Normal button activation remains native');
 assert.equal(await surface.getAttribute('aria-expanded'),'false');
 assert.deepEqual(errors,[]);console.log('PASS: unfocused browsing, loop, repeated keys, Enter/Space selection and return, hidden settings and editable fields, native button controls');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
