'use strict';
// Первый вход и приглашения по ссылке.
//  • Новая установка: первый член команды сам создаёт свою учётную запись (руководитель, все права).
//    Это можно сделать только с компьютера, где установлена CRM, или по одноразовой ссылке из установщика.
//  • Остальных руководитель приглашает ссылкой: человек открывает её, сам пишет имя, e-mail и пароль — и сразу работает.
const crypto=require('node:crypto');
const Access=require('./access');
const Security=require('./security');
const {passwordProblem}=require('./admin');
const fail=(message,status=400,code)=>{throw Object.assign(new Error(message),{status,...(code?{code}:{})})};
const str=v=>String(v??'').trim();
const now=()=>new Date().toISOString();
const validEmail=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)&&v.length<=320;
const hash=t=>crypto.createHash('sha256').update(String(t)).digest('hex');
const sameHash=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const DAY=86400000;
// Примеры, с которыми ставится CRM: их можно убрать при первом входе.
const DEMO_TABLES=['clients','partners','objects','equipment','orders','orderItems','assignments','shifts','leads'];

function audit(d,userId,action,entity,id,details){(d.audit||=[]).unshift({id:'log_'+crypto.randomUUID(),at:now(),userId,action,entity,entityId:id,details:String(details||'').slice(0,300)});d.audit=d.audit.slice(0,1000)}
function systemPost(d,text){(d.feed||=[]).push({id:'post_'+crypto.randomUUID(),kind:'system',authorId:'',text,important:false,pinned:false,createdAt:now(),likes:[],comments:[],readBy:[]})}
function checkPerson(d,b){
 const name=str(b.name),email=str(b.email).toLowerCase(),phone=str(b.phone),password=String(b.password??'');
 if(!name||name.length>120)fail('Укажите имя и фамилию');
 if(!validEmail(email))fail('Укажите e-mail — он будет логином для входа');
 if(d.users.some(u=>String(u.email||'').toLowerCase()===email))fail('Сотрудник с таким e-mail уже есть. Войдите или укажите другой e-mail',409);
 if(phone.length>40)fail('Слишком длинный телефон');
 const problem=passwordProblem(password,email);if(problem)fail(problem);
 return {name,email,phone,password};
}

