'use strict';
// Перенос CRM на другой компьютер или сервер: один архив со всеми данными и файлами.
//  • Выгрузка: база (клиенты, сделки, лента, переписка в сделках, сотрудники с паролями, документы, настройки)
//    + файлы ленты, загрузки, документы, записи звонков.
//  • Загрузка на новом месте: перед заменой — автоматическая резервная копия; сотрудники входят прежними логинами и паролями.
// Плюс «Мой архив»: лента и переписка в сделках сотрудника одной страницей HTML — сохранить или распечатать.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readZip,writeZip}=require('./zip');
const Access=require('./access');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const FORMAT='prometey-transfer',MAX_ARCHIVE=900*1024*1024;
const DIRS=['uploads','documents','recordings'];
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function walk(root,rel=''){const out=[];let list=[];try{list=fs.readdirSync(path.join(root,rel),{withFileTypes:true})}catch{return out}
 for(const e of list){const r=rel?rel+'/'+e.name:e.name;if(e.isDirectory())out.push(...walk(root,r));else if(e.isFile()&&!e.name.endsWith('.tmp'))out.push(r)}return out}

function counts(d){return {users:(d.users||[]).length,clients:(d.clients||[]).length,orders:(d.orders||[]).length,feed:(d.feed||[]).length,messages:(d.orders||[]).reduce((n,o)=>n+(o.chatMessages||[]).length,0),documents:(d.documents||[]).length,equipment:(d.equipment||[]).length,leads:(d.leads||[]).length}}

