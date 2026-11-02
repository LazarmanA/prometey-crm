/* Загрузка файлов перетаскиванием: логотипы компаний и свои шаблоны договоров (.docx). */
const logoUrl=logo=>logo?.fileId?'/api/files/logos/'+encodeURIComponent(logo.fileId):'';
function logoImg(logo,cls='logo-img'){return logo?.fileId?`<img class="${cls}" src="${esc(logoUrl(logo))}" alt="" loading="lazy">`:''}
function readAsDataUrl(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error('Не удалось прочитать файл'));r.readAsDataURL(file)})}
// Картинку уменьшаем в браузере: логотипу достаточно 600 px, файл становится маленьким.
async function prepareLogo(file){
 if(!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type))throw new Error('Нужна картинка PNG, JPG или WebP');
 if(file.size>25*1024*1024)throw new Error('Картинка слишком большая');
 const bmp=await createImageBitmap(file);const k=Math.min(1,600/Math.max(bmp.width,bmp.height));
 const c=document.createElement('canvas');c.width=Math.max(1,Math.round(bmp.width*k));c.height=Math.max(1,Math.round(bmp.height*k));c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
 let url=c.toDataURL('image/png');if(url.length>1.5*1024*1024)url=c.toDataURL('image/webp',0.9);return url;
}
// Зона «перетащите файл сюда или нажмите». opts: {accept, title, hint, onFile(file), compact}
function dropzone(opts){
 const box=document.createElement('div');box.className='dropzone'+(opts.compact?' compact':'');box.tabIndex=0;box.setAttribute('role','button');
 box.innerHTML=`<input type="file" hidden accept="${esc(opts.accept||'')}"><div class="dz-icon">⬆</div><div><b>${esc(opts.title||'Перетащите файл сюда')}</b><span>${esc(opts.hint||'или нажмите, чтобы выбрать')}</span></div><div class="dz-status"></div>`;
 const input=box.querySelector('input'),status=box.querySelector('.dz-status');
 const run=async file=>{if(!file)return;box.classList.add('busy');status.textContent='Загружаю «'+file.name+'»…';try{await opts.onFile(file);status.textContent=''}catch(e){status.textContent=e.message;box.classList.add('error');setTimeout(()=>box.classList.remove('error'),2500)}finally{box.classList.remove('busy','over');input.value=''}};
 box.onclick=e=>{if(e.target!==input)input.click()};box.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click()}};
 input.onchange=()=>run(input.files[0]);
 box.ondragover=e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';box.classList.add('over')};
 box.ondragleave=e=>{if(!box.contains(e.relatedTarget))box.classList.remove('over')};
 box.ondrop=e=>{e.preventDefault();e.stopPropagation();run(e.dataTransfer.files[0])};
 return box;
}
// Файл, брошенный мимо зоны, браузер открыл бы вместо CRM — не даём.
window.addEventListener('dragover',e=>{if([...(e.dataTransfer?.types||[])].includes('Files'))e.preventDefault()});
window.addEventListener('drop',e=>{if([...(e.dataTransfer?.types||[])].includes('Files'))e.preventDefault()});

// Блок логотипа: картинка + зона загрузки + «Убрать». target: legalEntity | client
function logoEditor(target,id,logo,onChange){
 const wrap=document.createElement('div');wrap.className='logo-editor';
 const draw=l=>{wrap.innerHTML=`<div class="logo-preview">${l?.fileId?logoImg(l):'<span>Нет логотипа</span>'}</div>`;const z=dropzone({accept:'image/png,image/jpeg,image/webp',title:l?.fileId?'Заменить логотип':'Перетащите логотип сюда',hint:'PNG, JPG или WebP · или нажмите',compact:true,onFile:async f=>{const data=await prepareLogo(f);const r=await api('/api/files/logo',{method:'POST',body:JSON.stringify({target,id,data})});toast('Логотип сохранён');draw(r.logo);onChange?.(r.logo)}});wrap.append(z);
  if(l?.fileId){const b=document.createElement('button');b.type='button';b.className='btn btn-ghost btn-sm';b.textContent='Убрать логотип';b.onclick=async()=>{try{await api('/api/files/logo',{method:'POST',body:JSON.stringify({target,id,remove:true})});toast('Логотип убран');draw(null);onChange?.(null)}catch(e){toast(e.message,true)}};wrap.append(b)}};
 draw(logo);return wrap;
}

