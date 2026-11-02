// Администрирование (как в Битрикс24): сотрудники, отделы, роли с матрицей прав, настройки CRM, сеансы, профиль.
const crypto=require('node:crypto');
const Access=require('./access');
const Security=require('./security');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const str=v=>String(v??'').trim();
const now=()=>new Date().toISOString();

const DEFAULT_SETTINGS={
 companyName:'ПРОМЕТЕЙ',
 vat:{defaultRate:22,pricesIncludeVat:true},
 accounting:{workCheckRequired:true,paymentTermDays:10,signerName:'',signerPosition:'Генеральный директор',
  okei:{hour:['356','ч'],day:['359','сут'],km:['008','км'],ton:['168','т'],m3:['113','м3'],unit:['796','шт'],machine_hour:['','маш.-ч'],shift:['','смена'],trip:['','рейс']}},
 feed:{allowComments:true}
};
const VAT_RATES=[22,20,10,7,5,0,'none'];
function settings(d){const s=d.settings||{};return {...DEFAULT_SETTINGS,...s,vat:{...DEFAULT_SETTINGS.vat,...(s.vat||{})},accounting:{...DEFAULT_SETTINGS.accounting,...(s.accounting||{}),okei:{...DEFAULT_SETTINGS.accounting.okei,...(s.accounting?.okei||{})}},feed:{...DEFAULT_SETTINGS.feed,...(s.feed||{})}}}

function passwordProblem(p,email=''){
 p=String(p||'');
 if(p.length<12)return 'Пароль: не короче 12 символов';
 if(p.length>200)return 'Пароль: не длиннее 200 символов';
 if(/[\r\n]/.test(p))return 'Пароль: без переводов строки';
 if(['director','manager','password','qwerty123456','123456789012'].includes(p.toLowerCase())||p.toLowerCase()===String(email).toLowerCase())return 'Пароль слишком простой';
 const kinds=[/[a-zа-яё]/,/[A-ZА-ЯЁ]/,/\d/,/[^\p{L}\p{N}]/u].filter(r=>r.test(p)).length;
 if(kinds<3)return 'Пароль: минимум три вида символов — строчные, заглавные, цифры, знаки';
 return '';
}
// Временный пароль: 4 группы по 4 символа без похожих букв, гарантированно все виды символов.
function tempPassword(){const sets=['abcdefghjkmnpqrstuvwxyz','ABCDEFGHJKMNPQRSTUVWXYZ','23456789'];let out='';for(let g=0;g<4;g++){for(let i=0;i<4;i++){const set=sets[(g+i)%3];out+=set[crypto.randomInt(set.length)]}if(g<3)out+='-'}return out}
const validEmail=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)&&v.length<=320;

