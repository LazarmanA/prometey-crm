'use strict';
/* Сделка как заказ в 1С: шапка (номер, дата, организация, статус, заказчик, договор, баланс, расчёты, посредник, менеджер, комментарий)
   и вкладки «Машины» / «Смены» / «Документы». «Смены» — таблица строк: дата, объект, машина, услуга, навесное, водитель,
   тариф ЗП, часы сотрудника, ответственный, комментарий, поставщик, ед. изм., количество, тариф, сумма, тариф суб., сумма суб., прибыль, маржа, скан, оригинал. */
const DD_UNITS=[['shift','смена'],['hour','час'],['machine_hour','маш.-ч'],['day','сутки'],['trip','рейс'],['unit','ед.'],['km','км'],['ton','т'],['m3','м³']];
const DD_PAY=[['cashless','Безнал'],['cash','Нал'],['mixed','Нал/Безнал']];
const DD_STATUS=[['planned','Запланирована'],['working','В работе'],['done','Выполнена'],['cancelled','Отменена']];
const ddDate=s=>s?String(s).slice(0,10).split('-').reverse().join('.'):'';
const ddNum=n=>n==null||n===''?'':String(Math.round(Number(n)*100)/100);
const ddMoney=n=>new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0);
const ddNext=s=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)};
const ddToday=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const DD_TAB_KEY='prometey_deal_tab';

