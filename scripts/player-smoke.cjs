/* eslint-disable @typescript-eslint/no-require-imports -- Standalone mocked browser test. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
const page = await browser.newPage({viewport:{width:1400,height:1000}});
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
const req=route.request();if(req.url().endsWith('/account'))return route.fulfill({contentType:'application/json',body:JSON.stringify({accountId:'guest'})});assert.ok(req.url().includes('/api/spotify/player'),'Unexpected Spotify request');
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
    tx.objectStore('albums').put({ id: 'spotify:smoke', availabilityCheckedAt: Date.now(), source: 'spotify', title: 'Player test album', artist: 'Test artist', artists: [{ id: 'artist', name: 'Test artist' }], year: '2026', genre: 'Uncategorized', genres: [], color: 'moss', note: '', catalogNumber: '', artworkUrl: 'https://covers.example/album.svg', externalUrl: 'https://open.spotify.com/album/smoke', playback: { kind: 'spotify', uri: 'spotify:album:smoke' }, tracks: [{ id: 'spotify:first', title: 'First track', duration: 100, disc: 1, number: 1 }, { id: 'spotify:second', title: 'Second track', duration: 120, disc: 1, number: 2 }] });
    tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
   }; request.onerror = () => reject(request.error);
  });
 });
 await page.reload();
 await page.getByText('Restored 1 albums. Import when you’re ready to add more.').waitFor();
 await page.getByRole('link',{name:'← Back to records',exact:true}).click();
 
 await page.getByRole('button', { name: 'Open All records, 1 record', exact: true }).click();
 await page.getByRole('button', { name: 'Show back cover and tracks of Player test album by Test artist', exact: true }).click();
 assert.equal(calls.length, 0, 'No Spotify traffic before a playback action');

const player=page.getByRole('region',{name:'Record player',exact:true});
assert.equal(await player.count(),0);
await page.getByRole('button',{name:/^Play .* by tapping the vinyl$/}).click();
await player.getByRole('button',{name:'Pause record',exact:true}).waitFor();
assert.deepEqual(calls.filter(x=>x!=='token').map(x=>x.action),['transfer','shuffle-off','repeat-off','play']);
await page.waitForFunction(()=>navigator.mediaSession.metadata?.title==='Player test album');
assert.equal(await page.evaluate(()=>navigator.mediaSession.metadata.artist),'Test artist');
assert.equal(await page.evaluate(()=>navigator.mediaSession.metadata.artwork[0].src),'https://covers.example/album.svg');
assert.equal(await page.evaluate(()=>window.mockPlayer.options.enableMediaSession),true);
await page.evaluate(()=>{navigator.mediaSession.metadata=null;window.dispatchEvent(new Event('pageshow'));});
await page.waitForFunction(()=>navigator.mediaSession.metadata?.title==='Player test album');
assert.equal(await page.evaluate(()=>window.systemHandlers.nexttrack),null);
const beforeStale=calls.length;
await page.evaluate(()=>{window.deferRead=true;window.stalePlayback={...window.mockPlayer.state,paused:false};window.dispatchEvent(new Event('focus'));});
await page.waitForFunction(()=>typeof window.resolveRead==='function');
await page.evaluate(()=>{window.mockPlayer.emit(0,25000,true);window.deferRead=false;window.resolveRead(window.stalePlayback);});
await player.getByRole('button',{name:'Play record',exact:true}).waitFor();
assert.equal(Number(await player.getByRole('slider',{name:'Tonearm position'}).getAttribute('aria-valuenow')),25,'Late foreground response cannot overwrite a newer SDK event');
assert.equal(calls.length,beforeStale);
await player.getByRole('button',{name:'Play record',exact:true}).click();
await player.getByRole('button',{name:'Pause record',exact:true}).waitFor();
const beforeRecovery=calls.length;
await page.evaluate(()=>{window.mockPlayer.state.paused=true;window.mockPlayer.state.position=45000;window.dispatchEvent(new Event('focus'));});
await player.getByRole('button',{name:'Play record',exact:true}).waitFor();
assert.equal(Number(await player.getByRole('slider',{name:'Tonearm position'}).getAttribute('aria-valuenow')),45);
assert.equal(calls.length,beforeRecovery,'Returning to the app reads SDK state without REST requests');
await player.getByRole('button',{name:'Play record',exact:true}).click();
await player.getByRole('button',{name:'Pause record',exact:true}).waitFor();
await page.evaluate(()=>window.systemHandlers.pause({action:'pause'}));
await player.getByRole('button',{name:'Play record',exact:true}).waitFor();
await page.waitForFunction(()=>navigator.mediaSession.playbackState==='paused');
await page.evaluate(()=>window.systemHandlers.play({action:'play'}));
await player.getByRole('button',{name:'Pause record',exact:true}).waitFor();
assert.equal(await player.getByText('Choose a track').count(),0);
const arm=player.getByRole('slider',{name:'Tonearm position'});
await page.evaluate(()=>{
 const p=window.mockPlayer;p.emit(0,20000);
 p.state.track_window.current_track.linked_from={uri:'spotify:track:first'};
 p.state.track_window.current_track.uri='spotify:track:replacement';
 p.listeners.player_state_changed(p.state);
});
assert.equal(Number(await arm.getAttribute('aria-valuenow')),20);
await player.getByRole('button',{name:'Pause record',exact:true}).click();
await player.getByRole('button',{name:'Play record',exact:true}).click();
await player.getByRole('button',{name:'Pause record',exact:true}).waitFor();

const beforeCue=calls.length;
await player.getByRole('button',{name:'Pause record',exact:true}).click();
await player.getByRole('button',{name:'Play record',exact:true}).waitFor();
assert.equal(await page.evaluate(()=>window.mockPlayer.state.paused),true);
await player.getByRole('button',{name:'Play record',exact:true}).click();
await player.getByRole('button',{name:'Pause record',exact:true}).waitFor();
assert.equal(calls.length,beforeCue,'Cue lever uses SDK pause and resume');
const volume=player.getByRole('slider',{name:'Record volume',exact:true});
await page.waitForFunction(()=>!document.querySelector('input[aria-label="Record volume"]')?.disabled);
await volume.scrollIntoViewIfNeeded();const knob=await volume.boundingBox();
const beforeVolume=await page.evaluate(()=>window.sdkCalls.filter(c=>c.volume!==undefined).length);
await page.mouse.move(knob.x+knob.width*.7,knob.y+knob.height/2);await page.mouse.down();await page.mouse.move(knob.x+knob.width*.3,knob.y+knob.height/2,{steps:6});await page.mouse.up();
await page.waitForFunction(()=>window.mockPlayer.volume<.7);
assert.equal(await page.evaluate(()=>window.sdkCalls.filter(c=>c.volume!==undefined).length),beforeVolume+1,'Drag commits one volume command');
assert.equal(calls.length,beforeCue,'Volume does not use the Web API');
await volume.focus();await page.keyboard.press('ArrowRight');
await page.waitForFunction(n=>window.sdkCalls.filter(c=>c.volume!==undefined).length===n,beforeVolume+2);

await page.evaluate(()=>window.mockPlayer.emit(1,20000));
assert.equal(await page.evaluate(()=>navigator.mediaSession.metadata.title),'Player test album','System title remains the album across tracks');
await page.waitForTimeout(300);
assert.ok(Number(await arm.getAttribute('aria-valuenow'))>=120);
const screenPoint=async seconds=>player.locator('svg').evaluate((svg,seconds)=>{const angle=(22+seconds/220*22)*Math.PI/180;const p=new DOMPoint(510-Math.sin(angle)*310,70+Math.cos(angle)*310).matrixTransform(svg.querySelector("[data-turntable-mechanism]").getScreenCTM());return {x:p.x,y:p.y};},seconds);
async function drag(toSeconds){await player.scrollIntoViewIfNeeded();const from=await screenPoint(Number(await arm.getAttribute('aria-valuenow'))),to=await screenPoint(toSeconds);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:10});await page.mouse.up();await page.waitForTimeout(50);assert.ok(Math.abs(Number(await arm.getAttribute('aria-valuenow'))-toSeconds)<2,'Arm holds the released position while Spotify seeks');await page.waitForTimeout(250);}
let count=calls.length;
await drag(150);assert.equal(calls.length,count);assert.ok(Math.abs((await page.evaluate(()=>window.sdkCalls.at(-1))).seek-50000)<1000);
await drag(50);assert.equal(calls.length,count+1);assert.equal(calls.at(-1).trackIndex,0);assert.ok(Math.abs(calls.at(-1).positionMs-50000)<1000);
await player.getByRole('button',{name:'Pause record',exact:true}).click();await player.getByRole('button',{name:'Play record',exact:true}).waitFor();count=calls.length;
await drag(170);assert.equal(calls.length,count);
await player.getByRole('button',{name:'Play record',exact:true}).click();await page.waitForTimeout(300);assert.equal(calls.at(-1).trackIndex,1);assert.ok(Math.abs(calls.at(-1).positionMs-70000)<1000);
assert.equal(await player.locator('image').getAttribute('href'),'https://covers.example/album.svg');
await player.getByRole('button',{name:'Pause playback',exact:true}).focus();
await page.keyboard.press('Enter');
await player.getByRole('button',{name:'Play record',exact:true}).waitFor();
await page.keyboard.press('Space');
await player.getByRole('button',{name:'Pause record',exact:true}).waitFor();
// Finish the last song; no REST traffic and no automatic restart.
count=calls.length;
await page.evaluate(()=>window.mockPlayer.emit(1,119900));
await player.getByText('The record has reached its end.',{exact:true}).waitFor();
assert.equal(await page.evaluate(()=>window.mockPlayer.state.paused),true);
assert.equal(calls.length,count);
await player.getByRole('button',{name:'Play record',exact:true}).click();
await player.getByRole('button',{name:'Pause record',exact:true}).waitFor();
assert.equal(calls.at(-1).trackIndex,0);
await page.evaluate(()=>{
 const p=window.mockPlayer;
 p.emit(1,119000);
 p.state.track_window.current_track.uri='spotify:track:recommendation';
 p.listeners.player_state_changed(p.state);
});
await player.getByRole('button',{name:'Play record',exact:true}).waitFor();
assert.equal(await page.evaluate(()=>window.mockPlayer.state.paused),true);
await player.screenshot({path:'/private/tmp/record-cover-player.png'});
await page.setViewportSize({width:390,height:844});await player.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
assert.equal(await player.getByRole('slider',{name:'Record volume',exact:true}).count(),0);
await player.getByText('Use device buttons',{exact:true}).waitFor();
await player.screenshot({path:'/private/tmp/record-cover-mobile.png'});
await player.getByRole('button',{name:'Play record',exact:true}).click();
await player.getByRole('button',{name:'Pause record',exact:true}).waitFor();
await page.evaluate(()=>{window.pauseNoop=true;});
const beforeFallback=calls.length;
await player.getByRole('button',{name:'Pause record',exact:true}).click();
await player.getByRole('button',{name:'Play record',exact:true}).waitFor();
assert.equal(calls.length,beforeFallback+1);
assert.equal(calls.at(-1).action,'pause');
assert.equal(calls.at(-1).deviceId,'browser');
assert.equal(await page.evaluate(()=>window.mockPlayer.state.paused),true);
await page.evaluate(()=>{window.pauseNoop=false;window.mockPlayer.listeners.player_state_changed({...window.mockPlayer.state,paused:false});});
await player.getByRole('button',{name:'Play record',exact:true}).waitFor();
count=calls.length;await page.waitForTimeout(1000);assert.equal(calls.length,count);assert.deepEqual(errors,[]);
// A stalled resume must release controls instead of leaving the deck busy.
await page.evaluate(()=>{window.stallResume=true;});
await player.getByRole('button',{name:'Play record',exact:true}).click();
await player.getByRole('alert').filter({hasText:'did not respond'}).waitFor();
assert.equal(await player.getByRole('button',{name:'Play record',exact:true}).isEnabled(),true);
await page.evaluate(()=>{window.stallResume=false;window.stallRead=true;window.dispatchEvent(new Event('online'));});
await player.getByText('Playback status could not refresh. Your record has not been stopped.',{exact:true}).waitFor();
await page.evaluate(()=>{window.stallRead=false;});
await player.getByRole('button',{name:'Play record',exact:true}).click();
await player.getByRole('button',{name:'Pause record',exact:true}).waitFor();
await page.evaluate(()=>{window.mockPlayer.state=null;document.dispatchEvent(new Event('visibilitychange'));});
await player.getByRole('button',{name:'Play record',exact:true}).waitFor();
await player.getByText('Playback is unavailable in this browser. Press Play to reconnect your record.',{exact:true}).waitFor();
console.log('PASS recovery: focus resync without REST, stalled resume releases controls, stalled background reads preserve the player, missing playback stays stopped');
console.log('PASS integrated SDK player: zero idle calls, ordered album playback, continuous needle, within/cross-track scrub, paused cue, cover label play/pause, album-end stop, recommendation stop, mobile layout.');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
