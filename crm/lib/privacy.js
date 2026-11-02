'use strict';
// Согласие на обработку персональных данных (152-ФЗ): каждый сотрудник принимает политику при первом входе
// (и снова — если выходит новая редакция). Руководитель видит актуальный список e-mail и кто когда дал согласие.
// Текст и реквизиты разработчика можно задать в пульте продавца — они приходят в CRM вместе с подпиской.
const Access=require('./access');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const DEFAULT_VERSION='2026-11-02';
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function defaultText({operator,vendor}){
 const op=operator.name?`${operator.name}${operator.inn?', ИНН '+operator.inn:''}${operator.address?', '+operator.address:''}`:'организация — владелец этой CRM (реквизиты указаны в разделе «Документы → Наши организации»)';
 const dev=vendor.name?`${vendor.name}${vendor.inn?', ИНН '+vendor.inn:''}${vendor.email?', e-mail '+vendor.email:''}`:'разработчик программы ПРОМЕТЕЙ CRM';
 return [
  ['1. Общие положения','Настоящая политика определяет порядок обработки персональных данных пользователей программы ПРОМЕТЕЙ CRM (далее — CRM) в соответствии с Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных».'],
  ['2. Оператор',`Оператор персональных данных — ${op}. Для обслуживания, поддержки и учёта лицензий CRM оператор поручает обработку и передаёт данные разработчику: ${dev}.`],
  ['3. Какие данные обрабатываются','Фамилия, имя, отчество; адрес электронной почты (логин); номер телефона; должность и отдел; роль и права в CRM; дата и время входов, IP-адрес и сведения о браузере; действия в CRM (журнал); сообщения в ленте и чатах CRM.'],
  ['4. Цели обработки','Создание и ведение учётной записи и вход в CRM; разграничение доступа; выполнение рабочих задач в CRM; обеспечение безопасности и расследование инцидентов; техническая поддержка; учёт числа пользователей по лицензии; направление служебных уведомлений об обновлениях, оплате и работе CRM.'],
  ['5. Передача разработчику','Разработчику передаются: имя, адрес электронной почты, роль, статус учётной записи, дата последнего входа и дата согласия. Данные клиентов, сделок и документов CRM разработчику не передаются.'],
  ['6. Действия с данными и сроки','Сбор, запись, систематизация, накопление, хранение, уточнение, использование, передача (предоставление доступа) разработчику, обезличивание, блокирование, удаление и уничтожение — с использованием средств автоматизации. Данные обрабатываются, пока действует учётная запись, и 3 года после её отключения, если более долгий срок не требуется по закону.'],
  ['7. Защита','Доступ к CRM — только по личному паролю; пароли хранятся в виде необратимого хеша; доступ ограничен правами ролей; ведутся журнал действий и резервные копии; соединение с разработчиком защищено и подписано.'],
  ['8. Права пользователя','Пользователь вправе получить сведения об обработке своих данных, потребовать их уточнения, блокирования или уничтожения, а также отозвать согласие, направив запрос оператору. После отзыва согласия учётная запись отключается.'],
  ['9. Согласие','Нажимая «Принимаю», пользователь подтверждает, что ознакомлен с политикой, и свободно, своей волей и в своём интересе даёт согласие на обработку указанных персональных данных на указанных условиях, включая передачу разработчику.'],
 ];
}

