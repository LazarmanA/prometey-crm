'use strict';
// 1.6.0: первая регистрация руководителя, приглашения по ссылке, файлы в ленте, доступ из офисной сети.
const {spawn}=require('node:child_process');const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-team-'));
let checks=0;const ok=(c,label)=>{assert.ok(c,label);checks++;console.log('PASS',label)};
const PNG=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4f30000000049454e44ae426082','hex');
function start(env){return new Promise((resolve,reject)=>{const port=40000+Math.floor(Math.random()*20000);
 const p=spawn(process.execPath,['--disable-warning=ExperimentalWarning','server.js'],{cwd:root,env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),DB_FILE:path.join(temp,'db.sqlite'),DATA_FILE:path.join(root,'storage','data.demo.json'),UPLOADS_DIR:path.join(temp,'uploads'),DOCUMENTS_DIR:path.join(temp,'docs'),COOKIE_SECURE:'false',...env},stdio:['ignore','pipe','pipe']});
 let out='';p.stdout.on('data',d=>{out+=d;if(out.includes('ПРОМЕТЕЙ'))resolve({p,base:`http://127.0.0.1:${port}`})});p.stderr.on('data',d=>out+=d);p.on('exit',c=>reject(new Error('exit '+c+' '+out)));setTimeout(()=>reject(new Error('timeout '+out)),15000)})}
