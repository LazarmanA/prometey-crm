'use strict';
// UI 1.6.0: регистрация руководителя → приглашение → регистрация сотрудника по ссылке → файлы в ленте.
const {spawn}=require('node:child_process');const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-team-ui-'));
const SHOTS=process.env.SHOTS||'';
let checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
const port=41000+Math.floor(Math.random()*15000),BASE=`http://127.0.0.1:${port}`;
const PNG=Buffer.from('89504e470d0a1a0a0000000d4948445200000040000000300802000000'+'00'.repeat(0),'hex');
(async()=>{let srv,browser;try{
 // настоящая картинка для ленты
 browser=await chromium.launch({args:['--no-sandbox']});
 const shotPage=await browser.newPage({viewport:{width:320,height:200}});await shotPage.setContent('<div style="width:320px;height:200px;background:linear-gradient(135deg,#ea5b0c,#ffaf52);display:grid;place-items:center;font:700 28px sans-serif;color:#fff">Кран на объекте</div>');
 const photo=path.join(temp,'кран.png');await shotPage.screenshot({path:photo});await shotPage.close();
 const pdf=path.join(temp,'Договор аренды.pdf');fs.writeFileSync(pdf,'%PDF-1.4\n'+'x'.repeat(5000));
 srv=spawn(process.execPath,['--disable-warning=ExperimentalWarning','server.js'],{cwd:root,env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),PROMETEY_SETUP:'1',PROMETEY_SETUP_TOKEN:'ui-token-1234567890',DB_FILE:path.join(temp,'db.sqlite'),UPLOADS_DIR:path.join(temp,'uploads'),DOCUMENTS_DIR:path.join(temp,'docs'),COOKIE_SECURE:'false'},stdio:['ignore','pipe','pipe']});
 await new Promise((res,rej)=>{let o='';srv.stdout.on('data',d=>{o+=d;if(o.includes('ПРОМЕТЕЙ'))res()});srv.stderr.on('data',d=>o+=d);setTimeout(()=>rej(new Error(o)),15000)});
 const errors=[];
 const ctx=await browser.newContext({viewport:{width:1366,height:900},reducedMotion:'reduce'});await ctx.grantPermissions(['clipboard-read','clipboard-write'],{origin:BASE});
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{try{localStorage.setItem('prometey_intro_seen','1')}catch{}});
 // 1. установщик открывает CRM на странице регистрации
 await page.goto(BASE+'/#setup=ui-token-1234567890');await page.locator('#ob-form').waitFor();
 ok(await page.getByText('Добро пожаловать!').isVisible()&&!(await page.locator('#login-email').count()),'first start shows registration, not a login with unknown password');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'1-setup.png')});
 await page.locator('#ob-company').fill('ООО Кран-Сервис');await page.locator('#ob-name').fill('Андрей Лазарь');await page.locator('#ob-email').fill('boss@kran.ru');
 await page.locator('#ob-pass').fill('слабый');ok(await page.locator('#ob-checks .bad').isVisible(),'warns about Russian keyboard layout in the password');
 await page.locator('#ob-pass').fill('Kran-Boss-2026!');ok(await page.locator('#ob-checks li.ok').count()===3,'password checklist turns green');
 await page.locator('#ob-go').click();
 // согласие с политикой ПДн
 await page.locator('#consent-agree').waitFor();await page.locator('#consent-agree').check();await page.locator('#consent-ok').click();
 await page.getByText('Готово! Пригласите команду').waitFor();ok(true,'after registration CRM offers to invite the team');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'2-welcome.png')});
 await page.locator('.modal-foot').getByRole('button',{name:'Пригласить сотрудника'}).click();
 await page.locator('#inv-role').waitFor();ok(await page.locator('.modal').getByText('только на этом компьютере').isVisible(),'invite dialog warns when the office network is closed');
 await page.locator('#inv-pos').fill('Диспетчер');await page.locator('.modal .save').click();
 await page.locator('#inv-link').waitFor();const link=(await page.locator('#inv-link').innerText()).trim();ok(/#invite=[A-Za-z0-9_-]{20,}$/.test(link),'invite link shown: '+link.replace(/=.*/,'=…'));
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'3-invite-link.png')});
 await page.locator('.modal-foot').getByRole('button',{name:'Скопировать ссылку'}).click();await page.getByText('Ссылка скопирована').waitFor();ok(true,'link copied');
 await page.locator('.modal-foot').getByRole('button',{name:'Готово'}).click();
 // 2. сотрудник открывает ссылку в другом браузере
 const ctx2=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',isMobile:true});const p2=await ctx2.newPage();p2.on('pageerror',e=>errors.push(e.message));
 await p2.addInitScript(()=>{try{localStorage.setItem('prometey_intro_seen','1')}catch{}});
 await p2.goto(link.replace(/^http:\/\/[^/]+/,BASE));await p2.locator('#ob-form').waitFor();
 ok((await p2.locator('.login-card').innerText()).includes('ООО Кран-Сервис')&&(await p2.locator('.login-card').innerText()).includes('Андрей Лазарь'),'invitation shows company and who invites');
 ok(await p2.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'registration fits a phone screen');
 if(SHOTS)await p2.screenshot({path:path.join(SHOTS,'4-invite-phone.png')});
 await p2.locator('#ob-name').fill('Ольга Петрова');await p2.locator('#ob-email').fill('olga@kran.ru');await p2.locator('#ob-pass').fill('Olga-Kran-2026!');await p2.locator('#ob-go').click();
 await p2.locator('#consent-agree').waitFor();await p2.locator('#consent-agree').check();await p2.locator('#consent-ok').click();
 await p2.locator('.nav').waitFor();ok(!(await p2.url()).includes('invite='),'employee is inside CRM; link removed from the address bar');
 // 3. руководитель видит сотрудника и пишет в ленту с файлами
 await page.reload();await page.locator('.nav').waitFor();
 await page.locator('.nav').getByRole('button',{name:/Администрирование$/}).click();await page.getByText('olga@kran.ru').waitFor();ok(await page.locator('.invite-panel').isVisible(),'Администрирование → Сотрудники: invite panel and the new employee');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'5-admin.png')});
 await page.locator('.nav').getByRole('button',{name:/Лента$/}).click();await page.locator('#feed-form').waitFor();
 ok((await page.locator('#feed-list').innerText()).includes('Ольга Петрова'),'feed welcomes the new employee');
 await page.locator('#feed-text').fill('Фото с объекта и договор');const chooser=page.waitForEvent('filechooser');await page.locator('#feed-clip').click();await (await chooser).setFiles([{name:'кран.png',mimeType:'image/png',buffer:fs.readFileSync(photo)},{name:'Договор аренды.pdf',mimeType:'application/pdf',buffer:fs.readFileSync(pdf)}]);
 await page.waitForFunction(()=>document.querySelectorAll('.attach-chip:not(.up)').length===2,null,{timeout:20000}).catch(()=>{});ok(await page.locator('.attach-chip.ok').count()===2,'two files attached via the 📎 button');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'6-compose.png')});
 await page.locator('#feed-send').click();await page.locator('.post-images img').first().waitFor();
 const loaded=await page.locator('.post-images img').first().evaluate(i=>i.complete&&i.naturalWidth>0);ok(loaded,'photo shows right in the feed');
 ok(await page.locator('.file-chip').filter({hasText:'Договор аренды.pdf'}).isVisible(),'document shown as a download chip');
 // перетаскивание файла в окно сообщения
 const dt=await page.evaluateHandle(()=>{const d=new DataTransfer();d.items.add(new File(['a;b\n1;2'],'смета.csv',{type:'text/csv'}));return d});
 await page.locator('#feed-form').dispatchEvent('dragenter',{dataTransfer:dt});ok(await page.locator('#feed-form.dragging').count()===1,'drop zone appears while dragging');
 await page.locator('#feed-form').dispatchEvent('drop',{dataTransfer:dt});await page.locator('.attach-chip.ok').waitFor();ok((await page.locator('.attach-chip').innerText()).includes('смета.csv'),'file dropped into the message');
 await page.locator('#feed-send').click();await page.locator('.file-chip').filter({hasText:'смета.csv'}).waitFor();ok(true,'file-only post published');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'7-feed.png'),fullPage:true});
 await p2.reload();await p2.locator('.nav').waitFor();await p2.locator('.nav').getByRole('button',{name:/Лента/}).click();await p2.locator('.post-images img').first().waitFor();ok(true,'employee sees the photo on the phone');
 ok(await p2.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'feed with files fits a phone screen');
 // архив ленты и перенос данных
 await page.locator('.nav').getByRole('button',{name:/Лента$/}).click();await page.locator('#feed-form').waitFor();
 let dl=page.waitForEvent('download');await page.getByRole('link',{name:'Скачать архив'}).click();const arch=await dl;ok(/arhiv-lenty/.test(arch.suggestedFilename()),'feed: «Скачать архив» downloads the archive');
 await page.locator('.nav').getByRole('button',{name:/Администрирование$/}).click();await page.locator('[data-admin-tab="transfer"]').click();await page.locator('#tr-export').waitFor();
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'8-transfer.png')});
 dl=page.waitForEvent('download');await page.locator('#tr-export').click();const z=await dl;ok(/prometey-perenos-.*\.zip$/.test(z.suggestedFilename()),'transfer archive downloads from Администрирование → Перенос данных');
 const zf=path.join(temp,'perenos.zip');await z.saveAs(zf);
 const ch=page.waitForEvent('filechooser');await page.locator('#tr-pick').click();await (await ch).setFiles({name:'perenos.zip',mimeType:'application/zip',buffer:fs.readFileSync(zf)});
 ok(await page.locator('#tr-go').isDisabled(),'replace button locked until ЗАМЕНИТЬ is typed');
 await page.locator('#tr-confirm').fill('заменить');await page.locator('#tr-go').click();await page.getByText('Данные перенесены').waitFor({timeout:30000});ok(true,'archive loaded back from the browser');
 await page.locator('.modal-foot').getByRole('button',{name:'Перейти ко входу'}).click();await page.locator('#login-email').fill('boss@kran.ru');await page.locator('#login-pass').fill('Kran-Boss-2026!');await page.locator('#login-pass').press('Enter');await page.locator('.nav').waitFor();ok(true,'owner signs in again after the transfer');
 assert.deepEqual(errors,[]);ok(true,'no browser errors');
 console.log(`OK team UI: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{try{await browser?.close()}catch{};try{srv?.kill()}catch{};fs.rmSync(temp,{recursive:true,force:true})}})();
