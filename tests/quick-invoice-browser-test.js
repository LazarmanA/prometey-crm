'use strict';
// UI: «Сделки → Выставить счёт» — ИНН → реквизиты → техника со ставкой → счёт одним нажатием.
const {chromium}=require('playwright');const http=require('node:http');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-qi-ui-'));
process.env.DB_FILE=path.join(temp,'prometey.sqlite');process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.UPLOADS_DIR=path.join(temp,'up');process.env.RECORDINGS_DIR=path.join(temp,'recordings');process.env.NODE_ENV='test';
try{process.env.PROMETEY_CHROMIUM=process.env.PROMETEY_CHROMIUM||chromium.executablePath()}catch{}
const dadata=http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{res.setHeader('content-type','application/json');const q=JSON.parse(b).query;
 res.end(JSON.stringify({suggestions:[{value:'ООО "НОВОСТРОЙ"',data:{inn:q,kpp:'772801001',ogrn:'1027700132195',name:{full_with_opf:'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "НОВОСТРОЙ"',short_with_opf:'ООО "НОВОСТРОЙ"'},management:{name:'Петров Пётр Петрович',post:'Генеральный директор'},address:{unrestricted_value:'117342, г Москва, ул Профсоюзная, д 65'},state:{status:'ACTIVE'}}}]}))})});
