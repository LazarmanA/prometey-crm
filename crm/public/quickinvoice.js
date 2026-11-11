/* «Сделки → Выставить счёт».
   Одна форма: ввели название или ИНН — подтянулись реквизиты, сделки, адреса и ставки компании.
   Компания, объект и сделка создаются сами при выставлении. */
let ordersView='list';
const QI_UNITS=[['shift','смена'],['hour','час'],['machine_hour','маш.-ч'],['day','сутки'],['trip','рейс'],['unit','ед.'],['km','км'],['ton','тонна'],['m3','м³']];
let qi=null; // состояние формы
const qiInput=(id,label,value,type='text')=>`<div class="form-group"><label for="${id}">${esc(label)}</label><input class="field" id="${id}" type="${type}" value="${esc(value||'')}"></div>`;

function ordersTabs(active){return `<div class="seg qi-tabs" role="tablist"><button type="button" class="${active==='list'?'active':''}" data-orders-view="list" role="tab" aria-selected="${active==='list'}">Список сделок</button><button type="button" class="${active==='invoice'?'active':''}" data-orders-view="invoice" role="tab" aria-selected="${active==='invoice'}">Выставить счёт</button></div>`}
function bindOrdersTabs(p){p.querySelectorAll('[data-orders-view]').forEach(b=>b.onclick=()=>{ordersView=b.dataset.ordersView;renderPage()})}

function qiFresh(){const t=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);return {client:null,context:null,orderId:'',address:'',start:t,end:t,items:[{key:Math.random(),equipmentId:'',description:'',quantity:1,unit:'shift',rate:''}],type:'invoice',done:null}}

