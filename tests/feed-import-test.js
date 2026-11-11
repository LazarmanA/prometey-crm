'use strict';
// «Перенос данных → Добавить только ленту»: сообщения ленты с файлами из другой CRM добавляются, остальные данные не трогаются.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-feedimp-'));process.env.DATA_FILE=path.join(temp,'data.json');process.env.UPLOADS_DIR=path.join(temp,'up');process.env.DOCUMENTS_DIR=path.join(temp,'docs');process.env.BACKUP_DIR=path.join(temp,'bk');process.env.PROMETEY_CHROMIUM='/nonexistent';
fs.copyFileSync(path.join(__dirname,'../storage/data.demo.json'),process.env.DATA_FILE);const server=require('../server');const {writeZip}=require('../lib/zip');let base,checks=0;
const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
async function req(p,token,method='GET',body,type='application/json'){const r=await fetch(base+p,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':type},body:body===undefined?undefined:(Buffer.isBuffer(body)?body:JSON.stringify(body))});const ct=r.headers.get('content-type')||'';return {status:r.status,body:ct.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer())}}
// архив как из «Перенос данных» CRM 1.6.x на компьютере бухгалтера
function archive(users,feed,feedFiles,files){const data=Buffer.from(JSON.stringify({users,feed,feedFiles,clients:[{id:'c-old',name:'Чужая компания'}]}));
 return writeZip(new Map([['manifest.json',JSON.stringify({format:'prometey-transfer',formatVersion:1,crmVersion:'1.6.1',createdAt:'2026-11-11T10:00:00Z',counts:{},files:{},sha256:crypto.createHash('sha256').update(data).digest('hex')})],['data.json',data],...Object.entries(files).map(([id,b])=>['files/uploads/feed/'+id,b])]))}
(async()=>{try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});base='http://127.0.0.1:'+server.address().port;
 const login=async role=>(await req('/api/login',null,'POST',{email:role+'@prometey.local',password:role})).body.token;
 const director=await login('director'),manager=await login('manager');for(const t of [director,manager]){const r=await req('/api/privacy',t);await req('/api/privacy/accept',t,'POST',{agree:true,version:r.body.version})}
 const D=()=>structuredClone(server.store.read());const before=D();const dir=before.users.find(u=>u.email==='director@prometey.local');
 const id=()=>'f_'+crypto.randomUUID(),f1=id(),f2=id(),f3=id();const pdf=Buffer.from('%PDF-1.4 УПД 562');
 const users=[{id:'u-director',email:'admin@prometey.local',name:dir.name,role:'director'},{id:'u-buh',email:'director@prometey.local',name:'Мария',role:'accountant'},{id:'u-x',email:'x@old.local',name:'Уволенный',role:'manager'}];
 const feed=[{id:'post-welcome',kind:'system',text:'Добро пожаловать',createdAt:'2026-10-01T09:00:00Z',files:[]},
  {id:'post_'+crypto.randomUUID(),kind:'post',authorId:'u-buh',text:'ООО "СПЕЦ ТРАНС"\nнет заказа, прислали только упд',createdAt:'2026-11-06T09:21:40Z',files:[f1,f2],likes:['u-x'],comments:[{id:'c1',authorId:'u-director',text:'ок',at:'2026-11-06T09:30:00Z'}],readBy:['u-x']},
  {id:'post_'+crypto.randomUUID(),kind:'post',authorId:'u-x',text:'ООО "ГРАФ-СТРОЙ" 4606',createdAt:'2026-11-06T09:37:00Z',files:[f3]},
  {id:'post_'+crypto.randomUUID(),kind:'post',authorId:'u-director',text:'ИП Саркисян — нет заказа',createdAt:'2026-11-06T09:35:00Z',files:[]}];
 const feedFiles=[{id:f1,name:'Счет-фактура и УПД 30.06.26 № 562.pdf',size:pdf.length,mime:'application/pdf',authorId:'u-buh',at:'2026-11-06T09:21:38Z',postId:feed[1].id},{id:f2,name:'фото.png',size:3,mime:'image/png',authorId:'u-buh',postId:feed[1].id},{id:f3,name:'УПД 298.pdf',size:3,mime:'application/pdf',authorId:'u-x',postId:feed[2].id}];
 const zip=archive(users,feed,feedFiles,{[f1]:pdf,[f2]:Buffer.from('png'),[f3]:Buffer.from('pdf')});
 let r=await req('/api/admin/transfer/import?mode=feed',manager,'POST',zip,'application/zip');ok(r.status===403,'only an administrator can add a feed');
 r=await req('/api/admin/transfer/import?mode=feed',director,'POST',zip,'application/zip');
 ok(r.status===200&&r.body.posts===3&&r.body.files===3&&!r.body.skipped&&!r.body.missing,'3 posts and 3 files added (system greeting skipped)');
 let d=D();ok(d.clients.length===before.clients.length&&d.orders.length===before.orders.length&&d.users.length===before.users.length&&!d.clients.some(c=>c.id==='c-old'),'companies, deals and employees are not touched');
 ok(d.feed.length===(before.feed||[]).length+3,'feed grew by 3 posts; old posts kept');
 const p1=d.feed.find(x=>x.id===feed[1].id),p2=d.feed.find(x=>x.id===feed[2].id),p3=d.feed.find(x=>x.id===feed[3].id);
 ok(p1.authorId===dir.id&&p3.authorId===dir.id,'authors matched by e-mail, then by name');
 ok(p2.authorId===dir.id&&p1.likes.every(x=>d.users.some(u=>u.id===x))&&p1.readBy.length===0,'unknown author → the importer; no dangling user ids');
 ok(p1.createdAt==='2026-11-06T09:21:40Z'&&p1.comments[0].authorId===dir.id&&p1.text.includes('СПЕЦ ТРАНС'),'date, text and comments preserved');
 r=await req('/api/feed',manager);const list=Array.isArray(r.body)?r.body:(r.body.posts||r.body.items||[]);const v=list.find(x=>x.id===p1.id);
 ok(r.status===200&&v&&v.files.length===2&&v.files[0].name.includes('УПД'),'employees see the imported post with its files');
 r=await req('/api/feed/files/'+f1+'?download=1',manager);ok(r.status===200&&r.body.equals(pdf),'attached UPD downloads byte-for-byte');
 ok(fs.readdirSync(process.env.BACKUP_DIR).some(n=>n.startsWith('before-feed-import-')),'backup made before adding');
 r=await req('/api/admin/transfer/import?mode=feed',director,'POST',zip,'application/zip');d=D();
 ok(r.status===200&&r.body.posts===0&&r.body.skipped===3&&d.feed.length===(before.feed||[]).length+3&&d.feedFiles.filter(f=>f.id===f1).length===1,'second upload adds nothing (no duplicates)');
 r=await req('/api/admin/transfer/import?mode=feed',director,'POST',Buffer.from('not a zip'),'application/zip');ok(r.status===400,'broken archive refused');
 ok(d.audit.some(a=>a.action==='transfer.feed'),'action is written to the journal');
 console.log(`OK feed import: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
