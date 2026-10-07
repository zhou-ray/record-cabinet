/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser regression. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {createCipheriv,createHash,randomBytes}=require('node:crypto');
const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:3129';
function cookie(accountId){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update('record-cabinet-offline-test-secret-only').digest(),iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify({value:{accountId,accessToken:'mock',refreshToken:'mock',expiresAt:Date.now()+3600000},until:Date.now()+3600000})),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');}
const record=(id,extra={})=>({id:'spotify:'+id,source:'spotify',title:id,artist:'Artist '+id,artists:[],year:'2026',genres:[],genre:'Uncategorized',color:'moss',note:'',catalogNumber:'',artworkUrl:null,externalUrl:null,tracks:[],playback:{kind:'spotify',uri:'spotify:album:'+id},...extra});
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try { for(const mobile of [false,true]) {
  const context=await browser.newContext({viewport:{width:mobile?390:1400,height:1000},isMobile:mobile,hasTouch:mobile});
  await context.addCookies([{name:'rc_spotify',value:cookie('genres-test'),url:origin,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/spotify/**',r=>r.fulfill({json:{accountId:'genres-test'}}));
  await page.route('**/api/library/sync',r=>r.fulfill({status:503,json:{error:'Mock sync'}}));
  await page.goto(origin+'/settings');
  await page.getByRole('heading',{name:'Automatic genres',exact:true}).waitFor();
  const records=Array.from({length:26},(_,i)=>record('genre'+i,{title:String.fromCharCode(65+i)+' title',artist:'Same artist',artists:[{id:'same',name:'Same artist'}]}));records.push(record('unknown',{title:'Apple',artist:'Same artist',artists:[{id:'same',name:'Same artist'}]}));
  for (const [i,title] of ['Écho','Øresund','Łódź','東京','ひかり','Жизнь','Ωδή','أغاني','한글'].entries()) records.push(record('international'+i,{title,artist:'Same artist',artists:[{id:'same',name:'Same artist'}]}));
  await page.evaluate(async records=>{
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('record-cabinet-library:genres-test',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   await new Promise(resolve=>{const tx=db.transaction('albums','readwrite');records.forEach(a=>tx.objectStore('albums').put(a));tx.oncomplete=resolve;});db.close();
  },records);
  await page.goto(origin);
  await page.getByText(/36 records ·/).waitFor();
  await page.getByText(/36 records · 1 bins/).waitFor();
  await page.getByRole('button',{name:'Album',exact:true}).click();
  await page.getByText(/36 records · 17 bins/).waitFor();
  await page.reload();await page.getByText(/36 records · 17 bins/).waitFor();
  assert.equal(await page.getByRole('button',{name:'Album',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:/^Open A(?:–[A-Z])?,/}).click();
  await page.getByRole('heading',{name:/^A(?:–[A-Z])?$/}).waitFor();
  await page.getByRole('button',{name:'Back to shelf',exact:false}).click();
  await page.getByRole('button',{name:'Artist',exact:true}).click();await page.getByText(/36 records · 1 bins/).waitFor();
  await page.getByRole('button',{name:'Album',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  for(const label of ['漢字 / かな','Cyrillic','Greek','Arabic','Korean']) assert.equal(await page.getByRole('button',{name:new RegExp('^Open '+label+',')}).count(),1);
  await page.screenshot({path:'/private/tmp/rc-album-bins-'+(mobile?'mobile':'desktop')+'.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS '+(mobile?'mobile':'desktop')+': album title bins, whole-letter balancing, reload persistence, opening album bin, artist unchanged');
  await context.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
