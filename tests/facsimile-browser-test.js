'use strict';
// UI 1.7.1: подпись и печать у организации (фото на белом листе → прозрачный фон), выпуск документов из карточки компании.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-fax-ui-'));
process.env.DB_FILE=path.join(temp,'prometey.sqlite');process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.UPLOADS_DIR=path.join(temp,'up');process.env.RECORDINGS_DIR=path.join(temp,'recordings');process.env.NODE_ENV='test';
// PDF печатает тот же Chromium, что и тест (на компьютерах клиентов — Edge/Chrome)
try{process.env.PROMETEY_CHROMIUM=process.env.PROMETEY_CHROMIUM||chromium.executablePath()}catch{}
const server=require('../server');
const SHOTS=process.env.SHOTS;let checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
(async()=>{let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({args:['--no-sandbox']});
 // «фото» подписи и «скан» печати на бумаге (не белой, с тенью)
 const art=await browser.newPage();
 await art.setViewportSize({width:700,height:260});await art.setContent(`<body style="margin:0;background:#f4f2ec"><svg width="700" height="260"><path d="M40 180 C 90 40, 140 40, 160 170 S 230 60, 260 150 C 280 200, 320 90, 360 120 S 430 200, 470 110 C 500 60, 560 160, 640 90" stroke="#1a237e" stroke-width="7" fill="none" stroke-linecap="round"/></svg></body>`);
 const sigPhoto=await art.screenshot({type:'jpeg',quality:85});
 await art.setViewportSize({width:520,height:520});await art.setContent(`<body style="margin:0;background:#fff"><svg width="520" height="520"><circle cx="260" cy="260" r="230" fill="none" stroke="#2a3f9e" stroke-width="9"/><circle cx="260" cy="260" r="160" fill="none" stroke="#2a3f9e" stroke-width="4"/><text x="260" y="275" text-anchor="middle" font-family="Arial" font-size="46" font-weight="900" fill="#2a3f9e">ПЕЧАТЬ</text></svg></body>`);
 const stampScan=await art.screenshot({type:'jpeg',quality:85});await art.close();
 const page=await browser.newPage({reducedMotion:'reduce',viewport:{width:1400,height:1000},acceptDownloads:true});page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERR',e.message)});
 await page.addInitScript(()=>{try{localStorage.setItem('prometey_intro_seen','1')}catch{}});
 await page.goto(base);await page.locator('#login-email').fill('director@prometey.local');await page.locator('#login-pass').fill('director');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('.nav').waitFor();
 if(await page.locator('#consent-agree').count()){await page.locator('#consent-agree').check();await page.locator('#consent-ok').click()}
 await page.locator('.nav [data-page="documents"]').click();await page.locator('[data-doc-view="companies"]').click();
 const card=page.locator('.org-card').first();await card.locator('.fax').waitFor();
 ok(await card.getByText('Подпись и печать (факсимиле)').isVisible(),'«Наши организации»: each card has its signature and stamp');
 let fc=page.waitForEvent('filechooser');await card.locator('[data-fax-pick="signature"]').click();await (await fc).setFiles({name:'подпись.jpg',mimeType:'image/jpeg',buffer:sigPhoto});
 await card.locator('[data-slot="signature"] .fax-ok').waitFor();
 fc=page.waitForEvent('filechooser');await card.locator('[data-fax-pick="stamp"]').click();await (await fc).setFiles({name:'печать.jpg',mimeType:'image/jpeg',buffer:stampScan});
 await card.locator('[data-slot="stamp"] .fax-ok').waitFor();ok(true,'signature photo and stamp scan uploaded');
 // фон убран: углы прозрачные, чернила — нет; края обрезаны
 const px=await page.evaluate(async()=>{const r=[];for(const img of document.querySelectorAll('.org-card .fax-pic img')){const i=new Image();i.src=img.src;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const g=c.getContext('2d');g.drawImage(i,0,0);const d=g.getImageData(0,0,c.width,c.height).data;let ink=0;for(let k=3;k<d.length;k+=4)if(d[k]>200)ink++;r.push({w:i.width,h:i.height,corner:d[3],ink})}return r});
 ok(px.length===2&&px.every(p=>p.corner===0&&p.ink>200),'paper background removed (transparent), ink kept');
 ok(px[1].w<520&&px[1].h<520&&Math.abs(px[1].w-px[1].h)<12,'stamp trimmed to the circle');
 ok(await card.locator('.fax-sample .fax-s-sig').count()===1&&await card.locator('.fax-sample .fax-s-stamp').count()===1,'preview «так будет в счёте» shows both');
 if(SHOTS)await card.screenshot({path:path.join(SHOTS,'x1-org-fax.png')});
 // ---- карточка компании → рамочный договор ----
 await page.evaluate(()=>{current='clients';renderApp()});await page.waitForTimeout(300);
 await page.evaluate(()=>{workspaceSelection={kind:'clients',id:'c1'};renderPage()});
 const panel=page.locator('.documents-panel');await panel.waitFor();
 ok(await panel.locator('[data-client-doc="contract"]').isVisible()&&await panel.locator('[data-client-doc="invoice"]').isVisible(),'company card: «Счёт на оплату», «Договор-счёт», «Договор»');
 await panel.locator('[data-client-doc="contract"]').click();await page.locator('#cd-deal').waitFor();
 ok((await page.locator('#cd-deal option').first().innerText()).includes('Рамочный'),'contract: framework (no deal) or by a deal');
 await page.locator('.modal-foot .save, .modal .save').first().click();
 await page.locator('#doc-fax').waitFor();ok(await page.locator('#doc-fax').isChecked(),'«С подписью и печатью» on by default');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'x2-issue.png')});
 await page.locator('.modal .save').first().click();await page.getByText('рамочный договор').waitFor();ok(await page.getByText('будут в документе').isVisible(),'preview: framework contract, facsimile included');
 let dl=page.waitForEvent('download');await page.locator('.modal .save').first().click();let file=await dl;let pdf=fs.readFileSync(await file.path());
 if(SHOTS)fs.writeFileSync(path.join(SHOTS,'contract.pdf'),pdf);ok(pdf.subarray(0,4).toString()==='%PDF'&&pdf.length>20000,'contract PDF downloaded (with images)');
 // ---- счёт без факсимиле ----
 await page.locator('.modal').waitFor({state:'detached'}).catch(()=>{});
 await page.locator('.documents-panel [data-client-doc="invoice"]').click();
 if(await page.locator('#cd-deal').count()){await page.locator('.modal .save').first().click()}
 await page.locator('#doc-fax').waitFor();await page.locator('#doc-fax').uncheck();
 await page.locator('.modal .save').first().click();await page.getByText('подпишут от руки').waitFor();ok(true,'invoice without facsimile: shown in preview');
 dl=page.waitForEvent('download');await page.locator('.modal .save').first().click();file=await dl;const pdf2=fs.readFileSync(await file.path());
 ok(pdf2.subarray(0,4).toString()==='%PDF'&&pdf2.length<pdf.length,'invoice PDF without images is lighter');
 await page.waitForTimeout(400);await page.evaluate(()=>{workspaceSelection={kind:'clients',id:'c1'};renderPage()});await page.locator('.documents-panel .doc-recent a').nth(1).waitFor();
 ok(await page.locator('.documents-panel .doc-recent a').count()>=2,'both documents listed in the company card');
 if(SHOTS)await page.locator('.documents-panel').screenshot({path:path.join(SHOTS,'x3-client-docs.png')});
 // ---- Администрирование → Компания: тот же блок ----
 await page.evaluate(()=>{adminTab='company';current='admin';renderApp()});await page.locator('#co-fax .fax').waitFor();ok(await page.locator('#co-fax .fax-ok').count()===2,'Компания tab shows the same signature and stamp');
 // телефон
 await page.setViewportSize({width:390,height:844});await page.locator('.nav [data-page="documents"]').click().catch(()=>{});
 await page.evaluate(()=>{current='documents';documentView='companies';renderApp()});await page.locator('.org-card .fax').first().waitFor();
 ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'facsimile block fits a phone');
 assert.deepEqual(errors,[]);ok(true,'no browser errors');
 console.log(`OK facsimile UI: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1;try{if(SHOTS){const pg=browser.contexts().flatMap(c=>c.pages()).pop();await pg.screenshot({path:path.join(SHOTS,'fail.png')})}}catch{}}finally{try{await browser?.close()}catch{};server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
