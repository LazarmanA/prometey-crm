/* Организация: фирменный стиль во всём интерфейсе, мастер регистрации организации, вкладка «Администрирование → Компания». */

// ---------- фирменный стиль ----------
let BRAND={appName:'',color:'',company:'',logoUrl:''};
function applyBrand(b){
 if(b)BRAND={...BRAND,...b};
 const root=document.documentElement;
 if(/^#[0-9a-f]{6}$/i.test(BRAND.color||'')){root.style.setProperty('--accent',BRAND.color);root.style.setProperty('--accent2',BRAND.color)}else{root.style.removeProperty('--accent');root.style.removeProperty('--accent2')}
 const name=BRAND.appName||'';document.title=name||'ПРОМЕТЕЙ CRM';
 document.querySelectorAll('.brand-app-name').forEach(e=>e.textContent=name||'ПРОМЕТЕЙ CRM');
 brandMarks();
}
// логотип и название вместо «P ПРОМЕТЕЙ» — везде, где есть знак бренда
function brandMarks(){
 const name=BRAND.appName,logo=BRAND.logoUrl;if(!name&&!logo)return;
 document.querySelectorAll('.brand-mark:not([data-branded])').forEach(m=>{m.dataset.branded='1';
  const icon=m.querySelector('.brand-icon'),label=m.querySelector('span');
  if(logo&&icon){icon.textContent='';icon.classList.add('brand-icon-logo');const img=document.createElement('img');img.src=logo;img.alt='';icon.append(img)}
  if(name&&label)label.textContent=name;
 });
}
new MutationObserver(()=>brandMarks()).observe(document.documentElement,{childList:true,subtree:true});
(location.protocol==='file:'?Promise.reject():fetch('/api/config')).then(r=>r.json()).then(c=>{if(c.brand)applyBrand(c.brand)}).catch(()=>{});

const PRESET_COLORS=['#ea5b0c','#d92d20','#c11574','#6941c6','#1570ef','#0e9384','#079455','#ca8504','#344054'];
const readFileData=file=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error('Не удалось прочитать файл'));r.readAsDataURL(file)});