function createPrivacy({store,license,env=process.env}){
 // Текст/реквизиты из пульта (если заданы) → иначе стандартный текст.
 function policy(data=store.read()){
  const lic=license?.current?.()||{},remote=lic.policy||null;
  const e=(data.legalEntities||[])[0]||{};
  const operator={name:e.name||e.shortName||'',inn:e.inn||'',address:e.address||''};
  const vendor={name:remote?.vendor?.name||env.PROMETEY_VENDOR_NAME||'',inn:remote?.vendor?.inn||env.PROMETEY_VENDOR_INN||'',email:remote?.vendor?.email||env.PROMETEY_VENDOR_EMAIL||''};
  if(remote?.text&&remote?.version){return {version:String(remote.version).slice(0,40),title:remote.title||'Политика обработки персональных данных',sections:String(remote.text).split(/\n{2,}/).map(p=>['',p.trim()]).filter(x=>x[1]),operator,vendor}}
  return {version:DEFAULT_VERSION,title:'Политика обработки персональных данных',sections:defaultText({operator,vendor}),operator,vendor};
 }
 const accepted=(user,p)=>!!user?.privacyConsent&&user.privacyConsent.version===p.version;
 const ALLOWED=new Set(['/api/privacy','/api/privacy/accept','/api/privacy/policy','/api/logout','/api/session','/api/me','/api/license']);
 function guard(user,pathname){
  if(ALLOWED.has(pathname))return;
  const p=policy();if(accepted(user,p))return;
  throw Object.assign(new Error('Примите политику обработки персональных данных, чтобы продолжить работу'),{status:403,code:'privacy_consent_required'});
 }
 function html(p){return p.sections.map(([h,t])=>`${h?`<h4>${esc(h)}</h4>`:''}<p>${esc(t)}</p>`).join('')}
 function get(user){const p=policy();return {version:p.version,title:p.title,html:html(p),required:!accepted(user,p),acceptedAt:user?.privacyConsent?.at||'',acceptedVersion:user?.privacyConsent?.version||''}}
 function publicPolicy(){const p=policy();return {version:p.version,title:p.title,html:html(p)}}
 function accept(d,user,body,meta){
  const p=policy(d);if(body.agree!==true)fail('Отметьте согласие с политикой');if(String(body.version)!==p.version)fail('Политика обновилась — обновите страницу и прочитайте новую редакцию',409);
  const u=d.users.find(x=>x.id===user.id);if(!u)fail('Пользователь не найден',404);
  u.privacyConsent={version:p.version,at:new Date().toISOString(),ip:String(meta.ip||'').slice(0,64),userAgent:String(meta.agent||'').slice(0,200)};
  (u.privacyConsentHistory||=[]).push(u.privacyConsent);u.privacyConsentHistory=u.privacyConsentHistory.slice(-10);
  (d.audit||=[]).unshift({id:'log_'+require('node:crypto').randomUUID(),at:u.privacyConsent.at,userId:u.id,action:'privacy.accept',entity:'users',entityId:u.id,details:'Согласие на обработку ПДн, редакция '+p.version});d.audit=d.audit.slice(0,1000);
  return {ok:true,acceptedAt:u.privacyConsent.at,version:p.version};
 }
 // «Администрирование → Почта и согласия»
 function emails(d,user){
  const perms=Access.perms(d,user);if(!Access.at(perms,'settings','yes')&&!Access.at(perms,'users','yes'))fail('Список доступен администратору',403);
  const p=policy(d),roles=new Map((d.roles||[]).map(r=>[r.id,r.name]));
  const list=d.users.map(u=>({id:u.id,name:u.name||'',email:u.email||'',phone:u.phone||'',position:u.position||'',role:roles.get(u.role)||u.role,disabled:!!u.disabled,lastLoginAt:u.lastLoginAt||'',createdAt:u.createdAt||'',consentAt:u.privacyConsent?.at||'',consentVersion:u.privacyConsent?.version||'',consentCurrent:accepted(u,p),consentIp:u.privacyConsent?.ip||''}));
  const valid=e=>/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  return {version:p.version,users:list,summary:{total:list.length,active:list.filter(x=>!x.disabled).length,consented:list.filter(x=>x.consentCurrent).length,waiting:list.filter(x=>!x.disabled&&!x.consentCurrent).length,invalid:list.filter(x=>!valid(x.email)).map(x=>x.email)}};
 }
 function csv(rows){return '﻿'+rows.map(r=>r.map(v=>{let s=String(v??'');if(/^\s*[=+@-]/.test(s)&&!/^-?\d/.test(s.trim()))s="'"+s;return /[;"\n']/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}).join(';')).join('\r\n')}
 function emailsCsv(d,user){const r=emails(d,user);return csv([['Имя','E-mail','Телефон','Должность','Роль','Статус','Согласие на обработку ПДн','Редакция политики','IP при согласии','Последний вход'],...r.users.map(u=>[u.name,u.email,u.phone,u.position,u.role,u.disabled?'отключён':'активен',u.consentAt?new Date(u.consentAt).toLocaleString('ru-RU'):'не дано',u.consentVersion,u.consentIp,u.lastLoginAt?new Date(u.lastLoginAt).toLocaleString('ru-RU'):''])])}
 // Для пульта продавца: только сотрудники, давшие согласие на текущую редакцию.
 function forVendor(d){const p=policy(d),roles=new Map((d.roles||[]).map(r=>[r.id,r.name]));return {policyVersion:p.version,users:d.users.filter(u=>accepted(u,p)).slice(0,500).map(u=>({name:String(u.name||'').slice(0,120),email:String(u.email||'').slice(0,200),role:String(roles.get(u.role)||u.role||'').slice(0,60),disabled:!!u.disabled,lastLoginAt:u.lastLoginAt||'',consentAt:u.privacyConsent.at})),withoutConsent:d.users.filter(u=>!u.disabled&&!accepted(u,p)).length}}
 return {policy,guard,get,publicPolicy,accept,emails,emailsCsv,forVendor,DEFAULT_VERSION};
}
module.exports={createPrivacy,DEFAULT_VERSION};
