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
  const page=await context.newPage(),errors=[],imports=[];
  let listingFailure=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/genres',r=>r.fulfill({json:{genres:['Pop'],source:'apple',checkedAt:Date.now()}}));
  await page.route('**/api/library/sync',r=>r.fulfill({status:503,json:{error:'Offline test'}}));
  await page.route('**/api/spotify/**',r=>{
   const url=new URL(r.request().url());
   if(url.pathname.endsWith('/account'))return r.fulfill({json:{accountId:'imports-test'}});
   assert.ok(url.pathname.endsWith('/library'));
   if(url.searchParams.has('list'))return listingFailure ? r.fulfill({status:503,json:{error:'Playlist refresh failed'}}) : r.fulfill({json:{playlists:[{id:'p',name:'Test playlist'},...Array.from({length:100},(_,i)=>({id:'extra'+i,name:'Extra '+i}))]}});
   const body=r.request().postDataJSON();
   if(body.previewPlaylist)return r.fulfill({json:{id:'p',name:'Test playlist',snapshotId:'v1',total:1,albums:[{id:'summary',title:'summary',artist:'Artist summary'}]}});
   assert.equal(body.confirmedSnapshot,'v1');imports.push(body);
   const unchanged=body.completedSnapshot==='v1';
   const events=unchanged?[{type:'progress',loaded:0,skipped:0,total:0,checkpoint:null,unchanged:true}]:[{type:'progress',loaded:1,skipped:0,total:1,checkpoint:null,album:record('summary')},{type:'progress',loaded:1,skipped:0,total:1,checkpoint:null,completedSnapshot:'v1'}];
   events.push({type:'complete',usage:{import:unchanged?1:3,metadata:0,search:0}});
   return r.fulfill({contentType:'application/x-ndjson',body:events.map(e=>JSON.stringify(e)).join('\n')+'\n'});
  });
  await page.goto(origin+'/settings');
  await page.getByRole('button',{name:'Load my playlists',exact:true}).click();
  await page.getByLabel('Import from').selectOption('playlist:extra99');
  listingFailure=true;
  await page.getByRole('button',{name:'Load my playlists',exact:true}).click();
  await page.getByText('Playlist refresh failed',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Import from').inputValue(),'playlist:extra99');
  assert.equal(await page.getByLabel('Import from').locator('option').count(),103);
  listingFailure=false;
  await page.getByLabel('Import from').selectOption('playlist:p');
  await page.getByRole('button',{name:'Import new albums',exact:true}).click();
  await page.getByRole('region',{name:'Confirm playlist import'}).waitFor();
  assert.equal(imports.length,0);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByLabel('Spotify playlist link').fill('https://open.spotify.com/playlist/p?si=share');
  await page.getByRole('button',{name:'Preview playlist link',exact:true}).click();
  await page.getByRole('button',{name:'Import this playlist',exact:true}).click();
  await page.getByText('This import used 3 Spotify API requests, including retries. This is usage, not your remaining Spotify allowance.').waitFor();
  assert.equal(imports[0].batchSize,100);
  await page.reload();await page.getByRole('button',{name:'Load my playlists',exact:true}).click();await page.getByLabel('Import from').selectOption('playlist:p');
  await page.getByRole('button',{name:'Import new albums',exact:true}).click();
  await page.getByRole('button',{name:'Import this playlist',exact:true}).click();
  await page.getByText(/Playlist unchanged/).waitFor();
  await page.getByText('This import used 1 Spotify API requests, including retries. This is usage, not your remaining Spotify allowance.').waitFor();
  assert.equal(imports[1].completedSnapshot,'v1');assert.deepEqual(imports[1].knownAlbumIds,['spotify:summary']);
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log('PASS '+(mobile?'mobile':'desktop')+': summaries saved, completion receipt survives reload, unchanged playlist and usage displayed');
  await context.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
