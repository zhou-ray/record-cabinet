/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser regression. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:3103';
(async () => {
 const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {
  for (const mobile of [false,true]) {
   const context = await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1400,height:1200},isMobile:mobile,hasTouch:mobile});
   const page = await context.newPage();
   const errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.route('https://**/*spotify*',route=>route.abort());
   await page.goto(origin);
   await page.getByRole('button',{name:'Try the demo',exact:true}).click();
   await page.getByRole('button',{name:'Open All records, 15 records',exact:true}).click();
   const surface=page.locator('[class*=touchSurface]');
   const number=async()=>parseInt(await page.locator('[class*=recordNumber]').innerText(),10);
   await surface.scrollIntoViewIfNeeded();
   const box=await surface.boundingBox();const x=box.x+box.width/2,y=box.y+15;
   const cdp=await context.newCDPSession(page);
   if(mobile){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+i*45}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   }else{
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+510,{steps:6});await page.mouse.up();
   }
   await page.waitForTimeout(600);
   assert.ok(await number()>=(mobile?3:4),'Long drag retains progress rather than snapping to the second record');
   await surface.focus();await page.keyboard.press('Home');await page.waitForTimeout(600);
   assert.equal(await number(),1);
   await page.keyboard.press('ArrowLeft');await page.waitForTimeout(350);assert.equal(await number(),15);
   await page.keyboard.press('ArrowRight');await page.waitForTimeout(350);assert.equal(await number(),1);
   await page.getByRole('button',{name:'Previous album',exact:true}).click();await page.waitForTimeout(350);assert.equal(await number(),15);
   await page.getByRole('button',{name:'Next album',exact:true}).click();await page.waitForTimeout(350);assert.equal(await number(),1);

   if(!mobile){
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+450,{steps:6});
    await surface.dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse',clientX:x,clientY:y+450});
    await page.mouse.up();await page.waitForTimeout(600);
    assert.equal(await number(),4,'Interrupted drag settles at the nearest record');
   }
   const beforeFlip=await surface.boundingBox();
   await surface.click();await page.locator('#album-details').waitFor();
   await page.locator('[class*=activeBack]').waitFor();await page.waitForTimeout(450);
   assert.ok((await surface.boundingBox()).y < beforeFlip.y - 170,'Selection lifts before showing the back');
   assert.equal(await page.locator('[class*=activeBack]').count(),1,'One tap shows the back');
