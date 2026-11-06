'use strict';
// Перенос: CRM на компьютере (установщик Windows) → CRM на сервере (install-server.sh). Плюс «Мой архив».
const {spawn}=require('node:child_process');const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-transfer-'));
let checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
const PNG=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4f30000000049454e44ae426082','hex');
function start(dir,env){fs.mkdirSync(dir,{recursive:true});return new Promise((resolve,reject)=>{const port=42000+Math.floor(Math.random()*15000);
 const p=spawn(process.execPath,['--disable-warning=ExperimentalWarning','server.js'],{cwd:root,env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),DB_FILE:path.join(dir,'db.sqlite'),UPLOADS_DIR:path.join(dir,'uploads'),DOCUMENTS_DIR:path.join(dir,'documents'),RECORDINGS_DIR:path.join(dir,'recordings'),BACKUP_DIR:path.join(dir,'backups'),COOKIE_SECURE:'false',...env},stdio:['ignore','pipe','pipe']});
 let out='';p.stdout.on('data',d=>{out+=d;if(out.includes('ПРОМЕТЕЙ'))resolve({p,base:`http://127.0.0.1:${port}`})});p.stderr.on('data',d=>out+=d);p.on('exit',c=>reject(new Error('exit '+c+' '+out)));setTimeout(()=>reject(new Error('timeout '+out)),15000)})}
