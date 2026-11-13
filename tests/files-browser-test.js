'use strict';
// Перетаскивание файлов в интерфейсе: шаблон договора (.docx) и логотипы (наша организация, компания-клиент).
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-files-ui-'));
process.env.DB_FILE=path.join(temp,'prometey.sqlite');process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.RECORDINGS_DIR=path.join(temp,'recordings');process.env.NODE_ENV='test';
const server=require('../server');
const shots=process.env.SHOTS;
function png(w=120,h=40){const {crc32}=require('../lib/zip');const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(td));return Buffer.concat([len,td,c])};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;const rows=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++){rows[y*(w*3+1)]=0;for(let x=0;x<w;x++){const o=y*(w*3+1)+1+x*3;rows[o]=x<h?234:20;rows[o+1]=x<h?91:24;rows[o+2]=x<h?12:28}}return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))])}
// Настоящее перетаскивание: событие drop с файлом в DataTransfer.
async function dropFile(page,selector,name,mime,buffer){
 await page.evaluate(async ({selector,name,mime,b64})=>{const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],name,{type:mime}));const el=document.querySelector(selector);for(const t of ['dragenter','dragover','drop'])el.dispatchEvent(new DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:dt}))},{selector,name,mime,b64:buffer.toString('base64')});
}
(async()=>{let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage({reducedMotion:'reduce',viewport:{width:1400,height:1000}});page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERR',e.message)});page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text())});
 await page.goto(base);await page.locator('#login-email').fill('director@prometey.local');await page.locator('#login-pass').fill('director');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('.nav').waitFor();
 await page.locator('.nav [data-page="documents"]').click();
 await page.locator('[data-doc-view="templates"]').click();await page.locator('.dropzone').waitFor();
 if(shots)await page.screenshot({path:path.join(shots,'f1-templates-empty.png'),fullPage:true});
 // вид документа — «Свой договор»
 await page.locator('.tpl-kind:has-text("Свой договор")').first().click();await page.locator('.tpl-kind.on:has-text("Свой договор")').waitFor();
 // неверный формат
 await dropFile(page,'.dropzone','Договор.doc','application/msword',Buffer.from('xx'));await page.getByText('старый формат .doc').waitFor();
 // образец → обратно перетаскиванием
 const sample=Buffer.from(await (await page.request.get(base+'/api/templates/sample')).body());
 await dropFile(page,'.dropzone','Договор аренды.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',sample);
 await page.locator('.tpl-card').waitFor();assert.match(await page.locator('.tpl-card').innerText(),/Договор аренды[\s\S]*По умолчанию[\s\S]*Полей: \d\d/);
 if(shots)await page.screenshot({path:path.join(shots,'f2-template-uploaded.png'),fullPage:true});
 await page.locator('.tpl-fields summary').click();await page.locator('.chip').first().click();
 // логотип нашей организации
 await page.locator('[data-doc-view="companies"]').click();await page.locator('.org-card .dropzone').first().waitFor();
 await dropFile(page,'.org-card .dropzone','logo.png','image/png',png());
 await page.locator('.org-card .logo-preview img').first().waitFor();
 assert.ok(await page.locator('.org-card .logo-preview img').first().evaluate(i=>i.complete&&i.naturalWidth>0),'logo image loads');
 if(shots)await page.screenshot({path:path.join(shots,'f3-org-logo.png'),fullPage:true});
 // логотип клиента в карточке компании
 await page.locator('.nav [data-page="clients"]').click();await page.locator('[data-workspace]').first().click();
 await page.locator('.ws-logo-block .dropzone').waitFor();await dropFile(page,'.ws-logo-block .dropzone','client.png','image/png',png(60,60));
 await page.locator('.ws-logo-block .logo-preview img').waitFor();
 await page.locator('#ws-back').click();await page.locator('.ws-avatar img').first().waitFor();
 if(shots)await page.screenshot({path:path.join(shots,'f4-client-logos.png')});
 // выпуск договора по своему шаблону
 await page.locator('.nav [data-page="orders"]').click();await page.locator('[data-workspace]').first().click();
 await page.locator('[data-dd-tab="documents"]').click();await page.locator('[data-new-contract]').click();await page.locator('#doc-template').waitFor();
 assert.match(await page.locator('#doc-template').inputValue(),/^tpl_/,'own default template preselected');
 if(shots)await page.screenshot({path:path.join(shots,'f5-issue-with-template.png')});
 assert.deepEqual(errors,[]);console.log('PASS files UI: drag&drop template, organization logo, client logo, template in issue dialog');
}catch(e){console.error(e);process.exitCode=1}finally{await browser?.close();server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
