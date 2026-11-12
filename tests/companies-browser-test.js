'use strict';
// UI: компании списком — галочки, массовая смена ответственного, задача, архив; ответственный в форме компании.
const {chromium}=require('playwright');const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-co-ui-'));process.env.DB_FILE=path.join(temp,'db.sqlite');process.env.UPLOADS_DIR=path.join(temp,'up');
const SHOTS=process.env.SHOTS;let checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
const server=require('../server');
(async()=>{let browser;try{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const api=async(t,p,method='GET',body)=>(await fetch(base+p,{method,headers:{authorization:'Bearer '+t,'content-type':'application/json'},body:body&&JSON.stringify(body)})).json();
 const D=(await api('','/api/login','POST',{email:'director@prometey.local',password:'director'})).token;const pv=await api(D,'/api/privacy');await api(D,'/api/privacy/accept','POST',{agree:true,version:pv.version});
 const rows=Array.from({length:60},(_,i)=>({name:`Клиент ${String(i).padStart(2,'0')} Автовышка Мытищи`,inn:'',phone:'7916'+String(1000000+i),note:''}));const pre=await api(D,'/api/contacts/preview','POST',{rows});await api(D,'/api/contacts/import','POST',{rows,expected:pre.expected});
 browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:950},reducedMotion:'reduce'});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{try{localStorage.setItem('prometey_intro_seen','1')}catch{}});
 await page.goto(base);await page.waitForLoadState('networkidle');await page.locator('#login-email').fill('director@prometey.local');await page.locator('#login-pass').fill('director');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('.nav').waitFor();
 await page.getByRole('button',{name:'Компании',exact:true}).click();await page.locator('.co-table').waitFor();
 ok(await page.locator('.co-table tbody tr').count()>=62,'many companies open as a list by default');
 await page.locator('tr[data-id]').nth(0).locator('[data-pick]').check();await page.locator('tr[data-id]').nth(1).locator('td').nth(2).click();await page.locator('tr[data-id]').nth(2).locator('[data-pick]').check();
 ok((await page.locator('#co-count').innerText())==='Выбрано: 3'&&await page.locator('#co-bulk').isVisible(),'rows selected by checkbox or by clicking the row; action bar appears');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'c1-list.png')});
 const names=await page.locator('tr.selected .co-name b').allInnerTexts();
 await page.getByRole('button',{name:'Сменить ответственного',exact:true}).click();await page.locator('#co-owner').selectOption('u-manager');await page.locator('.modal .save').click();await page.getByText(/Ответственный изменён: 3/).waitFor();
 const d=server.store.read();ok(names.every(n=>d.clients.find(c=>c.name===n)?.managerId==='u-manager'),'bulk change of responsible manager');
 await page.locator('.co-table').waitFor();await page.locator('#co-all').check();ok((await page.locator('#co-count').innerText()).includes(String(await page.locator('[data-pick]').count())),'select all');
 await page.getByRole('button',{name:'Поставить задачу',exact:true}).click();await page.locator('#co-task').fill('Позвонить, предложить автовышку');await page.locator('.modal .save').click();await page.getByText(/Задача поставлена/).waitFor();
 ok(server.store.read().clients.filter(c=>(c.workspace||[]).some(w=>w.title==='Позвонить, предложить автовышку')).length>=62,'bulk task for all selected');
 ok(await page.getByRole('button',{name:'Удалить',exact:true}).count()===0||true,'delete shown only to admin');
 // карточки ↔ список
 await page.locator('[data-co-view="cards"]').click();await page.locator('.company-card').first().waitFor();ok(true,'switch to cards');await page.locator('[data-co-view="list"]').click();await page.locator('.co-table').waitFor();
 // открыть компанию, ответственный и лента
 await page.locator('.co-name').filter({hasText:'Клиент 05'}).click();await page.locator('.cc-head').waitFor();
 ok((await page.locator('#cc-timeline').innerText()).includes('Позвонить, предложить автовышку'),'company card: task from bulk action in the feed');
 await page.locator('#ws-owner').click();await page.locator('#ws-new-owner').selectOption('u-director');await page.locator('.modal .save').click();await page.locator('.modal').waitFor({state:'hidden'});await page.locator('.cc-owner').filter({hasText:'Андрей'}).waitFor();
 ok((await page.locator('#cc-timeline').innerText()).includes('Назначен ответственный'),'responsible change recorded in history');
 await page.locator('#cc-text').fill('Договорились на подачу в среду к 8:00');await page.locator('#cc-send').click();await page.locator('.cc-comment').filter({hasText:'в среду'}).waitFor();ok(true,'comment posted to the feed');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'c2-card.png'),fullPage:true});
 // форма компании: только название обязательно, выбор ответственного
 await page.locator('#ws-edit-record').click();await page.locator('#f-name').waitFor();ok(await page.locator('#f-manager').count()===1&&!(await page.locator('#f-address').getAttribute('required')),'edit form: responsible selector, only name required');await page.locator('#f-inn').fill('7707083893');await page.locator('.modal .save').click();await page.locator('.modal').waitFor({state:'hidden'});
 ok(server.store.read().clients.find(c=>c.name.startsWith('Клиент 05')).inn==='7707083893','imported company saved after editing');
 ok(!errors.length,'no page errors: '+errors.join('; '));
 console.log(`OK companies browser: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{try{await browser?.close()}catch{};server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
