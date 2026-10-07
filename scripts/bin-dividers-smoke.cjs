/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser regression. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:3162';
const albums=Array.from({length:240},(_,i)=>{const artist=(i<120?'X':'Y')+' Artist '+Math.floor(i/20);return {id:'manual:r'+i,source:'manual',addedAt:1000+i,title:'Record '+String(i).padStart(3,'0'),artist,artists:[{id:'artist'+Math.floor(i/20),name:artist}],year:'2026',genre:'Uncategorized',genres:[],color:'moss',note:'',catalogNumber:'',artworkUrl:null,externalUrl:null,tracks:[],playback:{kind:'none'}};});
(async()=>{const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{for(const width of [390,1400]){const context=await browser.newContext({viewport:{width,height:1000},isMobile:width===390,hasTouch:width===390,reducedMotion:width===390?'no-preference':'reduce'});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/spotify/**',r=>r.fulfill({json:{accountId:'guest'}}));
await page.goto(origin+'/settings');await page.getByText('Collection backup',{exact:true}).click();
await page.getByLabel('Restore backup',{exact:true}).setInputFiles({name:'dividers.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'record-cabinet',version:1,albums,organization:{systems:[],systemId:'',arrangement:'artist'}}))});
await page.getByRole('button',{name:'Add backup to collection',exact:true}).click();await page.getByText('Backup restored. Existing records and bins were kept.').waitFor();
await page.getByRole('link',{name:'← Back to records',exact:true}).click();
const surface=page.locator('[class*=touchSurface]');const tabs=page.getByRole('navigation',{name:'Bin dividers'});
await page.getByRole('button',{name:'Open Recently added, 50 records',exact:true}).click();
assert.match(await surface.getAttribute('aria-label'),/Record 239/);
await page.getByRole('button',{name:'Record Cabinet shelf',exact:true}).click();
await page.getByRole('button',{name:'Open X, 120 records',exact:true}).click();
const settled=()=>page.waitForFunction(()=>{const buttons=[...document.querySelectorAll('nav[aria-label="Bin dividers"] button')];return !document.querySelector('nav[aria-label="Bin dividers"]')?.hidden&&document.querySelector('nav[aria-label="Bin dividers"]')?.getAttribute('aria-busy')!=='true'&&buttons.length===2&&buttons.every(b=>!b.disabled);});
await settled();assert.equal(await tabs.getByRole('button').count(),2);
assert.equal(await tabs.getByRole('button',{name:/records 1–20$/}).count(),0);
assert.equal(await tabs.getByRole('button',{name:/dividers/}).count(),0);
if(width===390){
await surface.focus();for(let i=0;i<19;i++)await page.keyboard.press('ArrowRight');
await page.waitForTimeout(500);await page.keyboard.press('ArrowRight');
await page.waitForFunction(()=>[...document.querySelectorAll('nav[aria-label="Bin dividers"] button')].some(button=>button.getAttribute('aria-label')?.endsWith('records 21–40')&&Number(getComputedStyle(button.parentElement).zIndex)>50));
await settled();assert.match(await tabs.getByRole('button').first().getAttribute('aria-label'),/records 41–60$/);
await surface.press('ArrowLeft');await page.waitForTimeout(70);
const returningSleeve=page.locator('[class*=sleeveLayer]').filter({has:page.getByText('Record 019',{exact:true})});
assert.ok(await returningSleeve.evaluate(node=>Number(getComputedStyle(node.firstElementChild).opacity))>.05,'Returning record moves immediately without a divider pause');
await page.waitForTimeout(200);
assert.ok(await returningSleeve.evaluate(node=>Number(getComputedStyle(node.firstElementChild).opacity))>.1,'Record keeps returning continuously across the divider');
const returningDivider=tabs.getByRole('button',{name:/records 21–40$/});
const sheetOrder=await returningDivider.evaluate(button=>Number(getComputedStyle(button.parentElement).zIndex));
const existingOrder=await page.locator('[class*=sleeveLayer]').filter({has:page.getByText('Record 020',{exact:true})}).evaluate(node=>Number(getComputedStyle(node).zIndex));
assert.ok(sheetOrder<50 && sheetOrder>existingOrder,'Divider returns inside the bin, ahead of the existing record');
await page.waitForTimeout(500);
assert.ok(await returningSleeve.evaluate(node=>Number(getComputedStyle(node.firstElementChild).opacity))>.99,'Returning record arrives after the divider');
assert.equal(await returningDivider.evaluate(button=>Number(getComputedStyle(button.parentElement).zIndex)),sheetOrder,'Divider keeps the same layer throughout the return');
assert.ok(await returningSleeve.evaluate(node=>Number(getComputedStyle(node).zIndex))>sheetOrder,'Returned record lands in front of its divider');
await tabs.getByRole('button',{name:/records 41–60$/}).click();await settled();await page.waitForTimeout(500);
await surface.focus();const heldFrames=new Set();
for(let i=0;i<28;i++){await page.keyboard.down('ArrowLeft');await page.waitForTimeout(60);heldFrames.add((await page.locator('[class*=coverTitle]').allTextContents()).join('|'));}
assert.ok(heldFrames.size>5,'Sleeves must keep moving while the back key is held');
await page.keyboard.up('ArrowLeft');
await surface.press('Home');await page.waitForTimeout(1100);await settled();
}
const waitingTab=tabs.getByRole('button',{name:/records 41–60$/});
const waitingBounds=await waitingTab.boundingBox();
await waitingTab.evaluate(node=>{window.waitingDivider=node;});
if(width===390) await page.evaluate(()=>{window.riffled=[];const until=performance.now()+850;function sample(){window.riffled.push(...[...document.querySelectorAll('[class*=coverTitle]')].map(n=>n.textContent));if(performance.now()<until)requestAnimationFrame(sample);}requestAnimationFrame(sample);});
await tabs.getByRole('button',{name:/records 21–40$/}).click();await settled();
assert.ok(await waitingTab.evaluate(node=>node===window.waitingDivider),'The second divider should retain its DOM node');
const advancedBounds=await waitingTab.boundingBox();
assert.ok(Math.abs(advancedBounds.x-waitingBounds.x)<20 && Math.abs(advancedBounds.y-waitingBounds.y)<35,'The second divider should remain on its side while approaching with the stack');
assert.equal(await waitingTab.getAttribute('data-depth'),'1');
assert.match(await tabs.getByRole('button').first().getAttribute('aria-label'),/records 41–60$/);
assert.match(await tabs.getByRole('button').nth(1).getAttribute('aria-label'),/records 61–80$/);
assert.match(await surface.getAttribute('aria-label'),/Record 020/);
if(width===390){await page.waitForTimeout(550);assert.ok(await page.evaluate(()=>window.riffled.includes('Record 010')),'Sleeves should riffle through intermediate albums');}
await tabs.getByRole('button',{name:/records 41–60$/}).click();await settled();
await tabs.getByRole('button',{name:/records 61–80$/}).click();await settled();assert.match(await surface.getAttribute('aria-label'),/Record 060/);
await surface.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(100);assert.match(await surface.getAttribute('aria-label'),/Record 061/);
await page.getByRole('button',{name:'Record Cabinet shelf',exact:true}).click();await page.getByRole('button',{name:'Open Y, 120 records',exact:true}).click();
await tabs.getByRole('button',{name:/records 21–40$/}).click();await settled();assert.match(await surface.getAttribute('aria-label'),/Record 140/);
await page.reload();await page.getByRole('button',{name:'Open X, 120 records',exact:true}).click();await settled();assert.match(await surface.getAttribute('aria-label'),/Record 061/);
const deck=tabs.getByRole('button').first();const rect=await deck.boundingBox(),x=rect.x+rect.width/4,y=rect.y+30;
if(width===390){const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=5;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*6}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y-30,{steps:5});await page.mouse.up();}
await settled();assert.match(await surface.getAttribute('aria-label'),/Record 040/);
await tabs.getByRole('button').first().focus();await page.keyboard.press('ArrowDown');await settled();
await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')?.includes('records 81–100'));await page.waitForTimeout(450);assert.match(await surface.getAttribute('aria-label'),/Record 060/);
await page.screenshot({path:`/private/tmp/rc-dividers-${width}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await surface.click();await page.waitForFunction(()=>document.querySelector('[class*=touchSurface]')?.getAttribute('aria-expanded')==='true');await page.waitForFunction(()=>[...document.querySelectorAll('nav[aria-label="Bin dividers"] button')].every(button=>button.disabled));
await page.getByRole('button',{name:'Record Cabinet shelf',exact:true}).click();await page.getByRole('button',{name:'Open Y, 120 records',exact:true}).click();assert.match(await surface.getAttribute('aria-label'),/Record 140/);await page.waitForTimeout(100);await surface.focus();await page.keyboard.press('End');await tabs.waitFor({state:'hidden'});
assert.equal(await page.locator('[class*=dividerShadow]').count(),0,'No placeholder paper remains at the end');
await page.keyboard.press('Home');await page.waitForTimeout(500);await settled();await tabs.getByRole('button').first().waitFor();assert.equal(await tabs.getByRole('button').count(),2);
assert.deepEqual(errors,[]);
await context.close();console.log('PASS '+width+': divider jumps, closed sleeves, independent bin positions survive reload, no overflow');}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
