// Согласие с политикой обработки ПДн при первом входе и список e-mail для руководителя.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-privacy-'));
process.env.DB_FILE=path.join(temp,'db.sqlite');process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.RECORDINGS_DIR=path.join(temp,'recordings');process.env.NODE_ENV='test';
const server=require('../server');
let checks=0;const check=(ok,label)=>{assert.ok(ok,label);checks++;console.log('PASS',label)};
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const B='http://127.0.0.1:'+server.address().port;
 const req=async(p,token,method='GET',body)=>{const r=await fetch(B+p,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return {status:r.status,body:j,headers:r.headers}};
 const login=async(e,p)=>(await req('/api/login',null,'POST',{email:e,password:p})).body.token;
 const pub=await req('/api/privacy/policy');check(pub.status===200&&/152-ФЗ/.test(pub.body.html),'policy readable from the login page without signing in');
 const D=await login('director@prometey.local','director');
 // новый сотрудник
 let r=await req('/api/admin/users',D,'POST',{name:'Ольга Новикова',email:'olga@firma.ru',role:'manager',position:'Менеджер'});const temp1=r.body.temporaryPassword;
 const O=await login('olga@firma.ru',temp1);
 r=await req('/api/clients',O);check(r.status===403&&r.body.code==='privacy_consent_required','new employee cannot work before accepting the policy');
 r=await req('/api/privacy',O);check(r.body.required&&/152-ФЗ/.test(r.body.html)&&r.body.version,'consent screen: policy text and edition');
 check((await req('/api/privacy/accept',O,'POST',{agree:false,version:r.body.version})).status===400,'checkbox is mandatory');
 check((await req('/api/privacy/accept',O,'POST',{agree:true,version:'1999-01-01'})).status===409,'outdated edition rejected');
 r=await req('/api/privacy/accept',O,'POST',{agree:true,version:r.body.version});check(r.status===200&&r.body.acceptedAt,'consent saved with date');
 r=await req('/api/clients',O);check(r.status===403&&r.body.code==='password_change_required','then the temporary password must be changed');
 check((await req('/api/privacy',O)).body.required===false,'consent is not asked again');
 // список адресов
 const M=await login('manager@prometey.local','manager');
 check((await req('/api/admin/emails',M)).status===403,'managers cannot see the e-mail list');
 r=await req('/api/admin/emails',D);const olga=r.body.users.find(u=>u.email==='olga@firma.ru');
 check(r.status===200&&olga&&olga.consentCurrent&&olga.consentIp&&r.body.summary.total===r.body.users.length,'owner sees all e-mails with consent date and IP');
 await req('/api/admin/users',D,'POST',{name:'Пётр',email:'petr@firma.ru',role:'manager'});
 r=await req('/api/admin/emails',D);check(r.body.users.find(u=>u.email==='petr@firma.ru').consentCurrent===false&&r.body.summary.waiting>=1,'list is current: new employee shown as «waiting for consent»');
 r=await req('/api/admin/emails?format=csv',D);check(r.status===200&&/text\/csv/.test(r.headers.get('content-type'))&&r.body.includes('olga@firma.ru')&&r.body.includes('Согласие'),'export to Excel');
 check((await req('/api/audit',D)).body.some(a=>a.action==='privacy.accept'&&a.userId===olga.id),'consent recorded in the audit log');
 // реальный руководитель из установщика тоже даёт согласие
 const Security=require('../lib/security'),{Store}=require('../lib/database');const s2=new Store(path.join(temp,'p2.sqlite'),path.join(__dirname,'../storage/data.demo.json'));
 Security.bootstrapPasswords(s2,{NODE_ENV:'production',PROMETEY_ADMIN_EMAIL:'admin@prometey.local',PROMETEY_ADMIN_PASSWORD:'Very-Strong-Pass-2026'});
 check(!s2.read().users.find(u=>u.email==='admin@prometey.local').privacyConsent,'installed CRM: administrator accepts the policy at first sign-in too');s2.close();
 console.log(`OK privacy: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