const SHOTS=process.env.SHOTS;let checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
(async()=>{let browser,server;try{
 await new Promise(r=>dadata.listen(0,'127.0.0.1',r));process.env.PROMETEY_DADATA_URL='http://127.0.0.1:'+dadata.address().port;process.env.PROMETEY_DADATA_KEY='0123456789abcdef0123456789abcdef01234567';
 server=require('../server');await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({args:['--no-sandbox']});
 const page=await browser.newPage({reducedMotion:'reduce',viewport:{width:1440,height:1000},acceptDownloads:true});page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERR',e.message)});
 await page.addInitScript(()=>{try{localStorage.setItem('prometey_intro_seen','1')}catch{}});
 await page.goto(base);await page.locator('#login-email').fill('manager@prometey.local');await page.locator('#login-pass').fill('manager');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('.nav').waitFor();
 if(await page.locator('#consent-agree').count()){await page.locator('#consent-agree').check();await page.locator('#consent-ok').click()}
 await page.locator('.nav [data-page="orders"]').click();await page.locator('[data-orders-view="invoice"]').waitFor();
 ok(await page.locator('[data-orders-view="list"].active').count()===1,'«Сделки» has a second section «Выставить счёт»');
 await page.locator('[data-orders-view="invoice"]').click();await page.locator('#qi-q').waitFor();
 ok(await page.locator('#qi-go').isDisabled()&&await page.locator('.qi-off').count()===2,'start: only the company field is active');
 // новая компания по ИНН
 await page.locator('#qi-q').fill('7728168971');await page.locator('#qi-found').waitFor();
 ok((await page.locator('#qi-found').innerText()).includes('НОВОСТРОЙ'),'INN → company found in ЕГРЮЛ');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'q1-inn.png')});
 await page.locator('#qi-found').click();await page.locator('.qi-company').waitFor();
 ok((await page.locator('.qi-company').innerText()).includes('КПП 772801001')&&(await page.locator('.qi-company').innerText()).includes('Профсоюзная'),'requisites filled: KPP, address, director');
 // техника из списка → ставка подставилась
 const eq=(await (await page.request.get(base+'/api/equipment')).json()).find(e=>e.saleRate>0&&!e.archivedAt);
 const label=[eq.type,eq.model,eq.plate].filter(Boolean).join(' · ');
 await page.locator('#qi-address').fill('Москва, Ленинский пр., 30');
 const desc=page.locator('.qi-row [data-f="description"]').first();await desc.fill(label);await page.locator('.qi-eq-tag').waitFor();
 ok(Number(await page.locator('.qi-row [data-f="rate"]').first().inputValue())===eq.saleRate,'equipment picked → rate filled from the equipment card');
 await page.locator('.qi-row [data-f="quantity"]').first().fill('3');
 await page.locator('#qi-add').click();const row2=page.locator('.qi-row').nth(1);await row2.locator('[data-f="description"]').fill('Доставка техники на объект');await row2.locator('[data-f="unit"]').selectOption('trip');await row2.locator('[data-f="rate"]').fill('15000');
 const total=eq.saleRate*3+15000;await page.waitForFunction(t=>document.querySelector('#qi-sum').textContent.replace(/\D/g,'')===String(t),total);
 ok(true,'total updates live: '+total);
 ok((await page.locator('#qi-what').innerText()).includes('добавим компанию, создадим сделку и объект, выставим счёт'),'says what will happen in one click');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'q2-form.png')});
 let dl=page.waitForEvent('download');await page.locator('#qi-go').click();let file=await dl;const pdf=fs.readFileSync(await file.path());
 ok(pdf.subarray(0,4).toString()==='%PDF','one click → invoice PDF downloaded');
 await page.getByText(/Счёт № .* выставлен/).waitFor();ok((await page.locator('.qi-done').innerText()).includes('компания добавлена в CRM'),'done: company added, deal created');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'q3-done.png')});
 // проверим, что всё легло в CRM
 const st=server.store.read();const c=st.clients.find(x=>x.inn==='7728168971');const o=st.orders.find(x=>x.clientId===c?.id);
 ok(c&&o&&st.objects.find(x=>x.id===o.objectId).address.includes('Ленинский')&&st.documents.some(x=>x.orderIds?.includes(o.id)&&x.totalGross===total),'CRM: company, object, deal and invoice saved');
 // существующая компания: сделки и адреса подтягиваются
 await page.locator('#qi-more').click();await page.locator('#qi-q').fill('СтройПроект');await page.locator('.qi-opt[data-n]').first().waitFor();await page.locator('.qi-opt[data-n]').first().click();
 await page.locator('.qi-deal').nth(1).waitFor();
 ok(await page.locator('.qi-deal').count()>=2&&(await page.locator('#qi-address').inputValue()).length>0,'existing company: its deals and last address loaded');
 await page.locator('.qi-deal').nth(1).click();await page.waitForFunction(()=>document.querySelectorAll('.qi-row').length>=1&&document.querySelector('.qi-row [data-f="description"]').value);
 ok(!(await page.locator('#qi-address').count())&&(await page.locator('#qi-what').innerText()).includes('выставим счёт')&&!(await page.locator('#qi-what').innerText()).includes('создадим сделку'),'chosen deal: rows taken from the deal, no new deal');
 await page.locator('[data-qi-type="contract_invoice"]').click();
 dl=page.waitForEvent('download');await page.locator('#qi-go').click();await dl;await page.getByText(/Договор-счёт № .* выставлен/).waitFor();ok(true,'contract-invoice for an existing deal');
 await page.locator('#qi-deal').click();await page.locator('.documents-panel').waitFor();ok(await page.locator('.documents-panel .doc-recent a').count()>=1,'«Открыть сделку» → deal card with the document');
 // ошибка: без цены
 await page.evaluate(()=>{ordersView='invoice';qi=null;current='orders';workspaceSelection=null;renderApp()});await page.locator('#qi-q').fill('СтройПроект');await page.locator('.qi-opt[data-n]').first().click();await page.locator('.qi-company').waitFor();
 await page.locator('.qi-row [data-f="description"]').first().fill('Простой');await page.locator('#qi-go').click();await page.getByText('Строка 1: укажите количество и цену').waitFor();ok(true,'empty price → clear message, nothing sent');
 // телефон
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
 ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'fits a phone');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'q4-phone.png'),fullPage:true});
 assert.deepEqual(errors,[]);ok(true,'no browser errors');
 console.log(`OK quick invoice UI: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1;try{if(SHOTS){const pg=browser.contexts().flatMap(c=>c.pages()).pop();await pg.screenshot({path:path.join(SHOTS,'qfail.png')})}}catch{}}finally{try{await browser?.close()}catch{};server?.close();dadata.close();fs.rmSync(temp,{recursive:true,force:true})}})();
