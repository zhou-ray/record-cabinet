/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser test. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:3119';
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {
  for(const mobile of [false,true]) {
   const page=await browser.newPage({viewport:{width:mobile?390:1400,height:1000},isMobile:mobile,hasTouch:mobile});
   await page.addInitScript(()=>{
    const NativeAudio=window.Audio;
    window.Audio=function(...args){const audio=new NativeAudio(...args);window.demoAudio=audio;return audio;};
   });
   await page.route('**/api/spotify/**',r=>r.fulfill({json:{accountId:'guest'}}));
   await page.goto(origin);
   await page.getByRole('button',{name:'Open All records, 15 records',exact:true}).click();
   await page.getByRole('button',{name:/^Show back cover and tracks of /}).click();
   await page.getByRole('button',{name:/^Play .* by tapping the vinyl$/}).click();
   const player=page.getByRole('region',{name:'Record player',exact:true});
   await player.getByRole('button',{name:'Pause record',exact:true}).click();
   assert.equal(await page.evaluate(()=>window.demoAudio.paused),true);
   await player.getByRole('button',{name:'Play record',exact:true}).click();
   await page.waitForFunction(()=>!window.demoAudio.paused);
   console.log('Demo cue passed');
   await player.getByRole('button',{name:'Pause record',exact:true}).click();
   await page.waitForFunction(()=>window.demoAudio.paused);
   await player.getByRole('button',{name:'Play record',exact:true}).click();
   await page.waitForFunction(()=>!window.demoAudio.paused);
   assert.equal(await player.getByRole('button',{name:/RESTART RECORD|Put record away/}).count(),0);
   const volume=player.getByRole('slider',{name:'Record volume',exact:true});
   if(mobile) assert.equal(await volume.count(),0);
   else {
    await page.waitForFunction(()=>!document.querySelector('input[aria-label="Record volume"]')?.disabled);
    await volume.focus();await page.keyboard.press('Home');
    await page.waitForFunction(()=>window.demoAudio.volume===0);
   }
   console.log('Demo volume passed');
   await page.waitForFunction(()=>navigator.mediaSession.metadata?.title&&navigator.mediaSession.playbackState==='playing');
   assert.equal(await page.evaluate(()=>navigator.mediaSession.metadata.title),await player.getByRole('heading').innerText());
   await player.scrollIntoViewIfNeeded();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await player.screenshot({path:`/private/tmp/rc-working-deck-${mobile?'mobile':'desktop'}.png`});
   console.log(`PASS ${mobile?'mobile':'desktop'}: physical start/stop, volume availability, system metadata and layout`);
   await page.close();
  }
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
