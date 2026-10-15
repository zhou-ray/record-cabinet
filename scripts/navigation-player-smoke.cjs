/* eslint-disable @typescript-eslint/no-require-imports -- Standalone mocked browser test. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
for (const mobile of [false,true]) {
const page = await browser.newPage({viewport:{width:mobile?390:1400,height:1000},isMobile:mobile,hasTouch:mobile});
let accountFailure=0;
const calls=[]; const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/library/sync',route=>route.fulfill({status:503,json:{error:'Cloud disabled in this offline test'}}));
await page.addInitScript(() => {
window.sdkCalls=[];
window.systemHandlers={};
const media=navigator.mediaSession,setHandler=media.setActionHandler.bind(media);
media.setActionHandler=(action,handler)=>{window.systemHandlers[action]=handler;setHandler(action,handler);};
window.Spotify={Player: class {
 constructor(options){this.options=options;this.listeners={};window.mockPlayer=this;this.state=null;}
 addListener(name,fn){this.listeners[name]=fn;return true;}
 async connect(){this.options.getOAuthToken(()=>this.listeners.ready({device_id:'browser'}));return true;}
 disconnect(){window.sdkCalls.push('disconnect');} async activateElement(){}
 async setVolume(value){window.sdkCalls.push({volume:value});this.volume=value;}
 emit(index,position,paused=false){this.at=Date.now();this.state={paused,position,duration:index?120000:100000,track_window:{current_track:{uri:'spotify:track:'+ (index?'second':'first'),name:'Track',album:{uri:'spotify:album:smoke'}}}};this.listeners.player_state_changed(this.state);}
 async pause(){window.sdkCalls.push('pause');if(window.pauseNoop)return;this.state.paused=true;this.listeners.player_state_changed(this.state);}
 async resume(){window.sdkCalls.push('resume');if(window.stallResume)return new Promise(()=>{});this.state.paused=false;this.listeners.player_state_changed(this.state);}
 async seek(position){window.sdkCalls.push({seek:position});this.state.position=position;this.listeners.player_state_changed(this.state);}
 async getCurrentState(){if(window.deferRead)return new Promise(resolve=>{window.resolveRead=resolve;});if(window.stallRead)return new Promise(()=>{});return this.state ? {...this.state,position:Math.min(this.state.duration,this.state.position+(this.state.paused?0:Date.now()-this.at))} : null;}
}};
});
await page.route('**/api/spotify/**',async route=>{
const req=route.request();
if(req.url().endsWith('/api/spotify/library')) {
 calls.push('details');
 const saved=await page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('record-cabinet-library:guest');r.onsuccess=()=>resolve(r.result);});
  const record=await new Promise(resolve=>{const r=db.transaction('albums').objectStore('albums').get('spotify:smoke');r.onsuccess=()=>resolve(r.result);});db.close();return record;
 });
 const album={...saved,availabilityCheckedAt:Date.now(),tracks:[{id:'spotify:first',title:'First track',duration:100,disc:1,number:1},{id:'spotify:second',title:'Second track',duration:120,disc:1,number:2}]};
 return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'progress',album})+'\n'+JSON.stringify({type:'complete'})+'\n'});
}
if(req.url().endsWith('/account'))return route.fulfill({contentType:'application/json',status:accountFailure===503?503:200,body:JSON.stringify(accountFailure?{error:'Temporary account check failure'}:{accountId:'guest'})});assert.ok(req.url().includes('/api/spotify/player'),'Unexpected Spotify request');
const body=req.method()==='POST'?req.postDataJSON():null;calls.push(body||'token');
if(body?.action==='play') await new Promise(resolve=>setTimeout(resolve,600));
if(body?.action==='play') await page.evaluate(b=>window.mockPlayer.emit(b.trackIndex,b.positionMs),body);
if(body?.action==='pause') await page.evaluate(()=>{window.mockPlayer.state.paused=true;window.mockPlayer.listeners.player_state_changed(window.mockPlayer.state);});
await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body?{accepted:true}:{accessToken:'mock-token'})});
});
 await page.route('https://covers.example/album.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#c0744b"/><circle cx="64" cy="64" r="38" fill="#334f57"/></svg>'}));
 await page.goto((process.env.TEST_ORIGIN||'http://127.0.0.1:3100')+'/settings');
 await page.getByText('Imported albums will be saved in this browser.').waitFor();
 await page.evaluate(async () => {
  await new Promise((resolve, reject) => {
   const request = indexedDB.open('record-cabinet-library:guest', 1);
   request.onsuccess = () => {
    const db = request.result; const tx = db.transaction('albums', 'readwrite');
    tx.objectStore('albums').put({ id: 'spotify:smoke', availabilityCheckedAt: Date.now(), source: 'spotify', title: 'A Very Long Album Name With Plenty Of Words That Must Wrap Around Without Colliding With The Record Count', artist: 'Test artist', artists: [{ id: 'artist', name: 'Test artist' }], year: '2026', genre: 'Uncategorized', genres: [], color: 'moss', note: '', catalogNumber: '', artworkUrl: 'https://covers.example/album.svg', externalUrl: 'https://open.spotify.com/album/smoke', playback: { kind: 'spotify', uri: 'spotify:album:smoke' }, tracks: [] });
    tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
   }; request.onerror = () => reject(request.error);
  });
 });
 await page.reload();
 await page.getByText('Restored 1 albums. Import when you’re ready to add more.').waitFor();
 await page.getByRole('link',{name:'← Back to records',exact:true}).click();
 
 await page.getByRole('button', { name: 'Open All records, 1 record', exact: true }).click();
 await page.getByRole('button', { name: 'Show back cover and tracks of A Very Long Album Name With Plenty Of Words That Must Wrap Around Without Colliding With The Record Count by Test artist', exact: true }).click();


const idleFlip=()=>page.waitForFunction(()=>!document.querySelector('button[title="Play this album"]').disabled);
await page.getByRole('region',{name:'Full track list for A Very Long Album Name With Plenty Of Words That Must Wrap Around Without Colliding With The Record Count',exact:true}).getByText('Second track',{exact:true}).waitFor();
await idleFlip();
await page.locator('[class*=activeBack] [class*=backTitle]').click();
await page.locator('#album-details').waitFor({state:'detached'});
await page.locator('[class*=touchSurface]').click();await idleFlip();
assert.equal(calls.filter(x=>x==='details').length,1,'Repeated flips must reuse saved tracks');
const bounds=await page.locator('[class*="albumInfo"]').evaluate(node=>{
 const title=node.querySelector('h2').getBoundingClientRect(),count=node.querySelector('[class*="recordNumber"]').getBoundingClientRect();
 return {titleRight:title.right,countLeft:count.left,width:node.clientWidth,scroll:node.scrollWidth};
});
assert.ok(bounds.titleRight<=bounds.countLeft);assert.ok(bounds.scroll<=bounds.width);
const player=page.getByRole('region',{name:'Record player',exact:true});
assert.equal(await player.count(),0);
await page.getByRole('button',{name:/^Play .* by tapping the vinyl$/}).click();
await player.getByRole('button',{name:'Pause record',exact:true}).waitFor();
assert.deepEqual(calls.filter(x=>x!=='token'&&x!=='details').map(x=>x.action),['transfer','shuffle-off','repeat-off','play']);
await page.waitForFunction(()=>navigator.mediaSession.metadata?.title==='A Very Long Album Name With Plenty Of Words That Must Wrap Around Without Colliding With The Record Count');
assert.equal(await page.evaluate(()=>navigator.mediaSession.metadata.artist),'Test artist');
assert.equal(await page.evaluate(()=>navigator.mediaSession.metadata.artwork[0].src),'https://covers.example/album.svg');
assert.equal(await page.evaluate(()=>window.mockPlayer.options.enableMediaSession),true);
await page.evaluate(()=>{navigator.mediaSession.metadata=null;window.dispatchEvent(new Event('pageshow'));});
await page.waitForFunction(()=>navigator.mediaSession.metadata?.title==='A Very Long Album Name With Plenty Of Words That Must Wrap Around Without Colliding With The Record Count');
assert.equal(await page.evaluate(()=>{
 const before=JSON.stringify(window.sdkCalls);
 window.systemHandlers.nexttrack();window.systemHandlers.previoustrack();
 return JSON.stringify(window.sdkCalls)===before;
}),true,'system next/previous commands do not change playback');
// Keep Spotify state updates flowing while the sleeve returns beside the player.
await page.evaluate(()=>{
 window.returnTicker=setInterval(()=>window.mockPlayer.emit(0,1000),80);
 window.playingReturnFrames=[];
 const sample=()=>{
  const stack=document.querySelector('[class*=returningStack]');
  if(stack)window.playingReturnFrames.push(getComputedStyle(stack).clipPath);
  if(document.querySelector('[class*=touchSurface]').getAttribute('aria-expanded')==='true')requestAnimationFrame(sample);
 };
 requestAnimationFrame(sample);
});
await page.locator('[class*=activeBack] [class*=backTitle]').click();
await page.locator('#album-details').waitFor({state:'detached'});
assert.equal(await player.getByRole('button',{name:'Pause record',exact:true}).isEnabled(),true);
assert.ok(await page.evaluate(()=>window.playingReturnFrames.length>0 && window.playingReturnFrames.every(clip=>clip!=='none')),'Playing sleeve is clipped at the bin opening throughout lowering');
await page.locator('[class*=touchSurface]').click();await idleFlip();
await page.getByRole('button',{name:/^Show front cover of /}).press('Escape');
await page.locator('#album-details').waitFor({state:'detached'});
await page.evaluate(()=>clearInterval(window.returnTicker));
await page.locator('[class*=touchSurface]').scrollIntoViewIfNeeded();
await page.getByRole('button',{name:'Random record',exact:true}).click();
await page.waitForFunction(()=>document.activeElement===document.querySelector('[class*=touchSurface]'));
const selectedBounds=await page.locator('[class*=touchSurface]').boundingBox();
assert.ok(selectedBounds.y>=0 && selectedBounds.y+selectedBounds.height<=1000,'Random record stays visible instead of jumping to the player');
assert.equal(await page.locator('[class*=touchSurface]').getAttribute('aria-expanded'),'false');
assert.equal(await player.getByRole('button',{name:'Pause record',exact:true}).isEnabled(),true);

const beforeNavigation=calls.length;
const originalDisconnects=await page.evaluate(()=>window.sdkCalls.filter(x=>x==='disconnect').length);
accountFailure=503;
await page.evaluate(()=>{window.stallRead=true;window.dispatchEvent(new Event('focus'));});
await player.getByText('Playback status could not refresh. Your record has not been stopped.',{exact:true}).waitFor();
assert.equal(await page.evaluate(()=>window.sdkCalls.filter(x=>x==='disconnect').length),originalDisconnects);
assert.equal(await player.getByRole('button',{name:'Pause record',exact:true}).isEnabled(),true);
accountFailure=200;
await page.evaluate(()=>{window.stallRead=false;window.dispatchEvent(new Event('focus'));});
await player.getByText('Playback status could not refresh. Your record has not been stopped.',{exact:true}).waitFor({state:'hidden'});
accountFailure=0;

await page.evaluate(()=>{window.originalPlayer=window.mockPlayer;window.documentMarker='same document';});
await page.getByRole('link',{name:'Library & settings',exact:true}).click();
await page.getByRole('heading',{name:'Library & settings',exact:true}).waitFor();
assert.equal(await page.evaluate(()=>window.sdkCalls.includes('disconnect')),false);
assert.equal(await page.getByText('Import Spotify data file',{exact:true}).count(),0);
assert.deepEqual(await page.locator('.settings-section > h2').allTextContents(),['Library','Organization','Account & advanced']);
assert.equal(await page.locator('.settings-advanced').evaluate(el=>el.open),false);
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth),false,'settings fit the viewport');
await page.goBack();await player.getByRole('button',{name:'Pause record',exact:true}).waitFor();
await page.goForward();await page.getByRole('heading',{name:'Library & settings',exact:true}).waitFor();
await page.getByRole('link',{name:'← Back to records',exact:true}).click();
await player.getByRole('button',{name:'Pause record',exact:true}).waitFor();
await page.getByRole('button',{name:'Record Cabinet shelf',exact:true}).click();
await page.getByRole('link',{name:'Library & settings',exact:true}).click();
await page.getByRole('heading',{name:'Library & settings',exact:true}).waitFor();
assert.equal(await page.evaluate(()=>window.originalPlayer===window.mockPlayer&&window.documentMarker==='same document'&&!window.mockPlayer.state.paused),true);
assert.equal(await page.evaluate(()=>window.sdkCalls.includes('disconnect')),false,'Settings must not destroy the player');
await page.getByRole('link',{name:'← Back to records',exact:true}).click();
await player.getByRole('button',{name:'Pause record',exact:true}).waitFor();
await page.getByRole('link',{name:'Library & settings',exact:true}).click();
await page.getByRole('button',{name:'Manage my systems',exact:true}).click();
await page.locator('#system-editor').waitFor();
assert.equal(await page.getByRole('button',{name:'My systems',exact:true}).getAttribute('aria-pressed'),'true');
assert.equal(await page.evaluate(()=>window.originalPlayer===window.mockPlayer&&!window.mockPlayer.state.paused),true,'organizing keeps the same playing SDK');
assert.equal(calls.length,beforeNavigation);assert.deepEqual(errors,[]);
console.log('PASS '+(mobile?'mobile':'desktop')+': cached tracks on flip, long title layout, playing bin/shelf to Settings, browser back/forward, same SDK instance and no extra playback requests');
await page.close();
}
} finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
