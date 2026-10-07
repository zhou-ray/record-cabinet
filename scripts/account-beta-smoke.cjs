/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser regression. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createCipheriv, createHash, randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:3100';
function session(accountId) {
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update('record-cabinet-offline-test-secret-only').digest(),iv);
 const data=Buffer.concat([cipher.update(JSON.stringify({value:{accountId,accessToken:'mock',refreshToken:'mock',expiresAt:Date.now()+3600000,scope:'streaming'},until:Date.now()+3600000})),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');
}
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const login=async id=>context.addCookies([{name:'rc_spotify',value:session(id),url:origin,httpOnly:true,sameSite:'Lax'}]);
  await login('beta-a');
  await context.route('**/api/library/sync',route=>route.fulfill({status:503,json:{error:'Cloud disabled in this offline test'}}));
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**/*',route=>route.abort());
  await page.goto(origin+'/settings');await page.getByRole('button',{name:'Import new albums',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Batch size').inputValue(),'5');
  await page.evaluate(async()=>{
   for(const id of ['beta-a','beta-b'])await new Promise((resolve,reject)=>{
    const req=indexedDB.open('record-cabinet-library:'+id,1);
    req.onupgradeneeded=()=>{req.result.createObjectStore('albums',{keyPath:'id'});req.result.createObjectStore('settings');};
    req.onsuccess=()=>{const db=req.result;const tx=db.transaction(['albums','settings'],'readwrite');
     tx.objectStore('albums').put({id:'spotify:'+id,source:'spotify',title:id,artist:'Beta artist',artists:[],year:'2026',genre:'Uncategorized',genres:[],color:'moss',note:'',catalogNumber:'',artworkUrl:null,externalUrl:null,playback:{kind:'spotify',uri:'spotify:album:example'},tracks:[]});
     tx.objectStore('settings').put({liked:{source:'liked',pageUrl:'https://api.spotify.com/v1/me/tracks?limit=50',index:7}},'checkpoints');
     tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
    };
   });
   localStorage.setItem('record-cabinet-systems:beta-a',JSON.stringify({systems:[{id:'a',name:'Only A',bins:[{id:'a',label:'Private A'}],assignments:{}}],systemId:'a',arrangement:'custom'}));
  });
  await page.reload();await page.getByRole('link',{name:'← Back to records',exact:true}).click();await page.getByRole('button',{name:'Open All records, 1 record',exact:true}).waitFor();
  const other=await context.newPage();await other.goto(origin);
  await login('beta-b');
  const stale=await page.evaluate(async()=>{const r=await fetch('/api/spotify/library',{method:'POST',headers:{'Content-Type':'application/json','x-record-cabinet-account':'beta-a'},body:JSON.stringify({knownAlbumIds:[],batchSize:5})});return r.status;});
  assert.equal(stale,409,'Stale account cannot import using another account cookie');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByRole('button',{name:'Reload collection'}).waitFor();
  await page.getByRole('button',{name:'Reload collection'}).click();
  await page.getByRole('button',{name:'Open All records, 1 record',exact:true}).waitFor();
  await page.getByRole('button',{name:'Open All records, 1 record',exact:true}).click();
  await page.getByRole('button',{name:/Show back cover and tracks of beta-b/}).waitFor();
  assert.equal(await page.getByRole('button',{name:/Show back cover and tracks of beta-a/}).count(),0);
  await page.getByRole('link',{name:'Library & settings',exact:true}).click();
  await page.getByText('Account and privacy',{exact:true}).click();
  await page.getByRole('button',{name:'Disconnect and remove local data',exact:true}).click();
  await page.getByRole('button',{name:'Remove data and disconnect',exact:true}).click();
  await page.getByRole('link',{name:'Connect Spotify ↗',exact:true}).waitFor();
  const sizes=await page.evaluate(async()=>{const result={};for(const id of ['beta-a','beta-b'])result[id]=await new Promise(resolve=>{const req=indexedDB.open('record-cabinet-library:'+id,1);req.onsuccess=()=>{const db=req.result;const read=db.transaction('albums').objectStore('albums').getAll();read.onsuccess=()=>{resolve(read.result.length);db.close();};};});return result;});
  assert.deepEqual(sizes,{'beta-a':1,'beta-b':0});
  await login('beta-a');await page.reload();await page.getByRole('link',{name:'← Back to records',exact:true}).click();await page.getByRole('button',{name:'Open All records, 1 record',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: five-album default; two-account isolation; stale-tab API rejection; mobile reload; scoped deletion; original account preserved. No Spotify requests.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
