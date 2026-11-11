/* Лента компании: новости для всех сотрудников. */
let feedFilter='all',feedQuery='',feedTimer=null;
const feedTime=iso=>{const d=new Date(iso),diff=(Date.now()-d)/1000;if(diff<60)return 'только что';if(diff<3600)return Math.floor(diff/60)+' мин назад';if(diff<86400&&new Date().toDateString()===d.toDateString())return 'сегодня в '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});return d.toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})};
const initials=name=>String(name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(s=>s[0]).join('').toUpperCase()||'?';
// Текст сообщения: экранируется, ссылки http(s) становятся кликабельными.
function feedText(t){return esc(t).replace(/https?:\/\/[^\s<>&"']+/g,u=>`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`)}
const fileSize=n=>n<1024?n+' Б':n<1048576?Math.round(n/1024)+' КБ':(n/1048576).toFixed(n<10485760?1:0).replace('.',',')+' МБ';
const fileIcon=f=>{const e=(f.name.match(/\.([^.]+)$/)?.[1]||'').toLowerCase();return ({pdf:'PDF',doc:'DOC',docx:'DOC',xls:'XLS',xlsx:'XLS',csv:'XLS',ppt:'PPT',pptx:'PPT',zip:'ZIP',rar:'ZIP','7z':'ZIP',txt:'TXT',mp4:'▶',mov:'▶',mp3:'♪',dwg:'DWG'})[e]||(e?e.slice(0,4).toUpperCase():'FILE')};
function filesHtml(files){if(!files||!files.length)return '';const imgs=files.filter(f=>f.image),docs=files.filter(f=>!f.image);
 return `${imgs.length?`<div class="post-images n${Math.min(imgs.length,4)}">${imgs.map(f=>`<a href="/api/feed/files/${esc(f.id)}" target="_blank" rel="noopener" title="${esc(f.name)}"><img src="/api/feed/files/${esc(f.id)}" alt="${esc(f.name)}" loading="lazy"></a>`).join('')}</div>`:''}
 ${docs.length?`<div class="post-files">${docs.map(f=>`<a class="file-chip" href="/api/feed/files/${esc(f.id)}?download=1" download="${esc(f.name)}"><span class="file-ic">${esc(fileIcon(f))}</span><span class="file-nm">${esc(f.name)}</span><span class="muted small">${esc(fileSize(f.size))}</span></a>`).join('')}</div>`:''}`}
function postHtml(x,allowComments){
 return `<article class="panel post ${x.important?'important':''} ${x.kind==='system'?'system':''}" data-post="${esc(x.id)}">
 <div class="post-head"><div class="avatar">${x.kind==='system'?'P':esc(initials(x.author.name))}</div><div class="post-meta"><div class="strong">${esc(x.author.name)}${x.author.position?` <span class="muted small">· ${esc(x.author.position)}</span>`:''}</div><div class="muted">${esc(feedTime(x.createdAt))}${x.editedAt?' · изменено':''}</div></div>
 <div class="post-flags">${x.pinned?'<span class="badge badge-info">Закреплено</span>':''}${x.important?'<span class="badge badge-warn">Важное</span>':''}</div></div>
 ${x.text?`<div class="post-text">${feedText(x.text)}</div>`:''}${filesHtml(x.files)}
 ${x.important?`<div class="important-bar"><span class="small">${x.readByMe?'✓ Вы ознакомились':'Пожалуйста, подтвердите, что прочитали'} · прочитали: ${x.readCount}</span>${x.readByMe?'':`<button class="btn btn-primary btn-sm" data-read="${esc(x.id)}">Прочитал</button>`}</div>`:''}
 <div class="post-actions"><button class="btn btn-ghost btn-sm ${x.liked?'liked':''}" data-like="${esc(x.id)}" title="${esc(x.likedBy.join(', '))}">${x.liked?'♥':'♡'} Нравится${x.likes?' · '+x.likes:''}</button>
 ${allowComments?`<button class="btn btn-ghost btn-sm" data-comment-toggle="${esc(x.id)}">Комментарии${x.comments.length?' · '+x.comments.length:''}</button>`:''}
 <span style="flex:1"></span>${x.canPin?`<button class="btn btn-ghost btn-sm" data-pin="${esc(x.id)}" data-pinned="${x.pinned?1:0}">${x.pinned?'Открепить':'Закрепить'}</button>`:''}${x.canEdit?`<button class="btn btn-ghost btn-sm" data-edit-post="${esc(x.id)}">Изменить</button>`:''}${x.canDelete?`<button class="btn btn-ghost btn-sm" data-delete-post="${esc(x.id)}">Удалить</button>`:''}</div>
 ${allowComments?`<div class="comments" data-comments="${esc(x.id)}" ${x.comments.length?'':'hidden'}>${x.comments.map(c=>`<div class="comment"><span class="who">${esc(c.author.name)}</span><span class="when">${esc(feedTime(c.at))}</span>${c.canDelete?` <button class="btn btn-ghost btn-sm" data-delete-comment="${esc(c.id)}" data-post-id="${esc(x.id)}" aria-label="Удалить комментарий">×</button>`:''}<div class="post-text" style="margin:2px 0 0">${feedText(c.text)}</div></div>`).join('')}
 <form class="comment-form" data-comment-form="${esc(x.id)}"><input class="field" maxlength="2000" placeholder="Написать комментарий…" aria-label="Комментарий"><button class="btn btn-light btn-sm">Отправить</button></form></div>`:''}
 </article>`;
}
async function feedPage(p){
 const qs=new URLSearchParams();if(feedFilter!=='all')qs.set('filter',feedFilter);if(feedQuery)qs.set('q',feedQuery);
 const data=await api('/api/feed?'+qs);let next=data.next;
 p.innerHTML=`<div class="feed-wrap"><div class="page-head"><div><h1>Лента</h1><p>Новости компании — их видят все сотрудники.</p></div><a class="btn btn-light" href="/api/archive/messages" download title="Лента и переписка в ваших сделках одной страницей — сохранить или распечатать">Скачать архив</a></div>
 ${data.canPost?`<form class="panel feed-compose" id="feed-form"><label class="sr-only" for="feed-text">Сообщение</label><textarea class="field" id="feed-text" maxlength="5000" placeholder="Поделитесь новостью с коллегами… Файлы и фото можно перетащить сюда или вставить (Ctrl+V)"></textarea><div class="feed-attach" id="feed-attach" hidden></div><div class="row"><button type="button" class="btn btn-light btn-sm feed-clip" id="feed-clip" title="Прикрепить файлы: фото, документы, таблицы — до 10 файлов по 20 МБ">📎 Файлы</button><input type="file" id="feed-file" multiple hidden><label class="small"><input type="checkbox" id="feed-important"> Важное сообщение — сотрудники подтвердят прочтение</label><button class="btn btn-primary" id="feed-send">Опубликовать</button></div><div class="feed-drop" id="feed-drop">Отпустите, чтобы прикрепить</div></form>`:''}
 <div class="tabs-row"><div class="segmented">${[['all','Все'],['important','Важные'],['unread','Не прочитанные мной']].map(([v,t])=>`<button data-feed-filter="${v}" class="${feedFilter===v?'active':''}">${t}</button>`).join('')}</div><form id="feed-search" style="display:flex;gap:6px;flex:1;min-width:200px"><input class="field" id="feed-q" placeholder="Поиск по ленте" value="${esc(feedQuery)}" style="padding:8px 11px"><button class="btn btn-light btn-sm">Найти</button></form></div>
 <div id="feed-list">${data.posts.map(x=>postHtml(x,data.allowComments)).join('')||empty('Сообщений пока нет')}</div>
 <div style="text-align:center;margin:12px 0"><button class="btn btn-light" id="feed-more" ${next?'':'hidden'}>Показать ещё</button></div></div>`;
 const list=p.querySelector('#feed-list');
 const replace=x=>{const el=list.querySelector(`[data-post="${CSS.escape(x.id)}"]`);if(!el)return;const open=!el.querySelector('.comments')?.hidden;const tmp=document.createElement('div');tmp.innerHTML=postHtml(x,data.allowComments);const fresh=tmp.firstElementChild;if(open&&fresh.querySelector('.comments'))fresh.querySelector('.comments').hidden=false;el.replaceWith(fresh)};
 const act=async(fn)=>{try{await fn()}catch(e){toast(e.message,true)}};
 const form=p.querySelector('#feed-form');if(form)feedComposer(form,act);
 p.querySelectorAll('[data-feed-filter]').forEach(b=>b.onclick=()=>{feedFilter=b.dataset.feedFilter;renderPage()});
 p.querySelector('#feed-search').onsubmit=e=>{e.preventDefault();feedQuery=val('feed-q').trim();renderPage()};
 p.querySelector('#feed-more').onclick=e=>act(async()=>{const q=new URLSearchParams(qs);q.set('before',next);const more=await api('/api/feed?'+q);list.insertAdjacentHTML('beforeend',more.posts.map(x=>postHtml(x,data.allowComments)).join(''));next=more.next;e.target.hidden=!next});
 list.addEventListener('click',e=>{const t=e.target.closest('button');if(!t)return;
  if(t.dataset.like)act(async()=>replace(await api(`/api/feed/${t.dataset.like}/like`,{method:'POST',body:'{}'})));
  else if(t.dataset.read)act(async()=>{replace(await api(`/api/feed/${t.dataset.read}/read`,{method:'POST',body:'{}'}));refreshFeedBadge()});
  else if(t.dataset.pin)act(async()=>{await api(`/api/feed/${t.dataset.pin}/pin`,{method:'POST',body:JSON.stringify({pinned:t.dataset.pinned!=='1'})});renderPage()});
  else if(t.dataset.commentToggle){const box=list.querySelector(`[data-comments="${CSS.escape(t.dataset.commentToggle)}"]`);if(box){box.hidden=!box.hidden;if(!box.hidden)box.querySelector('input')?.focus()}}
  else if(t.dataset.deletePost)modal('Удалить сообщение?','<p>Сообщение и комментарии к нему будут удалены для всех.</p>',()=>api('/api/feed/'+t.dataset.deletePost,{method:'DELETE'}),'Удалить');
  else if(t.dataset.deleteComment)act(async()=>replace(await api(`/api/feed/${t.dataset.postId}/comments/${t.dataset.deleteComment}`,{method:'DELETE'})));
  else if(t.dataset.editPost){const x=[...list.querySelectorAll('[data-post]')].find(a=>a.dataset.post===t.dataset.editPost);const current=data.posts.find(z=>z.id===t.dataset.editPost);modal('Изменить сообщение',`<div class="form-group"><label for="ep-text">Текст</label><textarea class="field" id="ep-text" rows="6" maxlength="5000">${esc(current?.text||x?.querySelector('.post-text')?.textContent||'')}</textarea></div><label class="small"><input type="checkbox" id="ep-important" ${current?.important?'checked':''}> Важное сообщение</label>`,()=>api('/api/feed/'+t.dataset.editPost,{method:'PATCH',body:JSON.stringify({text:val('ep-text'),important:document.getElementById('ep-important').checked})}))}
 });
 list.addEventListener('submit',e=>{const f=e.target.closest('[data-comment-form]');if(!f)return;e.preventDefault();const input=f.querySelector('input');if(!input.value.trim())return;act(async()=>{replace(await api(`/api/feed/${f.dataset.commentForm}/comments`,{method:'POST',body:JSON.stringify({text:input.value})}))})});
 api('/api/feed/seen',{method:'POST',body:'{}'}).then(refreshFeedBadge).catch(()=>{});
}
async function refreshFeedBadge(){const b=document.getElementById('feed-badge');if(!b||!me)return;try{const r=await api('/api/feed/unread');const n=current==='feed'?r.important:Math.max(r.unread,r.important);b.textContent=n>99?'99+':String(n);b.hidden=!n;b.title=r.important?`Важных непрочитанных: ${r.important}`:''}catch{}}
function startFeedBadge(){refreshFeedBadge();if(!feedTimer)feedTimer=setInterval(()=>{if(me&&!document.hidden)refreshFeedBadge()},60000)}

// Окно нового сообщения: текст + файлы (кнопка, перетаскивание, вставка из буфера). Файлы загружаются сразу, сообщение — по кнопке.
function feedComposer(form,act){
 const box=form.querySelector('#feed-attach'),send=form.querySelector('#feed-send'),picker=form.querySelector('#feed-file'),drop=form.querySelector('#feed-drop');
 const items=[];// {key,name,size,state:'up'|'ok'|'err',id,error}
 const draw=()=>{box.hidden=!items.length;box.innerHTML=items.map(i=>`<span class="attach-chip ${i.state}" title="${esc(i.error||i.name)}"><span class="file-nm">${esc(i.name)}</span><span class="muted small">${i.state==='up'?'загрузка…':i.state==='err'?esc(i.error||'ошибка'):esc(fileSize(i.size))}</span><button type="button" data-unattach="${i.key}" aria-label="Убрать файл">×</button></span>`).join('');send.disabled=items.some(i=>i.state==='up')};
 const read=file=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error('Не удалось прочитать файл'));r.readAsDataURL(file)});
 async function add(list){
  for(const file of list){
   if(items.length>=10){toast('К сообщению — не больше 10 файлов',true);break}
   const it={key:Math.random().toString(36).slice(2),name:file.name||'фото.png',size:file.size,state:'up'};items.push(it);draw();
   if(file.size>20*1024*1024){it.state='err';it.error='больше 20 МБ';draw();continue}
   try{const data=await read(file);const r=await api('/api/feed/files',{method:'POST',body:JSON.stringify({name:it.name,data})});it.id=r.id;it.state='ok'}catch(e){it.state='err';it.error=e.message}
   draw();
  }
 }
 form.querySelector('#feed-clip').onclick=()=>picker.click();
 picker.onchange=()=>{add([...picker.files]);picker.value=''};
 box.addEventListener('click',e=>{const k=e.target.closest('[data-unattach]')?.dataset.unattach;if(!k)return;const i=items.findIndex(x=>x.key===k);if(i>=0)items.splice(i,1);draw()});
 let depth=0;
 form.addEventListener('dragenter',e=>{if(![...(e.dataTransfer?.types||[])].includes('Files'))return;e.preventDefault();depth++;form.classList.add('dragging')});
 form.addEventListener('dragover',e=>{if([...(e.dataTransfer?.types||[])].includes('Files'))e.preventDefault()});
 form.addEventListener('dragleave',()=>{if(--depth<=0){depth=0;form.classList.remove('dragging')}});
 form.addEventListener('drop',e=>{if(!e.dataTransfer?.files?.length)return;e.preventDefault();depth=0;form.classList.remove('dragging');add([...e.dataTransfer.files])});
 form.querySelector('#feed-text').addEventListener('paste',e=>{const files=[...(e.clipboardData?.files||[])];if(files.length){e.preventDefault();add(files)}});
 form.addEventListener('submit',e=>{e.preventDefault();act(async()=>{
  const files=items.filter(i=>i.state==='ok').map(i=>i.id),text=val('feed-text');
  if(!text.trim()&&!files.length){toast('Напишите текст или прикрепите файл',true);return}
  if(items.some(i=>i.state==='err'))toast('Файлы с ошибкой не прикреплены',true);
  send.disabled=true;try{await api('/api/feed',{method:'POST',body:JSON.stringify({text,important:form.querySelector('#feed-important').checked,files})});toast('Опубликовано');await renderPage()}finally{send.disabled=false}
 })});
}
