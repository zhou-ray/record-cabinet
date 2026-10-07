/* eslint-disable @typescript-eslint/no-require-imports -- Standalone mocked browser regression. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:3111';
const full=id=>({id:`spotify:${id}`,source:'spotify',title:id==='abc'?'A Album':'B Album',artist:'Artist',artists:[{id:'spotify:artist',name:'Artist'}],year:'2026',genres:[],genre:'Uncategorized',color:'moss',note:'',catalogNumber:'',artworkUrl:null,externalUrl:`https://open.spotify.com/album/${id}`,playback:{kind:'spotify',uri:`spotify:album:${id}`},tracks:[{id:'spotify:first',title:'First song',duration:180,number:1,disc:1},{id:'spotify:last',title:'Last song',duration:180,number:2,disc:1}]});
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}});const errors=[],lookups=[];let fail=true;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.Spotify={Player:class{
    constructor(options){this.options=options;this.listeners={};window.mockPlayer=this;this.state=null;}
    addListener(name,fn){this.listeners[name]=fn;return true;}
    async connect(){this.options.getOAuthToken(()=>this.listeners.ready({device_id:'browser'}));return true;}
    disconnect(){}async activateElement(){}
    emit(uri){this.state={paused:false,position:0,duration:180000,track_window:{current_track:{uri:'spotify:track:first',name:'First song',album:{uri}}}};this.listeners.player_state_changed(this.state);}
    async pause(){if(this.state){this.state.paused=true;this.listeners.player_state_changed(this.state);}}
    async resume(){this.state.paused=false;this.listeners.player_state_changed(this.state);}
    async getCurrentState(){return this.state;}
   }};
  });
  await page.route('https://**/*spotify*',r=>r.abort());
  await page.route('**/api/library/sync',r=>r.fulfill({status:503,json:{error:'Disabled in this offline test'}}));
  await page.route('**/api/spotify/**',async r=>{
   const req=r.request();if(req.url().endsWith('/account'))return r.fulfill({json:{accountId:'guest'}});
   if(req.url().includes('/library')){
    const body=req.postDataJSON();lookups.push(body);
    if(fail)return r.fulfill({status:429,json:{error:'Spotify quota pause. Try later.'}});
    const album=full(body.trackUri?'resolved':'abc');
    return r.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'progress',album})+'\n'+JSON.stringify({type:'complete'})});
   }
   assert.ok(req.url().includes('/player'));
   if(req.method()==='POST'){const body=req.postDataJSON();if(body.action==='play')await page.evaluate(uri=>window.mockPlayer.emit(uri),body.albumUri);return r.fulfill({json:{accepted:true}});}
   return r.fulfill({json:{accessToken:'mock'}});
  });
  await page.goto(origin);
  await page.getByRole('link',{name:'Library & settings',exact:true}).click();
  await page.getByText('Import Spotify data file',{exact:true}).click();
  const input=page.getByLabel('Spotify export files');
  const file={name:'YourLibrary.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({albums:[{album:'A Album',artist:'Artist',uri:'spotify:album:abc'}],tracks:[{album:'A Album',artist:'Artist',uri:'spotify:track:song'},{album:'B Album',artist:'Artist',uri:'spotify:track:b'},{album:'B Album',artist:'Artist',uri:'spotify:track:c'}],email:'not-stored@example.com'}))};
  await input.setInputFiles(file);await page.getByRole('button',{name:'Import selected music',exact:true}).click();
  await page.getByText('Added 2 albums.',{exact:false}).waitFor();
  assert.equal(lookups.length,0);
  await input.setInputFiles(file);await page.getByRole('button',{name:'Import selected music',exact:true}).click();await page.getByText('Added 0 albums.',{exact:false}).waitFor();
  await page.reload();await page.getByRole('link',{name:'← Back to records',exact:true}).click();await page.getByRole('button',{name:'Open All records, 2 records',exact:true}).click();
  await page.getByRole('button',{name:'Show back cover and tracks of A Album by Artist',exact:true}).click();
  assert.equal(lookups.length,0,'Browsing exported records is request-free');
  await page.getByRole('button',{name:'Play A Album by tapping the vinyl',exact:true}).click();await page.getByText('Spotify quota pause. Try later.',{exact:true}).waitFor();
  assert.equal(await page.locator('#album-details').count(),1);
  fail=false;await page.getByRole('button',{name:'Play A Album by tapping the vinyl',exact:true}).click();
  const player=page.getByRole('region',{name:'Record player',exact:true});await player.getByRole('button',{name:'Pause record',exact:true}).waitFor();
  await page.getByRole('link',{name:'Library & settings',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.mockPlayer.state.paused),false,'Opening settings keeps playback running');
  await page.getByRole('link',{name:'← Back to records',exact:true}).click();
  await player.getByRole('button',{name:'Pause record',exact:true}).waitFor();
  assert.equal(await page.locator('#album-details').isVisible(),true,'Selected sleeve survives navigation');
  assert.deepEqual(lookups,[{albumLink:'spotify:album:abc'},{albumLink:'spotify:album:abc'}]);
  await page.getByRole('button',{name:'Play A Album by tapping the vinyl',exact:true}).click();await page.waitForTimeout(200);assert.equal(lookups.length,2,'Loaded album details are reused');
  await page.getByRole('button',{name:/^Show front cover of /}).press('Escape');await page.locator('#album-details').waitFor({state:'detached'});
  await page.getByRole('button',{name:'Next album',exact:true}).click();await page.getByRole('button',{name:'Show back cover and tracks of B Album by Artist',exact:true}).click();
  await page.getByRole('button',{name:'Play B Album by tapping the vinyl',exact:true}).click();
  await player.getByRole('heading',{name:'B Album',exact:true}).waitFor();
  assert.deepEqual(lookups.at(-1),{trackUri:'spotify:track:b'});
  const persisted=await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('record-cabinet-library:guest');r.onsuccess=()=>{const db=r.result,tx=db.transaction('albums'),q=tx.objectStore('albums').getAll();tx.oncomplete=()=>{db.close();resolve(q.result);};tx.onerror=()=>reject(tx.error);};}));
  assert.equal(persisted.length,2);assert.ok(persisted.every(a=>a.tracks.length===2));assert.ok(persisted.some(a=>a.id.startsWith('export:')&&a.playback.uri==='spotify:album:resolved'));
  assert.equal(JSON.stringify(persisted).includes('not-stored'),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: export import/reimport/reload uses no Spotify requests; first-play quota recovery, album and track hydration, stable IDs and cached replay.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
