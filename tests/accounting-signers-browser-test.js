'use strict';
// UI: Бухгалтерия → «Подписи и образцы»: подпись и ФИО главного бухгалтера, свой образец УПД; печать УПД с факсимиле.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Docx=require('../lib/docx');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-accsig-ui-'));
process.env.DB_FILE=path.join(temp,'db.sqlite');process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.UPLOADS_DIR=path.join(temp,'up');
const SHOTS=process.env.SHOTS;let checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
const server=require('../server');
(async()=>{let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const api=async(tok,p,method='GET',body)=>(await fetch(base+p,{method,headers:{authorization:'Bearer '+tok,'content-type':'application/json'},body:body&&JSON.stringify(body)})).json();
 const D=(await api('','/api/login','POST',{email:'director@prometey.local',password:'director'})).token;const pv=await api(D,'/api/privacy');if(pv.required)await api(D,'/api/privacy/accept','POST',{agree:true,version:pv.version});
 const R=await api(D,'/api/accounting/realizations','POST',{clientId:'c1',date:'2026-11-11',lines:[{name:'Услуги автокрана 25 т',quantity:3,unit:'shift',rate:42000,shiftIds:[]}]});
 browser=await chromium.launch({args:['--no-sandbox']});
 const art=await browser.newPage();await art.setViewportSize({width:600,height:220});await art.setContent(`<body style="margin:0;background:#f3f1ea"><svg width="600" height="220"><path d="M30 150 C 80 30, 140 40, 160 140 S 240 50, 280 130 C 300 170, 360 80, 420 110 S 500 170, 560 80" stroke="#0b3d91" stroke-width="7" fill="none" stroke-linecap="round"/></svg></body>`);const photo=await art.screenshot({type:'jpeg',quality:85});await art.close();
 const page=await browser.newPage({reducedMotion:'reduce',viewport:{width:1440,height:1000},acceptDownloads:true});page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERR',e.message)});
 await page.addInitScript(()=>{try{localStorage.setItem('prometey_intro_seen','1')}catch{}});
 await page.goto(base);await page.waitForLoadState('networkidle');await page.locator('#login-email').fill('director@prometey.local');await page.locator('#login-pass').fill('director');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('.nav, #consent-agree').first().waitFor();
 if(await page.locator('#consent-agree').count()){await page.locator('#consent-agree').check();await page.locator('#consent-ok').click()}
 await page.locator('.nav [data-page="accounting"]').click();await page.locator('[data-acc-tab="signers"]').click();await page.locator('.acc-sign').first().waitFor();
 ok(await page.getByText('Главный бухгалтер').first().isVisible()&&await page.getByText('Свои образцы УПД (Word)').isVisible(),'«Бухгалтерия → Подписи и образцы»: director, chief accountant, stamp, УПД samples');
 const sec=page.locator('.acc-sign').first();
 await sec.locator('[data-acc-name]').fill('Петрова Мария Ивановна');await sec.locator('[data-acc-name]').press('Tab');await page.getByText('ФИО главного бухгалтера сохранено').waitFor();ok(true,'chief accountant name saved');
 const fc=page.waitForEvent('filechooser');await page.locator('.acc-sign').first().locator('[data-acc-pick]').click();await (await fc).setFiles({name:'подпись главбуха.jpg',mimeType:'image/jpeg',buffer:photo});
 await page.getByText('Подпись главного бухгалтера сохранена').waitFor();await page.locator('.acc-sign').first().locator('[data-drop-acc] img').waitFor();
 const corner=await page.evaluate(async()=>{const img=document.querySelector('.acc-sign [data-drop-acc] img');const i=new Image();i.src=img.src;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const g=c.getContext('2d');g.drawImage(i,0,0);return g.getImageData(0,0,1,1).data[3]});
 ok(corner===0,'chief accountant signature: photo cleaned (transparent background)');
 ok(await page.locator('.acc-sample .fax-s-sig').count()>=1&&(await page.locator('.acc-sample').first().innerText()).includes('Петрова Мария Ивановна'),'preview «Так будет в УПД»');
 // свой образец УПД
 const fc2=page.waitForEvent('filechooser');await page.locator('#upd-upload').click();await (await fc2).setFiles({name:'Наш УПД.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Docx.sampleUpd()});
 await page.locator('.upd-tpl').first().waitFor();ok((await page.locator('.upd-tpl').first().innerText()).includes('по умолчанию'),'own УПД sample uploaded, default');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'a1-signers.png'),fullPage:true});
 // печать УПД из реализации
 await page.evaluate(id=>realizationView(id),R.id);await page.locator('.upd-print').waitFor();
 ok(await page.locator('#rv-fax').isChecked()&&(await page.locator('.upd-print').innerText()).includes('главный бухгалтер'),'УПД print: «С подписями и печатью» incl. chief accountant');
 ok((await page.locator('#rv-form option:checked').innerText()).includes('Свой образец'),'own УПД sample preselected');
 const names=[];await page.evaluate(()=>{const o=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download)window.__n=this.download;return o.call(this)}});
 await page.locator('#rv-form').selectOption('');await page.getByRole('button',{name:'Скачать УПД'}).click();await page.waitForFunction(()=>window.__n&&window.__n.endsWith('.pdf'));ok(true,'standard УПД PDF downloaded');
 await page.evaluate(()=>window.__n='');await page.locator('#rv-form').selectOption({index:1});await page.getByRole('button',{name:'УПД в Word'}).click();await page.waitForFunction(()=>window.__n&&window.__n.endsWith('.docx'));ok(true,'own УПД in Word downloaded');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'a2-print.png')});
 assert.deepEqual(errors,[]);ok(true,'no browser errors');
 console.log(`OK accounting signers UI: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1;try{if(SHOTS){const pg=browser.contexts().flatMap(c=>c.pages()).pop();await pg.screenshot({path:path.join(SHOTS,'afail.png')})}}catch{}}finally{try{await browser?.close()}catch{};server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
