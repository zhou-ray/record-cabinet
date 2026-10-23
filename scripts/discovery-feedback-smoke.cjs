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
  let requests=0;
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
  await page.evaluate(account => localStorage.setItem(`record-cabinet-systems:${account}`, JSON.stringify({arrangement:'artist',systemId:'mine',systems:[{id:'mine',name:'My records',bins:[{id:'shelf',label:'My shelf'}],assignments:{'spotify:a124':'shelf'}}]})), account);
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
  assert.equal(first.snapshot.version,'behavioral-1');

  await page.evaluate(account=>{
    const key=`record-cabinet-systems:${account}`,org=JSON.parse(localStorage.getItem(key));
    org.systems.push(...Array.from({length:20},(_,i)=>({id:`system${i}`,name:`System ${i}`,bins:Array.from({length:5},(_,j)=>({id:`bin${j}`,label:`Destination ${i}-${j}`})),assignments:{}})));
    localStorage.setItem(key,JSON.stringify(org));
  },account);
  await page.reload();await page.getByRole('button',{name:'Discover',exact:true}).click();
  await page.getByRole('button',{name:'Open Wander, 20 records',exact:true}).click();
  await page.locator('[class*=touchSurface]').click();
  await page.waitForFunction(()=>!document.querySelector('button[title="Play this album"]').disabled);
  await page.getByRole('button',{name:/^Play .* by tapping the vinyl$/}).click();
  await page.getByRole('button',{name:'Pause record',exact:true}).waitFor();
  await page.getByRole('button',{name:'File in bin',exact:true}).click();
  const panel=page.getByRole('region',{name:/Choose a personal bin/});
  assert.equal(await panel.locator('strong').count(),8,'bounded destination list');
  await panel.screenshot({path:`/private/tmp/rc-feedback-picker-${width}.png`});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),'no horizontal overflow');
  await page.getByRole('searchbox',{name:'Find a destination'}).fill('Destination 19-4');
  assert.equal(await panel.locator('strong').count(),1);
  // Force the second store to fail, after personal filing succeeds.
  await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='discovery-feedback')throw new Error('Injected feedback failure');return window.originalPut.call(this,value,key);};});
  await panel.getByRole('button',{name:'Destination 19-4 System 19'}).click();
  await page.getByRole('button',{name:'Retry feedback',exact:true}).waitFor();
  assert.equal((await read()).snapshot.bins[1].albumIds.length,20);
  const moved=first.snapshot.bins[1].albumIds[0];
  assert.equal(await page.evaluate(({account,moved})=>JSON.parse(localStorage.getItem(`record-cabinet-systems:${account}`)).systems.find(s=>s.id==='system19').assignments[moved],{account,moved}),'bin4');
  await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut;});
  await page.getByRole('button',{name:'Retry feedback',exact:true}).click();
  await page.getByText('Filed in your personal bin. This record stays in Discover.',{exact:true}).waitFor();
  assert.equal((await read()).snapshot.bins[1].albumIds.length,20);
  assert.equal(await page.getByRole('heading',{name:'Wander',exact:true}).count(),1);
  assert.equal(await page.evaluate(()=>window.mockPlayer.state.paused),false,'filing preserves playback');
  assert.ok(!playbackCalls.includes('pause'));
  await page.reload();await page.getByRole('button',{name:'Discover',exact:true}).click();
  await page.getByRole('button',{name:'Open Wander, 20 records',exact:true}).click();
  await page.locator('[class*=touchSurface]').click();
  await page.getByRole('button',{name:'Remove from this Discover bin',exact:true}).click();
  await page.getByRole('heading',{name:'Wander',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.getElementById('album-details'));
  assert.equal(await page.locator('[class*=albumInfo] h2').innerText(),`Record ${first.snapshot.bins[1].albumIds[1].split(':a')[1].padStart(3,'0')}`);
  assert.equal((await read()).snapshot.bins[1].albumIds.length,19);
  assert.equal((await read()).snapshot.bins[2].albumIds.length,20);
  assert.equal(requests,4,'feedback makes no Spotify requests');
  const after=(await read()).snapshot;
  const excluded=first.snapshot.bins[1].albumIds.filter(id=>!after.bins[1].albumIds.includes(id));
  assert.equal(excluded.length,1);
  await page.evaluate(async account=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open(`record-cabinet-engagement:${account}`);r.onsuccess=()=>resolve(r.result);});
    await new Promise(resolve=>{const tx=db.transaction('metadata','readwrite'),store=tx.objectStore('metadata'),r=store.get('discovery-snapshot');r.onsuccess=()=>{const value=r.result;value.snapshot.generatedAt-=8*86400000;value.snapshot.expiresAt-=8*86400000;store.put(value,'discovery-snapshot');};tx.oncomplete=resolve;});db.close();
    localStorage.setItem(`record-cabinet-systems:${account}`,JSON.stringify({arrangement:'artist',systemId:'',systems:[]}));
  },account);
  await page.reload();await page.getByRole('button',{name:'Discover',exact:true}).click();
  await page.getByRole('button',{name:'Prepare discovery bins',exact:true}).click();
  await page.getByRole('button',{name:'Check saved albums',exact:true}).waitFor();
  const regenerated=(await read()).snapshot;
  assert.notEqual(regenerated.id,first.snapshot.id);
  for(const id of excluded)assert.ok(!regenerated.bins[1].albumIds.includes(id),'future Wander respects source feedback');
  assert.equal(requests,4,'regeneration reuses membership cache');
  await page.getByRole('button',{name:'Open Wander, 20 records',exact:true}).click();
  await page.locator('[class*=touchSurface]').click();
  await page.getByRole('button',{name:'File in bin',exact:true}).click();
  await page.getByText('Create a personal system to give this record a home.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Create a personal system',exact:true}).click();
  await page.getByRole('textbox',{name:'System name',exact:true}).fill('Evenings');
  await page.getByRole('textbox',{name:'Bin 1',exact:true}).fill('Quiet');
  await page.getByRole('button',{name:'Remove bin 3',exact:true}).click();
  await page.getByRole('button',{name:'Remove bin 2',exact:true}).click();
  await page.getByRole('button',{name:'Create bins & start filing →',exact:true}).click();
  await panel.getByRole('button',{name:'Quiet Evenings',exact:true}).click();
  await page.getByText('Filed in your personal bin. This record stays in Discover.',{exact:true}).waitFor();
  assert.equal((await read()).snapshot.bins[1].albumIds.length,20);
  // A small set exercises last-record wrap and the empty-bin boundary.
  await page.evaluate(async account=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open(`record-cabinet-engagement:${account}`);r.onsuccess=()=>resolve(r.result);});
    await new Promise(resolve=>{const tx=db.transaction('metadata','readwrite'),store=tx.objectStore('metadata'),r=store.get('discovery-snapshot');r.onsuccess=()=>{const value=r.result;value.snapshot.bins[1].albumIds=value.snapshot.bins[1].albumIds.slice(0,3);store.put(value,'discovery-snapshot');};tx.oncomplete=resolve;});db.close();
  },account);
  await page.reload();await page.getByRole('button',{name:'Discover',exact:true}).click();
  await page.getByRole('button',{name:'Open Wander, 3 records',exact:true}).click();
  await page.locator('[class*=touchSurface]').focus();await page.keyboard.press('End');
  const small=(await read()).snapshot.bins[1].albumIds;
  for(let remaining=3;remaining>0;remaining--){
    await page.locator('[class*=touchSurface]').click();
    await page.getByRole('button',{name:'Remove from this Discover bin',exact:true}).click();
    await page.waitForFunction(()=>!document.getElementById('album-details'));
    assert.equal((await read()).snapshot.bins[1].albumIds.length,remaining-1);
    if(remaining===3)assert.equal(await page.locator('[class*=albumInfo] h2').innerText(),`Record ${small[0].split(':a')[1].padStart(3,'0')}`,'removing last wraps to first');
    if(remaining>1)assert.equal(await page.getByRole('heading',{name:'Wander',exact:true}).count(),1);
  }
  assert.equal(await page.getByRole('heading',{name:'Wander',exact:true}).count(),0,'empty bin returns to shelf');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`/private/tmp/rc-feedback-${width}.png`,fullPage:true});
  await context.close();console.log(`Discovery feedback passed at ${width}px`);
 } } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
