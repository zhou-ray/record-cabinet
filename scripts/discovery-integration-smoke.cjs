/* eslint-disable @typescript-eslint/no-require-imports -- Isolated mocked provider integration. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createCipheriv, createHash, randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:3194', account = 'a'.repeat(64);
function cookie() {
 const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', createHash('sha256').update('record-cabinet-offline-test-secret-only').digest(), iv);
 const encrypted = Buffer.concat([cipher.update(JSON.stringify({value:{accountId:account,accessToken:'test',refreshToken:'test',expiresAt:Date.now()+3600000},until:Date.now()+3600000})),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
(async () => {
 const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try { for (const width of [390,1400]) {
  const context = await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
  await context.addCookies([{name:'rc_spotify',value:cookie(),url:origin}]);
  let requests=0, mode='ok', release;
  const playbackCalls=[];
  await context.addInitScript(() => {
   window.playerInstances=0;
   window.Spotify={Player:class {
    constructor(){this.listeners={};window.mockPlayer=this;window.playerInstances++;}
    addListener(name,fn){this.listeners[name]=fn;}
    async connect(){this.listeners.ready({device_id:'test-device'});return true;}
    disconnect(){} async activateElement(){} async setVolume(){}
    emit(id){this.state={paused:false,position:0,duration:100000,track_window:{current_track:{uri:`spotify:track:t${id.slice(1)}`,name:'Track',album:{uri:`spotify:album:${id}`}}}};this.listeners.player_state_changed(this.state);}
    async getCurrentState(){return this.state||null;}
    async pause(){this.state.paused=true;this.listeners.player_state_changed(this.state);}
   }};
  });
  await context.route('**/api/library/sync', r=>r.fulfill({status:503,json:{error:'Test cloud disabled'}}));
  await context.route('**/api/genres**', r=>r.fulfill({status:503,json:{error:'Test genres disabled'}}));
  await context.route('**/api/spotify/**', async r=>{
   if(r.request().url().includes('/player')) {
    const body=r.request().method()==='POST'?r.request().postDataJSON():null;
    if(body) playbackCalls.push(body.action);
    if(body?.action==='play') await page.evaluate(body=>window.mockPlayer.emit(body.albumUri.split(':').pop()),body);
    return r.fulfill({json:body?{accepted:true}:{accessToken:'mock-token'}});
   }
   if(r.request().url().endsWith('/account')) return r.fulfill({json:{accountId:account}});
   if(r.request().url().endsWith('/library') && r.request().method()==='POST') {
    const ids=r.request().postDataJSON().membershipAlbumIds;
    if(ids) {
     requests++; const checkedAt=Date.now();
     if(mode==='hold') await new Promise(resolve=>release=resolve);
     if(mode==='error') return r.fulfill({status:429,json:{error:'Test cooldown'}});
     return r.fulfill({json:{accountId:account,records:ids.map(albumId=>({albumId,saved:albumId!=='spotify:a0',checkedAt,source:'spotify-library-contains'}))}}).catch(()=>{});
    }
   }
   return r.fulfill({status:503,json:{error:'Unexpected test request'}});
  });
  const page=await context.newPage(), errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  await page.goto(origin+'/settings');
  await page.getByText('Account and privacy',{exact:true}).waitFor();
  await page.evaluate(async account=>{
   const db=await new Promise(resolve=>{const r=indexedDB.open(`record-cabinet-library:${account}`,1);r.onsuccess=()=>resolve(r.result);});
   await new Promise((resolve,reject)=>{const tx=db.transaction('albums','readwrite');
    for(let i=0;i<125;i++) tx.objectStore('albums').put({id:`spotify:a${i}`,source:'spotify',title:`Record ${String(i).padStart(3,'0')}`,artist:`Artist ${i%10}`,artists:[{id:`artist${i%10}`,name:`Artist ${i%10}`}],year:'2026',genre:'Jazz',genres:['Jazz'],genresEdited:true,color:'moss',note:'',catalogNumber:'',artworkUrl:null,externalUrl:null,playback:{kind:'spotify',uri:`spotify:album:a${i}`},availabilityCheckedAt:Date.now(),tracks:[{id:`spotify:t${i}`,title:'Track',duration:100,disc:1,number:1}]});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
   });db.close();
  },account);
  await page.reload();
  await page.getByRole('button',{name:'Skip',exact:true}).click();
  for (const exit of ['skip', 'escape']) {
    await page.getByRole('button',{name:'How to use the cabinet',exact:true}).click();
    await page.getByText('Open a bin',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Open All records, 125 records',exact:true}).waitFor();
    if(exit==='skip') await page.getByRole('button',{name:'Skip tour',exact:true}).click();
    else await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Open All records, 125 records',exact:true}).waitFor();
    assert.equal(new URL(page.url()).searchParams.has('demo'),false,'tour removes demo URL on exit');
    await page.getByRole('link',{name:'Library & settings',exact:true}).first().click();
  }

  await page.getByRole('link',{name:'← Back to records',exact:true}).click();
  await page.getByRole('button',{name:'Discover',exact:true}).click();
  assert.equal(requests,0,'no checks on mount or navigation');
  await page.getByRole('button',{name:'Prepare discovery bins',exact:true}).click();
  await page.getByRole('button',{name:'Check saved albums',exact:true}).waitFor();
  assert.equal(requests,4,'resume only remaining five');
  const read=()=>page.evaluate(async account=>{
   const db=await new Promise(resolve=>{const r=indexedDB.open(`record-cabinet-engagement:${account}`);r.onsuccess=()=>resolve(r.result);});
   const result=await new Promise(resolve=>{const r=db.transaction('metadata').objectStore('metadata').get('discovery-snapshot');r.onsuccess=()=>resolve(r.result);});db.close();return result;
  },account);
  const first=await read();
  assert.deepEqual(first.snapshot.bins.map(b=>b.albumIds.length),[0,20,20]);
  assert.equal(first.snapshot.version,'cold-start-1');
  const artistCounts=new Map();
  for(const id of first.snapshot.bins[1].albumIds){const artist=Number(id.slice('spotify:a'.length))%10;artistCounts.set(artist,(artistCounts.get(artist)||0)+1);}
  assert.equal(artistCounts.size,10);assert.ok([...artistCounts.values()].every(count=>count===2));
  // A current pre-M4 snapshot must survive deployment without reshuffling.
  first.snapshot.version='framework-1';
  await page.evaluate(async ({account,first})=>{
   const db=await new Promise(resolve=>{const r=indexedDB.open(`record-cabinet-engagement:${account}`);r.onsuccess=()=>resolve(r.result);});
   await new Promise(resolve=>{const tx=db.transaction('metadata','readwrite');tx.objectStore('metadata').put(first,'discovery-snapshot');tx.oncomplete=resolve;});db.close();
  },{account,first});
  assert.equal(new Set(first.snapshot.bins.flatMap(b=>b.albumIds)).size,40);
  assert.ok(!first.snapshot.bins.flatMap(b=>b.albumIds).includes('spotify:a0'));
  await page.screenshot({path:`/private/tmp/rc-discovery-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Open Wander, 20 records',exact:true}).click();
  await page.getByRole('heading',{name:'Wander',exact:true}).waitFor();
  await page.getByRole('button',{name:'Next album',exact:true}).click();
  await page.getByRole('button',{name:'Random record',exact:true}).click();
  const rememberedTitle = await page.locator('[class*=albumInfo] h2').innerText();
  await page.getByRole('button',{name:'← Back to shelf',exact:true}).click();
  const preview = page.getByRole('button',{name:'Open Wander, 20 records',exact:true}).locator('[data-album-id]').last();
  const rememberedId = await preview.getAttribute('data-album-id');
  assert.equal(await preview.locator('span').innerText(), rememberedTitle, 'thumbnail shows remembered record');
  await page.getByRole('button',{name:'Check saved albums',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="Discovery preparation"] button').disabled);
  assert.equal(requests,4,'fresh cache makes no requests');
  await page.reload();await page.getByRole('button',{name:'Discover',exact:true}).click();
  await page.getByRole('button',{name:'Open Wander, 20 records',exact:true}).waitFor();
  assert.deepEqual(await read(),first,'reload preserves exact snapshot');
  assert.equal(await preview.getAttribute('data-album-id'), rememberedId, 'thumbnail position survives reload');
  await page.getByRole('button',{name:'Open Wander, 20 records',exact:true}).click();
  assert.equal(await page.locator('[class*=albumInfo] h2').innerText(), rememberedTitle, 'bin opens at thumbnail record');
  await page.locator('[class*=touchSurface]').click();
  await page.waitForFunction(()=>!document.querySelector('button[title="Play this album"]').disabled);
  await page.getByRole('button',{name:/^Play .* by tapping the vinyl$/}).click();
  await page.getByRole('button',{name:'Pause record',exact:true}).waitFor();
  const playerInstances=await page.evaluate(()=>window.playerInstances);
  await page.getByRole('button',{name:'← Back to shelf',exact:true}).click();
  await page.getByRole('button',{name:'Open Digging, 20 records',exact:true}).click();
  await page.getByRole('button',{name:'← Back to shelf',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.mockPlayer.state.paused),false);
  assert.equal(await page.evaluate(()=>window.playerInstances),playerInstances,'bin navigation must not remount player');
  assert.ok(!playbackCalls.includes('pause'),'discovery browsing must not pause audio');
  // Expire both verification and snapshot locally; browsing must not hit Spotify.
  await page.evaluate(async account=>{
   for(const [name,key] of [[`record-cabinet-library:${account}`,'saved-membership'],[`record-cabinet-engagement:${account}`,'discovery-snapshot']]) {
    const db=await new Promise(resolve=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);});
    await new Promise(resolve=>{const tx=db.transaction(name.includes('-library:')?'settings':'metadata','readwrite'),store=tx.objectStore(tx.objectStoreNames[0]),r=store.get(key);r.onsuccess=()=>{const value=r.result;if(Array.isArray(value))value.forEach(row=>row.checkedAt-=8*86400000);else {value.snapshot.generatedAt-=8*86400000;value.snapshot.expiresAt-=8*86400000;}store.put(value,key);};tx.oncomplete=resolve;});db.close();
   }
  },account);
  await page.reload();await page.getByRole('button',{name:'Discover',exact:true}).click();
  await page.getByRole('button',{name:'Prepare discovery bins',exact:true}).waitFor();
  assert.equal(requests,4);
  // One tab holds the account request lock; a second tab must not duplicate it.
  mode='hold';await page.getByRole('button',{name:'Prepare discovery bins',exact:true}).click();
  while(!release) await new Promise(resolve=>setTimeout(resolve,20));
  const peer=await context.newPage();await peer.goto(origin);await peer.getByRole('button',{name:'Discover',exact:true}).click();
  await peer.getByRole('button',{name:'Prepare discovery bins',exact:true}).click();
  await peer.getByText(/being checked in another tab/).waitFor();assert.equal(requests,5);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();mode='ok';release();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="Discovery preparation"] button').disabled);
  mode='error';await page.getByRole('button',{name:'Prepare discovery bins',exact:true}).click();
  await page.getByText(/Spotify needs a pause/).waitFor();assert.equal(requests,6);
  mode='ok';await page.getByRole('button',{name:'Prepare discovery bins',exact:true}).click();
  await page.getByRole('button',{name:'Check saved albums',exact:true}).waitFor();
  assert.notEqual((await read()).snapshot.id,first.snapshot.id,'expired snapshot regenerated');
  assert.equal((await read()).snapshot.version,'cold-start-1','expired old set upgrades on preparation');
  await page.getByRole('button',{name:'Open Wander, 20 records',exact:true}).click();
  await page.locator('[class*=touchSurface]').click();
  await page.waitForFunction(()=>!document.querySelector('button[title="Play this album"]').disabled);
  await page.getByRole('button',{name:/^Play .* by tapping the vinyl$/}).click();
  await page.getByRole('button',{name:'Pause record',exact:true}).waitFor();
  const renewed = await read();
  const removedId = renewed.snapshot.bins[1].albumIds[0];
  await page.evaluate(async ({account,removedId})=>{
   const db=await new Promise(resolve=>{const r=indexedDB.open(`record-cabinet-library:${account}`);r.onsuccess=()=>resolve(r.result);});
   await new Promise(resolve=>{const tx=db.transaction('settings','readwrite'),store=tx.objectStore('settings'),r=store.get('saved-membership');r.onsuccess=()=>store.put(r.result.map(row=>row.albumId===removedId?{...row,saved:false,checkedAt:Date.now()}:row),'saved-membership');tx.oncomplete=resolve;});db.close();window.dispatchEvent(new Event('focus'));
  },{account,removedId});
  await page.getByRole('button',{name:'Open Wander, 19 records',exact:true}).waitFor();
  assert.deepEqual(await read(),renewed,'removal filters without refilling persisted order');
  assert.equal(await page.evaluate(()=>window.mockPlayer.state.paused),false,'membership removal does not stop playing record');
  // Reset while a generated bin is open must retire that view, not the player tree.
  await page.getByRole('button',{name:'Open Digging, 20 records',exact:true}).click();
  await peer.goto(origin+'/settings');await peer.getByText('Account and privacy',{exact:true}).click();
  await peer.getByRole('button',{name:'Reset Personalization History',exact:true}).click();await peer.getByRole('button',{name:'Reset history',exact:true}).click();
  await page.getByRole('button',{name:'Prepare discovery bins',exact:true}).waitFor();
  assert.equal(await read(),undefined);
  assert.equal(await page.evaluate(()=>window.mockPlayer.state.paused),false,'reset keeps audio playing');
  assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,'no horizontal overflow');
  await context.close();console.log(`PASS: discovery checks/resume/cancel/lock/cooldown, three bins, browsing, reload, expiry and cross-tab reset at ${width}px`);
 }} finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
