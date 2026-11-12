'use strict';
// UI «Лиды»: вкладки статусов, ручной лид, взять в работу, КП из лида, Победа → сделка (зелёный), массовые действия, очистка.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-leads-ui-'));
process.env.DB_FILE=path.join(temp,'db.sqlite');process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.UPLOADS_DIR=path.join(temp,'up');
const SHOTS=process.env.SHOTS;let checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
const server=require('../server');
(async()=>{let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const api=async(tok,p,method='GET',body)=>(await fetch(base+p,{method,headers:{authorization:'Bearer '+tok,'content-type':'application/json'},body:body&&JSON.stringify(body)})).json();
 const D=(await api('','/api/login','POST',{email:'director@prometey.local',password:'director'})).token;const pv=await api(D,'/api/privacy');if(pv.required)await api(D,'/api/privacy/accept','POST',{agree:true,version:pv.version});
 await api(D,'/api/leads','POST',{name:'Покупатель Авито',phone:'+7 911 000-00-01',source:'avito',ownerId:'',equipment:'Автокран 25 т'});
 await api(D,'/api/leads','POST',{name:'Заявка Директ',phone:'+7 911 000-00-02',source:'direct',ownerId:''});
 await api(D,'/api/leads','POST',{name:'Спам',phone:'+7 911 000-00-03',source:'direct',ownerId:''});
 browser=await chromium.launch({args:['--no-sandbox']});
 const page=await browser.newPage({reducedMotion:'reduce',viewport:{width:1500,height:950}});page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERR',e.message)});
 await page.addInitScript(()=>{try{localStorage.setItem('prometey_intro_seen','1')}catch{}});
 await page.goto(base);await page.waitForLoadState('networkidle');await page.locator('#login-email').fill('director@prometey.local');await page.locator('#login-pass').fill('director');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('.nav, #consent-agree').first().waitFor();
 if(await page.locator('#consent-agree').count()){await page.locator('#consent-agree').check();await page.locator('#consent-ok').click()}
 await page.locator('.nav [data-page="leads"]').click();await page.locator('.ld-tabs').waitFor();
 const tabs=await page.locator('.ld-tabs').innerText();ok(/Не обработан\s*3/.test(tabs)&&/В работе\s*0/.test(tabs)&&/Отправлено КП/.test(tabs)&&/Победа/.test(tabs)&&/Некачественные/.test(tabs),'status tabs with counts');
 // ручной лид
 await page.locator('#create-lead').click();await page.locator('#ld-name').fill('Сергей');await page.locator('#ld-phone').fill('+7 922 333-44-55');await page.locator('#ld-company').fill('ООО Котлован');await page.locator('#ld-equipment').fill('Экскаватор JCB 3CX');await page.locator('#ld-address').fill('Тверь, ул. Мира 5');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'l1-form.png')});
 await page.locator('.modal .save').click();await page.getByText('Сергей').waitFor();ok(/Не обработан\s*4/.test(await page.locator('.ld-tabs').innerText()),'manual lead added without a next action');
 // взять в работу
 const row=page.locator('.ld-row',{hasText:'Сергей'});await row.getByRole('button',{name:'Взять в работу'}).click();await page.waitForFunction(()=>/В работе\s*1/.test(document.querySelector('.ld-tabs').innerText));
 ok((await page.locator('.ld-row',{hasText:'Сергей'}).innerText()).includes('В работе'),'«Взять в работу» → status В работе');
 // некачественный через массовые действия
 await page.locator('.ld-row',{hasText:'Спам'}).locator('[data-ld-pick]').check();await page.locator('.ld-bulk').waitFor();ok((await page.locator('.ld-bulk').innerText()).includes('Выбрано: 1'),'bulk bar appears');
 await page.locator('[data-ldb="junk"]').click();await page.waitForFunction(()=>/Некачественные\s*1/.test(document.querySelector('.ld-tabs').innerText));ok(true,'bulk → «Некачественный» archive');
 // назначить ответственного массово
 await page.locator('.ld-row',{hasText:'Заявка Директ'}).locator('[data-ld-pick]').check();await page.locator('#ldb-owner').selectOption({index:1});await page.waitForFunction(()=>!document.querySelector('.ld-bulk'));
 ok(!(await page.locator('.ld-row',{hasText:'Заявка Директ'}).innerText()).includes('Не назначен'),'bulk assign owner');
 // КП из лида
 await page.locator('.ld-row',{hasText:'Сергей'}).getByRole('button',{name:'КП'}).click();await page.locator('#kp-client').waitFor();
 ok(await page.locator('#kp-client').inputValue()==='ООО Котлован'&&await page.locator('#kp-contact').inputValue()==='Сергей','КП editor prefilled from lead');
 await page.locator('.kp-row[data-n] [data-f="rate"]').first().fill('28000');await page.getByRole('button',{name:/Сохранить/}).first().click();await page.waitForFunction(()=>/КП-|^\d/.test(document.querySelector('.page-head h1').textContent)&&document.querySelector('.page-head h1').textContent!=='Новое КП');
 await page.locator('.nav [data-page="leads"]').click();await page.locator('.ld-tabs').waitFor();ok(/Отправлено КП\s*1/.test(await page.locator('.ld-tabs').innerText()),'lead moved to «Отправлено КП»');
 // карточка лида
 await page.locator('.ld-row',{hasText:'Сергей'}).locator('.ld-open').click();await page.locator('.ld-feed').waitFor();const card=await page.locator('.modal').innerText();ok(card.includes('Создано КП')&&card.includes('Лид добавлен вручную'),'lead card: history with КП');
 await page.locator('#ld-event-text').fill('Клиент согласен по цене');await page.locator('#ld-event-add').click();await page.getByText('Клиент согласен по цене').waitFor();ok(true,'comment added to the lead feed');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'l2-card.png')});
 // Победа → сделка
 await page.locator('[data-lda="win"]').click();await page.locator('#f-name').waitFor();ok((await page.locator('#modal-title').innerText())==='Новая сделка'&&(await page.locator('#f-client option:checked').innerText()).includes('Котлован'),'«Победа» opens the deal form with the new company');
 await page.locator('#f-object').selectOption({index:1});if(!(await page.locator('#f-own').inputValue()))await page.locator('#f-own').selectOption({index:1});
 await page.locator('.modal .save').click();await page.waitForFunction(()=>!document.querySelector('.modal'));
 await page.locator('.nav [data-page="leads"]').click();await page.locator('[data-ld-tab="won"]').click();await page.locator('.ld-row-won').first().waitFor();
 const won=page.locator('.ld-row-won',{hasText:'Сергей'});ok((await won.innerText()).includes('Сделка PR-'),'won lead linked to the deal');
 const bg=await page.locator('[data-ld-tab="won"]').evaluate(e=>getComputedStyle(e).backgroundColor);const badge=await won.locator('.ld-badge').evaluate(e=>getComputedStyle(e).backgroundColor);
 ok(bg==='rgb(22, 163, 74)'&&badge==='rgb(22, 163, 74)','«Победа» is green');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'l3-won.png')});
 // очистить все лиды
 await page.locator('#ld-clear').click();await page.locator('#ld-confirm').fill('удалить');await page.getByRole('button',{name:'Удалить все'}).click();await page.getByText('Лидов пока нет').waitFor();ok((await api(D,'/api/leads')).length===0,'admin cleared all leads');
 // мобильная ширина
 await page.setViewportSize({width:390,height:800});ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no horizontal overflow on phone');
 ok(!errors.length,'no page errors');
 console.log(`OK leads browser: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{try{await browser?.close()}catch{};server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
