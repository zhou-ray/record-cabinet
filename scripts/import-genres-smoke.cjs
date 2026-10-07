/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser regression. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {createCipheriv,createHash,randomBytes}=require('node:crypto');
const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:3126';
function cookie(accountId){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update('record-cabinet-offline-test-secret-only').digest(),iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify({value:{accountId,accessToken:'mock',refreshToken:'mock',expiresAt:Date.now()+3600000},until:Date.now()+3600000})),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');}
const record=(id,extra={})=>({id:'spotify:'+id,source:'spotify',title:id,artist:'Artist '+id,artists:[],year:'2026',genres:[],genre:'Uncategorized',color:'moss',note:'',catalogNumber:'',artworkUrl:null,externalUrl:null,tracks:[],playback:{kind:'spotify',uri:'spotify:album:'+id},...extra});
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:{width:mobile?390:1400,height:1000},isMobile:mobile,hasTouch:mobile});
  await context.addCookies([{name:'rc_spotify',value:cookie('imports-test'),url:origin,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage(),errors=[],calls=[];let imports=0,fail=true,holdRecheck=false,releaseRecheck;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/library/sync',r=>r.fulfill({status:503,json:{error:'Offline test'}}));
  await page.route('**/api/genres',async r=>{
   const q=r.request().postDataJSON();
   if(holdRecheck && q.title==='later')await new Promise(resolve=>{releaseRecheck=resolve;});
   calls.push(`${q.title}:${q.depth??q.mode}`);
   if(q.mode==='album'&&fail){fail=false;return r.fulfill({status:503,json:{error:'Genre lookup paused.'}});}
   const genres=q.title==='hard'?(q.mode==='album'?['Rock']:[]):['Pop'];
   return r.fulfill({json:{genres,source:genres.length?(q.mode==='album'?'album':'apple'):'none',checkedAt:Date.now()}});
  });
  await page.route('**/api/spotify/**',r=>{
   const url=new URL(r.request().url());
   if(url.pathname.endsWith('/account'))return r.fulfill({json:{accountId:'imports-test'}});
   assert.ok(url.pathname.endsWith('/library'));imports++;
   const records=imports===1?[record('aHard',{title:'hard'}),record('bEasy',{title:'easy'}),record('cManual',{title:'manual',genresEdited:true})]:[record('dLater',{title:'later'})];
   const events=records.map((album,i)=>({type:'progress',loaded:i+1,skipped:0,total:records.length,checkpoint:null,album}));
   events.push({type:'complete',usage:{import:1,metadata:0,search:0}});
   return r.fulfill({contentType:'application/x-ndjson',body:events.map(e=>JSON.stringify(e)).join('\n')+'\n'});
  });
  await page.goto(origin+'/settings');
  await page.getByText('Your first record · 1 of 3 steps complete',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Import new albums',exact:true}).click();
  await page.getByText(/Import complete · 3 new/).waitFor();
  const genres=page.getByRole('region',{name:'Genres',exact:true});
  await genres.getByText(/Genre lookup paused.*progress is saved/).waitFor();
  assert.equal(await genres.getByRole('button',{name:'Find missing genres',exact:true}).count(),1);
  assert.equal(await genres.getByRole('button',{name:'Retry unmatched albums',exact:true}).count(),0);
  assert.equal(await genres.getByRole('button',{name:'Recheck existing labels',exact:true}).isVisible(),false);
  assert.deepEqual(calls,['hard:quick','easy:quick','hard:deep','hard:album']);
  await genres.getByRole('button',{name:'Find missing genres',exact:true}).click();
  await genres.getByText(/^Finished:/).waitFor();
  assert.deepEqual(calls,['hard:quick','easy:quick','hard:deep','hard:album','hard:album']);
  const snapshot=await page.evaluate(async()=>{
   const db=await new Promise(resolve=>{const r=indexedDB.open('record-cabinet-library:imports-test');r.onsuccess=()=>resolve(r.result);});
   const tx=db.transaction(['albums','settings']);const records=tx.objectStore('albums').getAll(),queue=tx.objectStore('settings').get('genre-import-queue');
   return new Promise(resolve=>{tx.oncomplete=()=>{db.close();resolve({records:records.result,queue:queue.result});};});
  });
  assert.deepEqual(snapshot.records.map(a=>a.genres),[['Rock'],['Pop'],[]]);assert.deepEqual(snapshot.queue,[]);
  const checkbox=genres.getByRole('checkbox',{name:'Automatically sort genres after importing'});
  await checkbox.uncheck();
  await page.getByRole('button',{name:'Import new albums',exact:true}).click();await page.getByText(/Import complete · 1 new/).waitFor();
  await page.reload();await checkbox.waitFor();assert.equal(await checkbox.isChecked(),false);
  await page.waitForTimeout(500);assert.equal(calls.length,5);
  await checkbox.check();await genres.getByText(/^Finished:/).waitFor();
  assert.equal(calls.at(-1),'later:quick');assert.equal(imports,2);assert.deepEqual(errors,[]);
  await page.getByText('Spotify requests · 2 today',{exact:true}).waitFor();
  await page.getByText('Spotify requests · 2 today',{exact:true}).click();
  assert.equal(await page.locator('.usage-table tbody tr').first().locator('td').first().textContent(),'2');
  await genres.getByRole('button',{name:'Review & edit',exact:true}).click();
  await genres.getByLabel('Show genres',{exact:true}).selectOption('automatic');
  await genres.getByLabel('Find a record',{exact:true}).fill('later');
  const review=genres.locator('.genre-review');
  await review.getByText('Pop · Apple catalog',{exact:true}).waitFor();
  const before=calls.length;
  holdRecheck=true;
  await review.getByRole('button',{name:'Recheck this album',exact:true}).click();
  await genres.getByRole('button',{name:'Pause genre sorting',exact:true}).waitFor();
  await review.getByRole('button',{name:'Set genre',exact:true}).click();
  const form=review.getByRole('form',{name:'Genres for later',exact:true});
  await form.getByRole('button',{name:'Pop',exact:true}).click();
  await form.getByRole('button',{name:'Jazz',exact:true}).click();
  await form.getByRole('button',{name:'Save genres',exact:true}).click();
  // The record leaves the automatic-label filter after a manual correction.
  await genres.getByLabel('Show genres',{exact:true}).selectOption('manual');
  await review.getByText('Jazz · Manual choice',{exact:true}).waitFor();
  assert.equal(typeof releaseRecheck,'function');releaseRecheck();holdRecheck=false;
  await genres.getByRole('button',{name:'Pause genre sorting',exact:true}).waitFor({state:'detached'});
  await review.getByText('Jazz · Manual choice',{exact:true}).waitFor();
  assert.equal(calls.length,before+1);assert.ok(calls.at(-1).startsWith('later:'));
  await genres.getByLabel('Show genres',{exact:true}).selectOption('manual');
  await genres.getByLabel('Find a record',{exact:true}).fill('manual');
  await review.getByText('Uncategorized · Manual choice',{exact:true}).waitFor();
  assert.equal(await review.getByRole('button',{name:'Retry this album',exact:true}).count(),0);

  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log('PASS '+(mobile?'mobile':'desktop')+': automatic two-pass import, easy matches before deep lookup, independent import success, reload resume, manual protection, persistent pause');
  await context.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