// ---------- мастер регистрации организации ----------
const ORG={company:{},bank:{},brand:{},step:0};
function renderOrgWizard(info={}){
 const params=new URLSearchParams(location.hash.slice(1)),setupToken=params.get('setup')||'';
 const steps=['Компания','Банк','Оформление','Владелец'];
 const s=ORG.step,c=ORG.company,b=ORG.bank,br=ORG.brand;
 const dots=`<ol class="wz-steps">${steps.map((t,i)=>`<li class="${i<s?'done':i===s?'now':''}"><span>${i<s?'✓':i+1}</span><b>${t}</b></li>`).join('')}</ol>`;
 const fld=(id,label,v,opt={})=>`<label for="${id}">${label}${opt.req?'':' <span class="muted small">(необязательно)</span>'}</label><input class="field" id="${id}" value="${esc(v||'')}"${opt.type?` type="${opt.type}"`:''}${opt.ph?` placeholder="${esc(opt.ph)}"`:''}${opt.mode?` inputmode="${opt.mode}"`:''} autocomplete="off">`;
 let body='';
 if(s===0)body=`<p class="muted">Введите ИНН — остальное заполнится само. Можно и вручную.</p>
  <div class="wz-find"><div>${fld('wz-inn','ИНН',c.inn,{req:1,mode:'numeric',ph:'10 или 12 цифр'})}</div><button type="button" class="btn btn-light" id="wz-find-inn">Найти</button></div><div class="wz-note" id="wz-inn-note"></div>
  ${fld('wz-name','Полное наименование',c.name,{req:1,ph:'Общество с ограниченной ответственностью «…»'})}${fld('wz-short','Короткое название',c.shortName,{ph:'ООО «…»'})}
  <div class="wz-two"><div>${fld('wz-kpp','КПП',c.kpp,{mode:'numeric'})}</div><div>${fld('wz-ogrn','ОГРН',c.ogrn,{mode:'numeric'})}</div></div>
  ${fld('wz-address','Юридический адрес',c.address)}
  <div class="wz-two"><div>${fld('wz-sign','Руководитель (ФИО)',c.signatoryName)}</div><div>${fld('wz-pos','Должность',c.signatoryPosition||'Генеральный директор')}</div></div>
  <div class="wz-two"><div>${fld('wz-phone','Телефон компании',c.phone,{type:'tel'})}</div><div>${fld('wz-email','E-mail компании',c.email,{type:'email'})}</div></div>`;
 if(s===1)body=`<p class="muted">Нужны для счетов и договоров. Можно заполнить позже — «Администрирование → Компания».</p>
  <div class="wz-find"><div>${fld('wz-bik','БИК банка',b.bik,{mode:'numeric',ph:'9 цифр'})}</div><button type="button" class="btn btn-light" id="wz-find-bik">Найти</button></div><div class="wz-note" id="wz-bik-note"></div>
  ${fld('wz-bank','Банк',b.bankName)}${fld('wz-corr','Корреспондентский счёт',b.correspondentAccount,{mode:'numeric'})}${fld('wz-acc','Расчётный счёт',b.bankAccount,{mode:'numeric',ph:'20 цифр'})}
  <label for="wz-vat">НДС</label><select class="field" id="wz-vat">${[['22','22%'],['20','20%'],['10','10%'],['7','7%'],['5','5%'],['0','Без НДС (УСН)']].map(([v,t])=>`<option value="${v}"${String(b.vatRate??22)===v?' selected':''}>${t}</option>`).join('')}</select>`;
 if(s===2){const name=br.appName??((c.shortName||c.name||'').replace(/^(ООО|АО|ПАО|ЗАО|ИП)\s*/i,'').replace(/[«»"]/g,'').trim()+' CRM').trim();const color=br.color||'#ea5b0c';
  body=`<p class="muted">Так CRM будет выглядеть для ваших сотрудников: ваше название, логотип и цвет — на входе, в меню и в документах.</p>
  ${fld('wz-app','Название CRM',name,{req:1,ph:'Например: КранСервис CRM'})}
  <label>Фирменный цвет</label><div class="wz-colors">${PRESET_COLORS.map(x=>`<button type="button" class="wz-color${x===color?' on':''}" data-color="${x}" style="background:${x}" aria-label="${x}"></button>`).join('')}<label class="wz-color wz-color-own" title="Свой цвет"><input type="color" id="wz-color" value="${color}"></label></div>
  <label>Логотип <span class="muted small">(необязательно, PNG или JPG до 2 МБ)</span></label><div class="wz-logo"><button type="button" class="btn btn-light" id="wz-logo-pick">${br.logo?'Заменить логотип':'Выбрать файл…'}</button>${br.logo?'<button type="button" class="btn btn-ghost" id="wz-logo-del">Убрать</button>':''}<input type="file" id="wz-logo" accept="image/png,image/jpeg,image/webp" hidden></div>
  <div class="wz-preview" id="wz-preview"><div class="wz-preview-bar"><span class="wz-preview-icon">${br.logo?`<img src="${br.logo}" alt="">`:'P'}</span><b id="wz-preview-name">${esc(name)}</b></div><div class="wz-preview-body"><span class="wz-preview-btn">Новый заказ</span><span class="muted small">так будут выглядеть кнопки и меню</span></div></div>`}
 if(s===3)body=`<p class="muted">Ваша учётная запись — вы станете владельцем CRM со всеми правами. Сотрудников пригласите потом по ссылке или загрузите списком из Excel.</p>${personFields(false)}
  ${info.demo?`<label class="small ob-demo"><input type="checkbox" id="ob-clear" checked> Начать с чистой базы — убрать примеры (демо-компании, сделки, технику)</label>`:''}`;
 onboardShell('Регистрация организации',`Шаг ${s+1} из 4 · ${steps[s]}`,`${dots}<form id="wz-form" autocomplete="on">${body}<div class="wz-nav">${s?'<button type="button" class="btn btn-light" id="wz-back">Назад</button>':'<span></span>'}<button class="btn btn-primary" id="wz-next">${s===3?'Создать организацию':s===1&&!b.bankAccount?'Далее (можно пропустить)':'Далее'}</button></div></form><p class="small"><a href="#" id="login-policy">Политика обработки персональных данных</a></p>`);
 document.querySelector('.login-card')?.classList.add('wz-card');
 document.getElementById('login-policy').onclick=e=>{e.preventDefault();if(typeof showPolicy==='function')showPolicy()};
 const $=id=>document.getElementById(id);
 const save=()=>{
  if(s===0)Object.assign(c,{inn:val('wz-inn').replace(/\D/g,''),name:val('wz-name').trim(),shortName:val('wz-short').trim(),kpp:val('wz-kpp').replace(/\D/g,''),ogrn:val('wz-ogrn').replace(/\D/g,''),address:val('wz-address').trim(),signatoryName:val('wz-sign').trim(),signatoryPosition:val('wz-pos').trim(),phone:val('wz-phone').trim(),email:val('wz-email').trim()});
  if(s===1)Object.assign(b,{bik:val('wz-bik').replace(/\D/g,''),bankName:val('wz-bank').trim(),correspondentAccount:val('wz-corr').replace(/\D/g,''),bankAccount:val('wz-acc').replace(/\D/g,''),vatRate:Number(val('wz-vat'))});
  if(s===2)Object.assign(br,{appName:val('wz-app').trim(),color:br.color||val('wz-color')});
 };
 const lookup=async(kind,query,note)=>{note.textContent='Ищу…';note.className='wz-note';
  try{const r=await api('/api/setup/lookup',{method:'POST',body:JSON.stringify({kind,query,token:setupToken})});note.textContent=kind==='inn'?`Найдено: ${r.shortName||r.name}${r.status&&r.status!=='действующая'?' — '+r.status:''}`:`Найден: ${r.bankName}`;note.className='wz-note ok';return r}
  catch(e){note.textContent=e.message;note.className='wz-note bad';return null}};
 if(s===0)$('wz-find-inn').onclick=async()=>{const r=await lookup('inn',val('wz-inn'),$('wz-inn-note'));if(!r)return;for(const [id,k] of [['wz-name','name'],['wz-short','shortName'],['wz-kpp','kpp'],['wz-ogrn','ogrn'],['wz-address','address'],['wz-sign','signatoryName'],['wz-pos','signatoryPosition'],['wz-phone','phone'],['wz-email','email']])if(r[k])$(id).value=r[k]};
 if(s===1)$('wz-find-bik').onclick=async()=>{const r=await lookup('bik',val('wz-bik'),$('wz-bik-note'));if(!r)return;$('wz-bank').value=r.bankName||'';$('wz-corr').value=r.correspondentAccount||''};
 if(s===2){
  const preview=()=>{const col=br.color||val('wz-color');$('wz-preview').style.setProperty('--wz',col);$('wz-preview-name').textContent=val('wz-app')||'CRM'};
  document.querySelectorAll('[data-color]').forEach(x=>x.onclick=()=>{br.color=x.dataset.color;$('wz-color').value=x.dataset.color;document.querySelectorAll('.wz-color').forEach(y=>y.classList.toggle('on',y===x));preview()});
  $('wz-color').oninput=()=>{br.color=val('wz-color');document.querySelectorAll('.wz-color').forEach(y=>y.classList.toggle('on',y.classList.contains('wz-color-own')));preview()};
  $('wz-app').oninput=preview;preview();
  $('wz-logo-pick').onclick=()=>$('wz-logo').click();
  $('wz-logo').onchange=async()=>{const f=$('wz-logo').files[0];if(!f)return;if(f.size>2*1024*1024)return toast('Логотип больше 2 МБ — уменьшите картинку',true);save();br.logo=await readFileData(f);renderOrgWizard(info)};
  if($('wz-logo-del'))$('wz-logo-del').onclick=()=>{save();delete br.logo;renderOrgWizard(info)};
 }
 if(s===3)wirePerson();
 if($('wz-back'))$('wz-back').onclick=()=>{save();ORG.step--;renderOrgWizard(info)};
 $('wz-form').onsubmit=async e=>{e.preventDefault();save();
  if(s===0){if(!c.name)return toast('Укажите название организации (или найдите её по ИНН)',true);if(c.inn&&!/^\d{10}(\d{2})?$/.test(c.inn))return toast('ИНН — 10 или 12 цифр',true);if(c.kpp&&!/^\d{9}$/.test(c.kpp))return toast('КПП — 9 цифр',true)}
  if(s===1){if(b.bik&&!/^\d{9}$/.test(b.bik))return toast('БИК — 9 цифр',true);if(b.bankAccount&&!/^\d{20}$/.test(b.bankAccount))return toast('Расчётный счёт — 20 цифр',true);if(b.correspondentAccount&&!/^\d{20}$/.test(b.correspondentAccount))return toast('Корр. счёт — 20 цифр',true)}
  if(s===2&&!br.appName)return toast('Укажите название CRM',true);
  if(s<3){ORG.step++;return renderOrgWizard(info)}
  const btn=$('wz-next');btn.disabled=true;
  try{const r=await api('/api/setup',{method:'POST',body:JSON.stringify({...personBody(),company:c.shortName||c.name,clearDemo:$('ob-clear')?.checked!==false,token:setupToken,organization:{company:c,bank:b,brand:br}})});
   window.__orgSetup=true;applyBrand({appName:br.appName,color:br.color});try{const cfg=await (await fetch('/api/config')).json();if(cfg.brand)applyBrand(cfg.brand)}catch{}
   await afterRegister(r)}
  catch(err){toast(err.message,true);if(/ИНН|КПП|ОГРН|наименован/i.test(err.message)){ORG.step=0;renderOrgWizard(info)}else if(/счёт|БИК/i.test(err.message)){ORG.step=1;renderOrgWizard(info)}}finally{const x=$('wz-next');if(x)x.disabled=false}};
}

// ---------- Администрирование → Компания ----------
async function adminCompany(box){
 const info=await api('/api/company');const e=info.entity||{},br=info.brand||{};
 const img=(ref,label)=>ref?`<img class="co-img" src="/api/files/logos/${esc(ref.fileId)}" alt="${label}">`:`<span class="muted small">не загружено</span>`;
 box.innerHTML=`${window.__orgSetup?`<div class="panel co-next"><b>Организация создана. Осталось загрузить данные</b><p class="muted">Загрузите клиентов, технику и сотрудников из Excel, добавьте подпись и печать для документов, загрузите свои шаблоны договоров. Всё это можно сделать и позже.</p></div>`:''}
 <div class="co-grid">
 <section class="panel co-card"><div class="co-head"><h3>Реквизиты</h3><div class="actions">${e.id?`<button class="btn btn-light btn-sm" id="co-edit">Изменить</button>`:`<button class="btn btn-primary btn-sm" id="co-edit">Заполнить</button>`}</div></div>
  ${e.id?`<dl class="co-dl"><dt>Организация</dt><dd>${esc(e.name)}</dd><dt>ИНН / КПП</dt><dd>${esc(e.inn||'—')} / ${esc(e.kpp||'—')}</dd>${e.ogrn?`<dt>ОГРН</dt><dd>${esc(e.ogrn)}</dd>`:''}<dt>Адрес</dt><dd>${esc(e.address||'—')}</dd><dt>Руководитель</dt><dd>${esc(e.signatoryName||'—')}, ${esc(e.signatoryPosition||'')}</dd><dt>Банк</dt><dd>${e.bankAccount?`р/с ${esc(e.bankAccount)}, ${esc(e.bankName)}, БИК ${esc(e.bik)}`:'<span class="muted">не указан</span>'}</dd></dl>`:'<p class="muted">Реквизиты ещё не заполнены — они нужны для счетов и договоров.</p>'}</section>
 <section class="panel co-card"><div class="co-head"><h3>Оформление</h3></div>
  <label for="co-app">Название CRM</label><input class="field" id="co-app" maxlength="40" value="${esc(br.appName||'')}" placeholder="ПРОМЕТЕЙ CRM">
  <label>Фирменный цвет</label><div class="wz-colors">${PRESET_COLORS.map(x=>`<button type="button" class="wz-color${x===(br.color||'#ea5b0c')?' on':''}" data-color="${x}" style="background:${x}" aria-label="${x}"></button>`).join('')}<label class="wz-color wz-color-own" title="Свой цвет"><input type="color" id="co-color" value="${esc(br.color||'#ea5b0c')}"></label></div>
  <label>Логотип</label><div id="co-logo"></div>
  <div class="actions"><button class="btn btn-primary" id="co-brand-save">Сохранить оформление</button></div></section>
 <section class="panel co-card"><div class="co-head"><h3>Подпись и печать</h3></div><p class="muted small">Картинки PNG с прозрачным фоном — появятся в счетах и договорах в блоке подписи.</p>
  ${e.id?`<div class="co-sign"><div><b>Подпись</b><div>${img(e.signatureImage,'подпись')}</div><button class="btn btn-light btn-sm" data-img="signature">Загрузить</button>${e.signatureImage?'<button class="btn btn-ghost btn-sm" data-img-del="signature">Убрать</button>':''}</div><div><b>Печать</b><div>${img(e.stampImage,'печать')}</div><button class="btn btn-light btn-sm" data-img="stamp">Загрузить</button>${e.stampImage?'<button class="btn btn-ghost btn-sm" data-img-del="stamp">Убрать</button>':''}</div></div><input type="file" id="co-img-file" accept="image/png,image/jpeg,image/webp" hidden>`:'<p class="muted">Сначала заполните реквизиты.</p>'}</section>
 <section class="panel co-card co-wide"><div class="co-head"><h3>Загрузка данных из Excel</h3></div><p class="muted small">Скачайте шаблон, заполните его (или перенесите свою таблицу в те же колонки) и загрузите. Перед загрузкой CRM покажет, что добавится, а что пропустит. Повторы (тот же ИНН, госномер, e-mail) не задваиваются.</p>
  <div class="co-imports">${Object.entries(info.kinds).map(([k,v])=>`<div class="co-import"><div><b>${esc(v.title)}</b><div class="muted small">${esc(v.columns.join(' · '))}</div></div><div class="actions"><a class="btn btn-light btn-sm" href="/api/import/template/${k}" download>Шаблон</a><button class="btn btn-primary btn-sm" data-import="${k}">Загрузить…</button></div></div>`).join('')}</div><input type="file" id="co-import-file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden></section>
 <section class="panel co-card"><div class="co-head"><h3>Шаблоны договоров</h3></div><p class="muted small">Свои договоры и акты в Word (.docx) — CRM подставит реквизиты, клиента и технику.</p><button class="btn btn-light" id="co-tpl">Открыть шаблоны</button></section>
 <section class="panel co-card"><div class="co-head"><h3>Поиск по ИНН и БИК</h3></div><p class="muted small">${info.dadata?'✓ Подключён — реквизиты клиентов и банков заполняются по ИНН и БИК.':'Бесплатный ключ сервиса DaData: dadata.ru → регистрация → «Личный кабинет» → «API-ключ».'}${info.dadataSource==='vendor'?' Ключ выдан разработчиком.':''}</p>
  ${info.dadataSource==='server'?'':`<label for="co-key">Ключ DaData</label><input class="field" id="co-key" placeholder="${info.dadataSource==='settings'?'ключ сохранён — впишите новый, чтобы заменить':'40 символов'}" autocomplete="off"><div class="actions"><button class="btn btn-light" id="co-key-save">Сохранить ключ</button></div>`}</section>
 </div>`;
 window.__orgSetup=false;
 const $=id=>box.querySelector('#'+id);
 $('co-edit').onclick=()=>openLegalEntity(e.id?e:{});
 if(typeof logoEditor==='function'&&e.id)$('co-logo').append(logoEditor('legalEntity',e.id,e.logo));else $('co-logo').innerHTML='<span class="muted small">Сначала заполните реквизиты</span>';
 let color=br.color||'#ea5b0c';
 box.querySelectorAll('[data-color]').forEach(x=>x.onclick=()=>{color=x.dataset.color;$('co-color').value=color;box.querySelectorAll('.wz-color').forEach(y=>y.classList.toggle('on',y===x));document.documentElement.style.setProperty('--accent',color)});
 $('co-color').oninput=()=>{color=$('co-color').value;document.documentElement.style.setProperty('--accent',color)};
 $('co-brand-save').onclick=async()=>{try{const r=await api('/api/company/brand',{method:'PATCH',body:JSON.stringify({appName:$('co-app').value,color})});const cfg=await (await fetch('/api/config')).json();document.querySelectorAll('[data-branded]').forEach(m=>delete m.dataset.branded);applyBrand(cfg.brand||r);toast('Оформление сохранено');renderApp()}catch(err){toast(err.message,true)}};
 if($('co-key-save'))$('co-key-save').onclick=async()=>{try{await api('/api/company/brand',{method:'PATCH',body:JSON.stringify({appName:$('co-app').value,color,dadataKey:$('co-key').value.trim()})});toast('Ключ сохранён');renderPage()}catch(err){toast(err.message,true)}};
 $('co-tpl').onclick=()=>{documentView='templates';current='documents';renderApp()};
 let imgKind='';const imgFile=$('co-img-file');
 box.querySelectorAll('[data-img]').forEach(x=>x.onclick=()=>{imgKind=x.dataset.img;imgFile.click()});
 if(imgFile)imgFile.onchange=async()=>{const f=imgFile.files[0];imgFile.value='';if(!f)return;try{await api('/api/files/logo',{method:'POST',body:JSON.stringify({target:'legalEntity',id:e.id,kind:imgKind,data:await readFileData(f)})});toast('Загружено — появится в новых документах');renderPage()}catch(err){toast(err.message,true)}};
 box.querySelectorAll('[data-img-del]').forEach(x=>x.onclick=async()=>{try{await api('/api/files/logo',{method:'POST',body:JSON.stringify({target:'legalEntity',id:e.id,kind:x.dataset.imgDel,remove:true})});renderPage()}catch(err){toast(err.message,true)}});
 let importKind='';const impFile=$('co-import-file');
 box.querySelectorAll('[data-import]').forEach(x=>x.onclick=()=>{importKind=x.dataset.import;impFile.click()});
 impFile.onchange=async()=>{const f=impFile.files[0];impFile.value='';if(!f)return;
  try{const data=await readFileData(f);const pre=await api('/api/import/'+importKind,{method:'POST',body:JSON.stringify({name:f.name,data,dryRun:true})});showImportReport(pre,{name:f.name,data,kind:importKind})}catch(err){toast(err.message,true)}};
}
function importReportHtml(r,done){
 const rows=(list,cls,fmt)=>list.length?`<ul class="imp-list ${cls}">${list.slice(0,50).map(fmt).join('')}${list.length>50?`<li class="muted">…и ещё ${list.length-50}</li>`:''}</ul>`:'';
 return `<p><b>${done?'Добавлено':'Будет добавлено'}: ${r.created}</b> из ${r.total}${r.skipped.length?` · пропущено (уже есть): ${r.skipped.length}`:''}${r.errors.length?` · с ошибками: <span class="bad-text">${r.errors.length}</span>`:''}</p>
 ${rows(r.errors,'bad',x=>`<li>Строка ${x.row}: ${esc(x.message)}</li>`)}${rows(r.skipped,'',x=>`<li class="muted">Строка ${x.row}: ${esc(x.reason)}</li>`)}
 ${!done&&r.errors.length?'<p class="muted small">Строки с ошибками не загрузятся — исправьте их в файле и загрузите ещё раз (повторы не задвоятся).</p>':''}`;
}
function showImportReport(pre,src){
 const kindName={clients:'компаний',equipment:'единиц техники',employees:'сотрудников'}[src.kind];
 sheet(`Загрузка: ${pre.title}`,`<p class="muted small">Файл «${esc(src.name)}»</p>${importReportHtml(pre,false)}${src.kind==='employees'&&pre.created?'<p class="small">Каждый сотрудник получит личную ссылку для входа (7 дней): по ней он сам задаст пароль. После загрузки скачайте таблицу со ссылками и разошлите их.</p>':''}`,
  pre.created?[{text:`Загрузить ${pre.created} ${kindName}`,cls:'btn-primary',onClick:async()=>{try{const r=await api('/api/import/'+src.kind,{method:'POST',body:JSON.stringify({name:src.name,data:src.data})});setTimeout(()=>showImportDone(r),60)}catch(err){toast(err.message,true)}}},{text:'Отмена',cls:'btn-light',onClick:()=>{}}]:[{text:'Понятно',cls:'btn-primary',onClick:()=>{}}]);
}
function showImportDone(r){
 const save=()=>{const a=document.createElement('a');const bin=atob(r.linksFile);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);a.href=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));a.download='ssylki-dlya-sotrudnikov.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)};
 sheet(`Загружено: ${r.title}`,`${importReportHtml(r,true)}${r.links?.length?`<p>Ссылки для входа сотрудников — разошлите каждому его ссылку (WhatsApp, Telegram, почта):</p><div class="imp-links">${r.links.map(x=>`<div><b>${esc(x.name)}</b> <span class="muted small">${esc(x.email)}</span><div class="invite-link small">${esc(x.url||location.origin+'/'+x.link)}</div></div>`).join('')}</div>`:''}`,
  [...(r.linksFile?[{text:'Скачать таблицу со ссылками',cls:'btn-primary',close:false,onClick:save}]:[]),{text:'Готово',cls:r.linksFile?'btn-light':'btn-primary',onClick:()=>{if(current==='admin')renderPage()}}]);
}
