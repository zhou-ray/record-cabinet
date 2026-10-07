/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser regression. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {createCipheriv,createHash,randomBytes}=require('node:crypto');
const assert=require('node:assert/strict');
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:3109';
const empty=()=>({albums:[],organization:{systems:[],systemId:'',arrangement:'artist'}});
const record=id=>({id:`spotify:${id}`,source:'spotify',title:`Record ${id}`,artist:'Artist',artists:[],year:'2026',genres:[],genre:'Uncategorized',color:'moss',note:'',catalogNumber:'',artworkUrl:null,externalUrl:null,playback:{kind:'spotify',uri:`spotify:album:${id}`},tracks:[]});
function cookie(accountId){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update('record-cabinet-offline-test-secret-only').digest(),iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify({value:{accountId,accessToken:'mock',refreshToken:'mock',expiresAt:Date.now()+3600000},until:Date.now()+3600000})),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');}
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const clouds=new Map();const errors=[];
 async function device(id,mobile=false){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1400,height:1000}});
  await context.addCookies([{name:'rc_spotify',value:cookie(id),url:origin,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  let fail=false,conflict=false,stall=false;
  await page.route('https://**/*spotify*',r=>r.abort());
  await page.route('**/api/spotify/**',r=>{assert.ok(r.request().url().endsWith('/account'),'Sync must not call Spotify');return r.fulfill({json:{accountId:id}});});
  await page.route('**/api/library/sync',r=>{
   if(stall)return;
   if(fail)return r.fulfill({status:503,json:{error:'Cloud temporarily unavailable'}});
   let cloud=clouds.get(id)||{revision:0,enabled:true,library:empty()};
   const method=r.request().method();assert.equal(r.request().headers()['x-record-cabinet-account'],id);
   if(method==='DELETE'){cloud={revision:cloud.revision+1,enabled:false,library:empty()};clouds.set(id,cloud);return r.fulfill({json:{enabled:false}});}
   if(method==='POST'){cloud={...cloud,revision:cloud.revision+1,enabled:true};clouds.set(id,cloud);return r.fulfill({json:{enabled:true}});}
   if(method==='PUT'){
    const body=r.request().postDataJSON();
    if(conflict){conflict=false;cloud={...cloud,revision:cloud.revision+1,library:{...cloud.library,albums:[...cloud.library.albums,record('concurrent')]}};clouds.set(id,cloud);return r.fulfill({status:412,json:{error:'Conflict'}});}
    if(body.revision!==cloud.revision||!cloud.enabled)return r.fulfill({status:412,json:{error:'Conflict'}});
    cloud={revision:cloud.revision+1,enabled:true,library:body.library};clouds.set(id,cloud);
   }
   return r.fulfill({json:cloud});
  });
  await page.goto(origin+'/settings');await page.getByRole('button',{name:'Import new albums',exact:true}).waitFor();
  const syncPanel=page.locator('details').filter({has:page.locator('summary').filter({hasText:/^Library sync/})}).first();
  await syncPanel.locator('summary').click();
  async function sync(){await syncPanel.getByRole('button',{name:'Sync now',exact:true}).click();await syncPanel.getByRole('button',{name:'Sync now',exact:true}).waitFor();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Sync now')?.disabled);}
  async function restore(id){
   const backup=page.getByText('Collection backup',{exact:true});
   if(!await backup.evaluate(el=>el.parentElement.open))await backup.click();
   const data={format:'record-cabinet',version:1,albums:[record(id)],organization:{systems:[{id:'system',name:'Room',bins:[{id:'bin',label:'Favorites'}],assignments:{[`spotify:${id}`]:'bin'}}],systemId:'system',arrangement:'custom'}};
   await page.getByLabel('Restore backup',{exact:true}).setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
   await page.getByRole('button',{name:'Add backup to collection'}).click();
   await page.getByText('Backup restored. Existing records and bins were kept.').waitFor();
   await sync();
  }
  return {page,context,sync,restore,syncPanel,fail:value=>fail=value,stall:value=>stall=value,conflict:()=>conflict=true};
 }
 try{
  const web=await device('sync-owner');web.conflict();await web.restore('desktop');
  assert.deepEqual(clouds.get('sync-owner').library.albums.map(a=>a.id).sort(),['spotify:concurrent','spotify:desktop']);
  const phone=await device('sync-owner',true);await phone.sync();
  await phone.page.getByRole('button',{includeHidden:true,name:'Open All records, 2 records',exact:true}).waitFor({state:'attached'});
  await phone.page.getByRole('button',{includeHidden:true,name:/Open Favorites/}).waitFor({state:'attached'});
  await phone.restore('phone');await web.sync();
  await web.page.getByRole('button',{includeHidden:true,name:'Open All records, 3 records',exact:true}).waitFor({state:'attached'});
  const other=await device('different-owner');await other.sync();
  assert.equal(await other.page.getByRole('button',{includeHidden:true,name:'Open All records, 0 records',exact:true}).count(),1);
  await phone.context.setOffline(true);await phone.sync();
  await phone.syncPanel.getByText(/You’re offline/).waitFor();
  await phone.context.setOffline(false);await phone.sync();
  phone.stall(true);await phone.sync();
  await phone.syncPanel.getByText(/Your records remain on this device/).waitFor();
  phone.stall(false);await phone.sync();
  await phone.syncPanel.getByText(/Library synced ·/).waitFor();
  phone.fail(true);await phone.sync();await phone.syncPanel.getByText(/Cloud temporarily unavailable/).waitFor();
  await phone.page.reload();await phone.page.getByRole('button',{includeHidden:true,name:'Open All records, 3 records',exact:true}).waitFor({state:'attached'});phone.fail(false);
  await web.syncPanel.getByRole('button',{name:'Delete cloud library',exact:true}).click();await web.syncPanel.getByRole('button',{name:'Delete cloud copy and pause sync',exact:true}).click();
  await web.syncPanel.getByRole('button',{name:'Enable library sync',exact:true}).waitFor();
  await phone.syncPanel.locator('summary').click();await phone.sync();await phone.syncPanel.getByRole('button',{name:'Enable library sync',exact:true}).waitFor();
  assert.equal(clouds.get('sync-owner').library.albums.length,0);assert.equal(clouds.get('sync-owner').enabled,false);
  await phone.page.getByRole('button',{includeHidden:true,name:'Open All records, 3 records',exact:true}).waitFor({state:'attached'});
  assert.deepEqual(errors,[]);
  console.log('PASS: desktop/mobile union, bins, conflict retry, separate accounts, offline reload, cloud deletion pauses stale devices; zero Spotify calls.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
