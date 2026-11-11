/* Сделки: аккуратный список с фильтрами — ответственный, статус, период работ, поиск. */
const DEAL_STATUS=[['','Все'],['planned','Запланированы'],['working','В работе'],['done','Завершены'],['cancelled','Отменены']];
const DEAL_PERIODS=[['','За всё время'],['today','Сегодня'],['week','Эта неделя'],['month','Этот месяц'],['prev','Прошлый месяц'],['custom','Свой период']];
function dealPeriod(s){const iso=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);const t=new Date();t.setHours(0,0,0,0);
 if(s.period==='today')return [iso(t),iso(t)];
 if(s.period==='week'){const a=new Date(t);a.setDate(t.getDate()-((t.getDay()+6)%7));const b=new Date(a);b.setDate(a.getDate()+6);return [iso(a),iso(b)]}
 if(s.period==='month')return [iso(new Date(t.getFullYear(),t.getMonth(),1)),iso(new Date(t.getFullYear(),t.getMonth()+1,0))];
 if(s.period==='prev')return [iso(new Date(t.getFullYear(),t.getMonth()-1,1)),iso(new Date(t.getFullYear(),t.getMonth(),0))];
 if(s.period==='custom')return [s.from||'0000-01-01',s.to||'9999-12-31'];return null}