function createTransfer({store,dirs,version,backupDir}){
 const isAdmin=(d,u)=>!!Access.perms(d,u).admin;

 function exportArchive(user){
  const d=store.read();if(!isAdmin(d,user))fail('Переносить данные может администратор',403);
  const data={};for(const k of Object.keys(d))if(k!=='sessions')data[k]=d[k];data.sessions=[];
  const entries=new Map(),files={};let bytes=0;
  for(const kind of DIRS){const root=dirs[kind];if(!root)continue;for(const rel of walk(root)){if(rel.split('/').includes('..'))continue;const buf=fs.readFileSync(path.join(root,rel));bytes+=buf.length;if(bytes>MAX_ARCHIVE)fail('Файлов больше 900 МБ — перенос одним архивом невозможен. Напишите разработчику',413);entries.set(`files/${kind}/${rel}`,buf);files[kind]=(files[kind]||0)+1}}
  const json=Buffer.from(JSON.stringify(data));
  const manifest={format:FORMAT,formatVersion:1,crmVersion:version,createdAt:new Date().toISOString(),createdBy:user.email||user.name||'',company:d.settings?.companyName||'',counts:counts(d),files,sha256:crypto.createHash('sha256').update(json).digest('hex')};
  const zip=writeZip(new Map([['manifest.json',JSON.stringify(manifest,null,1)],['data.json',json],...entries]));
  store.transaction(x=>{(x.audit||=[]).unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),userId:user.id,action:'transfer.export',entity:'system',entityId:'',details:`Выгружен архив переноса: ${manifest.counts.clients} компаний, ${manifest.counts.orders} сделок, ${manifest.counts.feed} сообщений ленты, ${Object.values(files).reduce((a,b)=>a+b,0)} файлов`});x.audit=x.audit.slice(0,1000);return {changed:true}});
  return {zip,manifest,name:`prometey-perenos-${manifest.createdAt.slice(0,10)}.zip`};
 }

 function inspect(buf){
  let entries;try{entries=readZip(buf,{maxTotal:MAX_ARCHIVE*1.2,maxEntries:200000})}catch(e){fail('Это не архив переноса ПРОМЕТЕЙ или он повреждён: '+e.message)}
  let manifest;try{manifest=JSON.parse(entries.get('manifest.json'))}catch{fail('В архиве нет описания (manifest.json) — это не архив переноса ПРОМЕТЕЙ')}
  if(manifest.format!==FORMAT)fail('Это не архив переноса ПРОМЕТЕЙ');
  const json=entries.get('data.json');if(!json)fail('В архиве нет данных');
  if(crypto.createHash('sha256').update(json).digest('hex')!==manifest.sha256)fail('Архив повреждён: данные не совпадают с контрольной суммой. Выгрузите архив заново');
  let data;try{data=JSON.parse(json)}catch{fail('Данные в архиве повреждены')}
  if(!Array.isArray(data.users)||!data.users.length)fail('В архиве нет сотрудников');
  return {entries,manifest,data};
 }

 async function importArchive(user,buf){
  const cur=store.read();if(!isAdmin(cur,user))fail('Загружать данные может администратор',403);
  const {entries,manifest,data}=inspect(buf);
  if(!data.users.some(u=>!u.disabled&&Access.roles(data).find(r=>r.id===u.role)?.admin))fail('В архиве нет активного администратора — после загрузки никто не смог бы управлять CRM');
  // резервная копия текущей базы — на случай, если загрузили не тот архив
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const backup=path.join(backupDir,`before-transfer-${stamp}.sqlite`);fs.mkdirSync(backupDir,{recursive:true});await store.backup(backup);
  // файлы
  let written=0;
  for(const [name,content] of entries){
   const m=name.match(/^files\/(uploads|documents|recordings)\/(.+)$/);if(!m)continue;
   const root=dirs[m[1]];if(!root)continue;const rel=m[2];
   if(rel.split('/').some(p=>!p||p==='.'||p==='..'))continue;
   const target=path.resolve(root,rel);if(!target.startsWith(path.resolve(root)+path.sep))continue;
   fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,content,{mode:0o600});written++;
  }
  // база: всё заменяется данными из архива; учётные данные администратора сервера (из настроек) не перезаписывают руководителя
  const envCredential=Object.fromEntries(['director','manager'].map(r=>[r,cur.users.find(u=>u.role===r)?.envCredential]));
  store.transaction(d=>{
   for(const k of Object.keys(d))if(!(k in data))delete d[k];
   for(const [k,v] of Object.entries(data))d[k]=v;
   d.sessions=[];
   for(const r of ['director','manager']){const first=d.users.find(u=>u.role===r);if(first&&envCredential[r])first.envCredential=envCredential[r]}
   (d.audit||=[]).unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),userId:user.id,action:'transfer.import',entity:'system',entityId:'',details:`Загружен архив переноса от ${manifest.createdAt.slice(0,10)} (${manifest.company||'—'}): ${manifest.counts.clients} компаний, ${manifest.counts.orders} сделок, ${written} файлов. Копия прежней базы: ${path.basename(backup)}`});d.audit=d.audit.slice(0,1000);
   return {changed:true};
  });
  store.invalidate?.();
  return {ok:true,counts:manifest.counts,files:written,from:manifest.createdAt,company:manifest.company,backup:path.basename(backup)};
 }


 // «Добавить ленту»: только сообщения ленты с файлами — остальные данные этой CRM не трогаются.
 // Авторы сопоставляются по e-mail, затем по имени; кого нет — сообщение от того, кто загружает. Повторная загрузка не дублирует.
 async function importFeed(user,buf){
  const cur=store.read();if(!isAdmin(cur,user))fail('Загружать данные может администратор',403);
  let entries,manifest,data;
  try{({entries,manifest,data}=inspect(buf))}catch(e){if(!/нет сотрудников/.test(e.message))throw e;entries=readZip(buf,{maxTotal:MAX_ARCHIVE*1.2,maxEntries:200000});manifest=JSON.parse(entries.get('manifest.json'));data=JSON.parse(entries.get('data.json'))}
  const posts=(data.feed||[]).filter(x=>x&&x.id&&x.kind!=='system');if(!posts.length)fail('В архиве нет сообщений ленты');
  const low=v=>String(v||'').trim().toLowerCase();
  const map=new Map();for(const s of data.users||[]){const t=cur.users.find(u=>!u.disabled&&low(u.email)&&low(u.email)===low(s.email))||cur.users.find(u=>!u.disabled&&low(u.name)&&low(u.name)===low(s.name));if(t)map.set(s.id,t.id)}
  const who=id=>map.get(id)||user.id;
  const srcFiles=new Map((data.feedFiles||[]).map(f=>[f.id,f]));
  const FILE_ID=/^f_[0-9a-f-]{36}$/;const root=dirs.uploads?path.resolve(dirs.uploads,'feed'):'';
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const backup=path.join(backupDir,`before-feed-import-${stamp}.sqlite`);fs.mkdirSync(backupDir,{recursive:true});await store.backup(backup);
  const have=new Set((cur.feed||[]).map(x=>x.id)),haveFiles=new Set((cur.feedFiles||[]).map(f=>f.id));
  const add=[],addFiles=[];let written=0,skipped=0,missing=0;
  for(const x of posts){if(have.has(x.id)){skipped++;continue}
   const files=[];
   for(const id of x.files||[]){const f=srcFiles.get(id),content=entries.get('files/uploads/feed/'+id);if(!f||!FILE_ID.test(id)||!content||!root){missing++;continue}
    if(!haveFiles.has(id)){fs.mkdirSync(root,{recursive:true,mode:0o700});fs.writeFileSync(path.join(root,id),content,{mode:0o600});written++;addFiles.push({id,name:String(f.name||'файл').slice(0,200),size:content.length,mime:String(f.mime||'application/octet-stream'),authorId:who(f.authorId||x.authorId),at:f.at||x.createdAt,postId:x.id})}
    files.push(id)}
   add.push({id:x.id,kind:'post',authorId:who(x.authorId),text:String(x.text||''),important:!!x.important,pinned:!!x.pinned,createdAt:x.createdAt||new Date().toISOString(),...(x.editedAt?{editedAt:x.editedAt}:{}),
    likes:[...new Set((x.likes||[]).map(who))],readBy:[],files,comments:(x.comments||[]).map(c=>({...c,authorId:who(c.authorId)})),importedAt:new Date().toISOString()});
  }
  store.transaction(d=>{d.feed||=[];d.feedFiles||=[];const ids=new Set(d.feed.map(x=>x.id));for(const x of add)if(!ids.has(x.id))d.feed.push(x);d.feedFiles.push(...addFiles);
   (d.audit||=[]).unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),userId:user.id,action:'transfer.feed',entity:'system',entityId:'',details:`Добавлена лента из архива от ${String(manifest.createdAt||'').slice(0,10)}: ${add.length} сообщений, ${written} файлов${skipped?`, уже были: ${skipped}`:''}. Копия базы: ${path.basename(backup)}`});d.audit=d.audit.slice(0,1000);
   return {changed:true}});
  store.invalidate?.();
  return {ok:true,posts:add.length,files:written,skipped,missing,authors:[...new Set(add.map(x=>x.authorId))].map(id=>cur.users.find(u=>u.id===id)?.name||'').filter(Boolean),backup:path.basename(backup)};
 }

 // «Мой архив»: что видит сотрудник в ленте и в чатах своих сделок.
 function personalArchive(user,{orders}){
  const d=store.read(),name=id=>d.users.find(u=>u.id===id)?.name||'ПРОМЕТЕЙ';
  const dt=s=>{try{return new Date(s).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})}catch{return s||''}};
  const files=new Map((d.feedFiles||[]).map(f=>[f.id,f]));
  const feed=[...(d.feed||[])].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  const chats=(orders||[]).filter(o=>(o.chatMessages||[]).length);
  const text=s=>esc(s).replace(/\n/g,'<br>');
  const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Архив ленты и сообщений — ${esc(user.name)}</title>
