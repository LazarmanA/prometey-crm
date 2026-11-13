'use strict';
// UI: Бухгалтерия как в 1С — Заказы, Смены поставщиков → документ поступления, Деньги, Поставщики, Доходы и расходы.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-fin-ui-'));
process.env.DB_FILE=path.join(temp,'db.sqlite');process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.UPLOADS_DIR=path.join(temp,'up');
const SHOTS=process.env.SHOTS;let checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
const server=require('../server');
(async()=>{let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const api=async(tok,p,method='GET',body)=>(await fetch(base+p,{method,headers:{authorization:'Bearer '+tok,'content-type':'application/json'},body:body&&JSON.stringify(body)})).json();
 const D=(await api('','/api/login','POST',{email:'director@prometey.local',password:'director'})).token;const pv=await api(D,'/api/privacy');if(pv.required)await api(D,'/api/privacy/accept','POST',{agree:true,version:pv.version});
 // данные: поставщики, смены наёмной техники, оплата заказчика, расход
 await api(D,'/api/accounting/partners/p1','PATCH',{inn:'7707083893',phone:'+7 928 035-03-03'});
 const mer=await api(D,'/api/accounting/partners','POST',{name:'ООО "МЕРИДИАН"',inn:'7728168971',phone:'+7 900 111-22-33'});
 for(const date of ['2026-11-02','2026-11-03','2026-11-04','2026-11-05'])await api(D,'/api/deals/o1/journal','POST',{date,equipmentId:'e3'});
 const j=await api(D,'/api/deals/o1/journal');const last=j.days[0].rows.find(r=>r.equipmentId==='e3');await api(D,'/api/deals/o1/journal/'+last.id,'PATCH',{partnerId:mer.id,purchaseRate:23000});
 await api(D,'/api/accounting/payments','POST',{clientId:'c1',amount:150000,date:'2026-11-08',number:'777',purpose:'Оплата по счёту'});
 await api(D,'/api/accounting/expenses','POST',{category:'rent',payee:'Бизнес-центр',amount:30000,date:'2026-11-08',purpose:'Аренда офиса за ноябрь'});
 await api(D,'/api/accounting/purchases','POST',{partnerId:mer.id,date:'2026-11-06',kind:'materials',updNumber:'90102',lines:[{name:'Топливо дизельное ЕВРО',quantity:199.91,unit:'l',rate:105}]});
 await api(D,'/api/quick-invoice','POST',{type:'invoice',clientId:'c1',orderId:'o1',items:[{description:'Услуги техники',unit:'shift',quantity:1,rate:42000}],vatRate:22});
 browser=await chromium.launch({args:['--no-sandbox']});
 const page=await browser.newPage({reducedMotion:'reduce',viewport:{width:1600,height:1000},acceptDownloads:true});page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERR',e.message)});
 await page.addInitScript(()=>{try{localStorage.setItem('prometey_intro_seen','1')}catch{}});
 await page.goto(base);await page.waitForLoadState('networkidle');await page.locator('#login-email').fill('director@prometey.local');await page.locator('#login-pass').fill('director');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('.nav, #consent-agree').first().waitFor();
 if(await page.locator('#consent-agree').count()){await page.locator('#consent-agree').check();await page.locator('#consent-ok').click()}
 await page.locator('.nav [data-page="accounting"]').click();await page.locator('.acc-money').waitFor();
 ok((await page.locator('.acc-money').innerText()).includes('Смены поставщиков без документов'),'overview: money and supplier KPIs');
 // Заказы
 await page.locator('[data-acc-tab="registry"]').click();await page.locator('.acc-reg tbody tr').first().waitFor();
 const reg=(await page.locator('.acc-reg').innerText()).toLowerCase();ok(reg.includes('сумма счетов')&&reg.includes('ооо техресурс')&&reg.includes('меридиан'),'«Заказы»: registry with suppliers, invoices and acts columns');
 ok(await page.locator('.acc-reg td.mis').count()>=1,'mismatched invoice sum highlighted pink');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'f1-registry.png')});
 // Смены поставщиков → документ поступления
 await page.locator('[data-acc-tab="supshifts"]').click();await page.locator('#ss-partner').waitFor();
 await page.locator('#ss-partner').selectOption('p1');await page.locator('#ss-filter button.btn-light').click();await page.locator('[data-pick]').first().waitFor();
 const n=await page.locator('[data-pick]').count();ok(n>=3,'supplier shifts without documents listed for ООО ТехРесурс');
 await page.locator('#ss-all').check();ok((await page.locator('#ss-picked').innerText()).includes('Выбрано: '+n),'selection with quantity and sum');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'f2-supshifts.png')});
 await page.getByRole('button',{name:'Добавить выделенные смены в документ поступления'}).click();await page.locator('#pe-upd').waitFor();
 ok(await page.locator('#pe-partner').inputValue()==='p1'&&(await page.locator('#pe-lines').innerText()).includes('Смены поставщика ('+n+')'),'purchase form prefilled with supplier and shifts');
 await page.locator('#pe-upd').fill('298');await page.locator('#pe-sf').fill('298');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'f3-purchase.png')});
 await page.getByRole('button',{name:'Создать документ'}).click();await page.getByText(/Создано: ПУ-/).waitFor();
 await page.locator('[data-acc-tab="supshifts"]').click();await page.locator('#ss-partner').waitFor();ok(await page.locator('[data-pick]').count()===0,'documented shifts left «Без документов»');
 // Поступления
 await page.locator('[data-acc-tab="purchases"]').click();await page.locator('[data-pur]').first().waitFor();const pl=await page.locator('#acc-body').innerText();
 ok(pl.includes('298')&&pl.includes('90102')&&pl.includes('нет'),'«Поступления»: УПД numbers, original flag');
 // Деньги
 await page.locator('[data-acc-tab="cash"]').click();await page.locator('#cs-from').fill('2026-11-01');await page.locator('#cs-filter button.btn-light').click();await page.locator('.acc-cash-actions').waitFor();
 const cash=await page.locator('#acc-body').innerText();ok(cash.includes('Поступление')&&cash.includes('Расход')&&cash.includes('Бизнес-центр')&&/150\s000/.test(cash),'«Деньги»: incoming from customers and expenses');
 await page.getByRole('button',{name:'+ Оплата подрядчику'}).click();await page.locator('#ex-partner').waitFor();await page.locator('#ex-partner').selectOption(mer.id);await page.locator('#ex-amount').fill('20990.55');await page.locator('#ex-number').fill('901');await page.getByRole('button',{name:'Провести'}).click();await page.waitForFunction(()=>/20\s990,55/.test(document.querySelector('#acc-body')?.innerText||''));
 ok(/20\s990,55/.test(await page.locator('#acc-body').innerText()),'supplier payment added from the UI');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'f4-cash.png')});
 // Поставщики
 await page.locator('[data-acc-tab="suppliers"]').click();await page.locator('[data-sp-recon]').first().waitFor();const sp=await page.locator('#acc-body').innerText();
 ok(sp.includes('МЕРИДИАН')&&sp.includes('ООО ТехРесурс')&&sp.includes('7728168971'),'«Поставщики»: directory with balances');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'f5-suppliers.png')});
 // Доходы и расходы
 await page.locator('[data-acc-tab="pnl"]').click();await page.locator('#pl-from').waitFor();const pnl=(await page.locator('#acc-body').innerText()).toLowerCase();
 ok(pnl.includes('подрядчики')&&pnl.includes('гсм')&&pnl.includes('аренда'),'«Доходы и расходы»: by month and by article');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'f6-pnl.png')});
 // журнал сделки: поставщик в строке
 await page.locator('.nav [data-page="orders"]').click();await page.locator('[data-workspace="o1"]').click();await page.locator('#deal-doc').waitFor();await page.locator('[data-dd-view="days"]').click();await page.locator('#ws-journal .jr-sup').first().waitFor();
 ok(await page.locator('#ws-journal .jr-sup .cp-btn').count()>=4,'deal journal: supplier and supplier price per row');
 if(SHOTS){await page.locator('#ws-journal').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(SHOTS,'f7-journal.png')})}
 ok(!errors.length,'no page errors');
 console.log(`OK finance browser: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{try{await browser?.close()}catch{};server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
