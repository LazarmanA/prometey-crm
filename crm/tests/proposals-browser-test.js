'use strict';
// UI: вкладка «КП» — несколько строк (смена / час / рейс), живой предпросмотр, PDF и Word.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readZip}=require('../lib/zip');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-kp-ui-'));
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
 await page.goto(base);await page.locator('#login-email').fill('manager@prometey.local');await page.locator('#login-pass').fill('manager');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('.nav').waitFor();
 if(await page.locator('#consent-agree').count()){await page.locator('#consent-agree').check();await page.locator('#consent-ok').click()}
 ok(await page.locator('.nav [data-page="proposals"]').isVisible(),'menu has «КП»');
 await page.locator('.nav [data-page="proposals"]').click();await page.getByText('Пока нет ни одного КП').waitFor();ok(true,'empty list explains what КП is');
 await page.locator('#kp-new').click();await page.locator('#kp-rows').waitFor();
 await page.locator('#kp-client').fill('ООО "Новострой"');await page.locator('#kp-inn').fill('7728168971');await page.locator('#kp-contact').fill('Петрову П.П.');
 const eq=(await (await page.request.get(base+'/api/equipment')).json()).find(e=>e.saleRate>0&&!e.archivedAt);const label=[eq.type,eq.model,eq.plate].filter(Boolean).join(' · ');
 const row=n=>page.locator('.kp-row[data-n]').nth(n);
 await row(0).locator('[data-f="name"]').fill(label);await page.waitForFunction(()=>Number(document.querySelector('.kp-row[data-n="0"] [data-f="rate"]').value)>0);
 ok(Number(await row(0).locator('[data-f="rate"]').inputValue())===eq.saleRate&&(await row(0).locator('[data-f="name"]').inputValue())===[eq.type,eq.model].filter(Boolean).join(' '),'equipment from the fleet → name and price filled');
 await row(0).locator('[data-f="minOrder"]').fill('1 смена');
 await page.locator('#kp-add').click();await row(1).locator('[data-f="name"]').fill('Самосвал 25 т');await row(1).locator('[data-f="rate"]').fill('9500');await row(1).locator('[data-f="unit"]').selectOption('trip');await row(1).locator('[data-f="minOrder"]').fill('3 рейса');
 await page.locator('#kp-add').click();await row(2).locator('[data-f="name"]').fill('Экскаватор-погрузчик JCB 3CX');await row(2).locator('[data-f="specs"]').fill('Ковш 1 м³, гидромолот');await row(2).locator('[data-f="rate"]').fill('3200');await row(2).locator('[data-f="unit"]').selectOption('hour');
 await row(2).locator('[data-dup]').click();ok(await page.locator('.kp-row[data-n]').count()===4,'rows: add and duplicate');
 await row(3).locator('[data-f="name"]').fill('Манипулятор 7 т');await row(3).locator('[data-f="rate"]').fill('3500');
 const frame=page.frameLocator('#kp-frame');await frame.getByText('Манипулятор 7 т').waitFor();
 ok(await frame.getByText('за рейс').isVisible()&&await frame.getByText('за час').first().isVisible()&&await frame.getByText('Новострой',{exact:false}).isVisible(),'live preview: rows, «за смену / за час / за рейс», client');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'k1-editor.png')});
 await page.evaluate(()=>{window.__names=[];const o=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download)__names.push(this.download);return o.call(this)}});
 let dl=page.waitForEvent('download');await page.locator('#kp-pdf').click();let f=await dl;const fname=async()=>(await page.evaluate(()=>__names.at(-1)));const pdf=fs.readFileSync(await f.path());
 const n1=await fname();ok(/^КП-\d{4}-0001 /.test(n1)&&n1.endsWith('Новострой.pdf')&&pdf.subarray(0,4).toString()==='%PDF','«Скачать PDF» → saved and downloaded: '+n1);
 if(SHOTS)fs.writeFileSync(path.join(SHOTS,'kp.pdf'),pdf);
 dl=page.waitForEvent('download');await page.locator('#kp-docx').click();f=await dl;const docx=fs.readFileSync(await f.path());const xml=readZip(docx).get('word/document.xml').toString();
 const n2=await fname();ok(n2.endsWith('.docx')&&xml.includes('Самосвал 25 т')&&xml.includes('за рейс')&&xml.includes('Манипулятор 7 т'),'«Скачать Word» → .docx with all rows');
 if(SHOTS)fs.writeFileSync(path.join(SHOTS,'kp.docx'),docx);
 ok(await page.locator('.page-head h1').innerText()===n2.split(' ')[0],'KP got its number');
 // список
 await page.locator('#kp-back').click();await page.locator('.kp-list').waitFor();
 ok(await page.locator('.kp-list tbody tr').count()===1&&(await page.locator('.kp-list tbody tr').innerText()).includes('Новострой'),'list: KP with client, rows, validity');
 await page.locator('[data-copy]').first().click();await page.locator('#kp-rows').waitFor();ok(/0002$/.test(await page.locator('.page-head h1').innerText())&&await page.locator('.kp-row[data-n]').count()===4,'«Копия» → new KP with the same rows');
 await page.locator('#kp-back').click();await page.locator('#kp-q').fill('Манипулятор');await page.waitForFunction(()=>document.querySelector('#kp-q')?.value==='Манипулятор'&&document.querySelectorAll('.kp-list tbody tr').length===2,null,{timeout:8000});ok(true,'search by equipment');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'k2-list.png')});
 // ошибка: нет цены
 await page.locator('.nav [data-page="proposals"]').click();await page.locator('#kp-new').click();await row(0).locator('[data-f="name"]').fill('Кран');await page.locator('#kp-save').click();await page.getByText('Строка 1: укажите стоимость').waitFor();ok(true,'no price → clear message');
 // телефон
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'editor fits a phone');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'k3-phone.png'),fullPage:true});
 assert.deepEqual(errors,[]);ok(true,'no browser errors');
 console.log(`OK KP UI: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1;try{if(SHOTS){const pg=browser.contexts().flatMap(c=>c.pages()).pop();await pg.screenshot({path:path.join(SHOTS,'kfail.png')})}}catch{}}finally{try{await browser?.close()}catch{};server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
