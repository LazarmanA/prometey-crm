/* Журнал работ сделки: менеджер каждый день отмечает, что отработала техника.
   Строку или весь день можно скопировать на следующую дату и поправить. */
const J_UNITS=[['shift','смена'],['hour','час'],['machine_hour','маш.-ч'],['day','сутки'],['trip','рейс'],['unit','ед.'],['km','км'],['ton','т'],['m3','м³']];
const jDate=s=>{const t=new Date(s+'T00:00:00').toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'long'});return t.charAt(0).toUpperCase()+t.slice(1)};
const jShort=s=>s.split('-').reverse().slice(0,2).join('.');
const jToday=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const jNext=s=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)};

async function mountJournal(host,orderId){
 const box=document.createElement('section');box.className='ws-panel jr';box.id='ws-journal';host.append(box);
 let j=null;
 const load=async()=>{j=await api('/api/deals/'+encodeURIComponent(orderId)+'/journal');draw()};
 const send=async(path,method,body)=>{const r=await api('/api/deals/'+encodeURIComponent(orderId)+'/journal'+path,{method,body:body?JSON.stringify(body):undefined});j=r.journal;return r};
 const edit=()=>j.order.canEdit;
 function draw(){
  const t=j.totals,pct=t.plan?Math.min(100,Math.round(t.fact/t.plan*100)):0,last=j.days[0]?.date;
  const nextDay=last?jNext(last):jToday();
  box.innerHTML=`<div class="jr-head"><div><h3>Журнал работ по дням</h3><p class="muted small">Что техника отработала каждый день. Отсюда берутся «Счёт по факту», акты и сверка.</p></div>
   ${edit()?`<div class="actions">${last?`<button type="button" class="btn btn-primary btn-sm" id="jr-copy-last" title="Скопировать все строки ${jShort(last)} на ${jShort(nextDay)}">⧉ Повторить ${jShort(last)} → ${jShort(nextDay)}</button>`:''}<button type="button" class="btn ${last?'btn-light':'btn-primary'} btn-sm" id="jr-new-day">+ День</button></div>`:''}</div>
   <div class="jr-stats"><div class="jr-progress"><div><b>${money(t.fact)}</b><span class="muted small"> по факту${t.plan?' из '+money(t.plan)+' по плану':''}</span></div>${t.plan?`<div class="jr-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>`:''}</div>
    <div class="jr-machines">${j.byEq.map(e=>`<span class="jr-chip" title="${esc(e.name)}"><b>${esc(e.name.split(' · ').slice(0,2).join(' '))}</b> ${fmtQty(e.fact)}${e.plan?' из '+fmtQty(e.plan):''} ${esc(unitLabel(e.unit))} · ${e.days} дн.</span>`).join('')}</div>
    ${t.rejected?`<div class="jr-warn">Бухгалтерия вернула строк: ${t.rejected} — исправьте, они отмечены красным</div>`:''}</div>
   <div class="jr-newday" id="jr-newday" hidden></div>
   ${j.days.length?j.days.map(dayHtml).join(''):`<div class="jr-empty"><b>Журнал пока пуст</b><p class="muted">Отметьте первый день работы — дальше строки можно копировать на следующий день одним нажатием.</p>${edit()&&j.equipment.length?`<button type="button" class="btn btn-primary" id="jr-first">Записать ${jShort(jToday())}</button>`:!j.equipment.length?'<p class="muted small">Сначала добавьте технику в сделку (блок «Техника и расчёт»).</p>':''}</div>`}
   ${j.days.length&&edit()?`<div class="actions jr-foot"><button type="button" class="btn btn-light btn-sm" id="jr-fact-invoice">Счёт по факту</button></div>`:''}`;
  bind();
 }
 const fmtQty=n=>String(Math.round((Number(n)||0)*100)/100).replace('.',',');
 function dayHtml(g){const can=edit();return `<div class="jr-day" data-day="${g.date}"><div class="jr-day-head"><b>${esc(jDate(g.date))}</b><span class="jr-day-sum">${money(g.sum)}</span>${can?`<span class="jr-day-actions"><button type="button" class="btn btn-ghost btn-sm" data-copy-day="${g.date}" title="Скопировать все строки дня на ${jShort(jNext(g.date))}">⧉ День → ${jShort(jNext(g.date))}</button>${j.equipment.some(e=>!g.rows.some(r=>r.equipmentId===e.id))?`<button type="button" class="btn btn-ghost btn-sm" data-add-row="${g.date}">+ Техника</button>`:''}</span>`:''}</div>
  <div class="jr-table" role="table"><div class="jr-row jr-th" role="row"><span>Техника и комментарий</span><span>Отработано</span><span>Часы</span><span title="Переработка, часов">Сверх, ч</span><span>Ставка</span><span>Сумма</span><span></span></div>${g.rows.map(r=>rowHtml(r,can)).join('')}</div></div>`}
 function rowHtml(r,can){const ro=!can||r.locked;const st=r.locked?`<span class="jr-tag jr-tag-done" title="Включено в реализацию">реализация №${esc(r.realization)}</span>`:r.check==='checked'?'<span class="jr-tag jr-tag-ok" title="Проверено бухгалтерией">✓ проверено</span>':r.check==='rejected'?`<span class="jr-tag jr-tag-bad" title="${esc(r.checkComment)}">возвращено</span>`:'';
  const dis=ro?'disabled':'';
  return `<div class="jr-row ${r.check==='rejected'&&!r.locked?'jr-rejected':''}" role="row" data-row="${esc(r.id)}">
   <span class="jr-eq" data-label="Техника"><b>${esc(r.equipment)}</b>${st}${r.check==='rejected'&&r.checkComment?`<small class="jr-why">${esc(r.checkComment)}</small>`:''}<input class="field jr-comment" data-f="comment" value="${esc(r.comment)}" placeholder="+ комментарий" maxlength="500" ${dis} aria-label="Комментарий">${r.ownership==='rented'||r.partnerId?`<span class="jr-sup"><span class="jr-cp" data-cp-own="${r.ownership==='rented'?'Поставщик не указан':'Своя техника'}" data-cp-name="${esc(r.partner||'')}" data-cp-inn="${esc(r.partnerInn||'')}" data-cp-off="${dis||r.purchase?1:''}"></span><input type="hidden" data-f="partnerId" value="${esc(r.partnerId||'')}"><label class="jr-cost">цена поставщика <input class="field" type="number" min="0" step="any" data-f="purchaseRate" value="${r.purchaseRate??''}" ${dis||(r.purchase?'disabled':'')} aria-label="Цена поставщика"></label>${r.purchase?`<span class="jr-tag jr-tag-ok" title="Поставщик прислал документ">у поставщика: ${esc(r.purchase)}</span>`:''}</span>`:''}</span>
   <span class="jr-qty" data-label="Отработано"><input class="field" type="number" min="0.01" step="any" data-f="quantity" value="${r.quantity??''}" ${dis} aria-label="Отработано"><select class="field" data-f="unit" ${dis} aria-label="Единица">${J_UNITS.map(([v,t])=>`<option value="${v}" ${r.unit===v?'selected':''}>${t}</option>`).join('')}</select></span>
   <span data-label="Часы"><input class="field" type="number" min="0" max="24" step="any" data-f="hours" value="${r.hours??''}" ${dis} aria-label="Часы работы"></span>
   <span data-label="Сверх, ч"><input class="field" type="number" min="0" max="24" step="any" data-f="overtime" value="${r.overtime||''}" placeholder="0" ${dis} aria-label="Переработка, часов"></span>
   <span data-label="Ставка"><input class="field" type="number" min="0" step="any" data-f="rate" value="${r.rate??''}" ${dis} aria-label="Ставка клиенту"></span>
   <span class="jr-sum" data-label="Сумма"><b>${money(r.sum)}</b>${r.overtime?`<small class="muted">вкл. переработку</small>`:''}</span>
   <span class="jr-acts">${!ro?`<button type="button" class="icon-btn jr-btn" data-copy-row="${esc(r.id)}" title="Копировать на следующий день" aria-label="Копировать строку на следующий день">⧉</button><button type="button" class="icon-btn jr-btn" data-del-row="${esc(r.id)}" title="Удалить строку" aria-label="Удалить строку">×</button>`:''}</span></div>`}
 function newDayForm(date){const f=box.querySelector('#jr-newday');f.hidden=false;
  f.innerHTML=`<div class="form-grid jr-nd"><div class="form-group"><label for="jr-nd-date">Дата</label><input class="field" type="date" id="jr-nd-date" value="${date}"></div><fieldset class="jr-nd-eq"><legend>Какая техника работала</legend>${j.equipment.map(e=>`<label><input type="checkbox" value="${esc(e.id)}" checked> ${esc(e.name)} <span class="muted small">${money(e.rate)} / ${esc(unitLabel(e.unit))}</span></label>`).join('')}</fieldset></div><div class="actions"><button type="button" class="btn btn-primary btn-sm" id="jr-nd-save">Записать</button><button type="button" class="btn btn-ghost btn-sm" id="jr-nd-cancel">Отмена</button></div>`;
  f.querySelector('#jr-nd-cancel').onclick=()=>{f.hidden=true;f.innerHTML=''};
  f.querySelector('#jr-nd-save').onclick=async()=>{const date=f.querySelector('#jr-nd-date').value,ids=[...f.querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);if(!date||!ids.length)return toast('Выберите дату и технику',true);
   const errs=[];for(const id of ids){try{await send('','POST',{date,equipmentId:id})}catch(e){errs.push(e.message)}}draw();if(errs.length)toast(errs.join('; '),true);else toast('День '+jShort(date)+' записан')};
  f.querySelector('#jr-nd-date').focus()}
 function bind(){
  box.querySelector('#jr-first')?.addEventListener('click',()=>newDayForm(jToday()));
  box.querySelector('#jr-new-day')?.addEventListener('click',()=>newDayForm(j.days[0]?jNext(j.days[0].date):jToday()));
  box.querySelector('#jr-copy-last')?.addEventListener('click',e=>copyDay(j.days[0].date,e.currentTarget));
  box.querySelectorAll('[data-copy-day]').forEach(b=>b.onclick=()=>copyDay(b.dataset.copyDay,b));
  box.querySelectorAll('[data-add-row]').forEach(b=>b.onclick=async()=>{const g=j.days.find(x=>x.date===b.dataset.addRow);const e=j.equipment.find(e=>!g.rows.some(r=>r.equipmentId===e.id));try{await send('','POST',{date:g.date,equipmentId:e.id});draw()}catch(err){toast(err.message,true)}});
  box.querySelectorAll('[data-copy-row]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const r=await send('/copy','POST',{shiftId:b.dataset.copyRow});draw();flash(r.created.map(x=>x.id));toast('Скопировано на '+jShort(r.date))}catch(e){toast(e.message,true);b.disabled=false}});
  box.querySelectorAll('[data-del-row]').forEach(b=>b.onclick=async()=>{const row=b.closest('.jr-row');if(!confirmDelete(row))return;try{await send('/'+encodeURIComponent(b.dataset.delRow),'DELETE');draw();toast('Строка удалена')}catch(e){toast(e.message,true)}});
  box.querySelector('#jr-fact-invoice')?.addEventListener('click',()=>typeof startDocument==='function'&&startDocument(orderId,'invoice','actual'));
  box.querySelectorAll('.jr-row[data-row]').forEach(row=>{let timer=0;const id=row.dataset.row;
   const save=async()=>{const body={};row.querySelectorAll('[data-f]').forEach(f=>body[f.dataset.f]=f.value);row.classList.add('jr-saving');
    try{await send('/'+encodeURIComponent(id),'PATCH',body);const r=j.days.flatMap(g=>g.rows).find(x=>x.id===id);row.querySelector('.jr-sum b').textContent=money(r?.sum||0);row.classList.remove('jr-saving');row.classList.add('jr-saved');setTimeout(()=>row.classList.remove('jr-saved'),900);refreshHead()}
    catch(e){row.classList.remove('jr-saving');toast(e.message,true)}};
   row.querySelectorAll('.jr-cp').forEach(h=>{const inp=h.parentElement.querySelector('[data-f="partnerId"]');if(typeof contractorPicker!=='function')return;contractorPicker(h,{own:h.dataset.cpOwn,disabled:!!h.dataset.cpOff,value:inp.value?{id:inp.value,name:h.dataset.cpName,inn:h.dataset.cpInn}:null,onChange:v=>{inp.value=v?v.id:'';inp.dispatchEvent(new Event('change'))}})});
   row.querySelectorAll('[data-f]').forEach(f=>{f.addEventListener('change',()=>{clearTimeout(timer);timer=setTimeout(save,150)});f.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();f.blur()}})})});
 }
 function confirmDelete(row){return row.dataset.confirm==='1'||(row.dataset.confirm='1',toast('Нажмите × ещё раз, чтобы удалить строку'),setTimeout(()=>delete row.dataset.confirm,3000),false)}
 function refreshHead(){const t=j.totals;const b=box.querySelector('.jr-progress b');if(b)b.textContent=money(t.fact);box.querySelectorAll('.jr-day').forEach(d=>{const g=j.days.find(x=>x.date===d.dataset.day);if(g)d.querySelector('.jr-day-sum').textContent=money(g.sum)});const bar=box.querySelector('.jr-bar i');if(bar&&t.plan)bar.style.width=Math.min(100,Math.round(t.fact/t.plan*100))+'%'}
 function flash(ids){ids.forEach(id=>{const r=box.querySelector(`[data-row="${CSS.escape(id)}"]`);if(r){r.classList.add('jr-new');r.scrollIntoView({block:'nearest',behavior:'smooth'})}})}
 async function copyDay(date,btn){if(btn)btn.disabled=true;try{const r=await send('/copy','POST',{date});draw();flash(r.created.map(x=>x.id));toast(`${jShort(date)} → ${jShort(r.date)}: строк ${r.created.length}${r.skipped.length?', уже были: '+r.skipped.join(', '):''}`)}catch(e){toast(e.message,true);if(btn)btn.disabled=false}}
 try{await load()}catch(e){box.innerHTML=`<h3>Журнал работ по дням</h3><p class="muted">${esc(e.message)}</p>`}
}
