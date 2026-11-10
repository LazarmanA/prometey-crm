'use strict';
// UI: вкладка «Быстрый счёт», свой счёт и свой договор (шаблоны Word), счёт + договор одним нажатием.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Docx=require('../lib/docx');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-tpl-ui-'));
process.env.DATA_FILE=path.join(temp,'data.json');fs.copyFileSync(path.join(__dirname,'../storage/data.demo.json'),process.env.DATA_FILE);process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.UPLOADS_DIR=path.join(temp,'up');
try{process.env.PROMETEY_CHROMIUM=process.env.PROMETEY_CHROMIUM||chromium.executablePath()}catch{}
const SHOTS=process.env.SHOTS;let checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
const server=require('../server');
(async()=>{let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({args:['--no-sandbox']});
 const page=await browser.newPage({reducedMotion:'reduce',viewport:{width:1440,height:1000},acceptDownloads:true});page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERR',e.message)});
 await page.addInitScript(()=>{try{localStorage.setItem('prometey_intro_seen','1')}catch{}});
 await page.goto(base);await page.locator('#login-email').fill('director@prometey.local');await page.locator('#login-pass').fill('director');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('.nav').waitFor();
 if(await page.locator('#consent-agree').count()){await page.locator('#consent-agree').check();await page.locator('#consent-ok').click()}
 // Документы → Шаблоны: вид документа и образец
 await page.evaluate(()=>{current='documents';documentView='templates';renderApp()});await page.locator('.tpl-kinds').waitFor();
 ok(await page.locator('.tpl-kind').count()===3&&(await page.locator('.tpl-kind.on').innerText()).includes('Свой счёт'),'templates page: «Свой счёт / Свой договор / Свой договор-счёт»');
 ok((await page.locator('.tpl-sample a').getAttribute('href')).includes('type=invoice'),'sample of an invoice offered');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'t1-templates.png')});
 // Быстрый счёт — отдельная вкладка
 ok(await page.locator('.nav [data-page="quickinvoice"]').isVisible(),'menu has «Быстрый счёт»');
 await page.locator('.nav [data-page="quickinvoice"]').click();await page.locator('#qi-q').waitFor();
 ok((await page.locator('.page-head h1').innerText())==='Быстрый счёт'&&!(await page.locator('.qi-tabs').count()),'«Быстрый счёт» opens the form directly');
 await page.locator('#qi-q').fill('СтройПроект');await page.locator('.qi-opt[data-n]').first().click();await page.locator('.qi-company').waitFor();
 await page.locator('.qi-row [data-f="description"]').first().fill('Автокран 25 т');await page.locator('.qi-row [data-f="rate"]').first().fill('42000');
 ok((await page.locator('#qi-tpl option').first().innerText()).includes('Стандартное'),'«Оформление счёта»: standard by default');
 // загрузить свой счёт прямо отсюда
 let fc=page.waitForEvent('filechooser');await page.locator('#qi-tpl').selectOption('__upload');await (await fc).setFiles({name:'Наш счёт.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Docx.sampleInvoice()});
 await page.waitForFunction(()=>document.querySelector('#qi-tpl')?.selectedOptions[0]?.textContent.includes('Свой: Наш счёт'));ok(true,'own invoice uploaded from the form and selected');
 await page.locator('#qi-with-contract').check();await page.locator('#qi-ctpl').waitFor();
 fc=page.waitForEvent('filechooser');await page.locator('#qi-ctpl').selectOption('__upload');await (await fc).setFiles({name:'Наш договор.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Docx.sample()});
 await page.waitForFunction(()=>document.querySelector('#qi-ctpl')?.selectedOptions[0]?.textContent.includes('Свой: Наш договор'));
 ok((await page.locator('#qi-go').innerText()).includes('счёт и договор')&&(await page.locator('#qi-what').innerText()).includes('сформируем договор'),'«Также договор»: own contract chosen, button says «счёт и договор»');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'t2-quick.png')});
 const dls=[];page.on('download',d=>dls.push(d));
 await page.locator('#qi-go').click();await page.locator('.qi-done').waitFor();await page.waitForTimeout(1500);
 ok((await page.locator('.qi-done h2').innerText()).includes('договор №')&&await page.locator('#qi-contract').isVisible(),'done: invoice and contract issued');
 ok(dls.length===2,'both files downloaded');
 ok((await page.locator('.qi-done').innerText()).includes('оформление: Наш счёт'),'own invoice design used');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'t3-done.png')});
 // следующий счёт — свой шаблон уже по умолчанию
 await page.locator('#qi-more').click();await page.locator('#qi-q').waitFor();
 ok(await page.evaluate(()=>document.querySelector('#qi-tpl').selectedOptions[0].textContent.includes('Наш счёт')),'next invoice: own template is the default');
 assert.deepEqual(errors,[]);ok(true,'no browser errors');
 console.log(`OK own templates UI: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1;try{if(SHOTS){const pg=browser.contexts().flatMap(c=>c.pages()).pop();await pg.screenshot({path:path.join(SHOTS,'tfail.png')})}}catch{}}finally{try{await browser?.close()}catch{};server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
