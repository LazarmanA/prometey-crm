// Лента: общие новости компании, видны всем сотрудникам. Важные сообщения с отметкой «Прочитал», лайки, комментарии, закрепление.
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const Access=require('./access');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const str=v=>String(v??'').trim();
const MAX_POSTS=5000,MAX_COMMENTS=300,PAGE=20;
// Файлы в ленте: фото, документы, таблицы, архивы — до 10 штук по 20 МБ к одному сообщению.
const MAX_FILE=20*1024*1024,MAX_FILES=10,FILE_ID=/^f_[0-9a-f-]{36}$/;
function sniff(buf){
 const h=(...b)=>b.every((x,i)=>buf[i]===x);
 if(h(0x89,0x50,0x4e,0x47))return 'image/png';if(h(0xff,0xd8,0xff))return 'image/jpeg';if(h(0x47,0x49,0x46,0x38))return 'image/gif';
 if(buf.length>12&&buf.toString('latin1',0,4)==='RIFF'&&buf.toString('latin1',8,12)==='WEBP')return 'image/webp';
 return '';
}
const MIME={pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',txt:'text/plain',csv:'text/csv',zip:'application/zip',rar:'application/vnd.rar','7z':'application/x-7z-compressed',mp4:'video/mp4',mov:'video/quicktime',mp3:'audio/mpeg',dwg:'image/vnd.dwg',odt:'application/vnd.oasis.opendocument.text',ods:'application/vnd.oasis.opendocument.spreadsheet',heic:'image/heic',xml:'application/xml',json:'application/json'};
function cleanName(n){let s=String(n||'файл').replace(/[\u0000-\u001f<>:"/\\|?*]+/g,' ').replace(/\s+/g,' ').trim().slice(0,150);if(!s||/^\.+$/.test(s))s='файл';return s}

function createFeed({settings,dir}){
 const root=dir?path.resolve(dir,'feed'):'';
 const fileOf=id=>{if(!FILE_ID.test(id)||!root)fail('Файл не найден',404);return path.join(root,id)};
 const removeFile=id=>{try{fs.rmSync(fileOf(id),{force:true})}catch{}};
 return function handle(d,u,method,url,b={}){
  const p=url.pathname,q=url.searchParams;let changed=false;
  const ok=(body,status=200)=>({body,status,changed});
  d.feed||=[];
  const perm=Access.perms(d,u),canPost=Access.at(perm,'feed','post'),moderator=Access.at(perm,'feed','moderate');
  const person=id=>{const x=d.users.find(z=>z.id===id);return x?{id:x.id,name:x.name,position:x.position||''}:{id:'',name:id?'Сотрудник':'ПРОМЕТЕЙ',position:''}};
  const fileView=f=>({id:f.id,name:f.name,size:f.size,mime:f.mime,image:/^image\/(png|jpeg|gif|webp)$/.test(f.mime)});
  const filesOf=x=>(x.files||[]).map(id=>(d.feedFiles||[]).find(f=>f.id===id)).filter(Boolean).map(fileView);
  const view=x=>({id:x.id,kind:x.kind||'post',text:x.text||'',files:filesOf(x),important:!!x.important,pinned:!!x.pinned,createdAt:x.createdAt,editedAt:x.editedAt||'',author:person(x.authorId),
   likes:(x.likes||[]).length,liked:(x.likes||[]).includes(u.id),likedBy:(x.likes||[]).slice(0,30).map(id=>person(id).name),
   readCount:(x.readBy||[]).length,readByMe:(x.readBy||[]).includes(u.id)||x.authorId===u.id,
   comments:(x.comments||[]).map(c=>({id:c.id,text:c.text,at:c.at,author:person(c.authorId),canDelete:c.authorId===u.id||moderator})),
   canEdit:x.kind!=='system'&&x.authorId===u.id,canDelete:(x.kind!=='system'&&x.authorId===u.id)||moderator,canPin:moderator});
  const find=id=>{const x=d.feed.find(z=>z.id===id);if(!x)fail('Сообщение не найдено',404);return x};
  const text=(v,max)=>{const t=str(v).replace(/\r\n?/g,'\n');if(!t||t.length>max)fail(`Текст: от 1 до ${max} символов`);return t};
  const flood=()=>{const since=Date.now()-60000;const recent=d.feed.filter(x=>x.authorId===u.id&&Date.parse(x.createdAt)>since).length+d.feed.reduce((n,x)=>n+(x.comments||[]).filter(c=>c.authorId===u.id&&Date.parse(c.at)>since).length,0);if(recent>=15)fail('Слишком часто. Подождите минуту',429)};
  const touch=()=>{changed=true};

  // Файлы, загруженные этим сотрудником и ещё не прикреплённые к сообщению.
  const attach=ids=>{if(ids===undefined||ids===null)return [];if(!Array.isArray(ids))fail('Некорректный список файлов');if(ids.length>MAX_FILES)fail(`К сообщению — не больше ${MAX_FILES} файлов`);const list=[...new Set(ids.map(String))].map(id=>{const f=(d.feedFiles||[]).find(z=>z.id===id&&z.authorId===u.id&&!z.postId);if(!f)fail('Файл не найден — загрузите его ещё раз',404);return f});return list};
  if(p==='/api/feed/files'&&method==='POST'){
   if(!canPost)fail('Публиковать в ленте может сотрудник с правом «Публиковать»',403);if(!root)fail('Файлы недоступны',503);
   const m=/^data:[^;,]*;base64,(.*)$/s.exec(str(b.data)),b64=(m?m[1]:str(b.data)).replace(/\s+/g,'');
   if(!b64||!/^[A-Za-z0-9+/]+=*$/.test(b64))fail('Файл не получен');
   if(b64.length*3/4>MAX_FILE+3)fail('Файл больше 20 МБ. Сожмите его или загрузите в «Файлы» и вставьте ссылку',413);
   const buf=Buffer.from(b64,'base64');if(!buf.length)fail('Файл пустой');if(buf.length>MAX_FILE)fail('Файл больше 20 МБ',413);
   d.feedFiles||=[];
   // недописанные сообщения: неприкреплённые файлы старше суток удаляются
   const stale=Date.now()-86400000;d.feedFiles=d.feedFiles.filter(f=>{if(!f.postId&&Date.parse(f.at)<stale){removeFile(f.id);return false}return true});
   if(d.feedFiles.filter(f=>f.authorId===u.id&&!f.postId).length>=30)fail('Слишком много неотправленных файлов — опубликуйте сообщение',429);
   const name=cleanName(b.name),ext=(name.match(/\.([A-Za-z0-9]{1,8})$/)?.[1]||'').toLowerCase();
   const mime=sniff(buf)||MIME[ext]||'application/octet-stream';
   const id='f_'+crypto.randomUUID(),file=fileOf(id);fs.mkdirSync(root,{recursive:true,mode:0o700});fs.writeFileSync(file+'.tmp',buf,{mode:0o600});fs.renameSync(file+'.tmp',file);
   const f={id,name,size:buf.length,mime,authorId:u.id,at:new Date().toISOString(),postId:''};d.feedFiles.push(f);touch();
   return ok(fileView(f),201);
  }
  if(p==='/api/feed'&&method==='GET'){
   const before=q.get('before');if(before&&!Number.isFinite(Date.parse(before)))fail('Некорректный курсор');
   const only=q.get('filter');
   let list=d.feed.filter(x=>!before||x.createdAt<before);
   if(only==='important')list=list.filter(x=>x.important);
   if(only==='unread')list=list.filter(x=>x.important&&!(x.readBy||[]).includes(u.id)&&x.authorId!==u.id);
   const query=str(q.get('q')).toLocaleLowerCase('ru');if(query)list=list.filter(x=>String(x.text||'').toLocaleLowerCase('ru').includes(query)||filesOf(x).some(f=>f.name.toLocaleLowerCase('ru').includes(query))||person(x.authorId).name.toLocaleLowerCase('ru').includes(query));
   list.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
   const pinned=before||only||query?[]:list.filter(x=>x.pinned);
   const rest=list.filter(x=>!pinned.includes(x)).slice(0,PAGE);
   return ok({posts:[...pinned,...rest].map(view),next:rest.length===PAGE?rest.at(-1).createdAt:null,canPost,moderator,allowComments:settings(d).feed.allowComments});
  }
  if(p==='/api/feed/unread'&&method==='GET'){const me=d.users.find(z=>z.id===u.id),seen=me?.feedSeenAt||'';return ok({unread:d.feed.filter(x=>x.createdAt>seen&&x.authorId!==u.id).length,important:d.feed.filter(x=>x.important&&x.authorId!==u.id&&!(x.readBy||[]).includes(u.id)).length})}
  if(p==='/api/feed/seen'&&method==='POST'){const me=d.users.find(z=>z.id===u.id);me.feedSeenAt=new Date().toISOString();touch();return ok({ok:true})}
  if(p==='/api/feed'&&method==='POST'){
   if(!canPost)fail('Публиковать в ленте может сотрудник с правом «Публиковать»',403);flood();
   const files=attach(b.files);
   const x={id:'post_'+crypto.randomUUID(),kind:'post',authorId:u.id,text:files.length&&!str(b.text)?'':text(b.text,5000),important:b.important===true,pinned:false,createdAt:new Date().toISOString(),likes:[],comments:[],readBy:[],files:files.map(f=>f.id)};
   for(const f of files)f.postId=x.id;
   d.feed.push(x);if(d.feed.length>MAX_POSTS){d.feed.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));d.feed=d.feed.filter((z,i)=>z.pinned||i>=d.feed.length-MAX_POSTS)}
   touch();return ok(view(x),201);
  }
  const m=p.match(/^\/api\/feed\/([^/]+)(?:\/(like|read|pin|comments)(?:\/([^/]+))?)?$/);
  if(m){const x=find(m[1]),action=m[2],sub=m[3];
   if(!action&&method==='PATCH'){if(x.authorId!==u.id||x.kind==='system')fail('Изменить можно только своё сообщение',403);x.text=(x.files||[]).length&&!str(b.text??x.text)?'':text(b.text??x.text,5000);if(b.important!==undefined)x.important=b.important===true;x.editedAt=new Date().toISOString();touch();return ok(view(x))}
   if(!action&&method==='DELETE'){if(!((x.authorId===u.id&&x.kind!=='system')||moderator))fail('Удалить можно своё сообщение; чужие — модератор',403);d.feed=d.feed.filter(z=>z!==x);for(const id of x.files||[]){removeFile(id);d.feedFiles=(d.feedFiles||[]).filter(f=>f.id!==id)}touch();return ok({ok:true})}
   if(action==='like'&&method==='POST'){x.likes||=[];x.likes=x.likes.includes(u.id)?x.likes.filter(id=>id!==u.id):[...x.likes,u.id];touch();return ok(view(x))}
   if(action==='read'&&method==='POST'){x.readBy||=[];if(!x.readBy.includes(u.id))x.readBy.push(u.id);touch();return ok(view(x))}
   if(action==='pin'&&method==='POST'){if(!moderator)fail('Закреплять может модератор ленты',403);x.pinned=b.pinned===true;touch();return ok(view(x))}
   if(action==='comments'&&method==='POST'&&!sub){if(!settings(d).feed.allowComments)fail('Комментарии в ленте отключены администратором',403);flood();x.comments||=[];if(x.comments.length>=MAX_COMMENTS)fail('Достигнут лимит комментариев',409);x.comments.push({id:'com_'+crypto.randomUUID(),authorId:u.id,text:text(b.text,2000),at:new Date().toISOString()});touch();return ok(view(x),201)}
   if(action==='comments'&&method==='DELETE'&&sub){const c=(x.comments||[]).find(z=>z.id===sub);if(!c)fail('Комментарий не найден',404);if(c.authorId!==u.id&&!moderator)fail('Удалить можно свой комментарий',403);x.comments=x.comments.filter(z=>z!==c);touch();return ok(view(x))}
  }
  fail('Операция ленты не найдена',404);
 };
}
// Скачивание файла ленты: путь и сведения (файлы видят все сотрудники — как и саму ленту).
function feedFile(d,dir,id){if(!FILE_ID.test(String(id)))return null;const f=(d.feedFiles||[]).find(z=>z.id===id&&z.postId);if(!f)return null;const file=path.join(path.resolve(dir,'feed'),f.id);return fs.existsSync(file)?{...f,file,inline:/^image\/(png|jpeg|gif|webp)$/.test(f.mime)}:null}
module.exports={createFeed,feedFile};
