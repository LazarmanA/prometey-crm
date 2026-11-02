// Подписка: CRM ↔ пульт продавца (vendor/). Регистрация установки, сервисы, пробный период, оплата,
// блокировка, режим «только просмотр», лимит пользователей, подпись ответов, работа без связи.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-license-'));
let checks=0;const check=(ok,label)=>{assert.ok(ok,label);checks++;console.log('PASS',label)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// --- пульт ---
if(!fs.existsSync(path.join(__dirname,'../../vendor/server.js'))){console.log('SKIP license: папка vendor (пульт продавца) не найдена рядом с CRM');process.exit(0)}
process.env.DATA_DIR=path.join(temp,'vendor');process.env.VENDOR_ADMIN_EMAIL='dev@prometey.ru';process.env.VENDOR_ADMIN_PASSWORD='Vendor-Strong-2026!';
const vendor=require('../../vendor/server');
(async()=>{let crm;try{
 await new Promise(r=>vendor.server.listen(0,'127.0.0.1',r));const V='http://127.0.0.1:'+vendor.server.address().port;
 let cookie='';
 const vreq=async(p,method='GET',body,extra={})=>{const r=await fetch(V+p,{method,headers:{'content-type':'application/json','x-prometey':'1',...(cookie?{cookie}:{}),...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{j=t}if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,body:j,headers:r.headers}};
 check((await vreq('/api/overview')).status===401,'vendor console requires login');
 check((await vreq('/api/login','POST',{email:'dev@prometey.ru',password:'wrong-password'})).status===401,'wrong vendor password rejected');
 let r=await vreq('/api/login','POST',{email:'DEV@prometey.ru',password:'Vendor-Strong-2026!'});check(r.status===200&&/HttpOnly/.test(r.headers.get('set-cookie'))&&/SameSite=Strict/.test(r.headers.get('set-cookie')),'vendor login with HttpOnly SameSite cookie');
 check((await vreq('/api/companies','POST',{name:'X'},{'x-prometey':''})).status===403,'console write without CSRF header refused');
 check((await vreq('/api/companies','POST',{name:'X'},{origin:'https://evil.example'})).status===403,'console write from foreign origin refused');
 const {publicKey}=(await vreq('/api/settings')).body;check(publicKey.length>40,'public key shown in settings');
 // --- CRM, собранная с адресом пульта ---
 process.env.DB_FILE=path.join(temp,'crm','db.sqlite');process.env.DOCUMENTS_DIR=path.join(temp,'crm','documents');process.env.RECORDINGS_DIR=path.join(temp,'crm','recordings');process.env.NODE_ENV='test';
 process.env.PROMETEY_LICENSE_SERVER=V;process.env.PROMETEY_LICENSE_KEY=publicKey;
 crm=require('../server');await new Promise(res=>crm.listen(0,'127.0.0.1',res));const C='http://127.0.0.1:'+crm.address().port;
 const creq=async(p,token,method='GET',body)=>{const x=await fetch(C+p,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});let j=null;try{j=await x.json()}catch{}return {status:x.status,body:j}};
 const D=(await creq('/api/login',null,'POST',{email:'director@prometey.local',password:'director'})).body.token,M=(await creq('/api/login',null,'POST',{email:'manager@prometey.local',password:'manager'})).body.token;
 let installs=[];for(let i=0;i<100&&!installs.length;i++){await sleep(100);installs=(await vreq('/api/installs')).body}
 check(installs.length===1,'CRM registered itself in the vendor console on start');
 const inst=installs[0],iid=inst.id;
 check(inst.status==='trial'&&!inst.companyId&&inst.version===require('../package.json').version,'new install: trial, not bound, version reported');
 check(inst.stats.users>=2&&inst.stats.clients>=1&&inst.services.some(s=>s.key==='pdf')&&inst.services.some(s=>s.key==='backup'),'usage stats and services status reported');
 const sent=JSON.stringify(inst);check(!sent.includes('Монолит')&&!sent.includes('office@stroyproject'),'no customer data (client names, client e-mails) sent to vendor');
 check(inst.users.some(u=>u.email==='director@prometey.local'&&u.consentAt),'employees who accepted the privacy policy: e-mails visible to the vendor');
 let l=(await creq('/api/license',M)).body;check(l.enabled&&l.status==='trial'&&!l.readOnly,'CRM: trial, full access');
 check((await creq('/api/admin/license',M)).status===403&&(await creq('/api/admin/license',D)).body.installId===iid,'license tab only for administrators');
 // чужой секрет
 check((await fetch(V+'/api/v1/checkin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({installId:iid,secret:crypto.randomBytes(32).toString('base64url')})})).status===403,'another computer cannot impersonate an installation');
 // пробный период закончился
 const yesterday=new Date(Date.now()-86400000*2).toISOString().slice(0,10);
 await vreq('/api/installs/'+iid,'PATCH',{trialUntil:yesterday});
 l=(await creq('/api/admin/license/check',D,'POST',{})).body;check(l.status==='expired'&&l.readOnly,'trial over → read-only');
 r=await creq('/api/clients',M,'POST',{name:'Новая',address:'Москва',equipmentType:'Кран',ownership:'own',requestAt:'2026-10-30T10:00'});check(r.status===402&&r.body.code==='license_read_only','writes blocked with clear message');
 check((await creq('/api/clients',M)).status===200&&(await creq('/api/documents',D)).status===200,'reading and export still work');
 check((await creq('/api/license',M)).body.banner.includes('только для просмотра'),'banner for all users');
 // компания + оплата
 r=await vreq('/api/companies','POST',{name:'ООО Заказчик',inn:'7701234567',plan:'Стандарт',price:4900,maxUsers:3});check(r.status===201,'vendor creates company');const co=r.body.id;
 await vreq('/api/installs/'+iid,'PATCH',{companyId:co});
 r=await vreq('/api/companies/'+co+'/payments','POST',{amount:14700,months:3,comment:'Счёт 15'});check(r.status===201&&r.body.company.paidUntil>new Date(Date.now()+80*86400000).toISOString().slice(0,10),'payment extends subscription by 3 months');
 l=(await creq('/api/admin/license/check',D,'POST',{})).body;check(l.status==='active'&&!l.readOnly&&l.companyName==='ООО Заказчик'&&l.maxUsers===3,'after payment CRM is active again');
 r=await creq('/api/clients',M,'POST',{name:'Новая после оплаты',address:'Москва',equipmentType:'Кран',note:'проверка',ownership:'own',requestAt:'2026-10-30T10:00'});if(r.status!==201)console.log(r);check(r.status===201,'writes work after payment');
 // лимит пользователей
 const active=(await creq('/api/admin/users',D)).body;const count=(active.users||active).filter(u=>!u.disabled).length;
 r=await creq('/api/admin/users',D,'POST',{name:'Лишний',email:'extra@firma.ru',role:'manager'});check(count>=3?r.status===402&&r.body.code==='license_users_limit':r.status===201,'user limit of the plan enforced');
 // сообщение и блокировка
 await vreq('/api/companies/'+co,'PATCH',{message:'С 1 декабря новый тариф'});await creq('/api/admin/license/check',D,'POST',{});
 check((await creq('/api/license',M)).body.message==='С 1 декабря новый тариф','vendor message shown in CRM');
 await vreq('/api/companies/'+co,'PATCH',{blocked:true});l=(await creq('/api/admin/license/check',D,'POST',{})).body;check(l.status==='blocked'&&l.readOnly,'blocked by vendor → read-only');
 check((await creq('/api/profile/password',D,'POST',{current:'x',next:'y'})).status!==402,'own password change still allowed when blocked');
 await vreq('/api/companies/'+co,'PATCH',{blocked:false});l=(await creq('/api/admin/license/check',D,'POST',{})).body;check(l.status==='active','unblocked');
 // льготный период
 await vreq('/api/companies/'+co,'PATCH',{paidUntil:yesterday});l=(await creq('/api/admin/license/check',D,'POST',{})).body;check(l.status==='grace'&&!l.readOnly&&/только просмотр/.test(l.banner),'unpaid → grace period with warning, still works');
 // отмена платежа возвращает срок
 const pays=(await vreq('/api/companies/'+co)).body.payments;await vreq('/api/companies/'+co,'PATCH',{paidUntil:pays[0].paidUntilAfter});
 r=await vreq('/api/payments/'+pays[0].id,'DELETE');check(r.status===200&&(await vreq('/api/companies/'+co)).body.company.paidUntil===pays[0].paidUntilBefore,'cancelled payment rolls subscription back');
 r=await vreq('/api/companies/'+co+'/payments','POST',{amount:4900,months:1});await creq('/api/admin/license/check',D,'POST',{});
 // сводка и выгрузка
 const o=(await vreq('/api/overview')).body;check(o.money.mrr===4900&&o.money.thisMonth===4900&&o.installs.total===1&&o.companies.total===1,'overview: MRR, payments this month, installs');
 r=await vreq('/api/payments?format=csv');check(r.status===200&&String(r.body).includes('ООО Заказчик'),'payments export to Excel (CSV)');
 check((await vreq('/api/events')).body.some(e=>e.type==='install.new')&&(await vreq('/api/events')).body.some(e=>e.type==='payment'),'events journal');
 // подпись: подделанный файл состояния не принимается
 const Lic=require('../lib/license');const dataDir=path.dirname(process.env.DB_FILE);
 const stateFile=path.join(dataDir,'license-state.json'),saved=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 const fake=JSON.parse(Buffer.from(saved.signed.payload,'base64url'));fake.until='2099-12-31T00:00:00.000Z';fake.status='active';fake.blocked=false;
 fs.writeFileSync(stateFile,JSON.stringify({...saved,signed:{payload:Buffer.from(JSON.stringify(fake)).toString('base64url'),signature:saved.signed.signature}}));
 const tampered=Lic.createLicense({dataDir,env:process.env,store:null,collect:async()=>({}),version:'t'});check(tampered.current().until!=='2099-12-31T00:00:00.000Z','tampered license file rejected (signature)');
 fs.writeFileSync(stateFile,JSON.stringify(saved));
 const otherKey=crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64');
 const wrong=Lic.createLicense({dataDir,env:{PROMETEY_LICENSE_SERVER:V,PROMETEY_LICENSE_KEY:otherKey},store:null,collect:async()=>({}),version:'t'});const w=await wrong.check();check(/Подпись/.test(w.lastError),'response signed by another key rejected');
 // без связи: работает по последнему подтверждённому сроку
 const offline=Lic.createLicense({dataDir,env:process.env,store:null,collect:async()=>({}),version:'t',transport:async()=>{throw new Error('нет сети')}});const off=await offline.check();check(off.status==='active'&&!off.readOnly&&/нет сети/.test(off.lastError),'offline: keeps last confirmed subscription');
 // без пульта в сборке подписка выключена
 const none=Lic.createLicense({dataDir:path.join(temp,'none'),env:{},store:null,collect:async()=>({}),version:'t'});check(!none.current().enabled&&!none.current().readOnly,'build without vendor server: no restrictions');
 // список адресов и политика из пульта
 await creq('/api/admin/license/check',D,'POST',{});r=await vreq('/api/users');check(r.body.users.some(u=>u.email==='director@prometey.local'&&u.companyName==='ООО Заказчик'),'vendor: users page lists e-mails with company');
 check(String((await vreq('/api/users?format=csv')).body).includes('director@prometey.local'),'vendor: users export');
 await vreq('/api/policy','PATCH',{name:'ИП Лазарь А.',inn:'771234567890',email:'support@prometey.ru'});await creq('/api/admin/license/check',D,'POST',{});
 let pol=(await creq('/api/privacy',M)).body;check(pol.html.includes('ИП Лазарь А.')&&!pol.required,'vendor details appear in the CRM policy; same edition — no re-consent');
 await vreq('/api/policy','PATCH',{name:'ИП Лазарь А.',inn:'771234567890',email:'support@prometey.ru',version:'2026-12-01',text:'Новая редакция политики.\n\nВторой абзац.'});await creq('/api/admin/license/check',D,'POST',{});
 pol=(await creq('/api/privacy',M)).body;check(pol.required&&pol.version==='2026-12-01'&&pol.html.includes('Второй абзац'),'new edition from the vendor → everyone accepts again');
 check((await creq('/api/clients',M)).body.code==='privacy_consent_required','work blocked until the new edition is accepted');
 check((await creq('/api/privacy/accept',M,'POST',{agree:true,version:'2026-12-01'})).status===200&&(await creq('/api/clients',M)).status===200,'accepted → works again');
 console.log(`OK license: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{crm?.close();vendor.server.close();setTimeout(()=>{fs.rmSync(temp,{recursive:true,force:true});process.exit()},300)}})();
