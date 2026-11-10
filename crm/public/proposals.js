/* КП — коммерческие предложения: строки техники со стоимостью за час / смену / рейс, PDF или Word. */
const KP_UNITS=[['shift','за смену'],['hour','за час'],['trip','за рейс'],['machine_hour','за маш.-час'],['day','за сутки'],['km','за км'],['ton','за тонну'],['m3','за м³'],['unit','за ед.']];
let kpOpen=null; // id открытого КП или 'new'

async function proposalsPage(p){
 if(kpOpen)return kpEditor(p,kpOpen==='new'?null:kpOpen);
 const q=sessionStorage.getItem('kp-q')||'';let data;
 try{data=await api('/api/proposals?q='+encodeURIComponent(q))}catch(e){p.innerHTML=`<p class="muted">${esc(e.message)}</p>`;return}
 const ru=s=>s?s.split('-').reverse().join('.'):'';
 p.innerHTML=`<div class="page-head"><div><h1>КП</h1><p>Коммерческие предложения: техника, стоимость за час, смену или рейс — в PDF или Word.</p></div><button class="btn btn-primary" id="kp-new">+ Новое КП</button></div>
 <div class="kp-toolbar"><input class="field" id="kp-q" type="search" placeholder="Поиск: номер, компания, техника" value="${esc(q)}" aria-label="Поиск КП"></div>
 ${data.items.length?`<div class="table-wrap"><table class="table kp-list"><thead><tr><th>№</th><th>Дата</th><th>Кому</th><th>Позиций</th><th>Цена от</th><th>Действует до</th><th>Менеджер</th><th></th></tr></thead><tbody>${data.items.map(k=>`<tr data-kp="${esc(k.id)}"><td><button type="button" class="link-btn" data-open="${esc(k.id)}"><b>${esc(k.number)}</b></button>${k.sentAt?'<span class="kp-sent" title="Файл скачивался">✓</span>':''}</td><td>${ru(k.date)}</td><td>${esc(k.clientName||'—')}</td><td>${k.items}</td><td class="nw">${Number.isFinite(k.minRate)?money(k.minRate):'—'}</td><td class="${k.expired?'kp-expired':''}">${ru(k.validUntil)}${k.expired?' · истекло':''}</td><td>${esc(k.manager)}</td><td class="nw kp-acts"><button type="button" class="btn btn-light btn-sm" data-pdf="${esc(k.id)}">PDF</button><button type="button" class="btn btn-light btn-sm" data-docx="${esc(k.id)}">Word</button><button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(k.id)}" title="Новое КП с теми же строками">Копия</button></td></tr>`).join('')}</tbody></table></div>`
 :`<div class="kp-empty panel"><b>${q?'Ничего не нашли':'Пока нет ни одного КП'}</b><p class="muted">${q?'Попробуйте другой запрос.':'Соберите предложение из техники вашего парка: название, стоимость за час, смену или рейс, условия — и скачайте PDF или Word.'}</p>${q?'':'<button class="btn btn-primary" id="kp-new2">Создать первое КП</button>'}</div>`}`;
 const open=id=>{kpOpen=id;renderPage()};
 p.querySelector('#kp-new').onclick=()=>open('new');p.querySelector('#kp-new2')?.addEventListener('click',()=>open('new'));
 let t=0;p.querySelector('#kp-q').oninput=e=>{clearTimeout(t);t=setTimeout(()=>{try{sessionStorage.setItem('kp-q',e.target.value)}catch{}renderPage()},300)};
 p.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>open(b.dataset.open));
 p.querySelectorAll('[data-pdf]').forEach(b=>b.onclick=()=>kpDownload(b.dataset.pdf,'pdf'));
 p.querySelectorAll('[data-docx]').forEach(b=>b.onclick=()=>kpDownload(b.dataset.docx,'docx'));
 p.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{try{const k=await api('/api/proposals/'+encodeURIComponent(b.dataset.copy)+'/copy',{method:'POST',body:'{}'});toast('Создано '+k.number);open(k.id)}catch(e){toast(e.message,true)}});
}
async function kpDownload(id,format){try{const headers={};if(token)headers.Authorization='Bearer '+token;const r=await fetch('/api/proposals/'+encodeURIComponent(id)+'/file?format='+format,{credentials:'same-origin',headers});
 if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||'Не удалось сформировать файл')}
 const cd=r.headers.get('content-disposition')||'',m=cd.match(/filename\*=UTF-8''([^;]+)/);const name=m?decodeURIComponent(m[1]):'КП.'+format;
 const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000)}catch(e){toast(e.message,true)}}

