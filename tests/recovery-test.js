'use strict';
// 1.6.2: восстановление пароля — код восстановления, запрос руководителю, одноразовая ссылка.
const {spawn}=require('node:child_process');const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-recovery-'));
let checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
const port=43000+Math.floor(Math.random()*15000),BASE=`http://127.0.0.1:${port}`;
const req=async(p,{method='GET',body,token}={})=>{const r=await fetch(BASE+p,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)}};
const login=(email,password)=>req('/api/login',{method:'POST',body:{email,password}});
const consent=async t=>{const r=await req('/api/privacy',{token:t});await req('/api/privacy/accept',{method:'POST',token:t,body:{agree:true,version:r.body.version}})};
(async()=>{let p;try{
 p=spawn(process.execPath,['--disable-warning=ExperimentalWarning','server.js'],{cwd:root,env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),PROMETEY_SETUP:'1',PROMETEY_SETUP_TOKEN:'rec-token-1234567890',DB_FILE:path.join(temp,'db.sqlite'),UPLOADS_DIR:path.join(temp,'up'),COOKIE_SECURE:'false'},stdio:['ignore','pipe','pipe']});
 await new Promise((res,rej)=>{let o='';p.stdout.on('data',d=>{o+=d;if(o.includes('ПРОМЕТЕЙ'))res()});p.stderr.on('data',d=>o+=d);setTimeout(()=>rej(new Error(o)),15000)});
 // регистрация руководителя → код восстановления
 let r=await req('/api/setup',{method:'POST',body:{name:'Андрей Лазарь',email:'boss@kran.ru',password:'Kran-Boss-2026!',company:'ООО Кран'}});
 const code1=r.body.recoveryCode;ok(r.status===200&&/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(code1),'owner gets a recovery code at registration: '+code1.slice(0,4)+'-…');
 ok(!JSON.stringify(r.body.user).includes('recoveryCodeHash'),'code hash never leaves the server');
 let boss=r.body.token;await consent(boss);
 // приглашённый сотрудник тоже получает код
 r=await req('/api/admin/invites',{method:'POST',token:boss,body:{role:'manager'}});
 r=await req('/api/invite/'+r.body.token,{method:'POST',body:{name:'Ольга',email:'olga@kran.ru',password:'Olga-Kran-2026!'}});const olgaCode=r.body.recoveryCode,olgaId=r.body.user.id;ok(olgaCode&&olgaCode!==code1,'invited employee gets own recovery code');
 // восстановление кодом
 ok((await req('/api/password/recover',{method:'POST',body:{email:'boss@kran.ru',code:'AAAA-BBBB-CCCC-DDDD',password:'New-Boss-2026!x'}})).status===400,'wrong code refused');
 ok((await req('/api/password/recover',{method:'POST',body:{email:'nobody@kran.ru',code:code1,password:'New-Boss-2026!x'}})).body.error===(await req('/api/password/recover',{method:'POST',body:{email:'boss@kran.ru',code:'AAAA-BBBB-CCCC-DDDD',password:'New-Boss-2026!x'}})).body.error,'same answer for unknown e-mail (no hints)');
 ok((await req('/api/password/recover',{method:'POST',body:{email:'boss@kran.ru',code:code1,password:'short'}})).status===400,'weak new password refused, code still valid');
 r=await req('/api/password/recover',{method:'POST',body:{email:'BOSS@kran.ru',code:code1.toLowerCase().replace(/-/g,' '),password:'New-Boss-2026!x'}});
 ok(r.status===200&&r.body.token&&r.body.recoveryCode&&r.body.recoveryCode!==code1,'recovered with the code (any case, spaces) — signed in, new code issued');
 const code2=r.body.recoveryCode;
 ok((await req('/api/clients',{token:boss})).status===401,'old sessions closed after recovery');
 ok((await login('boss@kran.ru','Kran-Boss-2026!')).status===401&&(await login('boss@kran.ru','New-Boss-2026!x')).status===200,'old password stops working, new one works');
 ok((await req('/api/password/recover',{method:'POST',body:{email:'boss@kran.ru',code:code1,password:'Other-Boss-2026!'}})).status===400,'used code cannot be reused');
 boss=(await login('boss@kran.ru','New-Boss-2026!x')).body.token;
 // нет кода: запрос руководителю → ссылка
 r=await req('/api/password/request',{method:'POST',body:{email:'olga@kran.ru'}});ok(r.status===200&&/руководителю/.test(r.body.message),'employee asks the manager for a new password');
 ok((await req('/api/password/request',{method:'POST',body:{email:'ghost@kran.ru'}})).body.message===r.body.message,'same answer for unknown e-mail');
 r=await req('/api/admin/password-requests',{token:boss});ok(r.body.length===1&&r.body[0].email==='olga@kran.ru','owner sees the request');
 const olga=(await login('olga@kran.ru','Olga-Kran-2026!')).body.token;await consent(olga);
 ok((await req(`/api/admin/users/${olgaId}/reset-link`,{method:'POST',token:olga,body:{}})).status===403,'employee cannot create reset links');
 r=await req(`/api/admin/users/${olgaId}/reset-link`,{method:'POST',token:boss,body:{}});const link=r.body.link.split('#reset=')[1];ok(r.status===201&&link,'owner creates a one-time link');
 ok((await req('/api/admin/password-requests',{token:boss})).body.length===0,'request cleared once a link is made');
 r=await req('/api/password/reset/'+link);ok(r.status===200&&r.body.email==='olga@kran.ru','link shows whose password is set');
 r=await req('/api/password/reset/'+link,{method:'POST',body:{password:'Olga-New-2026!!'}});ok(r.status===200&&r.body.token&&r.body.recoveryCode,'employee sets a new password by the link and is signed in');
 ok((await req('/api/password/reset/'+link,{method:'POST',body:{password:'Olga-Again-2026!'}})).status===410,'link works only once');
 ok((await login('olga@kran.ru','Olga-New-2026!!')).status===200,'new password works');
 // профиль: новый код только с текущим паролем
 ok((await req('/api/profile/recovery-code',{method:'POST',token:boss,body:{current:'wrong'}})).status===400,'new code needs the current password');
 r=await req('/api/profile/recovery-code',{method:'POST',token:boss,body:{current:'New-Boss-2026!x'}});ok(r.status===200&&r.body.recoveryCode&&r.body.recoveryCode!==code2,'new code from the profile');
 ok((await req('/api/password/recover',{method:'POST',body:{email:'boss@kran.ru',code:code2,password:'Other-Boss-2026!'}})).status===400,'previous code invalid after a new one');
 // перебор кодов ограничен
 let limited=false;for(let i=0;i<40&&!limited;i++)limited=(await req('/api/password/recover',{method:'POST',body:{email:'olga@kran.ru',code:'ZZZZ-ZZZZ-ZZZZ-ZZZ'+(i%9+1),password:'X-Pass-2026!!!'}})).status===429;
 ok(limited,'guessing codes is throttled');
 console.log(`OK recovery: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{try{p?.kill()}catch{};fs.rmSync(temp,{recursive:true,force:true})}})();