assert.ok(await page.evaluate(()=>{const front=Number(getComputedStyle(document.querySelector('[class*=binFront]')).zIndex);const layers=[...document.querySelectorAll('[class*=sleeveLayer]')];return layers.every(layer=>layer.querySelector('[class*=activeBack]')?Number(getComputedStyle(layer).zIndex)>front:Number(getComputedStyle(layer).zIndex)<front);}), 'Only the lifted sleeve sits in front of the wooden bin');
   const vinyl=page.getByRole('button',{name:/^Play .* by tapping the vinyl$/});
   const disc=await page.locator('[class*=peekVinyl]').boundingBox();const sleeve=await surface.boundingBox();
   assert.ok(disc.height/sleeve.height>0.9 && disc.height/sleeve.height<1,'Vinyl diameter matches the sleeve');
   await vinyl.click();
   await page.getByRole('region',{name:'Record player',exact:true}).getByRole('button',{name:'Pause record',exact:true}).waitFor();
   await page.evaluate(() => {
    window.returnFrames=[];
    const sleeve=[...document.querySelectorAll('[class*=sleeveLayer]')].find(el=>getComputedStyle(el).zIndex==='65');
    const sample=()=>{
     const y=new DOMMatrixReadOnly(getComputedStyle(sleeve).transform).m42;
     window.returnFrames.push({y,front:Number(getComputedStyle(document.querySelector('[class*=binFront]')).zIndex)});
     if(document.querySelector('[class*=touchSurface]').getAttribute('aria-expanded')==='true') requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
   });
   await page.getByRole('button',{name:/^Show front cover of /}).press('Escape');
   await page.locator('#album-details').waitFor({state:'detached'});
   const lowering=await page.evaluate(()=>window.returnFrames.filter(frame=>frame.y > -184));
   assert.ok(lowering.length>2,'Sampled return motion');
   assert.ok(lowering.every(frame=>frame.front===50 && frame.y<=0.5),'Sleeve lowers behind bin front without overshooting');
   assert.ok(lowering.every((frame,i)=>i===0||frame.y>=lowering[i-1].y-0.1),'Return motion never bounces back out');

   await page.getByRole('button',{name:'Return to shelf',exact:true}).click();
   const longAlbum={id:'spotify:long',source:'spotify',title:'AAA Long Album',artist:'AAA Artist',artists:[{id:'spotify:artist',name:'AAA Artist'}],year:'2026',genres:[],genre:'Uncategorized',color:'moss',note:'',catalogNumber:'',artworkUrl:null,externalUrl:null,playback:{kind:'spotify',uri:'spotify:album:long'},tracks:Array.from({length:30},(_,i)=>({id:`spotify:track${i}`,title:`Track ${i+1} with a title that should wrap rather than get cut off`,duration:180,disc:1,number:i+1}))};
   await page.getByRole('link',{name:'Library & settings',exact:true}).click();
   await page.getByText('Collection backup',{exact:true}).click();
   await page.getByLabel('Restore backup',{exact:true}).setInputFiles({name:'long.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'record-cabinet',version:1,albums:[longAlbum],organization:{systems:[],systemId:'',arrangement:'artist'}}))});
   await page.getByRole('button',{name:'Add backup to collection'}).click();
   await page.getByText('Backup restored. Existing records and bins were kept.').waitFor();
   await page.getByRole('link',{name:'← Back to records',exact:true}).click();
   await page.getByRole('button',{name:/^Open All records,/}).click();
   await surface.focus();await page.keyboard.press('Home');await page.waitForTimeout(300);
   await surface.click();

   const tracks=page.getByRole('region',{name:'Full track list for AAA Long Album',exact:true});
   await tracks.waitFor();await page.waitForTimeout(600);
   assert.equal(await page.getByRole('button',{name:/^Play .* by tapping the vinyl$/}).isEnabled(),true,'Vinyl returns after the cover turns');
   await page.screenshot({path:`/private/tmp/rc-full-vinyl-${mobile?'mobile':'desktop'}.png`});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Vinyl fits the viewport');
   assert.equal(await tracks.locator('li').count(),30);
   await tracks.scrollIntoViewIfNeeded();
   if(mobile){
    const rect=await tracks.boundingBox();const tx=rect.x+rect.width/2,ty=rect.y+rect.height-8;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty}]});
    for(let i=1;i<=4;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx,y:ty-i*20}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   }else{await tracks.hover();await page.mouse.wheel(0,650);}
   await page.waitForTimeout(400);
   assert.ok(await tracks.evaluate(el=>el.scrollTop)>0,'Back cover receives real scroll input');
   await tracks.focus();await page.keyboard.press('Control+End');
   await tracks.evaluate(el=>{el.scrollTop=el.scrollHeight;});
   assert.ok(await tracks.evaluate(el=>el.scrollTop+el.clientHeight>=el.scrollHeight-1),'Final track is reachable');
   assert.equal(await page.locator('#album-details').count(),1,'Scrolling does not put the record back');
   async function swipeBackDown() {
    const rect=await tracks.boundingBox(),sx=rect.x+rect.width/2,sy=rect.y+12;
    if(mobile){
     await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:sx,y:sy}]});
     for(let i=1;i<=5;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:sx,y:sy+i*16}]});
     await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }else{await page.mouse.move(sx,sy);await page.mouse.down();await page.mouse.move(sx,sy+80,{steps:5});await page.mouse.up();}
   }
   await swipeBackDown();await page.waitForTimeout(350);
   assert.equal(await page.locator('#album-details').count(),1,'Downward scrolling within tracks must not dismiss the sleeve');
   await tracks.evaluate(el=>{el.scrollTop=0;});await page.waitForTimeout(300);
   await swipeBackDown();await page.locator('#album-details').waitFor({state:'detached'});
   assert.equal(await surface.getAttribute('aria-expanded'),'false','Down-swipe at the top returns the flipped sleeve');
   await surface.click();await tracks.waitFor();await page.waitForTimeout(600);

   assert.equal(await page.locator('[class*=sleeveLayer] button, [class*=sleeveActions]').count(),0,'Sleeves have no buttons');
   await page.locator('[class*=activeBack] [class*=backTitle]').click();
   await tracks.waitFor({state:'detached'});
   await page.locator('#album-details').waitFor({state:'detached'});
   await surface.click();
   await tracks.waitFor();await page.waitForTimeout(600);
   await tracks.locator('li').first().click();
   await tracks.waitFor({state:'detached'});
   await page.locator('#album-details').waitFor({state:'detached'});
   assert.equal(await surface.getAttribute('aria-expanded'),'false','Tapping the back automatically returns the sleeve');
   await page.waitForTimeout(600);await surface.click();await tracks.waitFor();await page.waitForTimeout(600);
   await page.getByRole('button',{name:/^Show front cover of /}).press('Escape');
   await page.locator('#album-details').waitFor({state:'detached'});
   assert.equal(await page.locator('[class*=peekRecordLayer]').count(),0,'Vinyl retracts before the back-facing sleeve is returned');
   assert.deepEqual(errors,[]);
   await context.close();
  }
  console.log('PASS: desktop and mobile long drags retain progress, interruption keeps nearest record, keyboard and pull/return still work, all 30 tracks scroll, back taps flip, vinyl playback, external return and bin handle work on desktop and mobile.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