const stop=s=>new Promise(r=>{s.p.once('exit',r);s.p.kill()});
const mk=base=>async(p,{method='GET',body,raw,token,type='application/json'}={})=>{const r=await fetch(base+p,{method,headers:{'content-type':type,...(token?{authorization:'Bearer '+token}:{})},body:raw??(body===undefined?undefined:JSON.stringify(body))});const ct=r.headers.get('content-type')||'';return {status:r.status,headers:r.headers,body:ct.includes('json')?await r.json():Buffer.from(await r.arrayBuffer())}};
const consent=async(req,t)=>{const r=await req('/api/privacy',{token:t});await req('/api/privacy/accept',{method:'POST',token:t,body:{agree:true,version:r.body.version}})};
(async()=>{let pc,srv;try{
 // ---------- компьютер в офисе ----------
 pc=await start(path.join(temp,'pc'),{PROMETEY_SETUP:'1',PROMETEY_SETUP_TOKEN:'pc-token-1234567890'});let req=mk(pc.base);
 let r=await req('/api/setup',{method:'POST',body:{name:'Андрей Лазарь',email:'boss@kran.ru',password:'Kran-Boss-2026!',company:'ООО Кран',clearDemo:false}});const boss=r.body.token;await consent(req,boss);
 r=await req('/api/admin/invites',{method:'POST',token:boss,body:{role:'accountant',position:'Бухгалтер'}});
 r=await req('/api/invite/'+r.body.token,{method:'POST',body:{name:'Мария Счётова',email:'buh@kran.ru',password:'Buh-Kran-2026!!'}});const buh=r.body.token;await consent(req,buh);
 ok(r.status===200&&r.body.user.role==='accountant','accountant registered on the office PC');
 r=await req('/api/clients',{method:'POST',token:boss,body:{name:'ООО Стройка',inn:'7701234567',address:'Москва',equipmentType:'Кран',note:'перенос',ownership:'own',requestAt:'2026-11-06T10:00'}});ok(r.status===201,'client created');
 const orders=(await req('/api/orders',{token:boss})).body;const order=orders[0];
 assert.ok(order,'demo deal exists');{r=await req(`/api/orders/${order.id}/chat`,{method:'POST',token:boss,body:{text:'Мария, выставите счёт по этой сделке',nonce:'nonce-transfer-0001'}});ok(r.status===201,'message in a deal chat')}
 r=await req('/api/feed/files',{method:'POST',token:boss,body:{name:'объект.png',data:PNG.toString('base64')}});const fileId=r.body.id;
 r=await req('/api/feed',{method:'POST',token:boss,body:{text:'Добро пожаловать в CRM! Фото объекта во вложении',files:[fileId]}});ok(r.status===201,'feed post with a photo');
 // ---------- «Мой архив» ----------
 r=await req('/api/archive/messages',{token:buh});const html=r.body.toString();
 ok(r.status===200&&/attachment/.test(r.headers.get('content-disposition'))&&html.includes('Добро пожаловать в CRM!')&&html.includes('объект.png')&&html.includes('Мария Счётова'),'employee downloads own archive of the feed (HTML)');
 if(order){const h2=(await req('/api/archive/messages',{token:boss})).body.toString();ok(h2.includes('выставите счёт'),'archive includes deal chat messages')}
 ok((await req('/api/archive/messages')).status===401,'archive needs sign-in');
 // ---------- выгрузка ----------
 ok((await req('/api/admin/transfer/export',{token:buh})).status===403,'only an administrator exports');
 r=await req('/api/admin/transfer/export',{token:boss});const zip=r.body;
 ok(r.status===200&&r.headers.get('content-type')==='application/zip'&&zip.length>500&&/prometey-perenos-/.test(decodeURIComponent(r.headers.get('content-disposition'))),'transfer archive downloaded');
 const entries=require('../lib/zip').readZip(zip);const manifest=JSON.parse(entries.get('manifest.json'));
 ok(manifest.counts.users>=3&&manifest.counts.clients>=2&&manifest.counts.messages>=1&&[...entries.keys()].some(k=>k.startsWith('files/uploads/feed/')),'archive has data, employees and feed files');
 ok(!JSON.parse(entries.get('data.json')).sessions.length,'no live sessions in the archive');
 await stop(pc);pc=null;
 // ---------- сервер в интернете ----------
 const SRV={PROMETEY_ADMIN_EMAIL:'admin@server.ru',PROMETEY_ADMIN_PASSWORD:'Server-Admin-2026!',PROMETEY_MANAGER_EMAIL:'manager@server.ru',PROMETEY_MANAGER_PASSWORD:'Server-Manag-2026!'};
 srv=await start(path.join(temp,'srv'),SRV);req=mk(srv.base);
 let admin=(await req('/api/login',{method:'POST',body:{email:'admin@server.ru',password:'Server-Admin-2026!'}})).body.token;await consent(req,admin);
 ok((await req('/api/admin/transfer/import',{method:'POST',token:admin,raw:Buffer.from('not a zip'),type:'application/zip'})).status===400,'wrong file refused');
 const broken=Buffer.from(zip);broken[broken.length-30]^=0xff;
 r=await req('/api/admin/transfer/import',{method:'POST',token:admin,raw:require('../lib/zip').writeZip(new Map([['manifest.json',entries.get('manifest.json')],['data.json',Buffer.from('{"users":[]}')]])),type:'application/zip'});ok(r.status===400&&/контрольной/.test(r.body.error),'tampered archive refused');
 r=await req('/api/admin/transfer/import',{method:'POST',token:admin,raw:zip,type:'application/zip'});
 ok(r.status===200&&r.body.counts.clients>=2&&r.body.files>=1&&r.body.backup.startsWith('before-transfer-'),'archive loaded on the server, backup made');
 ok(fs.readdirSync(path.join(temp,'srv','backups')).some(f=>f.startsWith('before-transfer-')),'backup file exists');
 ok((await req('/api/clients',{token:admin})).status===401,'old sessions closed after the transfer');
 let t=(await req('/api/login',{method:'POST',body:{email:'boss@kran.ru',password:'Kran-Boss-2026!'}})).body.token;ok(t,'owner signs in on the server with the same password');
 ok((await req('/api/login',{method:'POST',body:{email:'buh@kran.ru',password:'Buh-Kran-2026!!'}})).status===200,'accountant signs in on the server with the same password');
 ok((await req('/api/clients',{token:t})).body.some(c=>c.name==='ООО Стройка'),'clients transferred');
 const post=(await req('/api/feed',{token:t})).body.posts.find(p=>p.text.includes('Добро пожаловать в CRM!'));
 ok(post&&post.files.length===1,'feed transferred');
 r=await req('/api/feed/files/'+post.files[0].id,{token:t});ok(r.status===200&&r.body.equals(PNG),'feed photo transferred');
 if(order){r=await req(`/api/orders/${order.id}/chat`,{token:t});ok(JSON.stringify(r.body).includes('выставите счёт'),'deal chat transferred')}
 await stop(srv);srv=await start(path.join(temp,'srv'),SRV);req=mk(srv.base);
 ok((await req('/api/login',{method:'POST',body:{email:'boss@kran.ru',password:'Kran-Boss-2026!'}})).status===200,'after server restart the owner keeps own login (server settings do not overwrite it)');
 ok((await req('/api/login',{method:'POST',body:{email:'admin@server.ru',password:'Server-Admin-2026!'}})).status===401,'temporary server admin account replaced by the company owner');
 console.log(`OK transfer: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{for(const s of [pc,srv])try{s?.p.kill()}catch{};fs.rmSync(temp,{recursive:true,force:true})}})();