let BASE='';
async function req(p,{method='GET',body,token,headers={}}={}){const r=await fetch(BASE+p,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});const ct=r.headers.get('content-type')||'';return {status:r.status,headers:r.headers,body:ct.includes('json')?await r.json():Buffer.from(await r.arrayBuffer())}}
(async()=>{let srv;try{
 srv=await start({PROMETEY_SETUP:'1',PROMETEY_SETUP_TOKEN:'install-token-123456'});BASE=srv.base;
 // ---------- первая регистрация ----------
 let r=await req('/api/setup');ok(r.body.needed===true&&r.body.demo===true,'new install asks the first team member to register');
 ok((await req('/api/config')).body.setup===true,'config tells the browser to show registration');
 for(const [e,pw] of [['director@prometey.local','director'],['manager@prometey.local','manager']])ok((await req('/api/login',{method:'POST',body:{email:e,password:pw}})).status===401,'demo login closed: '+e);
 r=await req('/api/setup',{method:'POST',body:{name:'Андрей Лазарь',email:'boss@firm.ru',password:'Boss-Pass-2026!',company:'ООО Кран'},headers:{'x-forwarded-for':'203.0.113.9'}});
 ok(r.status===403&&r.body.code==='setup_local_only','registration from another computer is refused without the installer link');
 r=await req('/api/setup',{method:'POST',body:{name:'Андрей Лазарь',email:'boss@firm.ru',password:'short',company:'ООО Кран'}});ok(r.status===400&&/12/.test(r.body.error),'weak password explained');
 r=await req('/api/setup',{method:'POST',body:{name:'Андрей Лазарь',email:'boss@firm.ru',phone:'+7 900 000-00-00',password:'Boss-Pass-2026!',company:'ООО Кран',clearDemo:true,token:'install-token-123456'},headers:{'x-forwarded-for':'203.0.113.9'}});
 ok(r.status===200&&r.body.token&&r.body.user.email==='boss@firm.ru'&&r.body.user.perms.admin,'owner registered with the installer link and is signed in as administrator');
 let boss=r.body.token;
 ok((await req('/api/setup')).body.needed===false,'registration closes after the first account');
 ok((await req('/api/setup',{method:'POST',body:{name:'Чужой',email:'x@y.ru',password:'Other-Pass-2026!'}})).status===409,'nobody can register as owner a second time');
 r=await req('/api/privacy',{token:boss});await req('/api/privacy/accept',{method:'POST',token:boss,body:{agree:true,version:r.body.version}});
 r=await req('/api/clients',{token:boss});ok(r.status===200&&r.body.length===0,'demo companies removed on request');
 ok((await req('/api/login',{method:'POST',body:{email:'boss@firm.ru',password:'Boss-Pass-2026!'}})).status===200,'owner signs in with own password');
 // ---------- приглашения ----------
 r=await req('/api/admin/invites',{token:boss});ok(r.status===200&&r.body.networkOff===true&&r.body.roles.length>=2,'invite screen warns that the CRM is not open to the office network yet');
 r=await new Promise((res,rej)=>{const u=new URL(BASE);const q=require('node:http').request({host:u.hostname,port:u.port,path:'/api/admin/invites',method:'POST',headers:{host:'192.168.1.20:3030','content-type':'application/json',authorization:'Bearer '+boss}},x=>{let t='';x.on('data',d=>t+=d);x.on('end',()=>res({status:x.statusCode,body:JSON.parse(t)}))});q.on('error',rej);q.end(JSON.stringify({role:'manager',position:'Менеджер по аренде'}))});
 ok(r.status===201&&r.body.url.startsWith('http://192.168.1.20:3030/#invite=')&&r.body.token,'invite link uses the office address');
 const one=r.body.token,oneId=r.body.id;
 r=await req('/api/invite/'+one);ok(r.status===200&&r.body.company==='ООО Кран'&&r.body.roleName&&r.body.author==='Андрей Лазарь','invite page shows company, role and who invites');
 ok((await req('/api/invite/AAAAAAAAAAAAAAAAAAAAAAAA')).status===410,'unknown link refused');
 r=await req('/api/invite/'+one,{method:'POST',body:{name:'Ольга Петрова',email:'boss@firm.ru',password:'Olga-Pass-2026!'}});ok(r.status===409,'existing e-mail refused');
 r=await req('/api/invite/'+one,{method:'POST',body:{name:'Ольга Петрова',email:'olga@firm.ru',password:'Olga-Pass-2026!'}});
 ok(r.status===200&&r.body.token&&r.body.user.role==='manager'&&r.body.user.position==='Менеджер по аренде'&&!r.body.user.mustChangePassword,'employee registers by link and starts working at once');
 const olga=r.body.token;
 ok((await req('/api/invite/'+one,{method:'POST',body:{name:'Второй',email:'two@firm.ru',password:'Two-Pass-2026!!'}})).status===410,'one-person link works only once');
 r=await req('/api/admin/invites',{method:'POST',token:boss,body:{role:'manager',multi:true}});const multi=r.body.token,multiId=r.body.id;
 for(const n of [1,2])ok((await req('/api/invite/'+multi,{method:'POST',body:{name:'Сотрудник '+n,email:`s${n}@firm.ru`,password:'Staff-Pass-2026!'}})).status===200,'multi-use link: person '+n);
 r=await req('/api/admin/invites',{token:boss});ok(r.body.invites.some(x=>x.id===multiId&&x.used.length===2)&&!r.body.invites.some(x=>x.id===oneId),'invite list shows who registered');
 ok((await req('/api/admin/invites/'+multiId,{method:'DELETE',token:boss})).status===200&&(await req('/api/invite/'+multi)).status===410,'revoked link stops working');
 r=await req('/api/privacy',{token:olga});await req('/api/privacy/accept',{method:'POST',token:olga,body:{agree:true,version:r.body.version}});
 ok((await req('/api/admin/invites',{method:'POST',token:olga,body:{role:'manager'}})).status===403,'manager cannot invite');
 r=await req('/api/admin/invites',{method:'POST',token:boss,body:{role:'director'}});ok(r.status===201,'administrator can invite another director');
 r=await req('/api/feed',{token:boss});ok(r.body.posts.some(p=>p.kind==='system'&&p.text.includes('Ольга Петрова')),'feed welcomes the new employee');
 r=await req('/api/admin/users',{token:boss});ok(r.body.filter(u=>!u.disabled).length===4&&r.body.some(u=>u.email==='manager@prometey.local'&&u.disabled),'team: owner + 3 invited, demo manager disabled');
 // ---------- файлы в ленте ----------
 r=await req('/api/feed/files',{method:'POST',token:olga,body:{name:'фото объекта.png',data:'data:image/png;base64,'+PNG.toString('base64')}});ok(r.status===201&&r.body.image&&r.body.mime==='image/png','photo uploaded to the feed');const img=r.body.id;
 const pdf=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(3*1024*1024,65)]);
 r=await req('/api/feed/files',{method:'POST',token:olga,body:{name:'Договор <аренды>.pdf',data:pdf.toString('base64')}});ok(r.status===201&&!r.body.image&&r.body.name.startsWith('Договор')&&!/[<>]/.test(r.body.name),'3 MB document uploaded, unsafe characters removed from its name');const doc=r.body.id;
 const big=Buffer.alloc(21*1024*1024,1).toString('base64');r=await req('/api/feed/files',{method:'POST',token:olga,body:{name:'big.zip',data:big}});ok(r.status===413,'file over 20 MB refused with a clear message');
 r=await req('/api/feed',{method:'POST',token:olga,body:{text:'',files:[img,doc]}});ok(r.status===201&&r.body.files.length===2&&r.body.text==='','post with files and no text');const post=r.body.id;
 ok((await req('/api/feed',{method:'POST',token:boss,body:{text:'чужие файлы',files:[img]}})).status===404,'cannot attach somebody else\'s file');
 r=await req('/api/feed/files/'+img,{token:boss});ok(r.status===200&&r.headers.get('content-type')==='image/png'&&/inline/.test(r.headers.get('content-disposition'))&&r.body.equals(PNG),'photo opens in the browser');
 r=await req('/api/feed/files/'+doc,{token:boss});ok(r.status===200&&r.headers.get('content-type')==='application/octet-stream'&&/attachment/.test(r.headers.get('content-disposition'))&&r.body.length===pdf.length,'document downloads as a file');
 ok((await req('/api/feed/files/'+img)).status===401,'files are not public');
 ok((await req('/api/feed?q=Договор',{token:boss})).body.posts.some(p=>p.id===post),'feed search finds file names');
 ok((await req('/api/feed/'+post,{method:'DELETE',token:olga})).status===200&&(await req('/api/feed/files/'+img,{token:boss})).status===404&&!fs.existsSync(path.join(temp,'uploads','feed',img)),'deleting the post deletes its files');
 srv.p.kill();await new Promise(r=>srv.p.once('exit',r));
 // ---------- забыли пароль руководителя ----------
 srv=await start({PROMETEY_SETUP:'1',PROMETEY_SETUP_TOKEN:'reset-token-123456',PROMETEY_RESET_OWNER:'reset-token-123456'});BASE=srv.base;
 r=await req('/api/setup');ok(r.body.needed&&r.body.reset&&r.body.name==='Андрей Лазарь'&&r.body.demo===false,'recovery mode: no "remove demo data" option');
 r=await req('/api/setup',{method:'POST',body:{name:'Андрей Лазарь',email:'andrey@firm.ru',password:'New-Boss-Pass-2027!',clearDemo:true}});ok(r.status===200&&r.body.user.perms.admin,'owner sets a new e-mail and password');
 boss=r.body.token;r=await req('/api/admin/users',{token:boss});ok(r.status===200&&r.body.filter(u=>!u.disabled).length===4,'all employees kept after recovery');
 ok((await req('/api/feed',{token:boss})).body.posts.length>0,'data kept after recovery');
 srv.p.kill();await new Promise(r=>srv.p.once('exit',r));
 srv=await start({PROMETEY_SETUP:'1',PROMETEY_SETUP_TOKEN:'reset-token-123456',PROMETEY_RESET_OWNER:'reset-token-123456'});BASE=srv.base;
 ok((await req('/api/setup')).body.needed===false,'same recovery link cannot be used again after restart');
 // ---------- брандмауэр ----------
 const cmd=require('../lib/server-admin').firewallCommands('C:\\Users\\Андрей\\AppData\\Local\\Prometey\\runtime\\node.exe',3030);
 ok(cmd.includes('delete rule name=all program="C:\\Users\\Андрей')&&cmd.includes('localport=3030')&&cmd.includes('remoteip=localsubnet')&&cmd.includes('profile=any'),'firewall: removes Windows "block" rules for node.exe and allows the office network only');
 console.log(`OK team: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{try{srv?.p.kill()}catch{};fs.rmSync(temp,{recursive:true,force:true})}})();