function createAdmin(){
 return function handle(d,u,method,url,b={},ctx={}){
  const p=url.pathname;let changed=false;
  const ok=(body,status=200)=>({body,status,changed});
  const me=Access.perms(d,u);
  const audit=(action,entity,id,details)=>{changed=true;d.audit.unshift({id:'log_'+crypto.randomUUID(),at:now(),userId:u.id,action,entity,entityId:id,details:String(details||'').slice(0,300)});d.audit=d.audit.slice(0,1000)};
  const isAdminRole=roleId=>!!Access.roles(d).find(r=>r.id===roleId)?.admin;
  const activeAdmins=()=>d.users.filter(x=>!x.disabled&&isAdminRole(x.role));
  const killSessions=(userId,keepHash)=>{d.sessions=(d.sessions||[]).filter(s=>s.userId!==userId||(keepHash&&s.tokenHash===keepHash))};
  const userView=x=>({id:x.id,name:x.name,email:x.email,phone:x.phone||'',position:x.position||'',departmentId:x.departmentId||'',role:x.role,roleName:Access.roleOf(d,x)?.name||x.role,admin:isAdminRole(x.role),disabled:!!x.disabled,mustChangePassword:!!x.mustChangePassword,createdAt:x.createdAt||'',lastLoginAt:x.lastLoginAt||'',sessions:(d.sessions||[]).filter(s=>s.userId===x.id&&Date.parse(s.expiresAt)>Date.now()).length});
  const feedPost=text=>{(d.feed||=[]).push({id:'post_'+crypto.randomUUID(),kind:'system',authorId:'',text,important:false,pinned:false,createdAt:now(),likes:[],comments:[],readBy:[]});changed=true};

  // ---------- профиль: доступен каждому ----------
  if(p==='/api/profile'){
   const x=d.users.find(z=>z.id===u.id);
   if(method==='GET')return ok({...userView(x),departmentName:(d.departments||[]).find(z=>z.id===x.departmentId)?.name||''});
   if(method==='PATCH'){const name=str(b.name??x.name),phone=str(b.phone??x.phone);if(!name||name.length>120||phone.length>40)fail('Укажите имя (до 120 символов) и телефон');Object.assign(x,{name,phone,updatedAt:now()});audit('profile.update','users',x.id,name);return ok(userView(x))}
  }
  if(p==='/api/profile/password'&&method==='POST'){
   const x=d.users.find(z=>z.id===u.id);
   if(typeof b.current!=='string'||typeof b.next!=='string')fail('Укажите текущий и новый пароль');
   if(!Security.verifyPassword(x.passwordHash||x.password,b.current))fail('Текущий пароль неверный',403);
   const problem=passwordProblem(b.next,x.email);if(problem)fail(problem);
   if(Security.verifyPassword(x.passwordHash||x.password,b.next))fail('Новый пароль должен отличаться от текущего');
   x.passwordHash=Security.hashPassword(b.next);delete x.password;x.mustChangePassword=false;x.passwordChangedAt=now();
   killSessions(x.id,ctx.tokenHash);audit('profile.password','users',x.id,'Сменён пароль');return ok({ok:true});
  }

  if(!p.startsWith('/api/admin'))fail('Операция не найдена',404);
  const canUsers=Access.at(me,'users','yes'),canSettings=Access.at(me,'settings','yes');

  // ---------- сводка для экрана администрирования ----------
  if(p==='/api/admin'&&method==='GET'){if(!canUsers&&!canSettings)fail('Доступно администратору',403);return ok({canUsers,canSettings,isAdmin:me.admin,users:d.users.length,active:d.users.filter(x=>!x.disabled).length,departments:(d.departments||[]).length,roles:Access.roles(d).length,sessions:(d.sessions||[]).filter(s=>Date.parse(s.expiresAt)>Date.now()).length})}

  // ---------- настройки CRM ----------
  if(p==='/api/admin/settings'){
   if(method==='GET'){if(!canSettings&&!Access.at(me,'accounting','read'))fail('Настройки доступны администратору',403);return ok({...settings(d),vatRates:VAT_RATES})}
   if(method==='PATCH'){
    if(!canSettings)fail('Настройки изменяет администратор',403);
    const cur=settings(d),next=structuredClone(cur);
    if(b.companyName!==undefined){const v=str(b.companyName);if(!v||v.length>80)fail('Название компании: от 1 до 80 символов');next.companyName=v}
    if(b.vat){const r=b.vat.defaultRate==='none'?'none':Number(b.vat.defaultRate);if(b.vat.defaultRate!==undefined){if(!VAT_RATES.includes(r))fail('Некорректная ставка НДС');next.vat.defaultRate=r}if(b.vat.pricesIncludeVat!==undefined)next.vat.pricesIncludeVat=b.vat.pricesIncludeVat===true}
    if(b.accounting){const a=b.accounting;
     if(a.workCheckRequired!==undefined)next.accounting.workCheckRequired=a.workCheckRequired===true;
     if(a.paymentTermDays!==undefined){const n=Number(a.paymentTermDays);if(!Number.isInteger(n)||n<0||n>365)fail('Срок оплаты: от 0 до 365 дней');next.accounting.paymentTermDays=n}
     for(const k of ['signerName','signerPosition']){if(a[k]!==undefined){const v=str(a[k]);if(v.length>120)fail('Слишком длинное значение');next.accounting[k]=v}}
     if(a.okei){for(const [unit,pair] of Object.entries(a.okei)){if(!(unit in DEFAULT_SETTINGS.accounting.okei))fail('Неизвестная единица: '+unit);const code=str(pair?.[0]),name=str(pair?.[1]);if(code&&!/^\d{3,4}$/.test(code))fail('Код ОКЕИ — 3–4 цифры или пусто');if(!name||name.length>20)fail('Укажите обозначение единицы');next.accounting.okei[unit]=[code,name]}}
    }
    if(b.feed&&b.feed.allowComments!==undefined)next.feed.allowComments=b.feed.allowComments===true;
    d.settings=next;audit('settings.update','settings','settings','Изменены настройки CRM');return ok({...next,vatRates:VAT_RATES});
   }
  }

  if(!canUsers)fail('Раздел доступен администратору',403);

  // ---------- отделы ----------
  const dep=p.match(/^\/api\/admin\/departments(?:\/([^/]+))?$/);
  if(dep){d.departments||=[];const id=dep[1],x=id?d.departments.find(z=>z.id===id):null;if(id&&!x)fail('Отдел не найден',404);
   if(method==='GET'&&!id)return ok(d.departments.map(z=>({...z,head:d.users.find(v=>v.id===z.headId)?.name||'',members:d.users.filter(v=>v.departmentId===z.id&&!v.disabled).length})));
   if(method==='POST'||method==='PATCH'){const name=str(b.name??x?.name),headId=str(b.headId??x?.headId),parentId=str(b.parentId??x?.parentId);if(!name||name.length>80)fail('Название отдела: от 1 до 80 символов');if(d.departments.some(z=>z.id!==id&&z.name.toLowerCase()===name.toLowerCase()))fail('Такой отдел уже есть',409);if(headId&&!d.users.some(v=>v.id===headId))fail('Руководитель отдела не найден');if(parentId&&(parentId===id||!d.departments.some(z=>z.id===parentId)))fail('Некорректный вышестоящий отдел');
    if(x){Object.assign(x,{name,headId,parentId,updatedAt:now()});audit('department.update','departments',x.id,name);return ok(x)}
    const nx={id:'dep_'+crypto.randomUUID(),name,headId,parentId,createdAt:now()};d.departments.push(nx);audit('department.create','departments',nx.id,name);return ok(nx,201)}
   if(method==='DELETE'&&x){if(d.users.some(v=>v.departmentId===x.id&&!v.disabled))fail('В отделе есть сотрудники. Сначала переведите их в другой отдел',409);d.departments=d.departments.filter(z=>z.id!==x.id);for(const z of d.departments)if(z.parentId===x.id)z.parentId='';audit('department.delete','departments',x.id,x.name);return ok({ok:true})}
  }

  // ---------- роли и права ----------
  const role=p.match(/^\/api\/admin\/roles(?:\/([^/]+))?$/);
  if(role){d.roles||=[];const id=role[1];
   if(method==='GET'&&!id)return ok({schema:Access.SCHEMA,roles:Access.roles(d).map(r=>({id:r.id,name:r.name,system:!!r.system||!!Access.PRESETS[r.id],admin:!!r.admin,customized:!!Access.PRESETS[r.id]&&d.roles.some(c=>c.id===r.id),permissions:r.admin?{...Access.FULL}:Access.normalize(r.permissions),users:d.users.filter(v=>v.role===r.id&&!v.disabled).length}))});
   if(!me.admin)fail('Роли и права изменяет только администратор',403);
   const preset=id&&Access.PRESETS[id];
   if(id==='director')fail('Роль администратора нельзя изменить — у неё всегда полный доступ',409);
   if(method==='POST'||method==='PATCH'){
    const existing=id?d.roles.find(r=>r.id===id):null;if(id&&!existing&&!preset)fail('Роль не найдена',404);
    const name=str(b.name??existing?.name??preset?.name);if(!name||name.length>60)fail('Название роли: от 1 до 60 символов');
    if(Access.roles(d).some(r=>r.id!==id&&r.name.toLowerCase()===name.toLowerCase()))fail('Роль с таким названием уже есть',409);
    const permissions=Access.normalize({...(existing?.permissions||preset?.permissions||{}),...(b.permissions||{})});
    for(const [k,v] of Object.entries(b.permissions||{}))if(permissions[k]!==v)fail('Некорректный уровень права: '+k);
    if(existing){Object.assign(existing,{name,permissions,updatedAt:now()});audit('role.update','roles',existing.id,name);return ok(existing)}
    if(preset){const r={id,name,system:true,admin:false,permissions,createdAt:now()};d.roles.push(r);audit('role.update','roles',id,name);return ok(r)}
    const r={id:'role_'+crypto.randomUUID().slice(0,8),name,system:false,admin:false,permissions,createdAt:now()};d.roles.push(r);audit('role.create','roles',r.id,name);return ok(r,201);
   }
   if(method==='DELETE'&&id){const existing=d.roles.find(r=>r.id===id);if(!existing)fail('Роль не найдена',404);
    if(preset){d.roles=d.roles.filter(r=>r.id!==id);audit('role.reset','roles',id,'Права сброшены к стандартным');return ok({ok:true})}
    if(d.users.some(v=>v.role===id))fail('Роль назначена сотрудникам. Сначала смените им роль',409);d.roles=d.roles.filter(r=>r.id!==id);audit('role.delete','roles',id,existing.name);return ok({ok:true})}
  }

  // ---------- активные сеансы ----------
  if(p==='/api/admin/sessions'&&method==='GET')return ok((d.sessions||[]).filter(s=>Date.parse(s.expiresAt)>Date.now()).map(s=>({id:s.id,userId:s.userId,user:d.users.find(v=>v.id===s.userId)?.name||'—',createdAt:s.createdAt,expiresAt:s.expiresAt,ip:s.ip||'',agent:s.agent||''})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
  const sess=p.match(/^\/api\/admin\/sessions\/([^/]+)$/);
  if(sess&&method==='DELETE'){const s=(d.sessions||[]).find(x=>x.id===sess[1]);if(!s)fail('Сеанс не найден',404);const owner=d.users.find(v=>v.id===s.userId);if(owner&&isAdminRole(owner.role)&&!me.admin)fail('Сеансы администратора закрывает администратор',403);d.sessions=d.sessions.filter(x=>x.id!==s.id);audit('session.revoke','users',s.userId,'Закрыт сеанс');return ok({ok:true})}

  // ---------- сотрудники ----------
  const usr=p.match(/^\/api\/admin\/users(?:\/([^/]+))?(?:\/(disable|enable|password|logout))?$/);
  if(usr){const id=usr[1],action=usr[2],x=id?d.users.find(z=>z.id===id):null;if(id&&!x)fail('Сотрудник не найден',404);
   const guardTarget=target=>{if(target&&isAdminRole(target.role)&&!me.admin)fail('Администратора изменяет только администратор',403)};
   if(method==='GET'&&!id)return ok(d.users.map(userView).sort((a,b)=>Number(a.disabled)-Number(b.disabled)||a.name.localeCompare(b.name,'ru')));
   if(method==='GET'&&id&&!action)return ok(userView(x));
   if((method==='POST'&&!id)||(method==='PATCH'&&id&&!action)){
    guardTarget(x);
    const name=str(b.name??x?.name),email=str(b.email??x?.email).toLowerCase(),phone=str(b.phone??x?.phone),position=str(b.position??x?.position),departmentId=str(b.departmentId??x?.departmentId),roleId=str(b.role??x?.role??'manager');
    if(!name||name.length>120)fail('Укажите имя сотрудника (до 120 символов)');
    if(!validEmail(email))fail('Укажите корректный e-mail — он будет логином');
    if(d.users.some(z=>z!==x&&String(z.email||'').toLowerCase()===email))fail('Сотрудник с таким e-mail уже есть',409);
    if(phone.length>40||position.length>120)fail('Слишком длинный телефон или должность');
    if(departmentId&&!(d.departments||[]).some(z=>z.id===departmentId))fail('Отдел не найден');
    if(!Access.roles(d).some(r=>r.id===roleId))fail('Роль не найдена');
    if(isAdminRole(roleId)&&!me.admin)fail('Назначить роль администратора может только администратор',403);
    if(x&&isAdminRole(x.role)&&!isAdminRole(roleId)&&activeAdmins().length<=1&&!x.disabled)fail('Нельзя снять последнего администратора — иначе никто не сможет управлять CRM',409);
    if(x){const roleChanged=x.role!==roleId;Object.assign(x,{name,email,phone,position,departmentId,role:roleId,updatedAt:now()});if(roleChanged)killSessions(x.id);audit('user.update','users',x.id,name+(roleChanged?' · роль: '+roleId:''));return ok(userView(x))}
    let password=b.password,generated=false;if(password===undefined||password===''){password=tempPassword();generated=true}else{const problem=passwordProblem(password,email);if(problem)fail(problem)}
    if(d.users.length>=1000)fail('Достигнут лимит 1000 сотрудников');
    const nx={id:'u_'+crypto.randomUUID(),name,email,phone,position,departmentId,role:roleId,passwordHash:Security.hashPassword(password),mustChangePassword:true,createdAt:now(),createdBy:u.id};
    d.users.push(nx);audit('user.create','users',nx.id,name);
    feedPost(`В команде новый сотрудник: ${name}${position?' — '+position:''}${departmentId?' ('+((d.departments||[]).find(z=>z.id===departmentId)?.name||'')+')':''}. Добро пожаловать!`);
    return ok({...userView(nx),temporaryPassword:generated?password:undefined},201);
   }
   if(method==='POST'&&action){
    guardTarget(x);
    if(action==='disable'){if(x.id===u.id)fail('Нельзя отключить самого себя',409);if(isAdminRole(x.role)&&activeAdmins().length<=1)fail('Нельзя отключить последнего администратора',409);x.disabled=true;x.disabledAt=now();killSessions(x.id);audit('user.disable','users',x.id,x.name);return ok(userView(x))}
    if(action==='enable'){x.disabled=false;x.disabledAt='';audit('user.enable','users',x.id,x.name);return ok(userView(x))}
    if(action==='logout'){killSessions(x.id);audit('user.logout','users',x.id,'Закрыты все сеансы');return ok(userView(x))}
    if(action==='password'){let password=b.password,generated=false;if(password===undefined||password===''){password=tempPassword();generated=true}else{const problem=passwordProblem(password,x.email);if(problem)fail(problem)}x.passwordHash=Security.hashPassword(password);delete x.password;x.mustChangePassword=true;x.passwordChangedAt=now();killSessions(x.id);audit('user.password','users',x.id,'Пароль сброшен администратором');return ok({...userView(x),temporaryPassword:generated?password:undefined})}
   }
  }
  fail('Операция администрирования не найдена',404);
 };
}
module.exports={createAdmin,settings,passwordProblem,tempPassword,DEFAULT_SETTINGS,VAT_RATES};