function createOnboarding({env=process.env}={}){
 const setupMode=()=>env.PROMETEY_SETUP==='1';
 const setupTokenOk=t=>!!env.PROMETEY_SETUP_TOKEN&&!!t&&sameHash(hash(t),hash(env.PROMETEY_SETUP_TOKEN));

 // Новая установка: демо-руководитель с паролем director ещё не заменён настоящим человеком.
 function setupNeeded(d){return setupMode()&&!!d.setup?.pending}

 // Вызывается при запуске (до проверки паролей): закрывает демо-входы director/manager и включает регистрацию.
 // PROMETEY_RESET_OWNER (установщик → «Забыли пароль?»): руководитель заново задаёт e-mail и пароль на этом компьютере.
 const ownerOf=d=>d.users.find(u=>u.id===d.setup?.by)||d.users.find(u=>u.role==='director')||d.users.find(u=>Access.roles(d).find(r=>r.id===u.role)?.admin);
 function prepare(d){
  if(!setupMode())return false;
  let changed=false;
  const reset=env.PROMETEY_RESET_OWNER;
  if(reset&&d.setup?.resetToken!==hash(reset)&&ownerOf(d)){d.setup={...(d.setup||{}),pending:true,reset:true,resetToken:hash(reset),since:now()};changed=true}
  if(d.setup?.done&&!d.setup?.pending)return changed;
  const director=d.users.find(u=>u.role==='director');
  const isDemo=u=>u&&Security.verifyPassword(String(u.passwordHash||u.password||''),u.role);
  if(director&&!d.setup?.pending&&isDemo(director)){director.passwordHash=Security.hashPassword(crypto.randomBytes(32).toString('base64url'));delete director.password;d.setup={pending:true,since:now()};changed=true}
  for(const u of d.users)if(u!==director&&!u.disabled&&isDemo(u)){u.disabled=true;u.disabledAt=now();changed=true}
  return changed;
 }

 // Примеры можно убрать только при самой первой регистрации — никогда при восстановлении доступа.
 const firstTime=d=>!d.setup?.reset&&!d.setup?.at;
 function setupInfo(d){const reset=!!d.setup?.reset&&setupNeeded(d);return {needed:setupNeeded(d),reset,name:reset?ownerOf(d)?.name||'':'',company:d.settings?.companyName||'',demo:firstTime(d)&&DEMO_TABLES.some(t=>(d[t]||[]).length)}}

 // Первый член команды создаёт свою учётную запись. local — запрос с этого же компьютера.
 function setup(d,b,{local}){
  if(!setupNeeded(d))fail('Учётная запись руководителя уже создана. Войдите или попросите ссылку-приглашение',409,'setup_done');
  if(!local&&!setupTokenOk(b.token))fail('Создать первую учётную запись можно на компьютере, где установлена CRM',403,'setup_local_only');
  const owner=ownerOf(d);if(!owner)fail('В базе нет руководителя',500);
  const first=firstTime(d),others={...d,users:d.users.filter(u=>u!==owner)};
  const p=checkPerson(others,b),company=str(b.company);
  if(company.length>120)fail('Название компании: до 120 символов');
  Object.assign(owner,{name:p.name,email:p.email,phone:p.phone||owner.phone||'',position:owner.position&&!first?owner.position:str(b.position)||'Руководитель',passwordHash:Security.hashPassword(p.password),mustChangePassword:false,disabled:false,passwordChangedAt:now(),updatedAt:now()});
  delete owner.password;delete owner.envCredential;if(first)delete owner.privacyConsent;
  if(company){d.settings||={};d.settings.companyName=company}
  if(first&&b.clearDemo!==false){for(const t of DEMO_TABLES)d[t]=[];d.feed=(d.feed||[]).filter(x=>x.kind!=='system')}
  d.sessions=(d.sessions||[]).filter(s=>s.userId!==owner.id);
  const wasReset=!!d.setup?.reset;
  d.setup={...(d.setup||{}),pending:false,reset:false,done:true,at:now(),by:owner.id};
  audit(d,owner.id,wasReset?'setup.reset':'setup.owner','users',owner.id,(wasReset?'Восстановлен доступ руководителя: ':'Создана учётная запись руководителя: ')+p.name);
  if(!wasReset)systemPost(d,`${company||'Компания'} начинает работу в ПРОМЕТЕЙ. Руководитель: ${p.name}. Приглашайте коллег по ссылке: «Администрирование → Сотрудники → Пригласить по ссылке».`);
  return owner;
 }

 // ---------- приглашения ----------
 const active=x=>!x.revokedAt&&Date.parse(x.expiresAt)>Date.now()&&(x.multi||!(x.usedBy||[]).length);
 function findInvite(d,token){const h=hash(token);const x=(d.invites||[]).find(i=>sameHash(i.tokenHash,h));if(!x||!active(x))fail('Ссылка-приглашение недействительна: её уже использовали, отозвали или срок истёк. Попросите новую',410,'invite_invalid');return x}

 function inviteView(d,x){const role=Access.roles(d).find(r=>r.id===x.role);return {id:x.id,role:x.role,roleName:role?.name||x.role,departmentId:x.departmentId||'',department:(d.departments||[]).find(z=>z.id===x.departmentId)?.name||'',position:x.position||'',note:x.note||'',multi:!!x.multi,createdAt:x.createdAt,expiresAt:x.expiresAt,author:d.users.find(u=>u.id===x.createdBy)?.name||'',used:(x.usedBy||[]).map(id=>d.users.find(u=>u.id===id)?.name||'—'),active:active(x),url:x.url||''}}

 function admin(d,u,method,url,b={},ctx={}){
  const perm=Access.perms(d,u);if(!Access.at(perm,'users','yes'))fail('Приглашать сотрудников может администратор',403);
  d.invites||=[];
  const m=url.pathname.match(/^\/api\/admin\/invites(?:\/([^/]+))?$/);
  if(method==='GET'&&!m[1])return {invites:d.invites.filter(active).map(x=>inviteView(d,x)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),base:ctx.base||'',networkOff:!!ctx.networkOff,roles:Access.roles(d).filter(r=>perm.admin||!r.admin).map(r=>({id:r.id,name:r.name,admin:!!r.admin})),departments:(d.departments||[]).map(z=>({id:z.id,name:z.name}))};
  if(method==='POST'&&!m[1]){
   const role=str(b.role)||'manager',departmentId=str(b.departmentId),position=str(b.position),note=str(b.note);
   const r=Access.roles(d).find(x=>x.id===role);if(!r)fail('Роль не найдена');
   if(r.admin&&!perm.admin)fail('Пригласить администратора может только администратор',403);
   if(departmentId&&!(d.departments||[]).some(z=>z.id===departmentId))fail('Отдел не найден');
   if(position.length>120||note.length>120)fail('Слишком длинная должность или пометка');
   const days=Math.min(30,Math.max(1,Number(b.days)||7));
   if(d.invites.filter(active).length>=200)fail('Слишком много действующих ссылок — отзовите ненужные',409);
   const token=crypto.randomBytes(18).toString('base64url');
   const x={id:'inv_'+crypto.randomUUID(),tokenHash:hash(token),role,departmentId,position,note,multi:b.multi===true,createdBy:u.id,createdAt:now(),expiresAt:new Date(Date.now()+days*DAY).toISOString(),usedBy:[]};
   const base=String(ctx.base||'').replace(/\/+$/,'');x.url=base?`${base}/#invite=${token}`:'';
   d.invites.push(x);d.invites=d.invites.filter(i=>active(i)||Date.parse(i.createdAt)>Date.now()-90*DAY).slice(-1000);
   audit(d,u.id,'invite.create','invites',x.id,`${r.name}${x.multi?' · многоразовая':''}`);
   return {...inviteView(d,x),token,url:x.url,link:`#invite=${token}`};
  }
  if(method==='DELETE'&&m[1]){const x=d.invites.find(i=>i.id===m[1]);if(!x)fail('Приглашение не найдено',404);x.revokedAt=now();delete x.url;audit(d,u.id,'invite.revoke','invites',x.id,'Ссылка отозвана');return {ok:true}}
  fail('Операция не найдена',404);
 }

 // Открыта ссылка: что показать до регистрации.
 function inviteInfo(d,token){const x=findInvite(d,token);const v=inviteView(d,x);return {company:d.settings?.companyName||'ПРОМЕТЕЙ',roleName:v.roleName,department:v.department,position:v.position,author:v.author,expiresAt:x.expiresAt}}

 // Человек сам регистрируется по ссылке.
 function accept(d,token,b,{canAddUser=()=>true}={}){
  const x=findInvite(d,token),p=checkPerson(d,b);
  if(d.users.length>=1000)fail('Достигнут лимит 1000 сотрудников',409);
  if(!canAddUser(d.users.filter(u=>!u.disabled).length))fail('По тарифу больше нет мест для сотрудников. Сообщите руководителю',402,'license_users_limit');
  if(!Access.roles(d).some(r=>r.id===x.role))fail('Роль из приглашения удалена. Попросите новую ссылку',410,'invite_invalid');
  const nx={id:'u_'+crypto.randomUUID(),name:p.name,email:p.email,phone:p.phone,position:x.position||str(b.position).slice(0,120),departmentId:x.departmentId||'',role:x.role,passwordHash:Security.hashPassword(p.password),mustChangePassword:false,createdAt:now(),createdBy:x.createdBy,invitedBy:x.createdBy,inviteId:x.id};
  d.users.push(nx);(x.usedBy||=[]).push(nx.id);x.usedAt=now();if(!x.multi)delete x.url;
  audit(d,nx.id,'invite.accept','users',nx.id,`${p.name} зарегистрировался по приглашению`);
  const dep=(d.departments||[]).find(z=>z.id===nx.departmentId)?.name;
  systemPost(d,`В команде новый сотрудник: ${p.name}${nx.position?' — '+nx.position:''}${dep?' ('+dep+')':''}. Добро пожаловать!`);
  return nx;
 }

 return {setupMode,setupNeeded,prepare,setupInfo,setup,admin,inviteInfo,accept};
}
module.exports={createOnboarding,DEMO_TABLES};
