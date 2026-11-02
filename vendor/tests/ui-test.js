// Пульт продавца: интерфейс (вход, сводка, компании, оплата, установка, настройки) на тестовых данных.
const {chromium}=require('playwright');const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-vendor-ui-'));const shots=process.env.SHOTS;
process.env.DATA_DIR=temp;process.env.VENDOR_ADMIN_EMAIL='dev@prometey.ru';process.env.VENDOR_ADMIN_PASSWORD='Vendor-Strong-2026!';
const {server}=require('../server');
(async()=>{let b;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const V='http://127.0.0.1:'+server.address().port;
 const svc=(pdf,backup)=>[{key:'pdf',name:'PDF-документы',status:pdf,detail:pdf==='on'?'LibreOffice':'нет LibreOffice и Edge'},{key:'templates',name:'Свои шаблоны договоров',status:'on',detail:'2'},{key:'bitrix24',name:'Битрикс24',status:'off'},{key:'onec',name:'1С (обмен)',status:'on'},{key:'telephony',name:'Телефония',status:'on',detail:'mango'},{key:'maps',name:'Яндекс Карты',status:'off'},{key:'lan',name:'Доступ из офисной сети',status:'on',detail:'0.0.0.0'},{key:'backup',name:'Резервные копии',status:backup,detail:'последняя 2026-10-29'}];
 for(const [name,inn,users,pdf,backup] of [['ООО «СтройКран»','7701234567',12,'on','on'],['ИП Сидоров','771234567890',3,'error','warn'],['ООО «Техника-Юг»','2310000000',7,'on','on']])
  await fetch(V+'/api/v1/checkin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({installId:crypto.randomUUID(),secret:crypto.randomBytes(32).toString('base64url'),version:'1.5.0',company:{name,inn},stats:{users,activeUsers:users-1,clients:40,orders:120,documents:300,templates:2,dbBytes:52e6,lastLoginAt:new Date().toISOString()},services:svc(pdf,backup),host:{os:'Windows_NT 10.0.22631',node:'24.22.2',hostname:'OFFICE-PC',lan:true},lastBackupAt:new Date().toISOString(),policyVersion:'2026-11-02',withoutConsent:1,users:[{name:'Иван Петров',email:'ivan@'+inn+'.ru',role:'Руководитель',lastLoginAt:new Date().toISOString(),consentAt:new Date().toISOString()},{name:'Мария',email:'maria@'+inn+'.ru',role:'Менеджер',consentAt:new Date().toISOString()}]})});
 b=await chromium.launch({args:['--no-sandbox']});const p=await b.newPage({viewport:{width:1360,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/401/.test(m.text()))errs.push(m.text())});
 const shot=async n=>shots&&p.screenshot({path:path.join(shots,n+'.png'),fullPage:true});
 await p.goto(V);await p.locator('input[name=email]').fill('dev@prometey.ru');await p.locator('input[name=password]').fill('Vendor-Strong-2026!');await p.getByRole('button',{name:'Войти'}).click();
 await p.getByText('Требует внимания').waitFor();await shot('v1-overview');
 // компания из установки + оплата
 await p.locator('[data-go="installs"]').click();await p.getByText('ООО «СтройКран»').first().click();await p.locator('#new-co').waitFor();await shot('v2-install');
 await p.locator('#new-co').click();await p.locator('input[name=price]').fill('4900');await p.locator('input[name=maxUsers]').fill('15');await p.locator('#modal .btn-primary').click();
 await p.locator('#bind').locator('option:checked',{hasText:'СтройКран'}).waitFor({state:'attached'});
 await p.getByText('Открыть компанию').click();await p.locator('#pay').click();await p.locator('input[name=months]').fill('12');await p.locator('input[name=amount]').fill('58800');await p.getByRole('button',{name:'Записать оплату'}).click();
 await p.getByText('58 800 ₽').first().waitFor();await shot('v3-company');
 await p.locator('[data-go="companies"]').click();await p.locator('#rows .badge.s-active').first().waitFor();await shot('v4-companies');
 await p.locator('[data-go="payments"]').click();await p.getByText('Поступило за месяц').waitFor();
 await p.locator('[data-go="settings"]').click();await p.getByText('Открытый ключ подписи').waitFor();await shot('v5-settings');
 await p.locator('#pol input[name=name]').fill('ИП Лазарь');await p.locator('#pol .btn-primary').click();
 await p.locator('[data-go="users"]').click();await p.getByText('ivan@7701234567.ru').waitFor();await shot('v7-users');
 await p.locator('[data-go=""]').click();await p.getByText('Доход в месяц').waitFor();assert.match(await p.locator('.kpi.dark b').innerText(),/4\s?900/);await shot('v6-overview-after');
 if(errs.length)console.log(errs);assert.deepEqual(errs,[]);console.log('PASS vendor console UI: overview → install → company → payment → companies → payments → settings');
}catch(e){console.error(e);process.exitCode=1}finally{await b?.close();server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
