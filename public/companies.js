/* Компании: список с галочками и массовыми действиями, новая карточка компании с лентой и историей. */
const CO_VIEW_KEY='prometey_companies_view';
function companiesView(list){const s=stateFor('clients');if(s.view)return s.view;let v='';try{v=localStorage.getItem(CO_VIEW_KEY)||''}catch{}return v||(list.length>50?'list':'cards')}
function setCompaniesView(v){stateFor('clients').view=v;try{localStorage.setItem(CO_VIEW_KEY,v)}catch{}renderPage()}
const coViewToggle=v=>`<div class="seg co-view" role="group" aria-label="Вид"><button type="button" class="${v==='list'?'active':''}" data-co-view="list" aria-pressed="${v==='list'}">☰ Список</button><button type="button" class="${v==='cards'?'active':''}" data-co-view="cards" aria-pressed="${v==='cards'}">▦ Карточки</button></div>`;
const coAgo=iso=>{if(!iso)return '';const d=new Date(iso),days=Math.floor((Date.now()-d)/864e5);return days<1?d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):days<7?days+' дн. назад':d.toLocaleDateString('ru-RU')};
const coInitials=n=>{const w=String(n||'').replace(/^(ООО|ИП|АО|ПАО|ЗАО|ОАО)\s+/i,'').replace(/["«»]/g,'').trim().split(/\s+/);return ((w[0]||'?')[0]+(w[1]?w[1][0]:'')).toUpperCase()};

// ---------- список компаний ----------
async function companiesList(p,list){
 const s=stateFor('clients'),assign=can('crm','all'),admin=!!me?.perms?.admin;
 const sel=new Set();
 p.innerHTML=`<div class="page-head"><div><h1>Компании</h1><p>Клиенты: ответственные, сделки и история работы.</p></div><div class="actions">${coViewToggle('list')}<button class="btn btn-primary" id="add-client">+ Компания</button></div></div>${toolbar('clients',[['name','По названию'],['revenue','По обороту'],['inn','По ИНН'],['requestAt','По дате заявки']])}
 <div class="co-bulk" id="co-bulk" hidden><b id="co-count">Выбрано: 0</b><span class="co-bulk-actions">${assign?'<button type="button" class="btn btn-dark btn-sm" data-bulk="owner">Сменить ответственного</button>':''}<button type="button" class="btn btn-light btn-sm" data-bulk="task">Поставить задачу</button><button type="button" class="btn btn-light btn-sm" data-bulk="export">Выгрузить в Excel</button>${s.archive==='archived'?'<button type="button" class="btn btn-light btn-sm" data-bulk="restore">Восстановить</button>':'<button type="button" class="btn btn-light btn-sm" data-bulk="archive">В архив</button>'}${admin?'<button type="button" class="btn btn-danger btn-sm" data-bulk="delete">Удалить</button>':''}</span><button type="button" class="link-btn" id="co-clear">Снять выделение</button></div>
 <div class="panel co-table-wrap" id="co-table"></div><div class="co-pager" id="co-pager"></div>`;
 bindToolbar('clients');await ownerControls(p,'clients',list);p.querySelector('#add-client').onclick=()=>openClientCreate();attachContactTransfer(p);
 p.querySelectorAll('[data-co-view]').forEach(b=>b.onclick=()=>setCompaniesView(b.dataset.coView));
 const PAGE_KEY='prometey_companies_page_size';let size=Number(s.pageSize)||(()=>{try{return Number(localStorage.getItem(PAGE_KEY))}catch{return 0}})()||20;if(![10,20,50,100].includes(size))size=20;
 const pages=()=>Math.max(1,Math.ceil(list.length/size));s.page=Math.min(Math.max(1,Number(s.page)||1),pages());
 const row=c=>`<tr data-id="${esc(c.id)}" class="${c.archivedAt?'co-arch':''}"><td class="co-chk"><input type="checkbox" data-pick="${esc(c.id)}" aria-label="Выбрать ${esc(c.name)}" ${sel.has(c.id)?'checked':''}></td><td><button type="button" class="co-name" data-workspace="${esc(c.id)}"><span class="co-ava">${esc(coInitials(c.name))}</span><span><b>${esc(c.name)}</b>${c.email?`<small>${esc(c.email)}</small>`:''}</span></button>${c.archivedAt?' <span class="badge">архив</span>':''}</td><td class="nw">${esc(c.inn||'—')}</td><td class="small">${esc(c.phone||'—')}</td><td class="small">${esc(c.manager||'—')}</td><td class="r">${c.dealCount||''}</td><td class="r nw">${c.revenue?money(c.revenue):''}</td><td class="small nw">${c.createdAt?new Date(c.createdAt).toLocaleDateString('ru-RU'):''}</td></tr>`;
 const pageRows=()=>list.slice((s.page-1)*size,s.page*size);
 const bar=p.querySelector('#co-bulk');
 const sync=()=>{bar.hidden=!sel.size;const shown=pageRows();const onPage=shown.filter(c=>sel.has(c.id)).length;
  p.querySelector('#co-count').innerHTML=`Выбрано: ${sel.size}${onPage===shown.length&&shown.length&&sel.size<list.length?` <button type="button" class="link-btn co-all-link" id="co-select-all">Выбрать все ${list.length}</button>`:''}`;
  p.querySelector('#co-select-all')?.addEventListener('click',()=>{list.forEach(c=>sel.add(c.id));draw()});
  p.querySelectorAll('tr[data-id]').forEach(tr=>tr.classList.toggle('selected',sel.has(tr.dataset.id)));const all=p.querySelector('#co-all');if(all){all.checked=!!shown.length&&onPage===shown.length;all.indeterminate=onPage>0&&onPage<shown.length}};
 const pagerHtml=()=>{const n=pages(),cur=s.page,from=list.length?(cur-1)*size+1:0,to=Math.min(cur*size,list.length);const nums=[];for(let k=1;k<=n;k++)if(k===1||k===n||Math.abs(k-cur)<=2)nums.push(k);else if(nums[nums.length-1]!=='…')nums.push('…');
  return `<label class="co-size">Показывать по <select class="field" id="co-size">${[10,20,50,100].map(v=>`<option ${v===size?'selected':''}>${v}</option>`).join('')}</select></label><span class="co-range">${from}–${to} из ${list.length}</span>${n>1?`<nav class="co-pages" aria-label="Страницы"><button type="button" data-page="${cur-1}" ${cur===1?'disabled':''} aria-label="Предыдущая">‹</button>${nums.map(k=>k==='…'?'<span>…</span>':`<button type="button" data-page="${k}" class="${k===cur?'active':''}" ${k===cur?'aria-current="page"':''}>${k}</button>`).join('')}<button type="button" data-page="${cur+1}" ${cur===n?'disabled':''} aria-label="Следующая">›</button></nav>`:''}`};
 const draw=(scroll)=>{const shown=pageRows();
  p.querySelector('#co-table').innerHTML=`<table class="table co-table"><thead><tr><th class="co-chk"><input type="checkbox" id="co-all" aria-label="Выбрать все на странице"></th><th>Компания</th><th>ИНН</th><th>Телефон</th><th>Ответственный</th><th class="r">Сделок</th><th class="r">Оборот</th><th>Создана</th></tr></thead><tbody>${shown.map(row).join('')}</tbody></table>${list.length?'':'<div class="empty">Компаний не найдено</div>'}`;
  p.querySelector('#co-pager').innerHTML=list.length?pagerHtml():'';
  const t=p.querySelector('#co-table');
  t.querySelectorAll('[data-workspace]').forEach(b=>b.onclick=e=>{e.stopPropagation();open(b.dataset.workspace)});
  t.querySelectorAll('[data-pick]').forEach(c=>c.onchange=()=>{c.checked?sel.add(c.dataset.pick):sel.delete(c.dataset.pick);sync()});
  t.querySelectorAll('tr[data-id] td:not(.co-chk)').forEach(td=>td.onclick=e=>{if(e.target.closest('button,a,input'))return;const c=td.closest('tr').querySelector('[data-pick]');c.checked=!c.checked;c.onchange()});
  t.querySelector('#co-all').onchange=e=>{t.querySelectorAll('[data-pick]').forEach(c=>{c.checked=e.target.checked;e.target.checked?sel.add(c.dataset.pick):sel.delete(c.dataset.pick)});sync()};
  const pg=p.querySelector('#co-pager');
  pg.querySelector('#co-size')?.addEventListener('change',e=>{size=Number(e.target.value);s.pageSize=size;try{localStorage.setItem(PAGE_KEY,String(size))}catch{}s.page=1;draw(true)});
  pg.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{s.page=Number(b.dataset.page);draw(true)});
  sync();if(scroll)p.querySelector('#co-table').scrollIntoView({block:'start',behavior:'auto'});
 };
 const open=id=>{workspaceSelection={kind:'clients',id};renderPage()};
 {const tb=p.querySelector('#list-toolbar');tb?.addEventListener('submit',()=>{s.page=1},true);tb?.addEventListener('change',()=>{s.page=1},true);p.querySelector('#owner-filter')?.addEventListener('change',()=>{s.page=1},true)}
 draw();
 p.querySelector('#co-clear').onclick=()=>{sel.clear();draw()};
 const run=async(body,title)=>{const r=await api('/api/clients/bulk',{method:'POST',body:JSON.stringify({ids:[...sel],...body})});toast(`${title}: ${r.done}${r.skipped.length?` · пропущено: ${r.skipped.length}`:''}`);if(r.skipped.length&&r.skipped.length<=20)setTimeout(()=>sheet('Не все компании обработаны',`<ul class="co-skip">${r.skipped.map(x=>`<li><b>${esc(x.name||x.id)}</b> — ${esc(x.reason)}</li>`).join('')}</ul>`,[]),300);await renderPage()};
 p.querySelectorAll('[data-bulk]').forEach(b=>b.onclick=async()=>{const a=b.dataset.bulk,n=sel.size;if(!n)return;
  if(a==='owner'){const users=(await api('/api/people')).filter(x=>!x.disabled);return modal('Сменить ответственного',`<p>Компаний: <b>${n}</b>. Новый ответственный увидит их у себя; ответственные по сделкам не меняются.</p>${select('co-owner','Ответственный',[['','Выберите'],...users.map(x=>[x.id,x.name])],'',true)}`,()=>run({action:'owner',managerId:val('co-owner')},'Ответственный изменён'),'Назначить')}
  if(a==='task')return modal('Поставить задачу',`<p>Задача появится в ленте каждой из <b>${n}</b> компаний.</p><div class="form-grid">${input('co-task','Что сделать','Позвонить, предложить технику','text',true,'maxlength="160"')}${input('co-due','Срок',localDate(),'date')}</div>`,()=>run({action:'task',title:val('co-task'),due:val('co-due')},'Задача поставлена'),'Поставить');
  if(a==='export'){const rows=list.filter(c=>sel.has(c.id)).map(c=>({inn:c.inn||'',name:c.name,phone:c.phone||'',note:c.note||''}));return downloadContactsFile(PrometeyContacts.csv(rows),'Компании_'+localDate()+'.csv')}
  if(a==='archive')return modal('Отправить в архив?',`<p>Компаний: <b>${n}</b>. Их можно будет восстановить: «Показывать → Архив».</p>`,()=>run({action:'archive'},'В архиве'),'В архив');
  if(a==='restore')return run({action:'restore'},'Восстановлено');
  if(a==='delete')return modal('Удалить компании?',`<p>Компаний: <b>${n}</b>. <b>Удаление нельзя отменить.</b> Компании со сделками, документами или оплатами не удаляются — их можно отправить в архив.</p>`,()=>run({action:'delete'},'Удалено'),'Удалить навсегда');
 });
 
}

// ---------- карточка компании ----------
const CO_ICON={comment:'💬',note:'📝',data:'📇',link:'🔗',task:'✓',log:'•',deal:'📋',doc:'📄',act:'🧾',payment:'₽',call:'📞'};
async function showCompanyCard(p,id){
 const d=await api('/api/workspaces/clients/'+encodeURIComponent(id)),x=d.record,edit=d.canEdit;
 const tl=d.timeline||[],open=tl.filter(e=>e.kind==='task'&&!e.done);
 const st=stateFor('clientcard');st.filter??='all';
 const facts=[['ИНН',x.inn],['КПП',x.kpp],['Телефон',x.phone],['E-mail',x.email],['Юридический адрес',x.legalAddress],['Адрес',x.address&&x.address!=='—'&&x.address!==x.legalAddress?x.address:''],['Вид техники',x.equipmentType&&x.equipmentType!=='Не указан'?x.equipmentType:''],['Создана',x.createdAt?new Date(x.createdAt).toLocaleDateString('ru-RU'):'']].filter(([,v])=>v);
 const phones=String(x.phone||'').split(/,\s*/).filter(Boolean);
 const last=tl.find(e=>e.kind!=='log')?.at||x.updatedAt;
 p.innerHTML=`<button class="btn btn-light btn-sm" id="ws-back">← К компаниям</button>
 <header class="cc-head"><div class="cc-ava">${x.logo&&typeof logoImg==='function'?logoImg(x.logo,'cc-ava-img'):esc(coInitials(x.name))}</div><div class="cc-title"><h1>${esc(x.name)} ${archiveBadge(x)}</h1>
  <div class="cc-meta">${x.inn?`<span>ИНН ${esc(x.inn)}</span>`:''}${phones.map(t=>`<a href="tel:${esc(t.replace(/[^\d+]/g,''))}">📞 ${esc(t)}</a>`).join('')}${x.email?`<a href="mailto:${esc(String(x.email).split(/,\s*/)[0])}">✉ ${esc(x.email)}</a>`:''}</div>
  <div class="cc-owner">Ответственный: <b>${esc(x.manager||'не назначен')}</b>${d.canAssign&&!x.archivedAt?' <button type="button" class="link-btn" id="ws-owner">сменить</button>':''}</div></div>
  <div class="cc-actions">${!x.archivedAt?`<button class="btn btn-primary btn-sm" id="cc-invoice">Выставить счёт</button><button class="btn btn-dark btn-sm" id="cc-deal">+ Сделка</button>`:''}${edit?'<button class="btn btn-light btn-sm" id="ws-edit-record">Изменить</button>':''}</div></header>
 <div class="cc-stats"><div><span>Сделок</span><b>${d.deals.length}</b></div><div><span>Плановый оборот</span><b>${money(x.revenue)}</b></div><div><span>Открытых задач</span><b class="${open.some(t=>t.due&&t.due<localDate())?'neg':''}">${open.length}</b></div><div><span>Последняя активность</span><b>${esc(coAgo(last)||'—')}</b></div></div>
 <div class="cc-grid"><aside class="cc-side"><section class="ws-panel"><h3>Реквизиты и контакты</h3>${facts.length?`<dl class="cc-facts">${facts.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`:'<p class="muted">Реквизиты не заполнены</p>'}${x.note&&x.note!=='Загружено из Excel'?`<p class="ws-text cc-note">${esc(x.note)}</p>`:''}${edit?'<button class="btn btn-ghost btn-sm" id="ws-edit-record2">Заполнить / изменить</button>':''}</section>
  <section class="ws-panel"><h3>Сделки <span class="muted">${d.deals.length}</span></h3>${d.deals.map(o=>`<button class="ws-related" data-related="${esc(o.id)}"><span><b>${esc(o.number)} · ${esc(o.name)}</b><small>${esc(o.manager)} · ${esc(statusLabel(o.status))}${o.archivedAt?' · Архив':''}</small></span><strong>${money(o.status==='cancelled'?0:o.revenue)}</strong></button>`).join('')||'<p class="muted">Сделок пока нет</p>'}</section></aside>
 <main class="ws-board cc-main"><section class="ws-panel cc-feed"><div class="cc-feed-head"><h2>Лента и история</h2><div class="seg cc-filter">${[['all','Всё'],['comment','Комментарии'],['task','Задачи'],['history','История']].map(([k,t])=>`<button type="button" class="${st.filter===k?'active':''}" data-feed-filter="${k}">${t}${k==='task'&&open.length?` <span class="cc-dot">${open.length}</span>`:''}</button>`).join('')}</div></div>
  ${edit?`<form class="cc-compose" id="cc-compose"><div class="seg cc-kind"><button type="button" class="active" data-compose="comment">Комментарий</button><button type="button" data-compose="task">Задача</button></div><textarea class="field" id="cc-text" rows="2" maxlength="12000" placeholder="Напишите комментарий: договорённости, условия, что обсудили…" aria-label="Текст"></textarea><div class="cc-compose-row"><label class="cc-due" hidden>Срок <input class="field" type="date" id="cc-due" value="${localDate()}"></label><span style="flex:1"></span><button class="btn btn-primary btn-sm" id="cc-send">Отправить</button></div></form>`:'<p class="code-note">Карточка доступна только для просмотра.</p>'}
  <div class="cc-timeline" id="cc-timeline"></div></section></main></div>`;
 const user=me?.name||'';
 const draw=()=>{const f=st.filter,list=tl.filter(e=>f==='all'||(f==='comment'&&['comment','note','data','link'].includes(e.kind))||(f==='task'&&e.kind==='task')||(f==='history'&&['log','deal','doc','act','payment','call'].includes(e.kind)));
  const box=p.querySelector('#cc-timeline');let day='';
  box.innerHTML=list.map(e=>{const dd=new Date(e.at).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});const head=dd!==day?`<div class="cc-day">${esc(dd)}</div>`:'';day=dd;const own=['comment','note','data','link','task'].includes(e.kind);
   return head+`<article class="cc-ev cc-${esc(e.kind)} ${e.done?'is-done':''}"><span class="cc-ic" aria-hidden="true">${CO_ICON[e.kind]||'•'}</span><div class="cc-body"><div class="cc-line"><b>${esc(e.user||'')}</b><time>${esc(new Date(e.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}))}</time>${e.kind==='task'?`<span class="badge ${!e.done&&e.due&&e.due<localDate()?'ws-overdue':e.done?'badge-ok':''}">${e.done?'выполнена':e.due?'до '+esc(new Date(e.due+'T00:00').toLocaleDateString('ru-RU')):'задача'}</span>`:''}${e.status?`<span class="badge">${esc(e.status)}</span>`:''}</div>
    ${e.title&&e.kind!=='comment'?`<div class="cc-t">${e.kind==='deal'?`<a href="#" data-related="${esc(e.orderId)}">${esc(e.title)}</a>`:esc(e.title)}</div>`:''}${e.text?`<div class="cc-x">${esc(e.text)}${e.extra?' → '+esc(e.extra):''}</div>`:''}${e.url?`<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">Открыть ссылку ↗</a>`:''}
    ${edit&&own?`<div class="cc-ev-act">${e.kind==='task'?`<button type="button" class="link-btn" data-toggle="${esc(e.id)}">${e.done?'Вернуть в работу':'Выполнено'}</button>`:''}${e.user===user||can('crm','all')?`<button type="button" class="link-btn" data-del="${esc(e.id)}">Удалить</button>`:''}</div>`:''}</div></article>`}).join('')||'<div class="ws-empty">Здесь будет лента: комментарии, задачи и всё, что происходит с компанией</div>';
  box.querySelectorAll('[data-related]').forEach(a=>a.onclick=ev=>{ev.preventDefault();current='orders';workspaceSelection={kind:'orders',id:a.dataset.related};renderApp()});
  box.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=async()=>{const e=tl.find(z=>z.id===b.dataset.toggle);b.disabled=true;try{await api(`/api/workspaces/clients/${id}/items/${e.id}`,{method:'PATCH',body:JSON.stringify({done:!e.done})});renderPage()}catch(err){toast(err.message,true);b.disabled=false}});
  box.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>modal('Удалить запись?','<p>Запись исчезнет из ленты.</p>',()=>api(`/api/workspaces/clients/${id}/items/${b.dataset.del}`,{method:'DELETE'}),'Удалить'));
 };draw();
 p.querySelectorAll('[data-feed-filter]').forEach(b=>b.onclick=()=>{st.filter=b.dataset.feedFilter;p.querySelectorAll('[data-feed-filter]').forEach(z=>z.classList.toggle('active',z===b));draw()});
 let kind='comment';const form=p.querySelector('#cc-compose');
 if(form){form.querySelectorAll('[data-compose]').forEach(b=>b.onclick=()=>{kind=b.dataset.compose;form.querySelectorAll('[data-compose]').forEach(z=>z.classList.toggle('active',z===b));form.querySelector('.cc-due').hidden=kind!=='task';form.querySelector('#cc-text').placeholder=kind==='task'?'Что нужно сделать? Например: перезвонить и предложить автокран':'Напишите комментарий: договорённости, условия, что обсудили…'});
  const send=async e=>{e?.preventDefault();const text=val('cc-text').trim();if(!text)return toast('Напишите текст',true);const btn=form.querySelector('#cc-send');btn.disabled=true;try{await api(`/api/workspaces/clients/${id}/items`,{method:'POST',body:JSON.stringify(kind==='task'?{type:'task',title:text.slice(0,160),content:text.length>160?text:'',due:val('cc-due')}:{type:'comment',title:'',content:text})});renderPage()}catch(err){toast(err.message,true);btn.disabled=false}};
  form.onsubmit=send;form.querySelector('#cc-text').onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))send(e)}}
 p.querySelector('#ws-back').onclick=()=>{workspaceSelection=null;renderPage()};
 ['#ws-edit-record','#ws-edit-record2'].forEach(s=>p.querySelector(s)?.addEventListener('click',()=>openClientCreate(x)));
 p.querySelectorAll('.cc-side [data-related]').forEach(b=>b.onclick=()=>{current='orders';workspaceSelection={kind:'orders',id:b.dataset.related};renderApp()});
 p.querySelector('#ws-owner')?.addEventListener('click',async()=>{try{const users=(await api('/api/people')).filter(u=>!u.disabled);modal('Ответственный за компанию',`<p>Ответственный видит компанию у себя и отвечает за работу с ней. Ответственные по сделкам не меняются.</p>${select('ws-new-owner','Сотрудник',users.map(u=>[u.id,u.name]),x.managerId||users[0]?.id,true)}`,()=>api('/api/workspaces/clients/'+id+'/owner',{method:'PATCH',body:JSON.stringify({managerId:val('ws-new-owner')})}))}catch(e){toast(e.message,true)}});
 p.querySelector('#cc-deal')?.addEventListener('click',()=>openOrderCreate({clientId:id}));
 p.querySelector('#cc-invoice')?.addEventListener('click',async()=>{if(typeof qiFresh!=='function'){current='quickinvoice';return renderApp()}qi=qiFresh();qi.client={id:x.id,name:x.name,inn:x.inn||'',kpp:x.kpp||'',legalAddress:x.legalAddress||'',phone:x.phone||'',email:x.email||'',isNew:false};try{qi.context=await api('/api/quick-invoice/context?clientId='+encodeURIComponent(x.id));if(qi.context?.objects?.[0])qi.address=qi.context.objects[0].address}catch{}workspaceSelection=null;current='quickinvoice';renderApp()});
 if(edit&&typeof logoEditor==='function'){const side=p.querySelector('.cc-side .ws-panel');const h=document.createElement('div');h.className='ws-logo-block';h.innerHTML='<h4>Логотип компании</h4>';h.append(logoEditor('client',x.id,x.logo));side.append(h)}
 await mountDocumentsPanel(p,'clients',id,{deals:d.deals||[]});
 await mountCalls(p,'clients',id,x);
}