<style>body{font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2433;max-width:860px;margin:0 auto;padding:24px 16px;background:#fff}h1{font-size:24px;margin:0 0 4px}h2{font-size:19px;margin:32px 0 8px;border-bottom:2px solid #ea5b0c;padding-bottom:4px}h3{font-size:16px;margin:20px 0 6px}.m{color:#667085;font-size:13px}.p{border:1px solid #e4e7ec;border-radius:10px;padding:10px 14px;margin:8px 0;break-inside:avoid}.imp{border-color:#ea5b0c}.f{display:inline-block;background:#f2f4f7;border-radius:6px;padding:2px 8px;margin:4px 6px 0 0;font-size:13px}.c{margin:6px 0 0 16px;padding-left:10px;border-left:3px solid #e4e7ec}@media print{body{padding:0}}</style>
<h1>Архив ленты и сообщений</h1><div class="m">${esc(user.name)} · ${esc(d.settings?.companyName||'ПРОМЕТЕЙ CRM')} · выгружено ${esc(dt(new Date().toISOString()))}</div>
<h2>Лента (${feed.length})</h2>${feed.map(p=>`<div class="p${p.important?' imp':''}"><b>${esc(p.kind==='system'?'ПРОМЕТЕЙ':name(p.authorId))}</b> <span class="m">${esc(dt(p.createdAt))}${p.important?' · важное':''}${p.pinned?' · закреплено':''}</span><div>${text(p.text)}</div>${(p.files||[]).map(id=>files.get(id)).filter(Boolean).map(f=>`<span class="f">📎 ${esc(f.name)}</span>`).join('')}${(p.comments||[]).map(c=>`<div class="c"><b>${esc(name(c.authorId))}</b> <span class="m">${esc(dt(c.createdAt))}</span><div>${text(c.text)}</div></div>`).join('')}</div>`).join('')||'<p class="m">Сообщений нет</p>'}
<h2>Переписка в сделках (${chats.length})</h2>${chats.map(o=>`<h3>${esc(o.number||o.name||'Сделка')}${d.clients.find(c=>c.id===o.clientId)?' · '+esc(d.clients.find(c=>c.id===o.clientId).name):''}</h3>${o.chatMessages.map(m=>`<div class="p"><b>${esc(name(m.userId))}</b> <span class="m">${esc(dt(m.at))}</span><div>${text(m.text)}</div></div>`).join('')}`).join('')||'<p class="m">Переписки нет</p>'}
</html>`;
  return {html,name:`arhiv-lenty-i-soobshcheniy-${new Date().toISOString().slice(0,10)}.html`};
 }

 return {exportArchive,inspect,importArchive,importFeed,personalArchive,MAX_ARCHIVE};
}
module.exports={createTransfer,FORMAT};
