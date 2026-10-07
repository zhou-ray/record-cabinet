/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser regression. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {createCipheriv,createHash,randomBytes}=require('node:crypto');
const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:3126';
function cookie(accountId){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update('record-cabinet-offline-test-secret-only').digest(),iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify({value:{accountId,accessToken:'mock',refreshToken:'mock',expiresAt:Date.now()+3600000},until:Date.now()+3600000})),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');}
const record=(id,extra={})=>({id:'spotify:'+id,source:'spotify',title:id,artist:'Artist '+id,artists:[],year:'2026',genres:[],genre:'Uncategorized',color:'moss',note:'',catalogNumber:'',artworkUrl:null,externalUrl:null,tracks:[],playback:{kind:'spotify',uri:'spotify:album:'+id},...extra});
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:{width:mobile?390:1400,height:1000},isMobile:mobile,hasTouch:mobile});
  await context.addCookies([{name:'rc_spotify',value:cookie('genres-test'),url:origin,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage(),calls=[],errors=[];let fail=true,retry=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/spotify/**',r=>{assert.ok(r.request().url().endsWith('/account'));return r.fulfill({json:{accountId:'genres-test'}});});
  await page.route('**/api/library/sync',r=>r.fulfill({status:503,json:{error:'Mock sync'}}));
  await page.route('**/api/genres',r=>{
   const q=r.request().postDataJSON();calls.push(q.title+':'+q.mode);assert.notEqual(q.mode,'artist');
   if(q.title==='b'&&q.mode==='album'&&fail)return r.fulfill({status:503,json:{error:'Genre lookup paused.'}});
   const genres=q.title==='b'?(q.mode==='apple'?[]:['Rock']):q.title==='unmatched'?(retry?['Pop']:[]):['existing','lana'].includes(q.title)?['Alternative']:['Jazz'];
   return r.fulfill({json:{genres,source:genres.length?(q.mode==='apple'?'apple':'album'):'none',checkedAt:Date.now()}});
  });
  await page.goto(origin+'/settings');await page.getByRole('heading',{name:'Automatic genres',exact:true}).waitFor();
  await page.evaluate(async records=>{
   const db=await new Promise(resolve=>{const r=indexedDB.open('record-cabinet-library:genres-test',1);r.onsuccess=()=>resolve(r.result);});
   await new Promise(resolve=>{const tx=db.transaction(['albums','settings'],'readwrite');records.forEach(a=>tx.objectStore('albums').put(a));tx.objectStore('settings').put({[JSON.stringify(['existing','artist existing'])]:{genres:['Classical'],source:'apple',strategy:2,phase:'complete',checkedAt:Date.now()},[JSON.stringify(['lana','lana del rey'])]:{genres:['Electronic'],source:'apple',strategy:2,phase:'complete',checkedAt:Date.now()}},'auto-genres');tx.oncomplete=resolve;});db.close();
  },[record('a'),record('b'),record('cleared',{genresEdited:true}),record('existing',{genres:['Classical'],genre:'Classical'}),record('lana',{artist:'Lana Del Rey',genres:['Electronic'],genre:'Electronic'}),record('unmatched')]);
  await page.reload();const section=page.getByRole('region',{name:'Automatic genres',exact:true});
  await section.getByRole('button',{name:'Auto-organize genres',exact:true}).click();
  await section.getByText(/Genre lookup paused.*progress is saved/).waitFor();
  await section.getByText(/Lookup failed: 1/).waitFor();assert.deepEqual(calls,['a:apple','b:apple','unmatched:apple','b:apple','b:album']);
  fail=false;await page.reload();await section.getByRole('button',{name:'Auto-organize genres',exact:true}).click();
  await section.getByText(/^Finished:/).waitFor();assert.deepEqual(calls,['a:apple','b:apple','unmatched:apple','b:apple','b:album','b:album','unmatched:apple','unmatched:album']);
  await section.getByRole('button',{name:'Recheck automatic genres with Apple',exact:true}).click();
  await section.getByText(/^Finished: 2 changed, 1 already matched, 1 without/).waitFor();
  const saved=await page.evaluate(async()=>{
   const db=await new Promise(resolve=>{const r=indexedDB.open('record-cabinet-library:genres-test');r.onsuccess=()=>resolve(r.result);});
   const rows=await new Promise(resolve=>{const r=db.transaction('albums').objectStore('albums').getAll();r.onsuccess=()=>resolve(r.result);});db.close();return rows;
  });
  assert.deepEqual(saved.find(a=>a.title==='existing').genres,['Alternative']);assert.deepEqual(saved.find(a=>a.title==='lana').genres,['Alternative']);
  await section.getByText('Show album results (5)',{exact:true}).click();
  await section.getByText(/Electronic → Alternative/).waitFor();
  await section.getByText(/Manual choice kept: Uncategorized/).waitFor();assert.deepEqual(saved.find(a=>a.title==='b').genres,['Rock']);assert.deepEqual(saved.find(a=>a.title==='cleared').genres,[]);
  retry=true;await section.getByRole('button',{name:'Retry unmatched albums',exact:true}).click();await section.getByText(/^Finished:/).waitFor();
  await section.getByText(/Records without automatic genres: 0/).waitFor();
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await section.screenshot({path:'/private/tmp/rc-apple-first-'+(mobile?'mobile':'desktop')+'.png'});
  console.log('PASS '+(mobile?'mobile':'desktop')+': Apple first, fallback resume, repair automatic labels, manual protection, retry unmatched, no Spotify requests');await context.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
