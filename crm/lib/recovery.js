'use strict';
// Восстановление пароля без почтового сервера.
//  1) Код восстановления: выдаётся при регистрации (руководителю и по приглашению), его можно сменить в «Профиле».
//     «Забыли пароль?» → e-mail + код + новый пароль → вход. Код одноразовый: после восстановления выдаётся новый.
//  2) Нет кода: сотрудник просит руководителя → тот в «Сотрудниках» создаёт одноразовую ссылку (24 часа)
//     и отправляет её в мессенджер → сотрудник по ссылке задаёт новый пароль.
const crypto=require('node:crypto');
const Access=require('./access');
const Security=require('./security');
const {passwordProblem}=require('./admin');
const fail=(message,status=400,code)=>{throw Object.assign(new Error(message),{status,...(code?{code}:{})})};
const str=v=>String(v??'').trim();
const now=()=>new Date().toISOString();
const hash=t=>crypto.createHash('sha256').update(String(t)).digest('hex');
const sameHash=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без 0/O и 1/I — чтобы не путать при переписывании
const HOUR=3600000;

function newCode(){const b=crypto.randomBytes(16);let s='';for(let i=0;i<16;i++)s+=ALPHABET[b[i]%ALPHABET.length];return s.match(/.{4}/g).join('-')}
const normCode=c=>str(c).toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/O/g,'0').replace(/0/g,'O').replace(/I/g,'1').replace(/1/g,'I');
// выдать новый код сотруднику (хранится только отпечаток)
function issueCode(u){const code=newCode();u.recoveryCodeHash=Security.hashPassword(normCode(code));u.recoveryCodeAt=now();return code}
function audit(d,userId,action,id,details){(d.audit||=[]).unshift({id:'log_'+crypto.randomUUID(),at:now(),userId,action,entity:'users',entityId:id,details:String(details||'').slice(0,300)});d.audit=d.audit.slice(0,1000)}
function setPassword(d,u,password){const problem=passwordProblem(password,u.email);if(problem)fail(problem);u.passwordHash=Security.hashPassword(password);delete u.password;u.mustChangePassword=false;u.passwordChangedAt=now();d.sessions=(d.sessions||[]).filter(s=>s.userId!==u.id)}
const findByEmail=(d,email)=>d.users.find(u=>String(u.email||'').toLowerCase()===str(email).toLowerCase());

function createRecovery(){
 // «Забыли пароль?» → e-mail + код восстановления + новый пароль
 function recover(d,b){
  const u=findByEmail(d,b.email);
  const ok=u&&!u.disabled&&u.recoveryCodeHash&&Security.verifyPassword(u.recoveryCodeHash,normCode(b.code));
  if(!ok)fail('Неверный e-mail или код восстановления. Нет кода — нажмите «Попросить руководителя»',400,'recovery_invalid');
  setPassword(d,u,String(b.password??''));
  const code=issueCode(u);
  audit(d,u.id,'password.recover',u.id,'Пароль восстановлен кодом восстановления');
  return {user:u,recoveryCode:code};
 }
 // нет кода: запрос руководителю (ответ одинаковый, есть такой сотрудник или нет)
 function request(d,b,meta={}){
  const email=str(b.email).toLowerCase();if(!email||email.length>320)fail('Укажите e-mail');
  const u=findByEmail(d,email);
  if(u&&!u.disabled){
   d.passwordRequests=(d.passwordRequests||[]).filter(r=>r.userId!==u.id&&Date.parse(r.at)>Date.now()-7*24*HOUR).slice(-200);
   d.passwordRequests.push({id:'pr_'+crypto.randomUUID(),userId:u.id,at:now(),ip:String(meta.ip||'').slice(0,64)});
   audit(d,u.id,'password.request',u.id,'Сотрудник просит новый пароль');
  }
  return {ok:true,message:'Запрос отправлен руководителю. Он пришлёт вам ссылку для нового пароля — в мессенджер или как вы договоритесь.'};
 }
 // руководитель: ссылка для нового пароля
 function adminLink(d,admin,userId,ctx={}){
  const perm=Access.perms(d,admin);if(!Access.at(perm,'users','yes'))fail('Ссылку для нового пароля создаёт администратор',403);
  const u=d.users.find(x=>x.id===userId);if(!u)fail('Сотрудник не найден',404);
  const role=Access.roles(d).find(r=>r.id===u.role);if(role?.admin&&!perm.admin)fail('Ссылку для администратора создаёт администратор',403);
  if(u.disabled)fail('Сотрудник отключён — сначала включите его');
  const token=crypto.randomBytes(18).toString('base64url');
  d.passwordResets=(d.passwordResets||[]).filter(r=>r.userId!==u.id&&Date.parse(r.expiresAt)>Date.now()).slice(-500);
  d.passwordResets.push({id:'rs_'+crypto.randomUUID(),tokenHash:hash(token),userId:u.id,createdBy:admin.id,createdAt:now(),expiresAt:new Date(Date.now()+24*HOUR).toISOString()});
  d.passwordRequests=(d.passwordRequests||[]).filter(r=>r.userId!==u.id);
  audit(d,admin.id,'password.reset_link',u.id,'Ссылка для нового пароля: '+u.name);
  const base=String(ctx.base||'').replace(/\/+$/,'');
  return {url:base?`${base}/#reset=${token}`:'',link:`#reset=${token}`,name:u.name,email:u.email,expiresAt:d.passwordResets.at(-1).expiresAt,networkOff:!!ctx.networkOff};
 }
 function findReset(d,token){const h=hash(token);const r=(d.passwordResets||[]).find(x=>sameHash(x.tokenHash,h));if(!r||r.usedAt||Date.parse(r.expiresAt)<=Date.now())fail('Ссылка для нового пароля недействительна: её уже использовали или прошло 24 часа. Попросите руководителя прислать новую',410,'reset_invalid');const u=d.users.find(x=>x.id===r.userId&&!x.disabled);if(!u)fail('Сотрудник не найден или отключён',410,'reset_invalid');return {r,u}}
 function resetInfo(d,token){const {u}=findReset(d,token);return {name:u.name,email:u.email,company:d.settings?.companyName||'ПРОМЕТЕЙ'}}
 function resetByLink(d,token,b){const {r,u}=findReset(d,token);setPassword(d,u,String(b.password??''));r.usedAt=now();const code=issueCode(u);audit(d,u.id,'password.reset',u.id,'Новый пароль задан по ссылке');return {user:u,recoveryCode:code}}
 // «Профиль → Новый код восстановления» (нужен текущий пароль)
 function profileCode(d,user,b){const u=d.users.find(x=>x.id===user.id);if(!u)fail('Пользователь не найден',404);if(!Security.verifyPassword(String(u.passwordHash||u.password||''),String(b.current??'')))fail('Текущий пароль неверный',400);const code=issueCode(u);audit(d,u.id,'password.recovery_code',u.id,'Выдан новый код восстановления');return {recoveryCode:code,at:u.recoveryCodeAt}}
 // список запросов для руководителя
 function requests(d,admin){const perm=Access.perms(d,admin);if(!Access.at(perm,'users','yes'))return [];return (d.passwordRequests||[]).filter(r=>Date.parse(r.at)>Date.now()-7*24*HOUR).map(r=>{const u=d.users.find(x=>x.id===r.userId);return u&&!u.disabled?{id:r.id,userId:u.id,name:u.name,email:u.email,at:r.at}:null}).filter(Boolean)}
 return {recover,request,adminLink,resetInfo,resetByLink,profileCode,requests,issueCode};
}
module.exports={createRecovery,issueCode,newCode,normCode};
