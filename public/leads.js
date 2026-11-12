'use strict';
// Лиды: заявки с рекламы (Авито, Директ) и ручные. Статусы: Не обработан → В работе → Отправлено КП → Победа (в сделку) / Некачественный (архив).
const leadSources={own:'Вручную',call:'Входящий звонок',website:'Сайт',avito:'Авито',direct:'Яндекс Директ',email:'Почта',referral:'Рекомендация',other:'Другое'};
const leadStates={new:'Не обработан',in_progress:'В работе',kp_sent:'Отправлено КП',won:'Победа',junk:'Некачественный'};
const LEAD_TABS=[['active','Активные',l=>['new','in_progress','kp_sent'].includes(l.status)],['new','Не обработан',l=>l.status==='new'],['in_progress','В работе',l=>l.status==='in_progress'],['kp_sent','Отправлено КП',l=>l.status==='kp_sent'],['won','Победа',l=>l.status==='won'],['junk','Некачественные',l=>l.status==='junk'],['all','Все',()=>true]];
const leadUi={tab:'active',q:'',source:'',owner:'',picked:new Set()};
const leadBadge=st=>`<span class="ld-badge ld-${esc(st)}">${esc(leadStates[st]||st)}</span>`;
const leadDate=v=>v?new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';

async function leadsPage(p){
 const [leads,meta]=await Promise.all([api('/api/leads'),api('/api/leads/meta')]);
 const count=Object.fromEntries(LEAD_TABS.map(([k,,f])=>[k,leads.filter(f).length]));
 const ids=new Set(leads.map(l=>l.id));for(const id of [...leadUi.picked])if(!ids.has(id))leadUi.picked.delete(id);
 p.innerHTML=`<div class="page-head"><div><h1>Лиды</h1><p>Заявки с Авито и Директа приходят сами, остальные добавляйте вручную. Победа — лид уходит в сделку.</p></div>
  <div class="actions">${meta.admin&&leads.length?'<button class="btn btn-light" id="ld-clear">Очистить все лиды</button>':''}<button class="btn btn-primary" id="create-lead">+ Добавить лид</button></div></div>
  <div class="ld-tabs" role="tablist">${LEAD_TABS.map(([k,name])=>`<button type="button" role="tab" class="ld-tab ld-tab-${k}${leadUi.tab===k?' on':''}" aria-selected="${leadUi.tab===k}" data-ld-tab="${k}">${esc(name)} <b>${count[k]}</b></button>`).join('')}</div>
  <div class="ld-filters"><input class="field" id="ld-q" type="search" placeholder="Имя, телефон, ИНН, техника…" value="${esc(leadUi.q)}">
   <select class="field" id="ld-src"><option value="">Все источники</option>${Object.entries(leadSources).map(([k,v])=>`<option value="${k}"${leadUi.source===k?' selected':''}>${esc(v)}</option>`).join('')}</select>
   <select class="field" id="ld-own"><option value="">Все ответственные</option><option value="none"${leadUi.owner==='none'?' selected':''}>Не назначен</option>${meta.people.map(v=>`<option value="${esc(v.id)}"${leadUi.owner===v.id?' selected':''}>${esc(v.name)}</option>`).join('')}</select></div>
  <div id="ld-bulk"></div><div class="panel co-table-wrap"><div id="ld-table"></div></div>`;
 const rows=()=>{const f=LEAD_TABS.find(t=>t[0]===leadUi.tab)[2],q=leadUi.q.trim().toLowerCase();return leads.filter(f).filter(l=>(!leadUi.source||l.source===leadUi.source)&&(!leadUi.owner||(leadUi.owner==='none'?!l.ownerId:l.ownerId===leadUi.owner))&&(!q||[l.name,l.company,l.phone,l.inn,l.equipment,l.address,l.note].join(' ').toLowerCase().includes(q)))};
 const draw=()=>{const list=rows(),box=p.querySelector('#ld-table');
  box.innerHTML=list.length?`<table class="table co-table ld-table"><thead><tr><th class="co-chk"><input type="checkbox" id="ld-all" aria-label="Выбрать все"${list.every(l=>leadUi.picked.has(l.id))?' checked':''}></th><th>Лид</th><th>Источник</th><th>Статус</th><th>Ответственный</th><th>Что нужно</th><th>Следующий шаг</th><th>Пришёл</th><th></th></tr></thead><tbody>${list.map(l=>`<tr class="ld-row ld-row-${esc(l.status)}" data-lead="${esc(l.id)}"><td class="co-chk"><input type="checkbox" data-ld-pick="${esc(l.id)}"${leadUi.picked.has(l.id)?' checked':''} aria-label="Выбрать"></td>
   <td><button type="button" class="link-btn ld-open" data-id="${esc(l.id)}"><b>${esc(l.name)}</b></button><div class="muted small">${esc([l.company!==l.name?l.company:'',l.phone].filter(Boolean).join(' · '))}</div></td>
   <td>${esc(leadSources[l.source]||l.source)}</td><td>${leadBadge(l.status)}</td><td>${l.ownerId?esc(l.owner):'<span class="muted">Не назначен</span>'}</td>
   <td class="small">${esc(l.equipment||'—')}${l.address?`<div class="muted">${esc(l.address)}</div>`:''}</td>
   <td class="small${l.overdue?' ld-late':''}">${l.nextAction||l.nextAt?esc(l.nextAction||'Действие')+'<div class="muted">'+esc(leadDate(l.nextAt))+(l.overdue?' · просрочено':'')+'</div>':'—'}</td>
   <td class="small muted">${esc(leadDate(l.createdAt))}</td><td class="ld-quick">${leadQuick(l)}</td></tr>`).join('')}</tbody></table>`:empty(leads.length?'В этой вкладке лидов нет':'Лидов пока нет. Добавьте вручную или подключите Авито / Директ.');
  box.querySelector('#ld-all')?.addEventListener('change',e=>{for(const l of list)e.target.checked?leadUi.picked.add(l.id):leadUi.picked.delete(l.id);draw()});
  box.querySelectorAll('[data-ld-pick]').forEach(c=>c.onchange=()=>{c.checked?leadUi.picked.add(c.dataset.ldPick):leadUi.picked.delete(c.dataset.ldPick);bulk()});
  box.querySelectorAll('.ld-open').forEach(b=>b.onclick=()=>leadDetail(b.dataset.id,meta));
  box.querySelectorAll('[data-ld-act]').forEach(b=>b.onclick=()=>leadAction(b.dataset.ldAct,leads.find(l=>l.id===b.dataset.id),meta,b));
  bulk()};
 const bulk=()=>{const n=leadUi.picked.size,box=p.querySelector('#ld-bulk');if(!n){box.innerHTML='';return}
  box.innerHTML=`<div class="co-bulk ld-bulk"><b>Выбрано: ${n}</b><div class="co-bulk-actions">
   ${meta.canAssign?`<select class="field" id="ldb-owner" aria-label="Ответственный"><option value="">Назначить ответственного…</option>${meta.people.map(v=>`<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('')}</select>`:''}
   <button type="button" class="btn btn-light btn-sm" data-ldb="in_progress">В работу</button><button type="button" class="btn btn-light btn-sm" data-ldb="new">Не обработан</button><button type="button" class="btn btn-light btn-sm" data-ldb="junk">Некачественный</button>
   ${meta.admin?'<button type="button" class="btn btn-danger btn-sm" data-ldb="delete">Удалить</button>':''}</div><button type="button" class="link-btn" id="ldb-clear">Снять выделение</button></div>`;
  const run=async body=>{try{const r=await api('/api/leads/bulk',{method:'POST',body:JSON.stringify({ids:[...leadUi.picked],...body})});toast('Готово: '+r.done);leadUi.picked.clear();await renderPage()}catch(e){toast(e.message,true)}};
  box.querySelector('#ldb-owner')?.addEventListener('change',e=>{if(e.target.value)run({action:'owner',ownerId:e.target.value})});
  box.querySelectorAll('[data-ldb]').forEach(b=>b.onclick=()=>{const v=b.dataset.ldb;if(v==='delete'){if(b.dataset.sure!=='1'){b.dataset.sure='1';b.textContent=`Точно удалить ${n}?`;return}return run({action:'delete'})}run({action:'status',status:v})});
  box.querySelector('#ldb-clear').onclick=()=>{leadUi.picked.clear();draw()}};
 p.querySelectorAll('[data-ld-tab]').forEach(b=>b.onclick=()=>{leadUi.tab=b.dataset.ldTab;p.querySelectorAll('[data-ld-tab]').forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-selected',x===b)});draw()});
 p.querySelector('#ld-q').oninput=e=>{leadUi.q=e.target.value;draw()};
 p.querySelector('#ld-src').onchange=e=>{leadUi.source=e.target.value;draw()};
 p.querySelector('#ld-own').onchange=e=>{leadUi.owner=e.target.value;draw()};
 p.querySelector('#create-lead').onclick=()=>leadForm(meta);
 p.querySelector('#ld-clear')?.addEventListener('click',()=>modal('Очистить все лиды?',`<p>Будут удалены <b>все ${leads.length}</b> лидов вместе с историей. Компании, сделки и КП останутся. Отменить нельзя.</p><div class="form-group"><label for="ld-confirm">Для подтверждения напишите УДАЛИТЬ</label><input class="field" id="ld-confirm" autocomplete="off"></div>`,async()=>{if(val('ld-confirm').trim().toUpperCase()!=='УДАЛИТЬ')throw new Error('Напишите УДАЛИТЬ');const r=await api('/api/leads/bulk',{method:'POST',body:JSON.stringify({ids:leads.map(l=>l.id),action:'delete'})});leadUi.picked.clear();toast('Удалено лидов: '+r.done)},'Удалить все'));
 draw();
}
function leadQuick(l){const b=(act,text,cls='btn-light')=>`<button type="button" class="btn ${cls} btn-sm" data-ld-act="${act}" data-id="${esc(l.id)}">${text}</button>`;
 if(l.status==='new')return b('take','Взять в работу','btn-primary');
 if(l.status==='in_progress')return b('kp','КП')+' '+b('win','Победа','btn-win');
 if(l.status==='kp_sent')return b('kp','Ещё КП')+' '+b('win','Победа','btn-win');
 if(l.status==='won')return l.orderId?`<span class="muted small">Сделка ${esc(l.order||'')}</span>`:b('deal','Создать сделку','btn-win');
 return b('restore','Вернуть в работу');
}
async function leadAction(act,l,meta,btn){if(btn)btn.disabled=true;
 try{
  if(act==='take'){await api('/api/leads/'+encodeURIComponent(l.id)+'/take',{method:'POST',body:'{}'});toast('Лид в работе');return renderPage()}
  if(act==='restore'){await api('/api/leads/'+encodeURIComponent(l.id),{method:'PATCH',body:JSON.stringify({status:'in_progress'})});toast('Лид снова в работе');return renderPage()}
  if(act==='junk'){modalRoot.innerHTML='';return modal('Некачественный лид',`<p>Лид уйдёт в архив «Некачественные». Его можно вернуть в работу.</p>${input('ld-reason','Причина','Не целевой')}`,()=>api('/api/leads/'+encodeURIComponent(l.id),{method:'PATCH',body:JSON.stringify({status:'junk',junkReason:val('ld-reason')})}),'В архив')}
  if(act==='kp'){if(typeof kpEditor!=='function')throw new Error('Раздел КП недоступен');modalRoot.innerHTML='';
   kpPreset={leadId:l.id,clientId:l.clientId||'',clientName:l.company||l.name,clientInn:l.inn||'',contactName:l.company&&l.company!==l.name?l.name:'',...(l.equipment?{items:[{name:l.equipment,specs:'',unit:'shift',rate:'',minOrder:''}]}:{})};
   kpOpen='new';current='proposals';return renderApp()}
  if(act==='win'||act==='deal'){const r=act==='win'?await api('/api/leads/'+encodeURIComponent(l.id)+'/win',{method:'POST',body:'{}'}):l;modalRoot.innerHTML='';
   if(act==='win')toast('Победа! Компания: '+(r.client||l.company||l.name));
   const nh=new Date(Date.now()+3600e3);nh.setMinutes(0,0,0);const start=new Date(nh.getTime()-nh.getTimezoneOffset()*6e4).toISOString().slice(0,16);
   return openOrderCreate({clientId:r.clientId,leadId:l.id,start,name:(l.equipment||'Аренда техники')+' — '+(r.client||l.company||l.name),address:l.address||'',equipmentType:l.equipment||'',note:l.note||('Из лида: '+l.name)})}
 }catch(e){toast(e.message,true);if(btn)btn.disabled=false}
}
function leadForm(meta){
 modal('Новый лид',`<p class="muted">Достаточно имени или телефона — остальное можно дописать позже.</p><div class="form-grid">${input('ld-name','Контактное лицо')}${input('ld-phone','Телефон','','tel')}${input('ld-company','Компания')}${input('ld-inn','ИНН','','text',false,'inputmode="numeric" maxlength="12"')}${input('ld-email','Почта','','email')}${select('ld-source','Источник',Object.entries(leadSources),'own')}${input('ld-equipment','Какая техника нужна','','text',false,'placeholder="Экскаватор-погрузчик, 3 смены"')}${input('ld-address','Адрес объекта')}
  ${select('ld-owner','Ответственный',meta.canAssign?[['','Не назначен'],...meta.people.map(v=>[v.id,v.name])]:[[me.id,me.name],['','Не назначен']],me.id)}${select('ld-status','Статус',[['new','Не обработан'],['in_progress','В работе']],'new')}
  <div class="form-group full"><label for="ld-note">Комментарий</label><textarea class="field" id="ld-note" rows="3"></textarea></div></div>`,
 ()=>{if(!val('ld-name').trim()&&!val('ld-phone').trim()&&!val('ld-company').trim())throw new Error('Укажите имя, телефон или компанию');
  return api('/api/leads',{method:'POST',body:JSON.stringify({name:val('ld-name'),phone:val('ld-phone'),company:val('ld-company'),inn:val('ld-inn'),email:val('ld-email'),source:val('ld-source'),equipment:val('ld-equipment'),address:val('ld-address'),ownerId:val('ld-owner'),status:val('ld-status'),note:val('ld-note')})})},'Добавить лид');
 const own=document.getElementById('ld-owner'),st=document.getElementById('ld-status');own.onchange=()=>{if(own.value&&own.value!==me.id)st.value='in_progress'};
}
async function leadDetail(id,meta){
 const [l,events]=await Promise.all([api('/api/leads/'+encodeURIComponent(id)),api('/api/leads/'+encodeURIComponent(id)+'/events')]);
 const closed=['won','junk'].includes(l.status);
 const statusItems=Object.entries(leadStates).filter(([k])=>k!=='won'||l.status==='won');
 const owners=meta.canAssign?[['','Не назначен'],...meta.people.map(v=>[v.id,v.name])]:[[l.ownerId||'',l.ownerId?l.owner:'Не назначен'],...(!l.ownerId?[[me.id,me.name]]:[])];
 modal('Лид · '+l.name,`<div class="ld-card-head">${leadBadge(l.status)}<span class="muted small">${esc(leadSources[l.source]||l.source)} · пришёл ${esc(leadDate(l.createdAt))}</span>${l.client?`<span class="small">Компания: <b>${esc(l.client)}</b></span>`:''}${l.order?`<span class="small">Сделка: <b>${esc(l.order)}</b></span>`:''}${l.proposals?.length?`<span class="small">КП: ${l.proposals.map(p=>esc(p.number)).join(', ')}</span>`:''}</div>
  <div class="ld-actions">${l.status==='new'?'<button type="button" class="btn btn-primary btn-sm" data-lda="take">Взять в работу</button>':''}${!closed?'<button type="button" class="btn btn-light btn-sm" data-lda="kp">Создать КП</button><button type="button" class="btn btn-win btn-sm" data-lda="win">Победа → в сделку</button><button type="button" class="btn btn-light btn-sm" data-lda="junk">Некачественный</button>':''}${l.status==='won'&&!l.orderId?'<button type="button" class="btn btn-win btn-sm" data-lda="deal">Создать сделку</button>':''}${l.status==='junk'?'<button type="button" class="btn btn-light btn-sm" data-lda="restore">Вернуть в работу</button>':''}</div>
  <div class="form-grid">${input('ld-name','Контактное лицо',l.name)}${input('ld-phone','Телефон',l.phone,'tel')}${input('ld-company','Компания',l.company)}${input('ld-inn','ИНН',l.inn,'text',false,'inputmode="numeric" maxlength="12"')}${input('ld-email','Почта',l.email,'email')}${select('ld-source','Источник',Object.entries(leadSources),l.source)}${input('ld-equipment','Какая техника нужна',l.equipment)}${input('ld-address','Адрес объекта',l.address)}
   ${select('ld-status','Статус',statusItems,l.status)}${select('ld-owner','Ответственный',owners,l.ownerId||'')}${input('ld-action','Следующий шаг',l.nextAction,'text',false,'placeholder="Перезвонить, отправить КП…"')}${input('ld-due','Когда',l.nextAt?new Date(new Date(l.nextAt).getTime()-new Date().getTimezoneOffset()*6e4).toISOString().slice(0,16):'','datetime-local')}
   <div class="form-group full"><label for="ld-note">Комментарий к лиду</label><textarea class="field" id="ld-note" rows="2">${esc(l.note||'')}</textarea></div></div>
  <h3 class="ld-h">Лента и история</h3><div class="ld-compose">${select('ld-event-type','Тип',[['note','Комментарий'],['call','Звонок'],['message','Сообщение'],['email','Письмо'],['meeting','Встреча']],'call')}<div class="form-group"><label for="ld-event-text">Что было</label><input class="field" id="ld-event-text" placeholder="Позвонил, обсудили…"></div><button type="button" class="btn btn-light btn-sm" id="ld-event-add">Добавить</button></div>
  <div class="ld-feed">${events.slice().reverse().map(e=>`<div class="ld-ev ld-ev-${esc(e.type)}"><div class="muted small">${esc(leadDate(e.at))} · ${esc(e.author)}</div><div>${esc(e.text)}</div></div>`).join('')||empty('История пуста')}</div>`,
 async()=>{await api('/api/leads/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({name:val('ld-name'),phone:val('ld-phone'),company:val('ld-company'),inn:val('ld-inn'),email:val('ld-email'),source:val('ld-source'),equipment:val('ld-equipment'),address:val('ld-address'),status:val('ld-status'),ownerId:val('ld-owner'),nextAction:val('ld-action'),nextAt:val('ld-due'),note:val('ld-note')})});
  if(val('ld-event-text').trim())await api('/api/leads/'+encodeURIComponent(id)+'/events',{method:'POST',body:JSON.stringify({type:val('ld-event-type'),text:val('ld-event-text')})})});
 document.getElementById('ld-event-add').onclick=async e=>{const text=val('ld-event-text').trim();if(!text)return document.getElementById('ld-event-text').focus();e.currentTarget.disabled=true;try{await api('/api/leads/'+encodeURIComponent(id)+'/events',{method:'POST',body:JSON.stringify({type:val('ld-event-type'),text})});await leadDetail(id,meta)}catch(err){toast(err.message,true);e.currentTarget.disabled=false}};
 modalRoot.querySelectorAll('[data-lda]').forEach(b=>b.onclick=()=>leadAction(b.dataset.lda,l,meta,b));
}