async function mountDealDoc(p,orderId,record){
 const main=p.querySelector('.ws-layout main');if(!main)return;
 const planSec=p.querySelector('[data-detail]')?.closest('.ws-panel'),journalSlot=p.querySelector('#ws-journal')?.parentElement,docs=p.querySelector('.documents-panel');
 const wrap=document.createElement('section');wrap.className='ws-panel dd';wrap.id='deal-doc';const layout=p.querySelector('.ws-layout');layout.before(wrap);
 let j=null,sel=null,view='grid';
 const url='/api/deals/'+encodeURIComponent(orderId)+'/journal';
 const send=async(path,method,body)=>{const r=await api(url+path,{method,body:body?JSON.stringify(body):undefined});j=r.journal;return r};
 const load=async()=>{j=await api(url)};
 let tab='shifts';try{tab=localStorage.getItem(DD_TAB_KEY)||'shifts';view=localStorage.getItem(DD_TAB_KEY+'_view')==='days'?'days':'grid'}catch{}
 try{await load()}catch(e){wrap.remove();console.warn('Deal doc:',e.message);return}
 const o=j.order,can=o.canEdit;
 const opt=(list,v)=>list.map(([k,t])=>`<option value="${esc(k)}"${k===v?' selected':''}>${esc(t)}</option>`).join('');
 wrap.innerHTML=`<div class="dd-title"><h2>Заказ ${esc(o.number)}${o.createdAt?' от '+esc(new Date(o.createdAt).toLocaleString('ru-RU')):''}</h2>${can?'':'<span class="badge">только просмотр</span>'}</div>
  <div class="dd-head">
   <label>Номер<input class="field" value="${esc(o.number)}" readonly></label>
   <label>Дата<input class="field" value="${esc(ddDate(o.start))}${o.end&&o.end!==o.start?' — '+esc(ddDate(o.end)):''}" readonly></label>
   <label>Организация<select class="field" data-h="legalEntityId"${can?'':' disabled'}>${j.legalEntities.length?opt(j.legalEntities.map(x=>[x.id,x.name]),o.legalEntityId):'<option value="">Не заполнены реквизиты</option>'}</select></label>
   <label>Статус<select class="field" data-h="status"${can?'':' disabled'}>${opt(DD_STATUS,o.status)}</select></label>
   <label class="dd-wide">Заказчик<button type="button" class="field dd-link" data-related-client="${esc(o.clientId)}">${esc(o.client)}</button></label>
   <label>Договор<input class="field" data-h="contract" value="${esc(o.contract)}" placeholder="№ и дата договора" maxlength="200"${can?'':' readonly'}></label>
   <div class="dd-bal"><span>Баланс</span><b class="${o.balance<0?'neg':''}">${ddMoney(o.balance)}</b></div>
   <label>Расчёты<select class="field" data-h="paymentForm"${can?'':' disabled'}>${opt(DD_PAY,o.paymentForm)}</select></label>
   <label class="dd-check"><input type="checkbox" data-h="intermediary"${o.intermediary?' checked':''}${can?'':' disabled'}> Есть посредник</label>
  </div>
  <div class="dd-tabs" role="tablist">${[['machines','Машины'],['shifts','Смены'],['documents','Документы']].map(([k,t])=>`<button type="button" role="tab" class="dd-tab" data-dd-tab="${k}">${t}</button>`).join('')}</div>
  <div class="dd-pane" data-pane="machines"></div>
  <div class="dd-pane" data-pane="shifts"><div class="dd-view"><span class="muted small">Вид:</span><button type="button" class="dd-vbtn on" data-dd-view="grid">Таблицей</button><button type="button" class="dd-vbtn" data-dd-view="days">По дням</button></div><div id="dd-grid"></div><div id="dd-days" hidden></div></div>
  <div class="dd-pane" data-pane="documents"></div>
  <div class="dd-foot"><label>Менеджер${o.canAssign?`<select class="field" id="dd-manager">${opt(j.people.map(x=>[x.id,x.name]),o.managerId)}</select>`:`<input class="field" value="${esc(o.manager)}" readonly>`}</label><label class="dd-wide">Комментарий<input class="field" data-h="note" value="${esc(o.note)}" maxlength="2000"${can?'':' readonly'}></label></div>`;
 const pane=k=>wrap.querySelector(`[data-pane="${k}"]`);
 if(planSec){planSec.classList.add('dd-inner');pane('machines').append(planSec)}
 if(journalSlot)wrap.querySelector('#dd-days').append(journalSlot);
 if(docs){docs.classList.add('dd-inner');pane('documents').append(docs)}else pane('documents').innerHTML='<p class="muted">Документов пока нет</p>';
 const showTab=k=>{tab=k;try{localStorage.setItem(DD_TAB_KEY,k)}catch{}wrap.querySelectorAll('[data-dd-tab]').forEach(b=>{const on=b.dataset.ddTab===k;b.classList.toggle('on',on);b.setAttribute('aria-selected',on)});wrap.querySelectorAll('[data-pane]').forEach(x=>x.hidden=x.dataset.pane!==k)};
 wrap.querySelectorAll('[data-dd-tab]').forEach(b=>b.onclick=async()=>{showTab(b.dataset.ddTab);if(b.dataset.ddTab==='shifts'&&view==='grid'){await load();grid()}});
 wrap.querySelectorAll('[data-dd-view]').forEach(b=>b.onclick=async()=>{view=b.dataset.ddView;try{localStorage.setItem(DD_TAB_KEY+'_view',view)}catch{}wrap.querySelectorAll('[data-dd-view]').forEach(x=>x.classList.toggle('on',x===b));wrap.querySelector('#dd-grid').hidden=view!=='grid';wrap.querySelector('#dd-days').hidden=view!=='days';
  if(view==='grid'){await load();grid()}else if(typeof mountJournal==='function'){const slot=wrap.querySelector('#dd-days');slot.innerHTML='';await mountJournal(slot,orderId)}});
 wrap.querySelector('[data-related-client]').onclick=()=>{current='clients';workspaceSelection={kind:'clients',id:o.clientId};renderApp()};
 // шапка: сохраняем поле сразу
 wrap.querySelectorAll('[data-h]').forEach(f=>f.addEventListener('change',async()=>{const k=f.dataset.h,v=f.type==='checkbox'?f.checked:f.value;f.classList.add('dd-saving');
  try{await api('/api/orders/'+encodeURIComponent(orderId),{method:'PATCH',body:JSON.stringify({[k]:v})});f.classList.remove('dd-saving');f.classList.add('dd-saved');setTimeout(()=>f.classList.remove('dd-saved'),900);if(k==='status')toast('Статус: '+DD_STATUS.find(x=>x[0]===v)[1])}
  catch(e){f.classList.remove('dd-saving');toast(e.message,true)}}));
 wrap.querySelector('#dd-manager')?.addEventListener('change',async e=>{try{await api('/api/workspaces/orders/'+encodeURIComponent(orderId)+'/owner',{method:'PATCH',body:JSON.stringify({managerId:e.target.value})});toast('Менеджер изменён')}catch(err){toast(err.message,true)}});

 function rows(){return j.days.flatMap(g=>g.rows).sort((a,b)=>a.date.localeCompare(b.date)||a.equipment.localeCompare(b.equipment))}
 function grid(){const list=rows(),box=wrap.querySelector('#dd-grid');if(sel&&!list.some(r=>r.id===sel))sel=null;
  const partners=[['','Своя техника'],...j.partners.map(p=>[p.id,p.name])],people=[['',''],...j.people.map(x=>[x.id,x.name])],eqs=j.equipment.map(e=>[e.id,e.name]);
  const t=j.totals;
  box.innerHTML=`<div class="dd-bar">${can?`<button type="button" class="btn btn-primary btn-sm" id="dd-add">+ Добавить</button><button type="button" class="btn btn-light btn-sm" id="dd-copy"${sel?'':' disabled'}>⧉ Скопировать</button><button type="button" class="btn btn-light btn-sm" id="dd-del"${sel?'':' disabled'}>× Удалить</button>`:''}<span class="muted small dd-hint">${can?'Скопировать — строка на следующий день. Поля сохраняются сразу.':''}</span></div>
  <div class="dd-scroll"><table class="dd-table"><thead><tr><th class="dd-n">N</th><th class="dd-sticky">Дата</th><th>Объект</th><th>Машина</th><th>Услуга</th><th>Навесное</th><th>Водитель / машинист</th><th>Тариф ЗП</th><th>Часы сотр.</th><th>Ответственный</th><th>Комментарий</th><th>Поставщик</th><th>Ед. изм.</th><th>Количество</th><th>Тариф</th><th>Сумма</th><th>Тариф суб.</th><th>Сумма суб.</th><th>Прибыль</th><th>Маржа</th><th>Скан</th><th>Оригинал</th></tr></thead>
  <tbody>${list.map((r,i)=>{const ro=!can||r.locked,dis=ro?' disabled':'';const inp=(f,v,type='text',extra='')=>`<input class="dd-in" data-f="${f}" type="${type}" value="${esc(v??'')}"${type==='number'?' step="any" min="0"':''}${dis} ${extra}>`;
   return `<tr data-r="${esc(r.id)}" class="${r.id===sel?'sel':''}${r.locked?' locked':''}${r.check==='rejected'&&!r.locked?' rej':''}"><td class="dd-n">${i+1}</td><td class="dd-sticky">${inp('date',r.date,'date')}</td><td class="dd-ro" title="${esc(r.object)}">${esc(r.object)}</td>
    <td><select class="dd-in" data-f="equipmentId"${dis}>${opt(eqs,r.equipmentId)}</select></td><td>${inp('service',r.service)}</td><td>${inp('attachment',r.attachment)}</td><td>${inp('driver',r.driver)}</td>
    <td>${inp('driverRate',ddNum(r.driverRate),'number')}</td><td>${inp('driverHours',ddNum(r.driverHours),'number','max="24"')}</td><td><select class="dd-in" data-f="responsibleId"${dis}>${opt(people,r.responsibleId)}</select></td><td>${inp('comment',r.comment)}</td>
    <td><div class="dd-cp" data-cp="${esc(r.id)}"></div></td><td><select class="dd-in" data-f="unit"${dis}>${opt(DD_UNITS,r.unit)}</select></td><td>${inp('quantity',ddNum(r.quantity),'number')}</td><td>${inp('rate',ddNum(r.rate),'number')}</td>
    <td class="dd-sum">${ddMoney(r.sum)}</td><td>${inp('purchaseRate',ddNum(r.purchaseRate),'number')}</td><td class="dd-sum">${ddMoney(r.cost)}</td><td class="dd-sum${r.profit<0?' neg':''}">${ddMoney(r.profit)}</td><td class="dd-sum${r.margin<0?' neg':''}">${r.margin} %</td>
    <td class="dd-c"><input type="checkbox" data-f="scan"${r.scan?' checked':''}${can?'':' disabled'} aria-label="Скан"></td><td class="dd-c"><input type="checkbox" data-f="original"${r.original?' checked':''}${can?'':' disabled'} aria-label="Оригинал"></td></tr>`}).join('')}</tbody>
  <tfoot><tr><td class="dd-n"></td><td class="dd-sticky"></td><td colspan="11"></td><td class="dd-sum">${ddNum(t.qty)}</td><td></td><td class="dd-sum">${ddMoney(t.fact)}</td><td></td><td class="dd-sum">${ddMoney(t.cost)}</td><td class="dd-sum${t.profit<0?' neg':''}">${ddMoney(t.profit)}</td><td class="dd-sum">${t.fact?Math.round(t.profit/t.fact*100):0} %</td><td colspan="2"></td></tr></tfoot></table>
  ${list.length?'':`<div class="dd-empty">Смен пока нет. ${can&&j.equipment.length?'Нажмите «+ Добавить».':j.equipment.length?'':'Сначала добавьте технику на вкладке «Машины».'}</div>`}</div>
  <div class="dd-selsum" id="dd-selsum">${selSum()}</div>`;
  bind(box)}
 function selSum(){const r=rows().find(x=>x.id===sel);return r?`<span>Кол-во: <b>${ddNum(r.quantity)}</b></span><span>Сумма: <b>${ddMoney(r.sum)}</b></span><span>Сумма суб.: <b>${ddMoney(r.cost)}</b></span><span>Прибыль: <b>${ddMoney(r.profit)}</b></span>${r.driverPay?`<span>ЗП: <b>${ddMoney(r.driverPay)}</b></span>`:''}`:`<span>Строк: <b>${rows().length}</b></span><span>Сумма: <b>${ddMoney(j.totals.fact)}</b></span><span>Сумма суб.: <b>${ddMoney(j.totals.cost)}</b></span><span>Прибыль: <b>${ddMoney(j.totals.profit)}</b></span>${j.totals.driverPay?`<span>ЗП: <b>${ddMoney(j.totals.driverPay)}</b></span>`:''}`}
 function bind(box){
  const all=rows();box.querySelectorAll('[data-cp]').forEach(h=>{const r=all.find(x=>x.id===h.dataset.cp);contractorPicker(h,{value:r.partnerId?{id:r.partnerId,name:r.partner,inn:r.partnerInn}:null,disabled:!can||r.locked||!!r.purchase,onChange:async v=>{const tr=h.closest('tr');tr.classList.add('saving');try{await send('/'+encodeURIComponent(r.id),'PATCH',{partnerId:v?v.id:''});tr.classList.remove('saving');refreshRow(tr,r.id)}catch(e){toast(e.message,true);grid()}}})});
  box.querySelectorAll('tbody tr').forEach(tr=>tr.addEventListener('focusin',()=>pick(tr.dataset.r)));
  box.querySelectorAll('tbody tr').forEach(tr=>tr.addEventListener('click',()=>pick(tr.dataset.r)));
  box.querySelectorAll('[data-f]').forEach(f=>f.addEventListener('change',()=>save(f)));
  box.querySelectorAll('input.dd-in').forEach(f=>f.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();f.blur()}}));
  box.querySelector('#dd-add')?.addEventListener('click',addRow);
  box.querySelector('#dd-copy')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;try{const r=await send('/copy','POST',{shiftId:sel});sel=r.created[0]?.id||sel;grid();toast('Скопировано на '+ddDate(r.date))}catch(err){toast(err.message,true);grid()}});
  box.querySelector('#dd-del')?.addEventListener('click',async e=>{const b=e.currentTarget;if(b.dataset.sure!=='1'){b.dataset.sure='1';b.textContent='Точно удалить?';return}try{await send('/'+encodeURIComponent(sel),'DELETE');sel=null;grid();toast('Строка удалена')}catch(err){toast(err.message,true);grid()}});
 }
 function pick(id){if(sel===id)return;sel=id;wrap.querySelectorAll('#dd-grid tbody tr').forEach(tr=>tr.classList.toggle('sel',tr.dataset.r===id));const r=rows().find(x=>x.id===id);['#dd-copy','#dd-del'].forEach(s=>{const b=wrap.querySelector(s);if(b){b.disabled=!r||(s==='#dd-del'&&r.locked);if(s==='#dd-del'){b.dataset.sure='';b.textContent='× Удалить'}}});wrap.querySelector('#dd-selsum').innerHTML=selSum()}
 function refreshRow(tr,id){const r=rows().find(x=>x.id===id);const cells=tr.querySelectorAll('.dd-sum');if(r&&cells.length===4){cells[0].textContent=ddMoney(r.sum);cells[1].textContent=ddMoney(r.cost);cells[2].textContent=ddMoney(r.profit);cells[2].classList.toggle('neg',r.profit<0);cells[3].textContent=r.margin+' %'}const ft=wrap.querySelectorAll('#dd-grid tfoot .dd-sum'),t=j.totals;if(ft.length===5){ft[0].textContent=ddNum(t.qty);ft[1].textContent=ddMoney(t.fact);ft[2].textContent=ddMoney(t.cost);ft[3].textContent=ddMoney(t.profit);ft[4].textContent=(t.fact?Math.round(t.profit/t.fact*100):0)+' %'}wrap.querySelector('#dd-selsum').innerHTML=selSum();tr.classList.add('saved');setTimeout(()=>tr.classList.remove('saved'),800)}
 async function save(f){const tr=f.closest('tr'),id=tr.dataset.r,k=f.dataset.f,v=f.type==='checkbox'?f.checked:f.value;tr.classList.add('saving');
  try{await send('/'+encodeURIComponent(id),'PATCH',{[k]:v});const r=rows().find(x=>x.id===id);const cells=tr.querySelectorAll('.dd-sum');if(r&&cells.length===4){cells[0].textContent=ddMoney(r.sum);cells[1].textContent=ddMoney(r.cost);cells[2].textContent=ddMoney(r.profit);cells[2].classList.toggle('neg',r.profit<0);cells[3].textContent=r.margin+' %'}
   if(['date','equipmentId'].includes(k))grid();else{tr.classList.remove('saving');tr.classList.add('saved');setTimeout(()=>tr.classList.remove('saved'),800);const ft=wrap.querySelectorAll('#dd-grid tfoot .dd-sum'),t=j.totals;if(ft.length===5){ft[0].textContent=ddNum(t.qty);ft[1].textContent=ddMoney(t.fact);ft[2].textContent=ddMoney(t.cost);ft[3].textContent=ddMoney(t.profit);ft[4].textContent=(t.fact?Math.round(t.profit/t.fact*100):0)+' %'}wrap.querySelector('#dd-selsum').innerHTML=selSum()}}
  catch(e){tr.classList.remove('saving');toast(e.message,true);grid()}}
 async function addRow(){const list=rows(),last=list.at(-1),base=list.find(x=>x.id===sel)||last;
  if(!j.equipment.length){toast('Сначала добавьте технику на вкладке «Машины»',true);return showTab('machines')}
  const eqId=base?.equipmentId||j.equipment[0].id;let date=last?ddNext(last.date):(o.start||ddToday());
  for(let i=0;i<60&&list.some(r=>r.equipmentId===eqId&&r.date===date);i++)date=ddNext(date);
  try{const r=await send('','POST',{date,equipmentId:eqId,...(base?{unit:base.unit,quantity:base.quantity,rate:base.rate,purchaseRate:base.purchaseRate,partnerId:base.partnerId,service:base.service,attachment:base.attachment,driver:base.driver,driverRate:base.driverRate,driverHours:base.driverHours,responsibleId:base.responsibleId}:{})});sel=r.id;grid();
   wrap.querySelector(`#dd-grid tr[data-r="${CSS.escape(r.id)}"] [data-f="date"]`)?.focus()}catch(e){toast(e.message,true)}}
 showTab(['machines','shifts','documents'].includes(tab)?tab:'shifts');grid();
 if(view==='days'){wrap.querySelectorAll('[data-dd-view]').forEach(x=>x.classList.toggle('on',x.dataset.ddView==='days'));wrap.querySelector('#dd-grid').hidden=true;wrap.querySelector('#dd-days').hidden=false}
}
