/* eslint-disable @typescript-eslint/no-require-imports -- Isolated real IndexedDB check. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'), path=require('node:path'), ts=require('typescript');
const sources={};
function compile(file){
 if(sources[file])return;
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 sources[file]={code,deps:{}};
 for(const [,name] of code.matchAll(/require\("([^"]+)"\)/g)){
  if(!name.startsWith('.'))throw Error('Unexpected dependency '+name);
  const target=path.normalize(path.join(path.dirname(file),name+'.ts'));
  sources[file].deps[name]=target;compile(target);
 }
}
compile('app/lib/library-storage.ts');
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
 const context=await browser.newContext();
 await context.route('http://membership.test/**',route=>route.fulfill({contentType:'text/html',body:'<title>Membership test</title>'}));
 await context.addInitScript(sources=>{
  const cache={};const load=file=>{if(cache[file])return cache[file].exports;const mod={exports:{}};cache[file]=mod;
   new Function('require','module','exports',sources[file].code)(name=>load(sources[file].deps[name]),mod,mod.exports);return mod.exports;};
  window.membershipStorage=load('app/lib/library-storage.ts').createLibraryStorage;
 },sources);
 const page=await context.newPage();await page.goto('http://membership.test');
 await page.evaluate(async()=>{
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const a='a'.repeat(64),b='b'.repeat(64),store=window.membershipStorage(a),other=window.membershipStorage(b);
  const batch=(accountId,saved,checkedAt)=>({accountId,records:[{albumId:'spotify:a',saved,checkedAt,source:'spotify-library-contains'}]});
  await store.saveAlbum({id:'spotify:a',title:'Kept',source:'spotify',genres:[],playback:{kind:'spotify',uri:'spotify:album:a'},tracks:[]});
  const before=JSON.stringify(await store.load());
  const writer=await store.membershipWriter(), otherWriter=await other.membershipWriter();
  await writer.save(batch(a,true,100));await otherWriter.save(batch(b,true,100));
  await Promise.all([writer.save(batch(a,false,300)),(await window.membershipStorage(a).membershipWriter()).save(batch(a,true,200))]);
  check((await store.loadMembership())[0].saved===false,'late response must not restore eligibility');
  check((await other.loadMembership())[0].saved===true,'accounts isolated');
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,key){if(key==='saved-membership')throw Error('Injected failure');return put.call(this,value,key);};
  let rejected=false;try{await writer.save(batch(a,true,400));}catch{rejected=true;}finally{IDBObjectStore.prototype.put=put;}
  check(rejected,'save failure reported');check((await store.loadMembership())[0].checkedAt===300,'failed write rolled back');
  check(JSON.stringify(await store.load())===before,'albums unchanged');
 });
 await page.reload();
 await page.evaluate(async()=>{
  const a=window.membershipStorage('a'.repeat(64)),b=window.membershipStorage('b'.repeat(64));
  if((await a.loadMembership())[0].saved!==false)throw Error('reload lost membership');
  const oldWriter=await a.membershipWriter();
  await a.clear();
  let rejected=false;try{await oldWriter.save({accountId:'a'.repeat(64),records:[{albumId:'spotify:a',saved:true,checkedAt:500,source:'spotify-library-contains'}]});}catch{rejected=true;}
  if(!rejected)throw Error('old writer repopulated cleared membership');
  if((await a.loadMembership()).length)throw Error('account clear left membership');
  if((await b.loadMembership()).length!==1)throw Error('other account cleared');
 });
 console.log('PASS: real IndexedDB persistence, concurrent stale writes, rollback, account isolation, unchanged albums and scoped deletion');
 await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
