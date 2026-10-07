/* eslint-disable @typescript-eslint/no-require-imports -- Standalone mocked browser test. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
for(const mobile of [false,true]) {
const page = await browser.newPage({viewport:{width:mobile?390:1400,height:1000},isMobile:mobile,hasTouch:mobile});
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
 emit(index,position,paused=false){this.at=Date.now();this.state={paused,position,duration:index===3?120000:100000,track_window:{current_track:{uri:'spotify:track:'+ (index===3?'second':'first'),name:'Track',album:{uri:'spotify:album:smoke'}}}};this.listeners.player_state_changed(this.state);}
 async pause(){window.sdkCalls.push('pause');if(window.pauseNoop)return;this.state.paused=true;this.listeners.player_state_changed(this.state);}
 async resume(){window.sdkCalls.push('resume');if(window.stallResume)return new Promise(()=>{});this.state.paused=false;this.listeners.player_state_changed(this.state);}
 async seek(position){window.sdkCalls.push({seek:position});this.state.position=position;this.listeners.player_state_changed(this.state);}
 async getCurrentState(){if(window.deferRead)return new Promise(resolve=>{window.resolveRead=resolve;});if(window.stallRead)return new Promise(()=>{});return this.state ? {...this.state,position:Math.min(this.state.duration,this.state.position+(this.state.paused?0:Date.now()-this.at))} : null;}
}};
});
await page.route('**/api/spotify/**',async route=>{
const req=route.request();if(req.url().endsWith('/account'))return route.fulfill({contentType:'application/json',body:JSON.stringify({accountId:'guest'})});if(req.url().endsWith('/api/spotify/library')) {
 calls.push('availability');
 const record=await page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('record-cabinet-library:guest');r.onsuccess=()=>resolve(r.result);});
  const record=await new Promise(resolve=>{const r=db.transaction('albums').objectStore('albums').get('spotify:smoke');r.onsuccess=()=>resolve(r.result);});db.close();
  return {...record,availabilityCheckedAt:Date.now(),tracks:record.tracks.map((track,index)=>({...track,playable:[1,3].includes(index)}))};
 });
 return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'album',album:record})+'\n'+JSON.stringify({type:'complete'})+'\n'});
}
assert.ok(req.url().includes('/api/spotify/player'),'Unexpected Spotify request');
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
    tx.objectStore('albums').put({ id: 'spotify:smoke', source: 'spotify', title: 'Player test album', artist: 'Test artist', artists: [{ id: 'artist', name: 'Test artist' }], year: '2026', genre: 'Uncategorized', genres: [], color: 'moss', note: '', catalogNumber: '', artworkUrl: 'https://covers.example/album.svg', externalUrl: 'https://open.spotify.com/album/smoke', playback: { kind: 'spotify', uri: 'spotify:album:smoke' }, tracks: [{id:'spotify:grey1',title:'Unavailable opening',duration:60,disc:1,number:1},{ id: 'spotify:first', title: 'First track', duration: 100, disc: 1, number: 1 },{id:'spotify:grey2',title:'Unavailable middle',duration:60,disc:1,number:3}, { id: 'spotify:second', title: 'Second track', duration: 120, disc: 1, number: 4 },{id:'spotify:grey3',title:'Unavailable ending',duration:60,disc:1,number:5}] });
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
await page.getByRole('button',{name:/^Play .* by tapping the vinyl$/}).click();
await player.getByRole('button',{name:'Pause record',exact:true}).waitFor();
assert.equal(calls.filter(c=>c==='availability').length,1);
assert.equal(calls.filter(c=>c?.action==='play')[0].trackIndex,1);
await player.getByText(/Spotify cannot play 3 tracks/).waitFor();
const arm=player.getByRole('slider',{name:'Tonearm position'});
assert.equal(Number(await arm.getAttribute('aria-valuemax')),220);
await page.evaluate(()=>window.systemHandlers.seekto({action:'seekto',seekTime:130}));
await page.waitForFunction(()=>window.mockPlayer.state.track_window.current_track.uri==='spotify:track:second');
await page.waitForTimeout(700);
assert.equal(calls.filter(c=>c?.action==='play').at(-1).trackIndex,3);
assert.equal(calls.filter(c=>c?.action==='play').at(-1).positionMs,30000);
const beforeEnd=calls.length;
await page.evaluate(()=>{window.mockPlayer.emit(3,119500);window.mockPlayer.emit(3,0,true);});
await player.getByText('The record has reached its end.',{exact:true}).waitFor();
assert.equal(calls.length,beforeEnd);assert.equal(await page.evaluate(()=>window.mockPlayer.state.paused),true);
assert.equal(await page.getByText(/Unavailable on Spotify/).count(),3);
assert.deepEqual(errors,[]);
await player.screenshot({path:'/private/tmp/rc-unavailable-'+(mobile?'mobile':'desktop')+'.png'});
console.log('PASS '+(mobile?'mobile':'desktop')+': legacy availability refresh, skipped first/middle/final tracks, original Spotify offsets, end stop, full track list');
await page.close();
}
}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
