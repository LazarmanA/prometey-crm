// Администрирование (сотрудники, роли и права, отделы, сеансы, настройки), профиль, лента.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-admin-'));
process.env.DB_FILE=path.join(temp,'db.sqlite');process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.RECORDINGS_DIR=path.join(temp,'recordings');
const server=require('../server');
const Security=require('../lib/security'),{Store}=require('../lib/database');
let base,checks=0;const check=(ok,label)=>{assert.ok(ok,label);checks++;console.log('PASS',label)};
async function req(p,token,method='GET',body){const r=await fetch(base+p,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});let json=null;try{json=await r.json()}catch{}return {status:r.status,body:json}}
// Сотрудник при первом входе принимает политику обработки ПДн (как в интерфейсе).
const login=async(email,password)=>{const t=(await req('/api/login',null,'POST',{email,password})).body?.token;if(t){const p=(await req('/api/privacy',t)).body;if(p?.required)await req('/api/privacy/accept',t,'POST',{agree:true,version:p.version})}return t};
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 const D=await login('director@prometey.local','director'),M=await login('manager@prometey.local','manager');
 check((await req('/api/session',D)).body.user.perms.admin===true,'director is administrator');
 check((await req('/api/admin',M)).status===403&&(await req('/api/admin/users',M)).status===403,'manager has no admin access');

 // --- сотрудники ---
 let r=await req('/api/admin/users',D,'POST',{name:'Ольга Счётова',email:'Olga@Firma.ru',role:'accountant',position:'Главный бухгалтер'});
 check(r.status===201&&/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/.test(r.body.temporaryPassword)&&r.body.email==='olga@firma.ru','admin creates employee with a one-time temporary password');
 const olgaId=r.body.id,temp1=r.body.temporaryPassword;
 check((await req('/api/admin/users',D,'POST',{name:'Дубль',email:'olga@firma.ru',role:'manager'})).status===409,'duplicate e-mail rejected');
 check((await req('/api/admin/users',D,'POST',{name:'Слабый',email:'weak@firma.ru',role:'manager',password:'12345678'})).status===400,'weak password rejected');
 let O=await login('olga@firma.ru',temp1);check(!!O,'employee logs in with the temporary password');
 check((await req('/api/accounting/summary',O)).status===403&&(await req('/api/orders',O)).status===403,'until the password is changed, work is blocked');
 check((await req('/api/profile/password',O,'POST',{current:'wrong',next:'Olga-Strong-2026!'})).status===403,'current password is verified');
 check((await req('/api/profile/password',O,'POST',{current:temp1,next:'short'})).status===400,'new password strength enforced');
 check((await req('/api/profile/password',O,'POST',{current:temp1,next:'Olga-Strong-2026!'})).status===200,'employee sets own password');
 check((await req('/api/orders',O)).status===200,'after the change the session keeps working');
 const feedNew=(await req('/api/feed',O)).body.posts.find(p=>p.kind==='system'&&p.text.includes('Ольга Счётова'));check(!!feedNew,'feed announces the new employee');

 // --- права бухгалтера ---
 const ords=(await req('/api/orders',O)).body;check(ords.length===2,'accountant (CRM: read) sees all deals');
 check((await req('/api/orders/o1',O,'PATCH',{name:'x'})).status===404,'accountant cannot edit deals');
 check((await req('/api/finance',O)).body.scope==='company','accountant sees company finance');
 check((await req('/api/accounting/summary',O)).status===200&&(await req('/api/accounting/summary',M)).status===403,'accounting open for accountant, closed for manager');
 check((await req('/api/admin/users',O)).status===403,'accountant is not an administrator');

 // --- роли ---
 const roles=(await req('/api/admin/roles',D)).body;check(roles.schema.length>=10&&roles.roles.some(x=>x.id==='accountant'),'role matrix with presets');
 r=await req('/api/admin/roles',D,'POST',{name:'Диспетчер',permissions:{crm:'read',feed:'moderate',users:'no'}});check(r.status===201,'custom role created');const dispatcher=r.body.id;
 check((await req('/api/admin/roles',D,'POST',{name:'Плохая',permissions:{crm:'god'}})).status===400,'unknown permission level rejected');
 check((await req('/api/admin/roles/director',D,'PATCH',{permissions:{crm:'none'}})).status===409,'administrator role is immutable');
 r=await req('/api/admin/users',D,'POST',{name:'Пётр Диспетчер',email:'disp@firma.ru',role:dispatcher,password:'Disp-Strong-2026!'});check(r.status===201&&r.body.temporaryPassword===undefined,'admin may set the password directly');
 const petrId=r.body.id;let P=await login('disp@firma.ru','Disp-Strong-2026!');await req('/api/profile/password',P,'POST',{current:'Disp-Strong-2026!',next:'Disp-Strong-2027!'});
 check((await req('/api/orders',P)).body.length===2,'custom role «read» sees all deals');
 check((await req('/api/accounting/summary',P)).status===403,'custom role without accounting is blocked');
 await req('/api/admin/roles/'+dispatcher,D,'PATCH',{permissions:{crm:'none'}});
 check((await req('/api/orders',P)).body.length===0,'permission change applies immediately (no re-login)');
 check((await req('/api/admin/roles/'+dispatcher,D,'DELETE')).status===409,'role in use cannot be deleted');
 await req('/api/admin/roles/manager',D,'PATCH',{permissions:{finance:'none'}});
 check((await req('/api/finance',M)).status===403,'preset role can be customised');
 await req('/api/admin/roles/manager',D,'DELETE');check((await req('/api/finance',M)).status===200,'preset role reset to defaults');

 // --- делегирование: право «Сотрудники» без администратора ---
 r=await req('/api/admin/roles',D,'POST',{name:'Кадровик',permissions:{users:'yes',feed:'post'}});const hr=r.body.id;
 await req('/api/admin/users',D,'POST',{name:'Ирина Кадры',email:'hr@firma.ru',role:hr,password:'Hr-Strong-2026!x'});let H=await login('hr@firma.ru','Hr-Strong-2026!x');await req('/api/profile/password',H,'POST',{current:'Hr-Strong-2026!x',next:'Hr-Strong-2027!x'});
 check((await req('/api/admin/users',H)).status===200,'HR role manages employees');
 check((await req('/api/admin/users',H,'POST',{name:'Новый админ',email:'evil@firma.ru',role:'director'})).status===403,'HR cannot create administrators');
 check((await req('/api/admin/users/u-director',H,'PATCH',{name:'hack'})).status===403,'HR cannot edit the administrator');
 check((await req('/api/admin/users/'+(await req('/api/admin/users',H)).body.find(u=>u.email==='hr@firma.ru').id,H,'PATCH',{role:'director'})).status===403,'HR cannot promote itself');
 check((await req('/api/admin/roles/'+hr,H,'PATCH',{permissions:{users:'yes',accounting:'edit'}})).status===403,'HR cannot change role permissions');

 // --- защита от потери доступа ---
 check((await req('/api/admin/users/u-director/disable',D,'POST',{})).status===409,'cannot disable yourself / the last administrator');
 check((await req('/api/admin/users/u-director',D,'PATCH',{role:'manager'})).status===409,'cannot demote the last administrator');

 // --- отключение и сброс пароля ---
 check((await req('/api/admin/users/'+petrId+'/disable',D,'POST',{})).status===200,'employee disabled');
 check((await req('/api/me',P)).status===401&&!(await login('disp@firma.ru','Disp-Strong-2027!')),'disabled employee: sessions closed, login refused');
 await req('/api/admin/users/'+petrId+'/enable',D,'POST',{});
 r=await req('/api/admin/users/'+petrId+'/password',D,'POST',{});check(r.status===200&&!!r.body.temporaryPassword,'password reset gives a new temporary password');
 P=await login('disp@firma.ru',r.body.temporaryPassword);check((await req('/api/orders',P)).status===403,'after reset the employee must change it again');

 // --- отделы ---
 r=await req('/api/admin/departments',D,'POST',{name:'Бухгалтерия',headId:olgaId});check(r.status===201,'department created');const dep=r.body.id;
 await req('/api/admin/users/'+olgaId,D,'PATCH',{departmentId:dep});
 check((await req('/api/admin/departments',D)).body.find(x=>x.id===dep).members===1,'department membership counted');
 check((await req('/api/admin/departments/'+dep,D,'DELETE')).status===409,'department with employees cannot be deleted');

 // --- сеансы ---
 const sessions=(await req('/api/admin/sessions',D)).body;check(sessions.length>=3&&sessions.every(s=>'ip' in s),'active sessions listed with address');
 const olgaSess=sessions.find(s=>s.userId===olgaId);check((await req('/api/admin/sessions/'+olgaSess.id,D,'DELETE')).status===200&&(await req('/api/me',O)).status===401,'admin closes a session remotely');
 O=await login('olga@firma.ru','Olga-Strong-2026!');

 // --- настройки ---
 check((await req('/api/admin/settings',D,'PATCH',{vat:{defaultRate:99}})).status===400,'invalid VAT rejected');
 r=await req('/api/admin/settings',D,'PATCH',{companyName:'ООО Спецтехника',vat:{defaultRate:22},accounting:{signerName:'Петров Пётр Петрович',okei:{shift:['','смена']}}});check(r.status===200&&r.body.accounting.signerName==='Петров Пётр Петрович','settings saved');
 check((await req('/api/admin/settings',M,'PATCH',{companyName:'x'})).status===403,'manager cannot change settings');

 // --- профиль ---
 r=await req('/api/profile',M,'PATCH',{name:'Иван Менеджеров',phone:'+79990001122'});check(r.status===200&&r.body.name==='Иван Менеджеров','own profile edited');

 // --- лента ---
 r=await req('/api/feed',M,'POST',{text:'Завтра ТО крана Liebherr, техника недоступна до 12:00',important:true});check(r.status===201,'manager publishes');const post=r.body.id;
 check((await req('/api/feed/unread',O)).body.important>=1,'important unread counter');
 check((await req(`/api/feed/${post}/read`,O,'POST',{})).body.readByMe===true,'«Прочитал» confirmation');
 check((await req('/api/feed?filter=unread',O)).body.posts.every(p=>p.id!==post),'read post leaves «unread» filter');
 check((await req(`/api/feed/${post}/like`,O,'POST',{})).body.likes===1,'like');check((await req(`/api/feed/${post}/like`,O,'POST',{})).body.likes===0,'unlike');
 r=await req(`/api/feed/${post}/comments`,O,'POST',{text:'Принято, перенесу смену'});check(r.status===201&&r.body.comments.length===1,'comment');const com=r.body.comments[0].id;
 check((await req(`/api/feed/${post}/comments/${com}`,M,'DELETE')).status===403,'cannot delete someone else\'s comment');
 check((await req(`/api/feed/${post}`,O,'PATCH',{text:'hack'})).status===403,'cannot edit someone else\'s post');
 check((await req(`/api/feed/${post}/pin`,M,'POST',{pinned:true})).status===403,'only moderator pins');
 check((await req(`/api/feed/${post}/pin`,D,'POST',{pinned:true})).status===200&&(await req('/api/feed',M)).body.posts[0].id===post,'moderator pins to the top');
 check((await req('/api/feed',M,'POST',{text:''})).status===400&&(await req('/api/feed',M,'POST',{text:'x'.repeat(5001)})).status===400,'post length validated');
 await req('/api/admin/settings',D,'PATCH',{feed:{allowComments:false}});check((await req(`/api/feed/${post}/comments`,O,'POST',{text:'x'})).status===403,'comments can be disabled');await req('/api/admin/settings',D,'PATCH',{feed:{allowComments:true}});
 let flood=0;for(let i=0;i<17;i++)if((await req('/api/feed',M,'POST',{text:'спам '+i})).status===429)flood++;check(flood>0,'feed flood protection');
 check((await req(`/api/feed/${post}`,D,'DELETE')).status===200,'moderator deletes a post');
 const roleRead=await req('/api/admin/roles',D,'POST',{name:'Только чтение',permissions:{crm:'own',feed:'read'}});await req('/api/admin/users',D,'POST',{name:'Читатель',email:'reader@firma.ru',role:roleRead.body.id,password:'Reader-Strong-1!'});let R=await login('reader@firma.ru','Reader-Strong-1!');await req('/api/profile/password',R,'POST',{current:'Reader-Strong-1!',next:'Reader-Strong-2!'});
 check((await req('/api/feed',R,'POST',{text:'привет'})).status===403&&(await req('/api/feed',R)).status===200,'«read» role reads but cannot publish');

 // --- учётные данные из настроек сервера: только первые руководитель и менеджер, смена в интерфейсе не сбрасывается ---
 const seed=path.join(temp,'seed.json');fs.writeFileSync(seed,JSON.stringify({...JSON.parse(fs.readFileSync(path.join(__dirname,'../storage/data.demo.json'),'utf8')),users:[...JSON.parse(fs.readFileSync(path.join(__dirname,'../storage/data.demo.json'),'utf8')).users,{id:'u-m2',name:'Второй менеджер',email:'m2@firma.ru',role:'manager',passwordHash:Security.hashPassword('Second-Manager-1!')}]}));
 const env={NODE_ENV:'production',PROMETEY_ADMIN_EMAIL:'boss@firma.ru',PROMETEY_ADMIN_PASSWORD:'Boss-Strong-2026!',PROMETEY_MANAGER_EMAIL:'sales@firma.ru',PROMETEY_MANAGER_PASSWORD:'Sales-Strong-2026!'};
 let st=new Store(path.join(temp,'prod.sqlite'),seed);Security.bootstrapPasswords(st,env);let data=st.read();
 check(data.users.find(u=>u.id==='u-m2').email==='m2@firma.ru'&&Security.verifyPassword(data.users.find(u=>u.id==='u-m2').passwordHash,'Second-Manager-1!'),'other managers keep their own login and password');
 st.transaction(d=>{d.users.find(u=>u.id==='u-director').passwordHash=Security.hashPassword('Changed-In-UI-2026!');return {changed:true}});
 Security.bootstrapPasswords(st,env);data=st.read();check(Security.verifyPassword(data.users.find(u=>u.id==='u-director').passwordHash,'Changed-In-UI-2026!'),'password changed in the UI survives a restart');
 Security.bootstrapPasswords(st,{...env,PROMETEY_ADMIN_PASSWORD:'New-From-Server-2026!'});data=st.read();check(Security.verifyPassword(data.users.find(u=>u.id==='u-director').passwordHash,'New-From-Server-2026!'),'new password from server settings (prometey passwords) is applied');
 st.close();

 console.log(`OK admin + feed: ${checks} checks`);
}finally{server.closeIdleConnections?.();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exit(1)});
