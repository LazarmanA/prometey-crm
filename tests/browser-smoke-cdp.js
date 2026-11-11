const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function chromePath(){
 const candidates=[process.env.PROMETEY_CHROME,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].filter(Boolean);
 const found=candidates.find(p=>fs.existsSync(p));if(found)return found;
 try{const p=require('playwright').chromium.executablePath();if(p&&fs.existsSync(p))return p}catch{}
 return '';
}
async function waitFor(fn,timeout=12000,step=100){const end=Date.now()+timeout;let last;while(Date.now()<end){try{const v=await fn();if(v)return v}catch(e){last=e}await sleep(step)}throw last||new Error('Timeout waiting for condition')}
class CDP{
 constructor(wsUrl){this.ws=new WebSocket(wsUrl);this.id=0;this.pending=new Map();this.events=[]}
 async open(){await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('CDP websocket timeout')),5000);this.ws.addEventListener('open',()=>{clearTimeout(t);resolve()},{once:true});this.ws.addEventListener('error',e=>{clearTimeout(t);reject(e)},{once:true})});this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.pending.has(m.id)){const {resolve,reject}=this.pending.get(m.id);this.pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result)}else this.events.push(m)});return this}
 call(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}))})}
 async eval(expression){const r=await this.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text||'Browser evaluation failed');return r.result?.value}
 close(){try{this.ws.close()}catch{}}
}
(async()=>{
 const chrome=chromePath();assert(chrome,'Chromium/Chrome not found. Set PROMETEY_CHROME.');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-browser-smoke-'));
 process.env.DATA_FILE=path.join(__dirname,'../storage/data.demo.json');
 process.env.DB_FILE=path.join(temp,'prometey.sqlite');
 process.env.DOCUMENTS_DIR=path.join(temp,'documents');
 process.env.RECORDINGS_DIR=path.join(temp,'recordings');
 process.env.NODE_ENV='test';
 const server=require('../server');
 let browser;let cdp;
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const base='http://127.0.0.1:'+server.address().port;
  // Port 0: Chrome picks a free port and writes it to DevToolsActivePort, so parallel/consecutive runs never attach to a stale browser.
  const profile=path.join(temp,'chrome-profile');
  browser=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--remote-allow-origins=*','--remote-debugging-port=0','--window-size=1400,1000',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  const debugPort=await waitFor(()=>{try{return Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])||0}catch{return 0}},10000);
  await waitFor(async()=>{try{return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok}catch{return false}},10000);
  const target=await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(base)}`,{method:'PUT'})).json();
  cdp=await new CDP(target.webSocketDebuggerUrl).open();await cdp.call('Runtime.enable');await cdp.call('Page.enable');await cdp.call('Log.enable');
  await cdp.call('Page.navigate',{url:base});
  await waitFor(()=>cdp.eval("!!document.querySelector('#login-email')"));
  {const shellText=await waitFor(()=>cdp.eval("document.body.innerText.includes('ПРОМЕТЕЙ')?'ok':''"),5000).catch(async()=>'missing: '+JSON.stringify(await cdp.eval('document.body.innerText.slice(0,300)')));assert.equal(shellText,'ok','Prometey shell not rendered')}
  await cdp.eval(`(()=>{const e=document.querySelector('#login-email'),p=document.querySelector('#login-pass');e.value='manager@prometey.local';e.dispatchEvent(new Event('input',{bubbles:true}));p.value='manager';p.dispatchEvent(new Event('input',{bubbles:true}));const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Войти');b.click();return true})()`);
  await waitFor(()=>cdp.eval("!!document.querySelector('.nav')"));
  const labels=['Компании','Сделки','Объекты','Техника','Финансы','Документы'];
  for(const label of labels){
   const ok=await cdp.eval(`(()=>{const b=[...document.querySelectorAll('.nav button')].find(x=>x.textContent.trim().endsWith(${JSON.stringify(label)}));if(!b)return false;b.click();return true})()`);assert(ok,'Navigation item missing: '+label);await sleep(120);const text=await cdp.eval("document.querySelector('#page')?.innerText||''");assert(text.trim().length>5,'Empty page after navigation: '+label)
  }
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(200);const overflow=await cdp.eval('document.documentElement.scrollWidth-innerWidth');assert(overflow<=4,'Mobile horizontal overflow: '+overflow+'px');
  const errors=cdp.events.filter(x=>x.method==='Runtime.exceptionThrown'||(x.method==='Log.entryAdded'&&x.params?.entry?.level==='error')).map(x=>x.params?.exceptionDetails?.text||x.params?.entry?.text||'browser error');assert.deepEqual(errors,[],'Browser errors: '+errors.join('; '));
  console.log('PASS browser smoke: login, main navigation, Companies, Deals, Objects, Equipment, Finance, Documents, mobile viewport, no JS errors');
 }finally{
  cdp?.close();if(browser&&browser.exitCode===null){const exited=new Promise(r=>browser.once('exit',r));browser.kill('SIGTERM');await Promise.race([exited,sleep(5000)])}server.closeIdleConnections?.();if(server.listening)await new Promise(r=>server.close(r));try{fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200})}catch{}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