async function kpEditor(p,id){
 const [list,equipment,entities]=await Promise.all([api('/api/proposals'),api('/api/equipment?archive=active'),api('/api/documents/legal-entities')]);
 const def=list.defaults;let k=id?await api('/api/proposals/'+encodeURIComponent(id)):null;
 const s=k?structuredClone(k):{clientId:'',clientName:'',clientInn:'',contactName:'',title:'Коммерческое предложение',date:def.date,validUntil:def.validUntil,legalEntityId:entities[0]?.id||'',vatRate:def.vatRate,vatIncluded:true,facsimile:true,intro:def.intro,terms:def.terms,managerPhone:def.managerPhone,items:[{name:'',specs:'',unit:'shift',rate:'',minOrder:''}]};
 const eqLabel=e=>[e.type,e.model,e.plate].filter(Boolean).join(' · ');const byLabel=new Map(equipment.map(e=>[eqLabel(e).toLowerCase(),e]));
 let dirty=false;
 p.innerHTML=`<div class="page-head"><div><button type="button" class="link-btn" id="kp-back">← Все КП</button><h1>${k?esc(k.number):'Новое КП'}</h1><p>${k?'от '+esc(k.date.split('-').reverse().join('.')):'Заполните строки — справа сразу видно, как будет выглядеть документ.'}</p></div>
  <div class="actions"><button class="btn btn-light" id="kp-docx">Скачать Word</button><button class="btn btn-primary" id="kp-pdf">Скачать PDF</button></div></div>
  <div class="kp-layout"><div class="kp-form">
   <section class="panel kp-card"><h3>Кому</h3><div class="form-grid kp-to">
    <div class="form-group kp-client"><label for="kp-client">Компания</label><input class="field" id="kp-client" list="kp-clients" value="${esc(s.clientName)}" placeholder="Из CRM или впишите" autocomplete="off"><datalist id="kp-clients"></datalist></div>
    <div class="form-group"><label for="kp-inn">ИНН</label><input class="field" id="kp-inn" inputmode="numeric" value="${esc(s.clientInn)}" maxlength="12"></div>
    <div class="form-group"><label for="kp-contact">Вниманию (кому лично)</label><input class="field" id="kp-contact" value="${esc(s.contactName)}" placeholder="Петрову П.П."></div></div></section>
   <section class="panel kp-card"><div class="kp-card-head"><h3>Техника и стоимость</h3><span class="muted small">Выберите из парка или впишите любое название</span></div>
    <div class="kp-rows" id="kp-rows"></div>
    <button type="button" class="btn btn-light btn-sm" id="kp-add">+ Строка</button>
    <datalist id="kp-eq">${equipment.map(e=>`<option value="${esc(eqLabel(e))}"></option>`).join('')}</datalist>
    <div class="form-grid kp-vat">${select('kp-vat','НДС',[['22','22%'],['20','20%'],['10','10%'],['7','7%'],['5','5%'],['0','Без НДС']],String(s.vatRate))}${select('kp-vat-inc','Цены',[['yes','с НДС'],['no','без НДС']],s.vatIncluded===false?'no':'yes')}</div></section>
   <section class="panel kp-card"><h3>Текст и условия</h3>
    <div class="form-group"><label for="kp-intro">Вступление</label><textarea class="field" id="kp-intro" rows="2">${esc(s.intro)}</textarea></div>
    <div class="form-group"><label for="kp-terms">Условия — каждое с новой строки</label><textarea class="field" id="kp-terms" rows="6">${esc(s.terms)}</textarea></div>
    <div class="form-grid kp-meta"><div class="form-group"><label for="kp-date">Дата</label><input class="field" type="date" id="kp-date" value="${esc(s.date)}"></div><div class="form-group"><label for="kp-valid">Действует до</label><input class="field" type="date" id="kp-valid" value="${esc(s.validUntil)}"></div><div class="form-group"><label for="kp-phone">Ваш телефон в КП</label><input class="field" id="kp-phone" value="${esc(s.managerPhone)}" placeholder="+7 …"></div>
    ${entities.length>1?select('kp-entity','От организации',entities.map(e=>[e.id,e.shortName||e.name]),s.legalEntityId):''}</div>
    <label class="check-line"><input type="checkbox" id="kp-fax" ${s.facsimile===false?'':'checked'}><span><b>С подписью и печатью</b><br><span class="muted small">Снимите, если будете подписывать от руки</span></span></label></section>
   <div class="actions kp-bottom"><button class="btn btn-primary" id="kp-save">Сохранить</button>${k?'<button class="btn btn-light" id="kp-copy">Сделать копию</button><button class="btn btn-ghost kp-del" id="kp-del">Удалить</button>':''}<span class="muted small" id="kp-state"></span></div>
  </div>
  <aside class="kp-preview panel"><div class="kp-preview-head"><b>Так будет выглядеть</b><span class="muted small">PDF — точно так; Word — с той же структурой</span></div><iframe id="kp-frame" title="Предпросмотр КП" sandbox=""></iframe></aside></div>`;
 const $=sel=>p.querySelector(sel);
 const rowsBox=$('#kp-rows');
 function drawRows(){rowsBox.innerHTML=`<div class="kp-row kp-th"><span>Техника</span><span>Стоимость, ₽</span><span>За</span><span>Мин. заказ</span><span></span></div>`+s.items.map((i,n)=>`<div class="kp-row" data-n="${n}">
  <div class="kp-name"><input class="field" list="kp-eq" data-f="name" value="${esc(i.name)}" placeholder="Автокран 25 т" aria-label="Техника, строка ${n+1}"><input class="field kp-specs" data-f="specs" value="${esc(i.specs||'')}" placeholder="Характеристики (необязательно)" aria-label="Характеристики"></div>
  <input class="field" type="number" min="0" step="any" data-f="rate" value="${esc(i.rate)}" placeholder="Цена, ₽" aria-label="Стоимость, рублей">
  <select class="field" data-f="unit" aria-label="За что">${KP_UNITS.map(([v,t])=>`<option value="${v}" ${i.unit===v?'selected':''}>${t}</option>`).join('')}</select>
  <input class="field" data-f="minOrder" value="${esc(i.minOrder||'')}" placeholder="Мин. заказ" aria-label="Минимальный заказ">
  <span class="kp-row-acts"><button type="button" class="icon-btn jr-btn" data-dup="${n}" title="Дублировать строку" aria-label="Дублировать строку">⧉</button><button type="button" class="icon-btn jr-btn" data-del="${n}" title="Удалить строку" aria-label="Удалить строку" ${s.items.length<2?'disabled':''}>×</button></span></div>`).join('');
  rowsBox.querySelectorAll('.kp-row[data-n]').forEach(row=>{const n=Number(row.dataset.n);row.querySelectorAll('[data-f]').forEach(f=>f.addEventListener(f.tagName==='SELECT'?'change':'input',()=>{const i=s.items[n];i[f.dataset.f]=f.value;
   if(f.dataset.f==='name'){const e=byLabel.get(f.value.trim().toLowerCase());if(e){i.equipmentId=e.id;i.name=[e.type,e.model].filter(Boolean).join(' ');if(!Number(i.rate)&&e.saleRate)i.rate=e.saleRate;if(!i.specs&&e.note)i.specs=String(e.note).slice(0,120);drawRows();rowsBox.querySelectorAll('[data-f="rate"]')[n]?.focus();changed();return}else i.equipmentId=''}
   changed()}))});
  rowsBox.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{s.items.splice(Number(b.dataset.del),1);drawRows();changed()});
  rowsBox.querySelectorAll('[data-dup]').forEach(b=>b.onclick=()=>{const n=Number(b.dataset.dup);s.items.splice(n+1,0,{...s.items[n]});drawRows();changed();rowsBox.querySelectorAll('[data-f="name"]')[n+1]?.focus()});
 }
 function collect(){s.clientName=$('#kp-client').value.trim();s.clientInn=$('#kp-inn').value.replace(/\D/g,'');s.contactName=$('#kp-contact').value.trim();s.intro=$('#kp-intro').value;s.terms=$('#kp-terms').value;s.date=$('#kp-date').value;s.validUntil=$('#kp-valid').value;s.managerPhone=$('#kp-phone').value.trim();s.vatRate=Number($('#kp-vat').value);s.vatIncluded=$('#kp-vat-inc').value==='yes';s.facsimile=$('#kp-fax').checked;if($('#kp-entity'))s.legalEntityId=$('#kp-entity').value;
  const c=clientsCache.find(c=>c.name===s.clientName);s.clientId=c?c.id:'';if(c&&!s.clientInn)s.clientInn=c.inn||'';
  return {...s,items:s.items.filter(i=>String(i.name).trim()).map(i=>({equipmentId:i.equipmentId||'',name:i.name,specs:i.specs||'',unit:i.unit,rate:i.rate===''?'':Number(i.rate),minOrder:i.minOrder||''}))}}
 let pt=0;function changed(){dirty=true;$('#kp-state').textContent='Есть несохранённые изменения';clearTimeout(pt);pt=setTimeout(preview,350)}
 async function preview(){const body=collect();try{const r=await fetch('/api/proposals/preview',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({...body,number:k?.number})});if(r.ok)$('#kp-frame').srcdoc=await r.text()}catch{}}
 async function save(){const body=collect();if(!body.items.length){toast('Добавьте хотя бы одну строку техники',true);return null}
  const bad=body.items.findIndex(i=>i.rate===''||!(i.rate>=0));if(bad>=0){toast(`Строка ${bad+1}: укажите стоимость`,true);rowsBox.querySelectorAll('.kp-row[data-n] [data-f="rate"]')[bad]?.focus();return null}
  try{k=k?await api('/api/proposals/'+encodeURIComponent(k.id),{method:'PATCH',body:JSON.stringify(body)}):await api('/api/proposals',{method:'POST',body:JSON.stringify(body)});kpOpen=k.id;dirty=false;
   p.querySelector('.page-head h1').textContent=k.number;$('#kp-state').textContent='Сохранено';return k}catch(e){toast(e.message,true);return null}}
 let clientsCache=[];let ct=0;$('#kp-client').addEventListener('input',e=>{changed();clearTimeout(ct);const v=e.target.value.trim();if(v.length<2)return;ct=setTimeout(async()=>{try{clientsCache=await api('/api/clients?archive=active&q='+encodeURIComponent(v));$('#kp-clients').innerHTML=clientsCache.slice(0,8).map(c=>`<option value="${esc(c.name)}">${esc(c.inn?'ИНН '+c.inn:'')}</option>`).join('');const c=clientsCache.find(c=>c.name===v);if(c&&c.inn&&!$('#kp-inn').value){$('#kp-inn').value=c.inn}}catch{}},250)});
 p.querySelectorAll('#kp-inn,#kp-contact,#kp-intro,#kp-terms,#kp-date,#kp-valid,#kp-phone').forEach(f=>f.addEventListener('input',changed));
 p.querySelectorAll('#kp-vat,#kp-vat-inc,#kp-fax,#kp-entity').forEach(f=>f.addEventListener('change',changed));
 $('#kp-add').onclick=()=>{s.items.push({name:'',specs:'',unit:s.items.at(-1)?.unit||'shift',rate:'',minOrder:''});drawRows();rowsBox.querySelectorAll('[data-f="name"]')[s.items.length-1]?.focus()};
 $('#kp-back').onclick=()=>{if(dirty&&!confirm('Выйти без сохранения?'))return;kpOpen=null;renderPage()};
 $('#kp-save').onclick=async()=>{if(await save())toast('КП '+k.number+' сохранено')};
 $('#kp-pdf').onclick=async()=>{if(await save())kpDownload(k.id,'pdf')};
 $('#kp-docx').onclick=async()=>{if(await save())kpDownload(k.id,'docx')};
 $('#kp-copy')?.addEventListener('click',async()=>{try{const c=await api('/api/proposals/'+encodeURIComponent(k.id)+'/copy',{method:'POST',body:'{}'});toast('Создано '+c.number);kpOpen=c.id;renderPage()}catch(e){toast(e.message,true)}});
 $('#kp-del')?.addEventListener('click',async e=>{const b=e.currentTarget;if(b.dataset.sure!=='1'){b.dataset.sure='1';b.textContent='Точно удалить?';setTimeout(()=>{b.dataset.sure='';b.textContent='Удалить'},3000);return}try{await api('/api/proposals/'+encodeURIComponent(k.id),{method:'DELETE'});toast('КП удалено');kpOpen=null;renderPage()}catch(err){toast(err.message,true)}});
 drawRows();preview();if(!k)$('#kp-client').focus();
}