async function quickInvoicePage(p,preset={}){
 if(!qi||preset.reset)qi=qiFresh();
 const [equipment,entities]=await Promise.all([api('/api/equipment?archive=active'),api('/api/documents/legal-entities')]);
 let templates=await api('/api/templates').catch(()=>[]);const canTpl=can('settings')||can('documents','all');
 const tplDefault=type=>(templates.find(t=>t.type===type&&t.isDefault)||{}).id||'';
 if(qi.templateId==null)qi.templateId=tplDefault(qi.type);if(qi.contractTemplateId==null)qi.contractTemplateId=tplDefault('contract');
 const ent=entities[0]||{};
 if(!qi.legalEntityId)qi.legalEntityId=ent.id||'';
 if(qi.vatRate==null)qi.vatRate=String(ent.vatRate??22);
 const eqLabel=e=>[e.type,e.model,e.plate].filter(Boolean).join(' · ');
 p.innerHTML=`<div class="page-head"><div><h1>${preset.standalone?'Быстрый счёт':'Выставить счёт'}</h1><p>Введите компанию — остальное подтянется. Сделка, объект и карточка компании создадутся сами. Счёт и договор — стандартные или по вашему шаблону Word.</p></div>${preset.standalone?'':ordersTabs('invoice')}</div>
 <div class="qi" id="qi"></div>
 <datalist id="qi-eq">${equipment.map(e=>`<option value="${esc(eqLabel(e))}"></option>`).join('')}</datalist>`;
 if(!preset.standalone)bindOrdersTabs(p);
 const root=p.querySelector('#qi');const eqByLabel=new Map(equipment.map(e=>[eqLabel(e).toLowerCase(),e]));
 const sum=()=>qi.items.reduce((s,i)=>s+(Number(i.quantity)||0)*(Number(i.rate)||0),0);
 const vatInfo=()=>{const rate=Number(qi.vatRate)||0,total=sum();if(!rate)return {gross:total,vat:0};const inc=qi.vatIncluded!==false;const gross=inc?total:total*(1+rate/100);return {gross,vat:inc?total*rate/(100+rate):total*rate/100}};

 function draw(){
  if(qi.done){root.innerHTML=doneHtml();bindDone();return}
  const c=qi.client,ctx=qi.context;
  root.innerHTML=`<div class="qi-main">
   <section class="panel qi-card"><div class="qi-step"><span>1</span><h3>Компания</h3></div>
    ${c?companyCard(c):`<div class="qi-search"><input class="field" id="qi-q" placeholder="Название компании или ИНН" autocomplete="off" aria-label="Название компании или ИНН"><div class="qi-sug" id="qi-sug" role="listbox"></div></div><p class="muted small">Есть в CRM — подставится карточка. Новый ИНН — реквизиты найдутся автоматически${''}.</p>`}
   </section>
   <section class="panel qi-card ${c?'':'qi-off'}"><div class="qi-step"><span>2</span><h3>Сделка и объект</h3></div>
    ${c?dealHtml(ctx):'<p class="muted">Сначала выберите компанию</p>'}
   </section>
   <section class="panel qi-card ${c?'':'qi-off'}"><div class="qi-step"><span>3</span><h3>Что в счёте</h3></div>
    <div class="qi-rows" id="qi-rows">${qi.items.map(rowHtml).join('')}</div>
    <button type="button" class="btn btn-light btn-sm" id="qi-add">+ Строка</button>
    <p class="muted small">Техника — выберите из списка, ставка подставится (последняя для этой компании или из карточки техники). Любая услуга — просто впишите текстом: доставка, простой, переработка.</p>
   </section>
  </div>
  <aside class="panel qi-side">
   <div class="seg qi-type"><button type="button" data-qi-type="invoice" class="${qi.type==='invoice'?'active':''}">Счёт</button><button type="button" data-qi-type="contract_invoice" class="${qi.type==='contract_invoice'?'active':''}">Договор-счёт</button></div>
   ${entities.length>1?select('qi-entity','От организации',entities.map(e=>[e.id,e.shortName||e.name]),qi.legalEntityId):`<div class="qi-from"><span class="muted small">От организации</span><b>${esc(ent.shortName||ent.name||'—')}</b></div>`}
   <div class="form-grid qi-vat">${select('qi-vat','НДС',[['22','22%'],['20','20%'],['10','10%'],['7','7%'],['5','5%'],['0','Без НДС']],qi.vatRate)}${select('qi-vat-inc','Цены',[['yes','с НДС'],['no','без НДС']],qi.vatIncluded===false?'no':'yes')}</div>
   ${tplHtml()}
   ${faxHtml()}
   <div class="qi-total"><div><span>Итого</span><b id="qi-sum">${money(vatInfo().gross)}</b></div><div class="muted small" id="qi-vatline">${Number(qi.vatRate)?'в т.ч. НДС '+money(vatInfo().vat):'без НДС'}</div></div>
   <button type="button" class="btn btn-primary qi-go" id="qi-go" ${c?'':'disabled'}>${goLabel()}</button>
   <p class="muted small" id="qi-what">${c?whatHappens():'Выберите компанию'}</p>
  </aside>`;
  bind();
 }
 function companyCard(c){return `<div class="qi-company"><div><b>${esc(c.name)}</b>${c.isNew?' <span class="badge badge-own">новая — добавится в CRM</span>':''}<div class="muted small">${[c.inn&&'ИНН '+c.inn,c.kpp&&'КПП '+c.kpp].filter(Boolean).map(esc).join(' · ')||'ИНН не указан'}</div>${c.legalAddress?`<div class="muted small">${esc(c.legalAddress)}</div>`:''}${c.director?`<div class="muted small">${esc(c.director)}</div>`:''}</div><button type="button" class="btn btn-ghost btn-sm" id="qi-change">Другая компания</button></div>${c.isNew&&!c.inn?`<div class="form-grid">${qiInput('qi-new-inn','ИНН (если знаете)','')}</div>`:''}`}
 function dealHtml(ctx){const deals=ctx?.deals||[];
  return `<div class="qi-deals" role="radiogroup" aria-label="Сделка"><label class="qi-deal ${!qi.orderId?'on':''}"><input type="radio" name="qi-deal" value="" ${!qi.orderId?'checked':''}><b>Новая сделка</b><span class="muted small">создастся автоматически</span></label>${deals.slice(0,6).map(o=>`<label class="qi-deal ${qi.orderId===o.id?'on':''}"><input type="radio" name="qi-deal" value="${esc(o.id)}" ${qi.orderId===o.id?'checked':''}><b>${esc(o.number)}</b><span class="muted small">${esc([o.name===o.number?'':o.name,o.start?new Date(String(o.start).slice(0,10)).toLocaleDateString('ru-RU'):'',o.invoiced?'счёт уже есть':''].filter(Boolean).join(' · '))}</span></label>`).join('')}</div>
  ${qi.orderId?`<p class="muted small">Счёт будет по сделке ${esc(deals.find(o=>o.id===qi.orderId)?.number||'')}. Строки взяты из сделки — поправьте, если нужно.</p>`:`<div class="form-grid qi-where"><div class="form-group qi-addr"><label for="qi-address">Адрес работ</label><input class="field" id="qi-address" list="qi-addr-list" value="${esc(qi.address)}" placeholder="${esc(qi.client.legalAddress||'Город, улица, дом')}"><datalist id="qi-addr-list">${(ctx?.objects||[]).map(o=>`<option value="${esc(o.address)}"></option>`).join('')}</datalist></div>${qiInput('qi-start','Работы с',qi.start,'date')}${qiInput('qi-end','по',qi.end,'date')}</div>${ctx?.objects?.length?`<div class="qi-chips">${ctx.objects.slice(0,4).map(o=>`<button type="button" class="chip" data-qi-addr="${esc(o.address)}">${esc(o.address)}</button>`).join('')}</div>`:''}`}`}
 function rowHtml(i,n){const total=(Number(i.quantity)||0)*(Number(i.rate)||0);return `<div class="qi-row" data-row="${n}"><div class="qi-desc"><input class="field" list="qi-eq" data-f="description" value="${esc(i.description)}" placeholder="Техника или услуга" aria-label="Техника или услуга, строка ${n+1}">${i.equipmentId?'<span class="qi-eq-tag" title="Техника из вашего парка — строка попадёт в сделку">парк</span>':''}</div><input class="field qi-num" type="number" min="0.01" step="any" data-f="quantity" value="${esc(i.quantity)}" aria-label="Количество"><select class="field qi-unit" data-f="unit" aria-label="Единица">${QI_UNITS.map(([v,t])=>`<option value="${v}" ${i.unit===v?'selected':''}>${t}</option>`).join('')}</select><input class="field qi-num" type="number" min="0" step="any" data-f="rate" value="${esc(i.rate)}" placeholder="Цена" aria-label="Цена"><b class="qi-rsum">${total?money(total):'—'}</b><button type="button" class="icon-btn qi-del" data-del="${n}" aria-label="Удалить строку" ${qi.items.length<2?'disabled':''}>×</button></div>`}
 function tplOptions(type,sel){const list=templates.filter(t=>t.type===type);return `<option value="">Стандартное оформление ПРОМЕТЕЙ</option>${list.map(t=>`<option value="${esc(t.id)}" ${sel===t.id?'selected':''}>Свой: ${esc(t.name)}</option>`).join('')}${canTpl?'<option value="__upload">+ Загрузить свой шаблон Word…</option>':''}`}
 function tplHtml(){const t=qi.type;return `<div class="qi-tpl"><div class="form-group"><label for="qi-tpl">Оформление ${t==='invoice'?'счёта':'договора-счёта'}</label><select class="field" id="qi-tpl" data-tpl-for="${t}">${tplOptions(t,qi.templateId)}</select></div>
  ${t==='invoice'?`<label class="check-line qi-contract"><input type="checkbox" id="qi-with-contract" ${qi.withContract?'checked':''}><span><b>Также договор</b><br><span class="muted small">Сформировать договор по этой же сделке</span></span></label>${qi.withContract?`<div class="form-group"><label for="qi-ctpl">Оформление договора</label><select class="field" id="qi-ctpl" data-tpl-for="contract">${tplOptions('contract',qi.contractTemplateId)}</select></div>`:''}`:''}
  ${(qi.templateId||qi.withContract&&qi.contractTemplateId)?'<p class="muted small">По своему шаблону документ выйдет в Word. PDF из него получится, если на компьютере есть Microsoft Word или LibreOffice.</p>':''}
  <input type="file" id="qi-tpl-file" accept=".docx" hidden></div>`}
 function faxHtml(){const e=entities.find(x=>x.id===qi.legalEntityId)||ent;if(!e.signatureImage&&!e.stampImage)return `<p class="muted small qi-nofax">Подпись и печать не загружены — будет строка для подписи от руки.</p>`;return `<label class="check-line qi-fax"><input type="checkbox" id="qi-fax" ${qi.facsimile===false?'':'checked'}><span><b>С подписью и печатью</b></span><span class="doc-fax-pics">${e.signatureImage?`<img src="${esc(logoUrl(e.signatureImage))}" alt="">`:''}${e.stampImage?`<img src="${esc(logoUrl(e.stampImage))}" alt="">`:''}</span></label>`}
 function goLabel(){const own=qi.templateId||(qi.withContract&&qi.contractTemplateId);return (qi.type==='invoice'?(qi.withContract?'Выставить счёт и договор':'Выставить счёт'):'Выставить договор-счёт')+(own?' и скачать':' и скачать PDF')}
 function whatHappens(){const c=qi.client,parts=[];if(c.isNew)parts.push('добавим компанию');if(!qi.orderId){parts.push('создадим сделку'+(qi.address||c.legalAddress?' и объект':''))}parts.push(qi.type==='invoice'?'выставим счёт':'выставим договор-счёт');if(qi.type==='invoice'&&qi.withContract)parts.push('сформируем договор');return 'Одним нажатием: '+parts.join(', ')+'.'}
 function doneHtml(){const r=qi.done,d=r.document,c=r.contract;const fmt=x=>x.file?.ext==='docx'?'Word':'PDF';return `<section class="panel qi-done"><div class="qi-done-mark">✓</div><h2>${d.type==='invoice'?'Счёт':'Договор-счёт'} № ${esc(d.number)} выставлен${c?` · договор № ${esc(c.number)}`:''}</h2><p class="muted">${esc(qi.client.name)} · ${money(d.totalGross)}${r.created.client?' · компания добавлена в CRM':''}${r.created.order?' · создана сделка':''}${d.templateName?' · оформление: '+esc(d.templateName):''}</p>${d.fileError?`<p class="qi-err">Файл пока не получился: ${esc(d.fileError)}. Документ сохранён — скачать можно позже в «Документах».</p>`:''}
  <div class="actions"><button class="btn btn-primary" id="qi-pdf">Скачать ${d.type==='invoice'?'счёт':'договор-счёт'} (${fmt(d)})</button>${d.file?.hasDocx&&d.file.ext!=='docx'?'<button class="btn btn-light" id="qi-docx">Счёт в Word</button>':''}${c?`<button class="btn btn-primary" id="qi-contract">Скачать договор (${fmt(c)})</button>`:''}<button class="btn btn-light" id="qi-deal">Открыть сделку</button><button class="btn btn-ghost" id="qi-more">Выставить ещё</button></div></section>`}
 function bindDone(){const r=qi.done;root.querySelector('#qi-pdf').onclick=()=>downloadDocument(r.documentId);root.querySelector('#qi-docx')?.addEventListener('click',()=>downloadDocument(r.documentId,'docx'));root.querySelector('#qi-contract')?.addEventListener('click',()=>downloadDocument(r.contractId));root.querySelector('#qi-deal').onclick=()=>{qi=null;ordersView='list';workspaceSelection={kind:'orders',id:r.orderId};current='orders';renderApp()};root.querySelector('#qi-more').onclick=()=>{qi=qiFresh();qi.templateId=tplDefault('invoice');qi.contractTemplateId=tplDefault('contract');draw()}}
 function refreshTotals(){root.querySelectorAll('.qi-row').forEach((row,n)=>{const i=qi.items[n];const t=(Number(i.quantity)||0)*(Number(i.rate)||0);row.querySelector('.qi-rsum').textContent=t?money(t):'—'});const v=vatInfo();root.querySelector('#qi-sum').textContent=money(v.gross);root.querySelector('#qi-vatline').textContent=Number(qi.vatRate)?'в т.ч. НДС '+money(v.vat):'без НДС'}

 async function pickClient(c){qi.client=c;qi.context=null;qi.orderId='';if(c.id){try{qi.context=await api('/api/quick-invoice/context?clientId='+encodeURIComponent(c.id))}catch(e){toast(e.message,true)}}
  if(!qi.address&&qi.context?.objects?.[0])qi.address=qi.context.objects[0].address;draw();root.querySelector('.qi-row [data-f="description"]')?.focus()}
 function rateFor(e){return qi.context?.rates?.[e.id]||{rate:e.saleRate||'',unit:'shift'}}

 function bind(){
  const q=root.querySelector('#qi-q');
  if(q){let timer=0,seq=0;const sug=root.querySelector('#qi-sug');q.focus();
   const search=async()=>{const text=q.value.trim(),my=++seq;if(text.length<2){sug.innerHTML='';return}
    const inn=text.replace(/\D/g,''),isInn=/^\d{10}(\d{2})?$/.test(inn)&&inn.length===text.replace(/\s/g,'').length;
    let list=[];try{list=await api('/api/clients?archive=active&q='+encodeURIComponent(isInn?inn:text))}catch{}
    if(my!==seq)return;
    const rows=list.slice(0,6).map(c=>({kind:'crm',c}));
    sug.innerHTML=rows.map((r,n)=>`<button type="button" class="qi-opt" data-n="${n}" role="option"><b>${esc(r.c.name)}</b><span class="muted small">${esc([r.c.inn&&'ИНН '+r.c.inn,r.c.legalAddress].filter(Boolean).join(' · '))}</span></button>`).join('')+
     (isInn&&!list.some(c=>c.inn===inn)?`<div class="qi-opt qi-looking" id="qi-lookup">Ищу ИНН ${esc(inn)} в ЕГРЮЛ…</div>`:'')+
     (!isInn&&!list.some(c=>c.name.toLowerCase()===text.toLowerCase())?`<button type="button" class="qi-opt qi-new" id="qi-newname">+ Новая компания «${esc(text)}»</button>`:'');
    sug.querySelectorAll('[data-n]').forEach(b=>b.onclick=()=>{const c=rows[b.dataset.n].c;pickClient({id:c.id,name:c.name,inn:c.inn||'',kpp:c.kpp||'',legalAddress:c.legalAddress||''})});
    sug.querySelector('#qi-newname')?.addEventListener('click',()=>pickClient({isNew:true,name:text,inn:'',kpp:'',legalAddress:''}));
    if(isInn&&!list.some(c=>c.inn===inn)){try{const r=await api('/api/company/lookup',{method:'POST',body:JSON.stringify({kind:'inn',query:inn})});if(my!==seq)return;const box=sug.querySelector('#qi-lookup');if(!box)return;
      const f=r.found||r.company||r;if(f&&f.name){box.outerHTML=`<button type="button" class="qi-opt qi-new" id="qi-found"><b>+ ${esc(f.shortName||f.name)}</b><span class="muted small">новая · ИНН ${esc(inn)}${f.kpp?' · КПП '+esc(f.kpp):''}${f.address?' · '+esc(f.address):''}</span></button>`;sug.querySelector('#qi-found').onclick=()=>pickClient({isNew:true,name:f.shortName||f.name,inn,kpp:f.kpp||'',legalAddress:f.address||f.legalAddress||'',director:f.signatoryName?[f.signatoryPosition,f.signatoryName].filter(Boolean).join(' '):''})}
      else throw new Error('not found')}
     catch(e){const box=sug.querySelector('#qi-lookup');if(box)box.outerHTML=`<div class="qi-opt"><span class="muted small">${esc(e.message&&e.message!=='not found'?e.message:'В ЕГРЮЛ не нашли')} — впишите название компании</span></div>`}}
   };
   q.oninput=()=>{clearTimeout(timer);timer=setTimeout(search,220)};
   q.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();sug.querySelector('.qi-opt[data-n], #qi-found, #qi-newname')?.click()}};
  }
  root.querySelector('#qi-change')?.addEventListener('click',()=>{qi.client=null;qi.context=null;qi.orderId='';draw()});
  root.querySelector('#qi-new-inn')?.addEventListener('input',e=>{qi.client.inn=e.target.value.replace(/\D/g,'')});
  root.querySelectorAll('input[name="qi-deal"]').forEach(r=>r.onchange=()=>{qi.orderId=r.value;const o=qi.context?.deals?.find(x=>x.id===r.value);
   if(o){qi.items=o.items.length?o.items.map(i=>({key:Math.random(),...i})):qi.items;qi.address=o.address||qi.address}draw()});
  root.querySelectorAll('[data-qi-addr]').forEach(b=>b.onclick=()=>{qi.address=b.dataset.qiAddr;draw()});
  for(const [id,k] of [['qi-address','address'],['qi-start','start'],['qi-end','end']])root.querySelector('#'+id)?.addEventListener('input',e=>{qi[k]=e.target.value;if(k==='start'&&qi.end<qi.start){qi.end=qi.start;root.querySelector('#qi-end').value=qi.end}if(k==='address')root.querySelector('#qi-what').textContent=whatHappens()});
  root.querySelectorAll('.qi-row').forEach((row,n)=>{row.querySelectorAll('[data-f]').forEach(f=>{f.addEventListener(f.tagName==='SELECT'?'change':'input',()=>{const i=qi.items[n];i[f.dataset.f]=f.value;
    if(f.dataset.f==='description'){const e=eqByLabel.get(f.value.trim().toLowerCase());if(e&&i.equipmentId!==e.id){i.equipmentId=e.id;const r=rateFor(e);if(r.rate!==''&&!Number(i.rate))i.rate=r.rate;i.unit=r.unit||i.unit;draw();root.querySelectorAll('.qi-row [data-f="quantity"]')[n]?.focus();return}if(!e&&i.equipmentId){i.equipmentId='';row.querySelector('.qi-eq-tag')?.remove()}}
    refreshTotals()})})});
  root.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{qi.items.splice(Number(b.dataset.del),1);draw()});
  root.querySelector('#qi-add').onclick=()=>{qi.items.push({key:Math.random(),equipmentId:'',description:'',quantity:1,unit:qi.items.at(-1)?.unit||'shift',rate:''});draw();root.querySelectorAll('.qi-row [data-f="description"]')[qi.items.length-1]?.focus()};
  root.querySelectorAll('[data-qi-type]').forEach(b=>b.onclick=()=>{qi.type=b.dataset.qiType;qi.templateId=tplDefault(qi.type);draw()});
  root.querySelector('#qi-entity')?.addEventListener('change',e=>{qi.legalEntityId=e.target.value;draw()});
  root.querySelector('#qi-vat').onchange=e=>{qi.vatRate=e.target.value;refreshTotals()};
  root.querySelector('#qi-vat-inc').onchange=e=>{qi.vatIncluded=e.target.value==='yes';refreshTotals()};
  root.querySelector('#qi-fax')?.addEventListener('change',e=>{qi.facsimile=e.target.checked});
  let uploadFor='';const tf=root.querySelector('#qi-tpl-file');
  root.querySelectorAll('[data-tpl-for]').forEach(sel=>sel.onchange=()=>{const type=sel.dataset.tplFor;if(sel.value==='__upload'){uploadFor=type;sel.value=type==='contract'?qi.contractTemplateId:qi.templateId;tf.click();return}if(type==='contract')qi.contractTemplateId=sel.value;else qi.templateId=sel.value;draw()});
  root.querySelector('#qi-with-contract')?.addEventListener('change',e=>{qi.withContract=e.target.checked;draw()});
  tf?.addEventListener('change',async()=>{const f=tf.files[0];tf.value='';if(!f)return;if(!/\.docx$/i.test(f.name))return toast(/\.doc$/i.test(f.name)?'Это старый формат .doc. Откройте файл в Word → «Сохранить как» → «Документ Word (*.docx)».':'Нужен файл Word .docx',true);
   try{const t=await api('/api/templates',{method:'POST',body:JSON.stringify({fileName:f.name,type:uploadFor,data:await readAsDataUrl(f)})});templates=await api('/api/templates').catch(()=>templates);if(uploadFor==='contract')qi.contractTemplateId=t.id;else qi.templateId=t.id;
    toast(t.fields.length?`Шаблон «${t.name}» загружен: полей — ${t.fields.length}`:'Шаблон загружен, но полей {{…}} в нём нет — данные не подставятся. Образец полей: «Документы → Шаблоны».',!t.fields.length);draw()}catch(e){toast(e.message,true)}});
  root.querySelector('#qi-go').onclick=submit;
 }
 async function submit(){
  const btn=root.querySelector('#qi-go');const c=qi.client;if(!c)return;
  const items=qi.items.filter(i=>String(i.description).trim()||i.equipmentId);
  if(!items.length)return toast('Добавьте технику или услугу',true);
  const bad=items.findIndex(i=>!(Number(i.quantity)>0)||i.rate===''||!(Number(i.rate)>=0));if(bad>=0)return toast(`Строка ${bad+1}: укажите количество и цену`,true);
  const body={type:qi.type,orderId:qi.orderId||'',address:qi.address,start:qi.start,end:qi.end,legalEntityId:qi.legalEntityId,vatRate:Number(qi.vatRate),vatIncluded:qi.vatIncluded!==false,facsimile:qi.facsimile!==false,templateId:qi.templateId||'',withContract:qi.type==='invoice'&&!!qi.withContract,contractTemplateId:qi.contractTemplateId||'',
   items:items.map(i=>({equipmentId:i.equipmentId||'',description:i.description,quantity:Number(i.quantity),unit:i.unit,rate:Number(i.rate)})),
   ...(c.id?{clientId:c.id}:{client:{name:c.name,inn:c.inn,kpp:c.kpp,legalAddress:c.legalAddress}})};
  btn.disabled=true;btn.textContent='Выставляю…';
  try{const r=await api('/api/quick-invoice',{method:'POST',body:JSON.stringify(body)});qi.done=r;if(!c.id)qi.client={...c,id:r.clientId,isNew:false};draw();
   if(r.document&&!r.document.fileError)downloadDocument(r.documentId);if(r.contract&&!r.contract.fileError)setTimeout(()=>downloadDocument(r.contractId),700)}
  catch(e){toast(e.message,true);btn.disabled=false;btn.textContent=goLabel()}
 }
 draw();
}
