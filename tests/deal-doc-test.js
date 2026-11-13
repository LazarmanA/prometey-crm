'use strict';
// Сделка как заказ 1С: шапка, вкладки Машины / Смены / Документы, таблица смен со всеми колонками, копирование строки, скан и оригинал.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-dealdoc-'));
process.env.DB_FILE=path.join(temp,'db.sqlite');process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.UPLOADS_DIR=path.join(temp,'up');
const SHOTS=process.env.SHOTS;let checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
const server=require('../server');
(async()=>{let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const req=async(tok,p,method='GET',body)=>{const r=await fetch(base+p,{method,headers:{authorization:'Bearer '+tok,'content-type':'application/json'},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json()}};
 const login=async(e,p)=>{const t=(await req('','/api/login','POST',{email:e,password:p})).body.token;const pv=(await req(t,'/api/privacy')).body;if(pv.required)await req(t,'/api/privacy/accept','POST',{agree:true,version:pv.version});return t};
 const D=await login('director@prometey.local','director');
 const order=(await req(D,'/api/orders','POST',{name:'Самосвалы — Капитал-Строй',clientId:'c1',objectId:'obj1',start:'2026-11-11T08:00',end:'2026-11-30T20:00',status:'working',address:'Наро-Фоминский городской округ',equipmentType:'Самосвал 20 м³',ownership:'rented',note:'Вывоз грунта'})).body;ok(order.id&&order.paymentForm==='cashless','new deal: payment form defaults to «Безнал»');
 await req(D,'/api/order-items','POST',{orderId:order.id,equipmentId:'e4',unit:'hour',quantity:24,saleRate:3300,partnerId:'p1',purchaseRate:2900});
 const J='/api/deals/'+order.id+'/journal';
 const a=await req(D,J,'POST',{date:'2026-11-11',equipmentId:'e4',quantity:8,driver:'Иванов И.И.',driverRate:500,driverHours:8,attachment:'Нет'});ok(a.status===201,'shift row added with driver and ZP rate');
 const j=a.body.journal,r=j.days[0].rows[0];
 ok(r.unit==='hour'&&r.rate===3300&&r.purchaseRate===2900&&r.sum===26400&&r.cost===23200&&r.profit===3200&&r.margin===12,'1С columns: Тариф 3300 × 8 = 26 400, суб. 23 200, прибыль 3 200, маржа 12 %');
 ok(r.service==='Услуги аренды техники'&&r.driver==='Иванов И.И.'&&r.driverPay===4000&&r.partner&&r.object&&r.responsibleId,'service, driver, ZP, supplier, object, responsible');
 const c=await req(D,J+'/copy','POST',{shiftId:r.id});const cr=c.body.journal.days.flatMap(g=>g.rows).find(x=>x.id===c.body.created[0].id);ok(cr.date==='2026-11-12'&&cr.driver==='Иванов И.И.'&&cr.driverRate===500,'copy row → next day with all fields');
 ok((await req(D,J+'/'+r.id,'PATCH',{scan:true})).body.journal.days.flatMap(g=>g.rows).find(x=>x.id===r.id).scan===true,'Скан checkbox saved');
 const h=await req(D,'/api/orders/'+order.id,'PATCH',{paymentForm:'mixed',intermediary:true,contract:'№ 15 от 01.11.2026'});ok(h.body.paymentForm==='mixed'&&h.body.intermediary===true&&h.body.contract.startsWith('№ 15'),'header: Расчёты, посредник, договор');
 ok((await req(D,'/api/orders/'+order.id,'PATCH',{paymentForm:'crypto'})).body.paymentForm==='mixed','unknown payment form ignored');
 // UI
 browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage({reducedMotion:'reduce',viewport:{width:1600,height:1000}});page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERR',e.message)});
 await page.addInitScript(()=>{try{localStorage.setItem('prometey_intro_seen','1')}catch{}});
 await page.goto(base);await page.locator('#login-email').fill('director@prometey.local');await page.locator('#login-pass').fill('director');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('.nav, #consent-agree').first().waitFor();
 if(await page.locator('#consent-agree').count()){await page.locator('#consent-agree').check();await page.locator('#consent-ok').click()}
 await page.locator('.nav [data-page="orders"]').click();await page.locator(`[data-workspace="${order.id}"]`).click();await page.locator('#deal-doc .dd-table').waitFor();
 const head=await page.locator('.dd-head').innerText();ok(/Номер/.test(head)&&/Организация/.test(head)&&/Заказчик/.test(head)&&/Баланс/.test(head)&&/Расчёты/.test(head)&&/посредник/.test(head),'header like the 1С order');
 const th=await page.locator('.dd-table thead').innerText();ok(['Объект','Машина','Услуга','Навесное','Водитель','Тариф ЗП','Часы сотр.','Ответственный','Поставщик','Ед. изм.','Количество','Тариф','Сумма','Тариф суб.','Сумма суб.','Прибыль','Маржа','Скан','Оригинал'].every(x=>th.includes(x)),'«Смены»: all 1С columns');
 ok(await page.locator('.dd-table tbody tr').count()===2,'two shift rows');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'dd1.png')});
 // выбрать строку → скопировать
 await page.locator('.dd-table tbody tr').nth(1).locator('.dd-n').click();await page.locator('#dd-copy').click();await page.waitForFunction(()=>document.querySelectorAll('.dd-table tbody tr').length===3);
 ok((await page.locator('.dd-table tbody tr').nth(2).locator('[data-f="date"]').inputValue())==='2026-11-13','«Скопировать» → row on the next day');
 // правка тарифа пересчитывает сумму и итог
 const row=page.locator('.dd-table tbody tr').nth(2);await row.locator('[data-f="quantity"]').fill('10');await row.locator('[data-f="quantity"]').press('Enter');await page.waitForFunction(()=>/33\s000,00/.test(document.querySelectorAll('.dd-table tbody tr')[2].innerText));
 ok(/85\s800,00/.test(await page.locator('.dd-table tfoot').innerText()),'sum and footer total recalculated');
 await row.locator('[data-f="original"]').check();await page.waitForTimeout(400);
 // поставщик в строке — из всех компаний, с ИНН
 await row.locator('.cp-btn').click();await page.locator('.cp-pop .cp-opt[data-i]').first().waitFor();if(SHOTS)await page.screenshot({path:path.join(SHOTS,'dd3-picker.png')});
 await page.locator('.cp-pop .cp-q').fill('СтройПроект');await page.waitForFunction(()=>document.querySelectorAll('.cp-pop .cp-opt[data-i]').length===1);await page.locator('.cp-pop .cp-opt[data-i]').click();
 await page.waitForFunction(()=>/СтройПроект/.test(document.querySelectorAll('.dd-table tbody tr')[2].querySelector('.cp-btn').innerText));
 const sup=(await req(D,'/api/deals/'+order.id+'/journal')).body.days.flatMap(g=>g.rows).find(r=>r.date==='2026-11-13');ok(sup.partner==='ООО СтройПроект'&&sup.partnerInn==='7701234567','grid: supplier picked from companies and saved with INN');
 // «+ Добавить»
 await page.locator('#dd-add').click();await page.waitForFunction(()=>document.querySelectorAll('.dd-table tbody tr').length===4);ok(true,'«+ Добавить» adds a row');
 ok(/Сумма:/.test(await page.locator('#dd-selsum').innerText()),'selected row totals under the table');
 // шапка
 await page.locator('[data-h="paymentForm"]').selectOption('cash');await page.waitForTimeout(500);
 const saved=(await req(D,'/api/orders/'+order.id)).body;ok(saved.paymentForm==='cash','header field saved on change');
 // вкладки
 await page.locator('[data-dd-tab="machines"]').click();ok(await page.locator('[data-pane="machines"] .line-table').isVisible(),'«Машины» tab: deal equipment and contractors');
 await page.locator('[data-dd-tab="documents"]').click();ok(await page.locator('[data-pane="documents"] .documents-panel').isVisible(),'«Документы» tab');
 await page.locator('[data-dd-tab="shifts"]').click();await page.locator('[data-dd-view="days"]').click();await page.locator('#dd-days .jr-day').first().waitFor();ok(true,'«По дням» view still available');
 if(SHOTS){await page.locator('[data-dd-view="grid"]').click();await page.locator('.dd-table').waitFor();await page.locator('.dd-scroll').evaluate(e=>e.scrollLeft=e.scrollWidth);await page.screenshot({path:path.join(SHOTS,'dd2.png')})}
 await page.setViewportSize({width:390,height:800});await page.waitForTimeout(300);ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no page overflow on phone (table scrolls inside)');
 ok(!errors.length,'no page errors');
 console.log(`OK deal doc: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{try{await browser?.close()}catch{};server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
