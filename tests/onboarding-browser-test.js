'use strict';
// Вход (показать пароль, подсказка про раскладку), согласие с политикой ПДн, «Почта и согласия», панель Авито.
const {chromium}=require('playwright');const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-onb-'));
process.env.DB_FILE=path.join(temp,'p.sqlite');process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.RECORDINGS_DIR=path.join(temp,'recordings');process.env.NODE_ENV='test';
const server=require('../server');const shots=process.env.SHOTS;
(async()=>{let b;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 b=await chromium.launch({args:['--no-sandbox']});const page=await b.newPage({reducedMotion:'reduce',viewport:{width:1400,height:950}});page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const shot=n=>shots&&page.screenshot({path:path.join(shots,n+'.png')});
 await page.goto(base);await page.locator('#login-pass').fill('пароль');await page.locator('#login-layout').waitFor();assert.match(await page.locator('#login-layout').innerText(),/русские буквы/);
 await page.locator('#login-eye').click();assert.equal(await page.locator('#login-pass').getAttribute('type'),'text','show password');
 await page.locator('#login-policy').click();await page.getByText('152-ФЗ').first().waitFor();await shot('o1-login-policy');await page.locator('.modal .cancel').click();
 await page.locator('#login-email').fill(' director@prometey.local ');await page.locator('#login-pass').fill('director');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('.nav').waitFor();
 // руководитель создаёт сотрудника
 const api=(p,o={})=>page.evaluate(async([p,o])=>{const r=await fetch(p,{credentials:'same-origin',headers:{'content-type':'application/json'},...o});return r.json()},[p,o]);
 const u=await api('/api/admin/users',{method:'POST',body:JSON.stringify({name:'Ольга Новикова',email:'olga@firma.ru',role:'manager'})});
 await page.locator('.nav [data-page="admin"]').click();await page.locator('[data-admin-tab="emails"]').click();await page.locator('#em-rows tr').first().waitFor();
 assert.match(await page.locator('#em-rows').innerText(),/olga@firma\.ru[\s\S]*Не дано/);await shot('o2-emails');
 await page.locator('.nav [data-page="integrations"]').click();await page.locator('.avito-panel #av-id').waitFor();await shot('o3-avito');
 // сотрудник: согласие → смена пароля
 await page.evaluate(()=>fetch('/api/logout',{method:'POST',credentials:'same-origin'}));const p2=await b.newPage({reducedMotion:'reduce',viewport:{width:1400,height:950}});p2.on('pageerror',e=>errors.push(e.message));
 await p2.goto(base);await p2.locator('#login-email').fill('olga@firma.ru');await p2.locator('#login-pass').fill(u.temporaryPassword);await p2.getByRole('button',{name:'Войти',exact:true}).click();
 await p2.locator('#consent-agree').waitFor();assert.ok(await p2.locator('#consent-ok').isDisabled(),'button disabled until checkbox');if(shots)await p2.screenshot({path:path.join(shots,'o4-consent.png')});
 await p2.locator('#consent-agree').check();await p2.locator('#consent-ok').click();await p2.locator('#force-pass').waitFor();
 assert.deepEqual(errors,[]);console.log('PASS onboarding UI: login helpers, policy, e-mail list, Avito panel, consent → password change');
}catch(e){console.error(e);process.exitCode=1}finally{await b?.close();server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
