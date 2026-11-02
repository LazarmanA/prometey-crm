// Лента: общие новости компании, видны всем сотрудникам. Важные сообщения с отметкой «Прочитал», лайки, комментарии, закрепление.
const crypto=require('node:crypto');
const Access=require('./access');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const str=v=>String(v??'').trim();
const MAX_POSTS=5000,MAX_COMMENTS=300,PAGE=20;

function createFeed({settings}){
 return function handle(d,u,method,url,b={}){
  const p=url.pathname,q=url.searchParams;let changed=false;
  const ok=(body,status=200)=>({body,status,changed});
  d.feed||=[];
  const perm=Access.perms(d,u),canPost=Access.at(perm,'feed','post'),moderator=Access.at(perm,'feed','moderate');
  const person=id=>{const x=d.users.find(z=>z.id===id);return x?{id:x.id,name:x.name,position:x.position||''}:{id:'',name:id?'Сотрудник':'ПРОМЕТЕЙ',position:''}};
  const view=x=>({id:x.id,kind:x.kind||'post',text:x.text,important:!!x.important,pinned:!!x.pinned,createdAt:x.createdAt,editedAt:x.editedAt||'',author:person(x.authorId),
   likes:(x.likes||[]).length,liked:(x.likes||[]).includes(u.id),likedBy:(x.likes||[]).slice(0,30).map(id=>person(id).name),
   readCount:(x.readBy||[]).length,readByMe:(x.readBy||[]).includes(u.id)||x.authorId===u.id,
   comments:(x.comments||[]).map(c=>({id:c.id,text:c.text,at:c.at,author:person(c.authorId),canDelete:c.authorId===u.id||moderator})),
   canEdit:x.kind!=='system'&&x.authorId===u.id,canDelete:(x.kind!=='system'&&x.authorId===u.id)||moderator,canPin:moderator});
  const find=id=>{const x=d.feed.find(z=>z.id===id);if(!x)fail('Сообщение не найдено',404);return x};
  const text=(v,max)=>{const t=str(v).replace(/\r\n?/g,'\n');if(!t||t.length>max)fail(`Текст: от 1 до ${max} символов`);return t};
  const flood=()=>{const since=Date.now()-60000;const recent=d.feed.filter(x=>x.authorId===u.id&&Date.parse(x.createdAt)>since).length+d.feed.reduce((n,x)=>n+(x.comments||[]).filter(c=>c.authorId===u.id&&Date.parse(c.at)>since).length,0);if(recent>=15)fail('Слишком часто. Подождите минуту',429)};
  const touch=()=>{changed=true};

  if(p==='/api/feed'&&method==='GET'){
   const before=q.get('before');if(before&&!Number.isFinite(Date.parse(before)))fail('Некорректный курсор');
   const only=q.get('filter');
   let list=d.feed.filter(x=>!before||x.createdAt<before);
   if(only==='important')list=list.filter(x=>x.important);
   if(only==='unread')list=list.filter(x=>x.important&&!(x.readBy||[]).includes(u.id)&&x.authorId!==u.id);
   const query=str(q.get('q')).toLocaleLowerCase('ru');if(query)list=list.filter(x=>x.text.toLocaleLowerCase('ru').includes(query)||person(x.authorId).name.toLocaleLowerCase('ru').includes(query));
   list.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
   const pinned=before||only||query?[]:list.filter(x=>x.pinned);
   const rest=list.filter(x=>!pinned.includes(x)).slice(0,PAGE);
   return ok({posts:[...pinned,...rest].map(view),next:rest.length===PAGE?rest.at(-1).createdAt:null,canPost,moderator,allowComments:settings(d).feed.allowComments});
  }
  if(p==='/api/feed/unread'&&method==='GET'){const me=d.users.find(z=>z.id===u.id),seen=me?.feedSeenAt||'';return ok({unread:d.feed.filter(x=>x.createdAt>seen&&x.authorId!==u.id).length,important:d.feed.filter(x=>x.important&&x.authorId!==u.id&&!(x.readBy||[]).includes(u.id)).length})}
  if(p==='/api/feed/seen'&&method==='POST'){const me=d.users.find(z=>z.id===u.id);me.feedSeenAt=new Date().toISOString();touch();return ok({ok:true})}
  if(p==='/api/feed'&&method==='POST'){
   if(!canPost)fail('Публиковать в ленте может сотрудник с правом «Публиковать»',403);flood();
   const x={id:'post_'+crypto.randomUUID(),kind:'post',authorId:u.id,text:text(b.text,5000),important:b.important===true,pinned:false,createdAt:new Date().toISOString(),likes:[],comments:[],readBy:[]};
   d.feed.push(x);if(d.feed.length>MAX_POSTS){d.feed.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));d.feed=d.feed.filter((z,i)=>z.pinned||i>=d.feed.length-MAX_POSTS)}
   touch();return ok(view(x),201);
  }
  const m=p.match(/^\/api\/feed\/([^/]+)(?:\/(like|read|pin|comments)(?:\/([^/]+))?)?$/);
  if(m){const x=find(m[1]),action=m[2],sub=m[3];
   if(!action&&method==='PATCH'){if(x.authorId!==u.id||x.kind==='system')fail('Изменить можно только своё сообщение',403);x.text=text(b.text??x.text,5000);if(b.important!==undefined)x.important=b.important===true;x.editedAt=new Date().toISOString();touch();return ok(view(x))}
   if(!action&&method==='DELETE'){if(!((x.authorId===u.id&&x.kind!=='system')||moderator))fail('Удалить можно своё сообщение; чужие — модератор',403);d.feed=d.feed.filter(z=>z!==x);touch();return ok({ok:true})}
   if(action==='like'&&method==='POST'){x.likes||=[];x.likes=x.likes.includes(u.id)?x.likes.filter(id=>id!==u.id):[...x.likes,u.id];touch();return ok(view(x))}
   if(action==='read'&&method==='POST'){x.readBy||=[];if(!x.readBy.includes(u.id))x.readBy.push(u.id);touch();return ok(view(x))}
   if(action==='pin'&&method==='POST'){if(!moderator)fail('Закреплять может модератор ленты',403);x.pinned=b.pinned===true;touch();return ok(view(x))}
   if(action==='comments'&&method==='POST'&&!sub){if(!settings(d).feed.allowComments)fail('Комментарии в ленте отключены администратором',403);flood();x.comments||=[];if(x.comments.length>=MAX_COMMENTS)fail('Достигнут лимит комментариев',409);x.comments.push({id:'com_'+crypto.randomUUID(),authorId:u.id,text:text(b.text,2000),at:new Date().toISOString()});touch();return ok(view(x),201)}
   if(action==='comments'&&method==='DELETE'&&sub){const c=(x.comments||[]).find(z=>z.id===sub);if(!c)fail('Комментарий не найден',404);if(c.authorId!==u.id&&!moderator)fail('Удалить можно свой комментарий',403);x.comments=x.comments.filter(z=>z!==c);touch();return ok(view(x))}
  }
  fail('Операция ленты не найдена',404);
 };
}
module.exports={createFeed};