// ---------- Документы → «Наши организации» ----------
async function ourCompaniesView(box){
 const list=await api('/api/documents/legal-entities');const admin=can('settings');
 box.innerHTML=`<div class="files-head"><div><h2>Наши организации</h2><p class="muted">Реквизиты и логотипы подставляются в счета и договоры. Логотип перетащите прямо на карточку.</p></div>${admin?'<button class="btn btn-primary" id="le-add">+ Организация</button>':''}</div><div class="org-grid"></div>`;
 const grid=box.querySelector('.org-grid');
 if(!list.length)grid.innerHTML=empty('Организаций пока нет — добавьте реквизиты');
 for(const e of list){const card=document.createElement('article');card.className='org-card';card.innerHTML=`<div class="org-top"><div><h3>${esc(e.name||'Без названия')}</h3><p class="muted small">ИНН ${esc(e.inn||'—')}${e.kpp?' · КПП '+esc(e.kpp):''} · НДС ${Number(e.vatRate??22)}%</p><p class="muted small">${esc(e.address||'')}</p></div>${admin?`<button class="btn btn-light btn-sm" data-le-edit>Реквизиты</button>`:''}</div>`;
  if(admin)card.append(logoEditor('legalEntity',e.id,e.logo));else if(e.logo)card.insertAdjacentHTML('beforeend',`<div class="logo-preview">${logoImg(e.logo)}</div>`);
  card.querySelector('[data-le-edit]')?.addEventListener('click',()=>openLegalEntity(e));grid.append(card)}
 box.querySelector('#le-add')?.addEventListener('click',()=>openLegalEntity({}));
}

