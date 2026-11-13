'use strict';
// Сделка: подрядчик (кто выполняет работы) и его стоимость; единицы — часы, рейсы, смены; отдельные количество и единица у подрядчика.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-lines-'));
process.env.DB_FILE=path.join(temp,'db.sqlite');process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.UPLOADS_DIR=path.join(temp,'up');
const SHOTS=process.env.SHOTS;let checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
const server=require('../server');
(async()=>{let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const req=async(tok,p,method='GET',body)=>{const r=await fetch(base+p,{method,headers:{authorization:'Bearer '+tok,'content-type':'application/json'},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json()}};
 const login=async(e,p)=>{const t=(await req('','/api/login','POST',{email:e,password:p})).body.token;const pv=(await req(t,'/api/privacy')).body;if(pv.required)await req(t,'/api/privacy/accept','POST',{agree:true,version:pv.version});return t};
 const D=await login('director@prometey.local','director'),M=await login('manager@prometey.local','manager');
 // API
 const np=await req(M,'/api/partners','POST',{name:'ИП Каменев',inn:'771234567890',phone:'+7 900 555-00-11'});ok(np.status===201&&np.body.id,'manager adds a contractor from the deal');
 ok((await req(M,'/api/partners','POST',{name:'ип каменев'})).body.id===np.body.id,'same contractor not duplicated');
 ok((await req(M,'/api/partners','POST',{name:''})).status===400,'contractor name required');
 const line=await req(M,'/api/order-items','POST',{orderId:'o1',equipmentId:'e3',unit:'hour',quantity:40,saleRate:4000,partnerId:np.body.id,performer:'Кузнецов Ю., +7 900 111',purchaseUnit:'shift',purchaseQuantity:5,purchaseRate:24000,extras:3000});
 ok(line.status===201&&line.body.partnerId===np.body.id&&line.body.purchaseUnit==='shift'&&line.body.purchaseQuantity===5&&line.body.performer.startsWith('Кузнецов'),'line: client by hours, contractor by shifts');
 const view=(await req(M,'/api/order-items?orderId=o1')).body;const v=view.items.find(i=>i.id===line.body.id);
 ok(v.partner==='ИП Каменев'&&v.subtotal===160000&&v.cost===123000&&v.profit===37000,'sums: 40 ч × 4000 − 5 смен × 24000 − 3000');
 ok(view.partners.some(p=>p.id===np.body.id),'contractors list returned with deal lines');
 const trip=await req(M,'/api/order-items','POST',{orderId:'o1',equipmentId:'e4',unit:'trip',quantity:12,saleRate:9000,purchaseRate:7000});ok(trip.status===201&&trip.body.purchaseUnit==='trip'&&trip.body.purchaseQuantity===12,'trips: contractor quantity defaults to client quantity');
 ok((await req(M,'/api/order-items','POST',{orderId:'o1',equipmentId:'e3',unit:'hour',quantity:1,saleRate:1,purchaseRate:1,partnerId:'nope'})).status===400,'unknown contractor rejected');
 ok((await req(M,'/api/order-items','POST',{orderId:'o1',equipmentId:'e3',unit:'week',quantity:1,saleRate:1,purchaseRate:1})).status===400,'unknown unit rejected');
 const rented=(await req(M,'/api/order-items','POST',{orderId:'o1',equipmentId:'e3',unit:'shift',quantity:1,saleRate:1,purchaseRate:1})).body;ok(rented.partnerId==='p1','hired equipment: contractor taken from the equipment owner');
 await req(M,'/api/order-items/'+rented.id,'DELETE');await req(M,'/api/order-items/'+trip.body.id,'DELETE');
 // журнал: смена по позиции получает подрядчика позиции
 const orig=view.items.find(i=>i.equipmentId==='e3'&&i.id!==line.body.id);await req(D,'/api/order-items/'+orig.id,'PATCH',{partnerId:np.body.id});
 const j=(await req(D,'/api/deals/o1/journal','POST',{date:'2026-11-20',equipmentId:'e3'})).body;const jr=(await req(D,'/api/deals/o1/journal')).body.days.find(x=>x.date==='2026-11-20')?.rows.find(r=>r.equipmentId==='e3');
 ok(jr&&jr.partnerId===np.body.id,'journal shift inherits the line contractor');
 // UI
 browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage({reducedMotion:'reduce',viewport:{width:1500,height:1000}});page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERR',e.message)});
 await page.addInitScript(()=>{try{localStorage.setItem('prometey_intro_seen','1')}catch{}});
 await page.goto(base);await page.locator('#login-email').fill('director@prometey.local');await page.locator('#login-pass').fill('director');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('.nav, #consent-agree').first().waitFor();
 if(await page.locator('#consent-agree').count()){await page.locator('#consent-agree').check();await page.locator('#consent-ok').click()}
 await page.locator('.nav [data-page="orders"]').click();await page.locator('[data-workspace="o1"]').click();await page.locator('[data-dd-tab="machines"]').click();await page.locator('.line-table').waitFor();
 const t=await page.locator('.line-table').innerText();ok(/ИП Каменев/.test(t)&&/Кузнецов/.test(t)&&/40 ч/.test(t)&&/5 смен/.test(t)&&/Своя техника/.test(t),'deal table shows contractor, performer, hours and shifts');
 if(SHOTS)await page.locator('.line-table').scrollIntoViewIfNeeded().then(()=>page.screenshot({path:path.join(SHOTS,'d1-table.png')}));
 await page.locator('[data-dd-tab="machines"]').click();await page.locator('#add-line').click();await page.locator('#f-partner').waitFor();
 await page.locator('#f-eq').selectOption('e4');await page.locator('#f-unit').selectOption('trip');ok(await page.locator('#f-punit').inputValue()==='trip','contractor unit follows client unit');
 await page.locator('#f-qty').fill('10');ok(await page.locator('#f-pqty').inputValue()==='10','contractor quantity follows client quantity');
 await page.locator('#f-sale').fill('9000');await page.locator('#f-partner').selectOption('__new');await page.locator('#f-np-name').fill('ООО Самосвалы Юг');await page.locator('#f-np-inn').fill('2310123456');await page.locator('#f-np-save').click();
 await page.waitForFunction(()=>document.querySelector('#f-partner').selectedOptions[0]?.textContent.includes('Самосвалы Юг'));ok(await page.locator('#f-new-partner').isHidden(),'new contractor added right in the form and selected');
 await page.locator('#f-performer').fill('Сидоров, КАМАЗ А123');await page.locator('#f-buy').fill('7000');await page.locator('#f-extra').fill('0');
 ok(/90\s000/.test(await page.locator('#f-sale-sum').innerText())&&/70\s000/.test(await page.locator('#f-buy-sum').innerText())&&/20\s000/.test(await page.locator('#f-profit').innerText()),'live sums: client, contractor, profit');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'d2-form.png')});
 await page.locator('.modal .save').click();await page.waitForFunction(()=>!document.querySelector('.modal'));await page.waitForFunction(()=>/Самосвалы Юг/.test(document.querySelector('.line-table')?.innerText||''));
 ok(/10 рейс/.test(await page.locator('.line-table').innerText()),'saved line with trips and contractor');
 await page.setViewportSize({width:390,height:800});await page.locator('.edit-line').first().click();await page.locator('#f-partner').waitFor();ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'form fits on a phone');
 ok(!errors.length,'no page errors');
 console.log(`OK deal lines: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{try{await browser?.close()}catch{};server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