async function dealsList(p){
 const s=stateFor('orders');s.status??='';s.period??='';
 const q=new URLSearchParams({q:s.q||'',archive:s.archive||'active',sort:s.sort||'start',dir:s.dir||'desc',owner:s.owner||'all'});
 const seeAll=can('crm','read');
 const [all,people]=await Promise.all([api('/api/orders?'+q),seeAll?api('/api/people').catch(()=>[]):Promise.resolve([])]);
 const range=dealPeriod(s);
 const list=all.filter(o=>(!s.status||o.status===s.status)&&(!range||String(o.start||'').slice(0,10)<=range[1]&&String(o.end||o.start||'').slice(0,10)>=range[0]));
 const live=list.filter(o=>o.status!=='cancelled');const sum=live.reduce((a,o)=>a+Number(o.revenue||0),0),profit=live.reduce((a,o)=>a+Number(o.profit||0),0);
 const byStatus=k=>all.filter(o=>(!range||String(o.start||'').slice(0,10)<=range[1]&&String(o.end||o.start||'').slice(0,10)>=range[0])&&(!k||o.status===k)).length;
 const ru=v=>v?String(v).slice(0,10).split('-').reverse().join('.'):'';
 const ownerOpts=[['all',seeAll?'Все сотрудники':'Все доступные'],['mine','Мои сделки'],...(seeAll?[['unassigned','Без ответственного'],...people.filter(x=>!x.disabled).map(x=>[x.id,x.name])]:[])];
 p.innerHTML=`<div class="page-head"><div><h1>Сделки</h1><p>${seeAll?'Сделки всей команды — выберите сотрудника, статус или период.':'Ваши сделки и те, где вы участник.'}</p></div><div class="actions dl-head-actions">${typeof ordersTabs==='function'?ordersTabs('list'):''}<button class="btn btn-primary" id="add-order">+ Сделка</button></div></div>
 <form class="dl-filters panel" id="dl-filters" onsubmit="return false">
  <div class="dl-row">
   <div class="dl-search"><input class="field" type="search" id="dl-q" placeholder="Номер, название, компания, ИНН, телефон" value="${esc(s.q||'')}" aria-label="Поиск сделок"></div>
   <label class="dl-field">Ответственный<select class="field" id="dl-owner">${ownerOpts.map(([v,t])=>`<option value="${esc(v)}" ${String(s.owner||'all')===v?'selected':''}>${esc(t)}</option>`).join('')}</select></label>
   <label class="dl-field">Период работ<select class="field" id="dl-period">${DEAL_PERIODS.map(([v,t])=>`<option value="${v}" ${s.period===v?'selected':''}>${t}</option>`).join('')}</select></label>
   ${s.period==='custom'?`<label class="dl-field dl-date">с<input class="field" type="date" id="dl-from" value="${esc(s.from||'')}"></label><label class="dl-field dl-date">по<input class="field" type="date" id="dl-to" value="${esc(s.to||'')}"></label>`:''}
   <label class="dl-field">Сортировка<select class="field" id="dl-sort">${[['start','Сначала новые по датам'],['number','По номеру'],['client','По компании'],['revenue','По обороту']].map(([v,t])=>`<option value="${v}" ${s.sort===v?'selected':''}>${t}</option>`).join('')}</select></label>
   <label class="dl-field">Показывать<select class="field" id="dl-archive">${[['active','Активные'],['archived','Архив'],['all','Все']].map(([v,t])=>`<option value="${v}" ${s.archive===v?'selected':''}>${t}</option>`).join('')}</select></label>
  </div>
  <div class="dl-chips" role="group" aria-label="Статус">${DEAL_STATUS.map(([v,t])=>`<button type="button" class="dl-chip ${s.status===v?'on':''}" data-status="${v}" aria-pressed="${s.status===v}">${t} <span>${byStatus(v)}</span></button>`).join('')}${s.q||s.status||s.period||(s.owner&&s.owner!=='all')?'<button type="button" class="link-btn dl-reset" id="dl-reset">Сбросить фильтры</button>':''}</div>
 </form>
 <div class="ws-metrics dl-metrics"><div><span>Сделок</span><strong>${list.length}</strong></div><div><span>Оборот${range?' за период':''}</span><strong>${money(sum)}</strong></div>${can('finance','own')?`<div><span>Прибыль</span><strong>${money(profit)}</strong></div>`:''}<div><span>В работе</span><strong>${list.filter(o=>o.status==='working').length}</strong></div></div>
 ${list.length?`<div class="table-wrap dl-table-wrap"><table class="table dl-table"><thead><tr><th>Сделка</th><th>Компания</th><th>Даты работ</th>${seeAll?'<th>Ответственный</th>':''}<th>Статус</th><th class="r">Оборот</th><th></th></tr></thead><tbody>${list.map(o=>`<tr class="dl-row-item" data-open="${esc(o.id)}" tabindex="0">
  <td><b class="dl-num">${esc(o.number)}</b>${o.name&&o.name!==o.number?`<div class="dl-name">${esc(o.name)}</div>`:''}${o.archivedAt?' <span class="badge">архив</span>':''}</td>
  <td><b>${esc(o.client||'—')}</b><div class="muted small">${esc(o.object||o.address||'')}</div></td>
  <td class="nw">${ru(o.start)}${o.end&&String(o.end).slice(0,10)!==String(o.start).slice(0,10)?' — '+ru(o.end):''}</td>
  ${seeAll?`<td>${esc(o.manager||'—')}</td>`:''}
  <td><span class="${statusBadge(o.status)}">${esc(o.status==='cancelled'?'Отменена':statusLabel(o.status))}</span></td>
  <td class="r nw"><b>${money(o.revenue)}</b>${can('finance','own')&&o.profit!=null?`<div class="muted small">прибыль ${money(o.profit)}</div>`:''}</td>
  <td class="nw dl-acts"><button type="button" class="btn btn-dark btn-sm" data-workspace="${esc(o.id)}">Рабочий стол</button>${!o.archivedAt&&o.canEdit!==false?`<button type="button" class="btn btn-ghost btn-sm edit-order" data-id="${esc(o.id)}" title="Изменить сделку">Изменить</button>`:''}${archiveButton(o)}</td></tr>`).join('')}</tbody></table></div>`
 :`<div class="panel dl-empty"><b>${all.length?'По фильтрам ничего не нашлось':'Сделок пока нет'}</b><p class="muted">${all.length?'Измените период, статус или ответственного.':'Создайте сделку или выставьте счёт — сделка создастся сама.'}</p></div>`}`;
 const st=k=>v=>{s[k]=v;renderPage()};
 let t=0;p.querySelector('#dl-q').oninput=e=>{clearTimeout(t);t=setTimeout(()=>{s.q=e.target.value.trim();renderPage().then(()=>{const f=document.getElementById('dl-q');if(f){f.focus();f.setSelectionRange(f.value.length,f.value.length)}})},350)};
 p.querySelector('#dl-owner').onchange=e=>st('owner')(e.target.value);
 p.querySelector('#dl-period').onchange=e=>st('period')(e.target.value);
 p.querySelector('#dl-from')?.addEventListener('change',e=>st('from')(e.target.value));p.querySelector('#dl-to')?.addEventListener('change',e=>st('to')(e.target.value));
 p.querySelector('#dl-sort').onchange=e=>{s.sort=e.target.value;s.dir=['start','revenue'].includes(s.sort)?'desc':'asc';renderPage()};
 p.querySelector('#dl-archive').onchange=e=>st('archive')(e.target.value);
 p.querySelectorAll('[data-status]').forEach(b=>b.onclick=()=>st('status')(b.dataset.status));
 p.querySelector('#dl-reset')?.addEventListener('click',()=>{Object.assign(s,{q:'',status:'',period:'',from:'',to:'',owner:'all'});renderPage()});
 p.querySelector('#add-order').onclick=()=>openOrderCreate();
 if(typeof bindOrdersTabs==='function')bindOrdersTabs(p);
 p.querySelectorAll('.edit-order').forEach(b=>b.onclick=e=>{e.stopPropagation();openOrderCreate(list.find(x=>x.id===b.dataset.id))});
 bindArchive('orders');
 const open=id=>{workspaceSelection={kind:'orders',id};renderPage()};p.querySelectorAll('[data-workspace]').forEach(b=>b.onclick=e=>{e.stopPropagation();open(b.dataset.workspace)});
 p.querySelectorAll('[data-open]').forEach(r=>{r.onclick=e=>{if(e.target.closest('button'))return;open(r.dataset.open)};r.onkeydown=e=>{if(e.key==='Enter')open(r.dataset.open)}});
}
