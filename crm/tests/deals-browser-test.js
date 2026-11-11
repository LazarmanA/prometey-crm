'use strict';
// Сделки: фильтры (ответственный, статус, период), видимость руководителя/менеджера/руководителя отдела,
// работа по http без crypto.randomUUID, метка версии у файлов страницы.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-deals-ui-'));
process.env.DATA_FILE=path.join(temp,'data.json');fs.copyFileSync(path.join(__dirname,'../storage/data.demo.json'),process.env.DATA_FILE);process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.UPLOADS_DIR=path.join(temp,'up');
const SHOTS=process.env.SHOTS;let checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
const server=require('../server');
(async()=>{let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 // ещё сделки разных менеджеров и дат
 const api=async(tok,p,method='GET',body)=>(await fetch(base+p,{method,headers:{authorization:'Bearer '+tok,'content-type':'application/json'},body:body&&JSON.stringify(body)})).json();
 const login=async (e,pw)=>(await (await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:e,password:pw})})).json()).token;
 const dir=await login('director@prometey.local','director');for(const t of [dir]){const r=await api(t,'/api/privacy');await api(t,'/api/privacy/accept','POST',{agree:true,version:r.version})}
 const st=server.store.read();const mgr=st.users.find(u=>u.email==='manager@prometey.local');const o1=st.orders.find(o=>o.id==='o1');
 const today=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
 const mk=async(name,start,end,status,managerId)=>{const r=await api(dir,'/api/orders','POST',{name,clientId:o1.clientId,objectId:o1.objectId,start:start+'T08:00',end:end+'T20:00',status,address:'Москва',equipmentType:'Кран',note:'—',ownership:'own'});if(managerId)await api(dir,'/api/orders/'+r.id,'PATCH',{managerId});return r};
 await mk('Сегодняшняя сделка руководителя',today,today,'working');await mk('Старая сделка менеджера','2025-01-10','2025-01-12','done',mgr.id);await mk('Отменённая','2025-02-01','2025-02-02','cancelled');
 browser=await chromium.launch({args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 // как на сервере по http: crypto.randomUUID недоступен
 await ctx.addInitScript(()=>{try{delete Crypto.prototype.randomUUID}catch{}try{localStorage.setItem('prometey_intro_seen','1')}catch{}});
 const page=await ctx.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERR',e.message)});
 const html=await (await fetch(base+'/')).text();ok(/<meta name="prometey-version" content="[\d.]+">/.test(html)&&/src="\/app\.js\?v=[\d.]+"/.test(html),'page files carry the version (no stale JS after an update)');
 await page.goto(base);await page.locator('#login-email').fill('director@prometey.local');await page.locator('#login-pass').fill('director');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('.nav').waitFor();
 if(await page.locator('#consent-agree').count()){await page.locator('#consent-agree').check();await page.locator('#consent-ok').click()}
 await page.locator('.nav [data-page="orders"]').click();await page.locator('.dl-table').waitFor();
 const rows=()=>page.locator('.dl-row-item').count();const total=await rows();
 ok(total>=5&&await page.locator('.dl-table th:has-text("Ответственный")').count()===1,'director sees all team deals with «Ответственный» column');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'d1-list.png')});
 await page.locator('#dl-owner').selectOption(mgr.id);await page.waitForFunction(n=>document.querySelectorAll('.dl-row-item').length<n,total);
 ok(await page.locator('.dl-row-item td:nth-child(4)').allInnerTexts().then(a=>a.every(x=>x.includes(mgr.name))),'filter by manager');
 await page.locator('#dl-owner').selectOption('all');await page.waitForFunction(n=>document.querySelectorAll('.dl-row-item').length===n,total);
 await page.locator('#dl-period').selectOption('today');await page.waitForFunction(()=>document.querySelectorAll('.dl-row-item').length>=1);
 ok((await page.locator('.dl-table').innerText()).includes('Сегодняшняя сделка')&&!(await page.locator('.dl-table').innerText()).includes('Старая сделка'),'period «Сегодня»');
 await page.locator('#dl-period').selectOption('custom');await page.locator('#dl-from').fill('2025-01-01');await page.locator('#dl-from').dispatchEvent('change');await page.locator('#dl-to').waitFor();await page.locator('#dl-to').fill('2025-01-31');await page.locator('#dl-to').dispatchEvent('change');
 await page.waitForFunction(()=>document.querySelectorAll('.dl-row-item').length===1);ok((await page.locator('.dl-table').innerText()).includes('Старая сделка'),'custom period (с — по)');
 await page.locator('#dl-reset').click();await page.waitForFunction(n=>document.querySelectorAll('.dl-row-item').length===n,total);
 await page.locator('[data-status="cancelled"]').click();await page.waitForFunction(()=>document.querySelectorAll('.dl-row-item').length===1);ok((await page.locator('.dl-table').innerText()).includes('Отменённая'),'status chips with counters');
 await page.locator('[data-status=""]').click();await page.locator('#dl-q').fill('СтройПроект');await page.waitForTimeout(800);ok(await rows()>=1,'search');
 // рабочий стол сделки — без crypto.randomUUID (чат сделки)
 await page.locator('#dl-reset').click();await page.waitForTimeout(300);await page.locator('.dl-row-item[data-open="o1"]').click();await page.locator('#ws-journal').waitFor();
 await page.waitForTimeout(800);ok(!errors.some(e=>/randomUUID/.test(e))&&!(await page.getByText('crypto.randomUUID is not a function').count()),'deal desk works over http (no crypto.randomUUID error)');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'d2-desk.png')});
 // менеджер: только свои
 const ctx2=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await ctx2.addInitScript(()=>{try{localStorage.setItem('prometey_intro_seen','1')}catch{}});const p2=await ctx2.newPage();p2.on('pageerror',e=>errors.push(e.message));
 await p2.goto(base);await p2.waitForLoadState('networkidle');await p2.locator('#login-email').fill('manager@prometey.local');await p2.locator('#login-pass').fill('manager');await p2.getByRole('button',{name:'Войти',exact:true}).click();await p2.locator('.nav, #consent-agree').first().waitFor();
 if(await p2.locator('#consent-agree').count()){await p2.locator('#consent-agree').check();await p2.locator('#consent-ok').click()}await p2.locator('.nav').waitFor();
 await p2.locator('.nav [data-page="orders"]').click();await p2.locator('.dl-table').waitFor();const mine=await p2.locator('.dl-row-item').count();
 ok(mine<total&&!(await p2.locator('.dl-table').innerText()).includes('Сегодняшняя сделка руководителя')&&!(await p2.locator('.dl-table th:has-text("Ответственный")').count()),'manager sees only own deals');
 // назначаем менеджера руководителем отдела — видит всех
 await api(dir,'/api/admin/departments','POST',{name:'Отдел продаж',headId:mgr.id});
 await p2.reload();await p2.locator('.nav').waitFor();await p2.locator('.nav [data-page="orders"]').click();await p2.locator('.dl-table').waitFor();
 ok(await p2.locator('.dl-row-item').count()===total&&(await p2.locator('.dl-table').innerText()).includes('Сегодняшняя сделка руководителя'),'department head sees all deals');
 // телефон
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{workspaceSelection=null;current='orders';renderApp()});await page.locator('.dl-table').waitFor();await page.waitForTimeout(200);
 ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'deals list fits a phone');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'d3-phone.png')});
 assert.deepEqual(errors,[]);ok(true,'no browser errors');
 console.log(`OK deals UI: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1;try{if(SHOTS){const pg=browser.contexts().flatMap(c=>c.pages()).pop();await pg.screenshot({path:path.join(SHOTS,'dfail.png')})}}catch{}}finally{try{await browser?.close()}catch{};server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
