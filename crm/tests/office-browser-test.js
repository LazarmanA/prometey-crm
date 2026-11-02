'use strict';
// Браузерный сценарий 1.4: администратор создаёт бухгалтера → лента → бухгалтер меняет временный пароль,
// проверяет работы, заполняет реквизиты, создаёт и проводит реализацию, скачивает XML для ЭДО, вносит оплату, смотрит акт сверки.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-office-'));
process.env.DB_FILE=path.join(temp,'prometey.sqlite');process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.RECORDINGS_DIR=path.join(temp,'recordings');process.env.NODE_ENV='test';
const server=require('../server');
const shots=process.env.PROMETEY_SHOTS||'';

(async()=>{let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.PROMETEY_CHROME,args:['--no-sandbox']});
 const errors=[];
 const open=async()=>{const ctx=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce',acceptDownloads:true});const p=await ctx.newPage();p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(()=>{window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective))});await p.goto(base);return p};
 const signIn=async(p,email,pass)=>{await p.locator('#login-email').fill(email);await p.locator('#login-pass').fill(pass);await p.getByRole('button',{name:'Войти',exact:true}).click()};
 const nav=p=>p.locator('.nav [data-page]').evaluateAll(b=>b.map(x=>x.dataset.page));
 const go=async(p,page)=>{await p.locator(`.nav [data-page="${page}"]`).click();await p.locator('#page .page-head h1').waitFor()};
 const shot=async(p,name)=>{if(shots)await p.screenshot({path:path.join(shots,name+'.png'),fullPage:true})};

 // 1. Администратор
 const d=await open();await signIn(d,'director@prometey.local','director');await d.locator('.nav').waitFor();
 const dn=await nav(d);assert.ok(['feed','accounting','admin'].every(x=>dn.includes(x)),'director sees Лента, Бухгалтерия, Администрирование');
 await go(d,'admin');await shot(d,'01-admin-users');
 await d.locator('#adm-new-user').click();
 await d.locator('#uf-name').fill('Ольга Счётова');await d.locator('#uf-email').fill('olga@firma.ru');await d.locator('#uf-position').fill('Главный бухгалтер');await d.locator('#uf-role').selectOption('accountant');
 await d.locator('.modal .save').click();
 const pass=(await d.locator('.temp-pass').innerText()).trim();assert.match(pass,/^\w{4}-\w{4}-\w{4}-\w{4}$/,'temporary password shown once');await shot(d,'02-temp-password');
 await d.locator('.modal .cancel').click();
 await d.locator('[data-admin-tab="roles"]').click();await d.locator('.matrix').waitFor();await shot(d,'03-roles');
 // лента: важное сообщение
 await go(d,'feed');await d.locator('#feed-text').fill('С понедельника закрываем смены до 18:00 — бухгалтерия проверяет работы ежедневно.');await d.locator('#feed-important').check();await d.locator('#feed-send').click();
 await d.getByText('С понедельника закрываем смены',{exact:false}).waitFor();await shot(d,'04-feed');

 // 2. Бухгалтер: смена временного пароля
 const b=await open();await signIn(b,'olga@firma.ru',pass);
 await b.locator('#consent-agree').waitFor();await b.locator('#consent-agree').check();await b.locator('#consent-ok').click();
 await b.locator('#force-pass').waitFor();await b.locator('#fp-cur').fill(pass);await b.locator('#fp-new').fill('Olga-Strong-2026!');await b.locator('#fp-new2').fill('Olga-Strong-2026!');await b.getByRole('button',{name:'Сохранить и продолжить'}).click();
 await b.locator('.nav').waitFor();const bn=await nav(b);assert.ok(bn.includes('accounting')&&!bn.includes('admin'),'accountant: Бухгалтерия yes, Администрирование no');
 // важное сообщение в ленте
 await b.waitForFunction(()=>!document.getElementById('feed-badge')?.hidden);
 await go(b,'feed');await b.getByRole('button',{name:'Прочитал'}).click();await b.getByText('✓ Вы ознакомились').waitFor();

 // 3. Проверка работ
 await go(b,'accounting');await shot(b,'05-accounting-overview');
 await b.locator('[data-acc-tab="work"]').click();await b.locator('[data-row]').first().waitFor();
 for(let i=0;i<2;i++){await b.locator('[data-row]').nth(i).click();await b.locator('#we-unit').selectOption('hour');await b.locator('#we-qty').fill('8');await b.locator('#we-rate').fill('4250');await b.locator('#we-doc').fill('ПЛ-'+(i+1));await b.locator('.modal .save').click();await b.locator('.modal').waitFor({state:'hidden'});await b.locator('[data-row]').first().waitFor()}
 await b.locator('#w-all').check();await b.locator('#w-ok').click();await b.getByText('Готово: 2').waitFor();
 await b.locator('#w-status').selectOption('checked');await b.getByRole('button',{name:'Показать'}).click();await b.locator('[data-row]').first().waitFor();await shot(b,'06-work-checked');
 // 4. Реквизиты покупателя
 await b.locator('[data-acc-tab="clients"]').click();await b.locator('[data-cl-edit="c1"]').click();await b.locator('#cr-kpp').fill('770101001');await b.locator('#cr-addr').fill('125009, г. Москва, ул. Тверская, д. 1');await b.locator('.modal .save').click();await b.locator('.modal').waitFor({state:'hidden'});
 // 5. Реализация
 await b.locator('#acc-new-real').click();await b.locator('#re-client').selectOption('c1');await b.locator('#re-basis-num').fill('15');await b.locator('#re-fill').click();
 await b.locator('#re-lines tr[data-i]').nth(1).waitFor();assert.match(await b.locator('#re-totals').innerText(),/68\s000,00/,'totals 68 000');await shot(b,'07-realization-editor');
 await b.getByRole('button',{name:'Сохранить и провести'}).click();
 await b.getByText('Проведён',{exact:true}).first().waitFor();await shot(b,'08-realization-view');
 const [dl]=await Promise.all([b.waitForEvent('download'),b.getByRole('button',{name:'XML для ЭДО'}).click()]);
 assert.match(dl.suggestedFilename(),/^ON_NSCHFDOPPR_7701234567-770101001_7700000000-770001001_\d{8}_[0-9a-f-]{36}\.xml$/,'XML downloaded with the EDO file name');
 const xml=new TextDecoder('windows-1251').decode(fs.readFileSync(await dl.path()));assert.ok(xml.includes('СтТовУчНалВсего="68000.00"'),'downloaded XML has the totals');
 await b.locator('.modal .cancel').click();
 // 6. Оплата и взаиморасчёты
 await b.locator('[data-acc-tab="pay"]').click();await b.locator('#p-new').click();await b.locator('#pn-client').selectOption('c1');await b.locator('#pn-amount').fill('50000');await b.locator('#pn-number').fill('321');await b.locator('.modal .save').click();await b.locator('.modal').waitFor({state:'hidden'});
 await b.locator('[data-acc-tab="debts"]').click();await b.getByText(/18\s000,00\s₽/).first().waitFor();await b.locator('[data-recon="c1"]').click();await b.getByText('Долг покупателя:').waitFor();await shot(b,'09-reconciliation');await b.locator('.modal .cancel').click();
 await b.locator('[data-acc-tab="sales"]').click();await b.getByText('Реестр реализаций').waitFor();
 // мобильная ширина
 await b.setViewportSize({width:390,height:844});await b.locator('[data-acc-tab="real"]').click();await b.locator('.table').first().waitFor();assert.ok(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'accounting fits a phone screen');
 await go(b,'feed');assert.ok(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'feed fits a phone screen');

 // 7. Менеджер
 const m=await open();await signIn(m,'manager@prometey.local','manager');await m.locator('.nav').waitFor();const mn=await nav(m);
 assert.ok(mn.includes('feed')&&!mn.includes('accounting')&&!mn.includes('admin'),'manager: Лента yes, Бухгалтерия/Администрирование no');
 await m.locator('#my-profile').click();await m.locator('#pf-name').waitFor();await m.locator('.modal .cancel').click();

 for(const p of [d,b,m])assert.deepEqual(await p.evaluate(()=>window.__csp),[],'no CSP violations');
 assert.deepEqual(errors,[],'no page errors');
 console.log('PASS office UI: admin creates accountant + temp password, roles matrix, important feed post + «Прочитал», forced password change, work pricing & check, requisites, realization fill → post → EDO XML download, payment, debts, reconciliation, sales, mobile, manager menu');
}finally{await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