// ---------- Документы → «Шаблоны договоров» ----------
const tplTypes=[['contract','Договор'],['contract_invoice','Договор-счёт'],['invoice','Счёт на оплату']];
async function templatesView(box){
 const [list,groups]=await Promise.all([api('/api/templates'),api('/api/templates/fields')]);const manage=can('settings')||can('documents','all');
 box.innerHTML=`<div class="files-head"><div><h2>Свои шаблоны договоров</h2><p class="muted">Загрузите свой договор в Word — CRM будет сама подставлять реквизиты, технику и суммы из сделки.</p></div><a class="btn btn-light" href="/api/templates/sample" download>Скачать образец .docx</a></div>
 <ol class="tpl-steps"><li>Откройте свой договор в Word и вместо данных клиента вставьте поля, например <code>{{Клиент.Наименование}}</code> (список — ниже, нажмите на поле, чтобы скопировать).</li><li>Сохраните файл как <b>.docx</b> и перетащите его в рамку.</li><li>При выпуске договора из сделки выберите этот шаблон — получите готовый PDF и Word.</li></ol>
 <div id="tpl-drop"></div><div class="tpl-list"></div>
 <details class="tpl-fields" ${list.length?'':'open'}><summary>Поля для вставки в договор</summary>${groups.map(g=>`<div class="field-group"><h4>${esc(g.group)}</h4><div class="chips">${g.fields.map(f=>`<button type="button" class="chip" data-copy-field="${esc(f.code)}" title="${esc(f.label)}">${esc(f.code)}<small>${esc(f.label)}</small></button>`).join('')}</div></div>`).join('')}<p class="muted small">Строка таблицы, в которой есть поля <code>{{Строка.…}}</code>, повторится для каждой единицы техники или услуги.</p></details>`;
 if(manage)box.querySelector('#tpl-drop').append(dropzone({accept:'.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',title:'Перетащите договор Word (.docx) сюда',hint:'или нажмите, чтобы выбрать файл · до 10 МБ',onFile:async f=>{if(/\.doc$/i.test(f.name))throw new Error('Это старый формат .doc. Откройте файл в Word → «Сохранить как» → «Документ Word (*.docx)».');if(!/\.docx$/i.test(f.name))throw new Error('Нужен файл Word .docx');if(f.size>10*1024*1024)throw new Error('Файл больше 10 МБ');const data=await readAsDataUrl(f);const t=await api('/api/templates',{method:'POST',body:JSON.stringify({fileName:f.name,type:'contract',data})});toast(t.fields.length?`Шаблон загружен: найдено полей — ${t.fields.length}`:'Шаблон загружен, но полей {{…}} в нём не найдено');templatesView(box)}}));
 else box.querySelector('#tpl-drop').innerHTML='<p class="muted">Загружать шаблоны может руководитель.</p>';
 const tl=box.querySelector('.tpl-list');
 tl.innerHTML=list.length?list.map(t=>`<article class="tpl-card" data-tpl="${esc(t.id)}"><div class="tpl-icon">W</div><div class="tpl-main"><b>${esc(t.name)}</b>${t.isDefault?' <span class="badge badge-ok">По умолчанию</span>':''}<div class="muted small">${esc(t.typeName)} · ${esc(t.fileName)} · ${Math.max(1,Math.round(t.size/1024))} КБ · ${esc(typeof fmtDateTime==='function'?fmtDateTime(t.updatedAt):t.updatedAt)}</div><div class="small">${t.fields.length?`Полей: <b>${t.fields.length}</b>`:'<span class="warn-text">Полей {{…}} не найдено — документ выйдет без подстановки данных</span>'}${t.unknown.length?` · <span class="warn-text">Не распознаны: ${t.unknown.map(x=>esc('{{'+x+'}}')).join(', ')}</span>`:''}</div></div><div class="actions">${manage?`<select class="field" data-tpl-type>${tplTypes.map(([v,l])=>`<option value="${v}" ${t.type===v?'selected':''}>${l}</option>`).join('')}</select>${t.isDefault?'':'<button class="btn btn-light btn-sm" data-tpl-default>Сделать основным</button>'}<button class="btn btn-light btn-sm" data-tpl-rename>Переименовать</button>`:''}<a class="btn btn-light btn-sm" href="/api/templates/${encodeURIComponent(t.id)}/file" download>Скачать</a>${manage?'<button class="btn btn-ghost btn-sm" data-tpl-del>Удалить</button>':''}</div></article>`).join(''):'';
 const patch=async(id,b)=>{try{await api('/api/templates/'+id,{method:'PATCH',body:JSON.stringify(b)});templatesView(box)}catch(e){toast(e.message,true)}};
 tl.querySelectorAll('[data-tpl]').forEach(card=>{const id=card.dataset.tpl,t=list.find(x=>x.id===id);
  card.querySelector('[data-tpl-type]')?.addEventListener('change',e=>patch(id,{type:e.target.value}));
  card.querySelector('[data-tpl-default]')?.addEventListener('click',()=>patch(id,{isDefault:true}));
  card.querySelector('[data-tpl-rename]')?.addEventListener('click',()=>modal('Название шаблона',input('tpl-name','Название',t.name,'text',true),()=>api('/api/templates/'+id,{method:'PATCH',body:JSON.stringify({name:val('tpl-name')})})));
  card.querySelector('[data-tpl-del]')?.addEventListener('click',()=>modal('Удалить шаблон?','<p>Уже выпущенные договоры сохранятся. Новые по этому шаблону создать будет нельзя.</p>',()=>api('/api/templates/'+id,{method:'DELETE'}),'Удалить'));
  // Новая версия того же шаблона — перетащить файл прямо на карточку.
  if(manage){card.ondragover=e=>{e.preventDefault();card.classList.add('over')};card.ondragleave=()=>card.classList.remove('over');card.ondrop=async e=>{e.preventDefault();e.stopPropagation();card.classList.remove('over');const f=e.dataTransfer.files[0];if(!f)return;try{if(!/\.docx$/i.test(f.name))throw new Error('Нужен файл Word .docx');await api('/api/templates/'+id,{method:'PATCH',body:JSON.stringify({fileName:f.name,data:await readAsDataUrl(f)})});toast('Шаблон обновлён');templatesView(box)}catch(x){toast(x.message,true)}}}
 });
 box.querySelectorAll('[data-copy-field]').forEach(b=>b.onclick=()=>{navigator.clipboard?.writeText(b.dataset.copyField).then(()=>toast('Скопировано: '+b.dataset.copyField),()=>toast(b.dataset.copyField))});
}
