/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser test. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  for(const mobile of [false,true]){
   const page=await browser.newPage({viewport:{width:mobile?390:1400,height:1000},isMobile:mobile,hasTouch:mobile});
   const calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
   const album={id:'spotify:abc',source:'spotify',title:'Kind of Blue',artist:'Miles Davis',artists:[],year:'1959',genres:[],genre:'Uncategorized',color:'moss',note:'',catalogNumber:'',artworkUrl:null,externalUrl:null,playback:{kind:'spotify',uri:'spotify:album:abc'},tracks:[{id:'spotify:track1',title:'So What',duration:540,number:1,disc:1}]};
   await page.route('**/api/spotify/**',route=>{
    if(route.request().url().endsWith('/account'))return route.fulfill({json:{accountId:'guest'}});
    const body=route.request().postDataJSON();calls.push(body);
    if(body.search)return route.fulfill({json:{results:body.search==='empty'?[]:[{id:'abc',title:album.title,artist:album.artist,year:'1959',tracks:5,artworkUrl:null}]}});
    assert.equal(body.albumLink,'spotify:album:abc');
    return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'progress',album})+'\n'+JSON.stringify({type:'complete'})+'\n'});
   });
   await page.goto((process.env.TEST_ORIGIN||'http://127.0.0.1:3125')+'/settings');
   await page.getByRole('button',{name:'Add album',exact:true}).click();
   await page.getByLabel('Album or artist',{exact:true}).fill('Miles Davis');
   assert.equal(calls.length,0);
   await page.getByRole('button',{name:'Search Spotify',exact:true}).click();
   await page.getByRole('button',{name:'Add Kind of Blue',exact:true}).waitFor();
   assert.equal(calls.length,1);
   await page.getByRole('button',{name:'Search Spotify',exact:true}).click();
   await page.getByRole('button',{name:'Add Kind of Blue',exact:true}).waitFor();
   assert.equal(calls.length,1,'Repeated search uses local results');
   await page.getByRole('button',{name:'Add Kind of Blue',exact:true}).click();
   await page.getByText('Added Kind of Blue from Spotify. Put the record on to listen.',{exact:true}).waitFor();
   assert.equal(calls.length,2);
   await page.getByRole('button',{name:'Add album',exact:true}).click();
   await page.getByLabel('Album or artist',{exact:true}).fill('Miles Davis');
   await page.getByRole('button',{name:'Search Spotify',exact:true}).click();
   await page.getByRole('button',{name:'Kind of Blue is already in your collection',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Kind of Blue is already in your collection',exact:true}).isDisabled(),true);
   await page.getByLabel('Album or artist',{exact:true}).fill('empty');
   await page.getByRole('button',{name:'Search Spotify',exact:true}).click();
   await page.getByText('No albums found. Try another album or artist name.',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.deepEqual(errors,[]);
   console.log('PASS '+(mobile?'mobile':'desktop')+': explicit search, cached results, full album add, duplicate protection, empty results');
   await page.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
