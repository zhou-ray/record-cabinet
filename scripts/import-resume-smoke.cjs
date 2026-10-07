/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS browser test supports an external Playwright installation. */
// Run against a local server started with the same test-only session secret.
// All Spotify endpoints are intercepted; no real account is used.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createCipheriv, createHash, randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const secret = 'record-cabinet-offline-test-secret-only';
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:3100';
function session() {
 const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(secret).digest(),iv);
 const encrypted=Buffer.concat([cipher.update(JSON.stringify({value:{accountId:'test-account',accessToken:'mock',refreshToken:'mock',expiresAt:Date.now()+3600000,scope:'streaming'},until:Date.now()+3600000})),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {
 const context=await browser.newContext();
 await context.addCookies([{name:'rc_spotify',value:session(),url:origin,httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();
 await page.route('**/api/library/sync',route=>route.fulfill({status:503,json:{error:'Cloud disabled in this offline test'}}));
 await page.addInitScript(()=>{
  window.importBodies=[];
  const original=window.fetch.bind(window);
  window.fetch=async(input,init)=>{
   if(!String(input).startsWith('/api/spotify/library'))return original(input,init);
   const body=JSON.parse(init.body);window.importBodies.push(body);
   const n=window.importBodies.length;
   const record={id:'spotify:batch'+n,source:'spotify',title:'Album '+n,artist:'Artist',artists:[{id:'spotify:artist',name:'Artist'}],genres:[],genre:'Uncategorized',tracks:[],playback:{kind:'spotify',uri:'spotify:album:batch'+n},artworkUrl:null,year:'2026',color:'moss',note:'',catalogNumber:'',externalUrl:null};
   const checkpoint={source:'saved',pageUrl:'https://api.spotify.com/v1/me/albums?limit=50',index:n};
   const events=[{type:'progress',loaded:1,total:10,album:record,checkpoint},{type:'complete'}];
   // The first server stream never closes after complete. The next response
   // closes without a final newline, exercising both legal message endings.
   const payload=events.map(JSON.stringify).join('\n')+(n===1?'\n':'');
   return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(payload));if(n!==1)controller.close();}}),{headers:{'Content-Type':'application/x-ndjson'}});
  };
 });
 await page.goto(origin+'/settings');
 await page.getByRole('button',{name:'Import new albums',exact:true}).click();
 await page.getByText('Batch saved — continue when ready',{exact:false}).waitFor();
 // Simulate another tab saving a record and newer cursor after this page loaded.
 await page.evaluate(()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('record-cabinet-library:test-account',1);
  request.onsuccess=()=>{const db=request.result;const tx=db.transaction(['albums','settings'],'readwrite');
   const albums=tx.objectStore('albums');const original=albums.get('spotify:batch1');original.onsuccess=()=>albums.put({...original.result,id:'spotify:elsewhere',title:'Saved elsewhere',playback:{kind:'spotify',uri:'spotify:album:elsewhere'}});
   tx.objectStore('settings').put({saved:{source:'saved',pageUrl:'https://api.spotify.com/v1/me/albums?limit=50',index:7}},'checkpoints');
   tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
  };
 }));
 await page.getByRole('button',{name:'Continue import',exact:true}).click();
 await page.getByRole('button',{includeHidden:true,name:'Open All records, 2 records',exact:true}).waitFor({state:'attached'});
 await page.getByText('Batch saved — continue when ready',{exact:false}).waitFor();
 const calls=await page.evaluate(()=>window.importBodies);
 assert.equal(calls.length,2);assert.equal(calls[1].checkpoint.index,7);
 assert.ok(calls[1].knownAlbumIds.includes('spotify:batch1'));
 assert.ok(calls[1].knownAlbumIds.includes('spotify:elsewhere'),'Durable IDs include records not in this tab’s React state');
 await page.getByRole('button',{name:'Scan from beginning',exact:true}).click();
 await page.getByText('Batch saved — continue when ready',{exact:false}).waitFor();
 await page.waitForFunction(()=>window.importBodies.length===3);
 assert.equal(await page.evaluate(()=>window.importBodies[2].checkpoint),null);
 assert.equal((await page.evaluate(()=>window.importBodies[2].knownAlbumIds)).length,3);
 await page.getByRole('button',{includeHidden:true,name:'Open All records, 3 records',exact:true}).waitFor({state:'attached'});
 await page.reload();
 await page.getByRole('button',{includeHidden:true,name:'Open All records, 4 records',exact:true}).waitFor({state:'attached'});
 await page.getByText(/Saved position: resume at item 4/).waitFor();
 assert.equal(await page.evaluate(()=>window.importBodies.length),0);
 console.log('PASS: continue while completed stream stays open, terminal message without newline, checkpoint resume, fresh durable IDs/cursor from another tab, safe fresh scan, visible saved position, persisted records.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
