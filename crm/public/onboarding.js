/* Первая регистрация руководителя и регистрация сотрудников по ссылке-приглашению. */
function pwChecks(p,email){const kinds=[/[a-zа-яё]/,/[A-ZА-ЯЁ]/,/\d/,/[^\p{L}\p{N}]/u].filter(r=>r.test(p)).length;return [[p.length>=12,'не короче 12 символов'],[kinds>=3,'есть три вида: строчные, заглавные, цифры или знаки'],[!!p&&p.toLowerCase()!==String(email||'').toLowerCase(),'не совпадает с e-mail']]}
function onboardShell(title,lead,form){
 app.innerHTML=`<div class="login-shell"><section class="login-hero"><div class="brand-mark"><div class="brand-icon">P</div><span>ПРОМЕТЕЙ</span></div><div class="hero-copy"><h1>Управляй техникой.<br>Контролируй прибыль.</h1><p>Отраслевая CRM для аренды и субаренды спецтехники.</p></div><div class="muted">ПРОМЕТЕЙ CRM</div></section>
 <section class="login-side"><div class="login-card"><div class="brand-mark login-card-brand"><div class="brand-icon">P</div><span>ПРОМЕТЕЙ</span></div><h2>${title}</h2><div class="muted">${lead}</div>${form}</div></section></div>`;
}
function personFields(withCompany){return `${withCompany?`<label for="ob-company">Компания</label><input class="field" id="ob-company" maxlength="120" placeholder="ООО «Ваша компания»" autocomplete="organization">`:''}
 <label for="ob-name">Имя и фамилия</label><input class="field" id="ob-name" maxlength="120" required autocomplete="name">
 <label for="ob-email">E-mail — это ваш логин</label><input class="field" id="ob-email" type="email" maxlength="320" required autocomplete="email">
 <label for="ob-phone">Телефон <span class="muted small">(необязательно)</span></label><input class="field" id="ob-phone" type="tel" maxlength="40" autocomplete="tel">
 <label for="ob-pass">Придумайте пароль</label><div class="pass-wrap"><input class="field" type="password" id="ob-pass" required autocomplete="new-password"><button type="button" class="pass-eye" id="ob-eye" aria-label="Показать пароль" title="Показать пароль">👁</button></div>
 <ul class="pw-checks" id="ob-checks"></ul>`}
function wirePerson(){const pass=document.getElementById('ob-pass'),email=document.getElementById('ob-email'),list=document.getElementById('ob-checks');
 const draw=()=>{const layout=/[а-яё]/i.test(pass.value)?'<li class="bad">в пароле русские буквы — проверьте раскладку</li>':'';list.innerHTML=layout+pwChecks(pass.value,email.value).map(([ok,t])=>`<li class="${ok?'ok':''}">${t}</li>`).join('')};
 pass.addEventListener('input',draw);email.addEventListener('input',draw);draw();
 document.getElementById('ob-eye').onclick=()=>{pass.type=pass.type==='password'?'text':'password';pass.focus()}}
const personBody=()=>({name:val('ob-name').trim(),email:val('ob-email').trim(),phone:val('ob-phone').trim(),password:document.getElementById('ob-pass').value});
async function afterRegister(r){token='';me=r.user;history.replaceState(null,'',location.pathname);window.__justRegistered=true;window.__recoveryCode=r.recoveryCode||'';renderApp()}

// Новая установка: первый член команды создаёт учётную запись руководителя.
function renderSetup(info={}){
 if(!info.reset&&typeof renderOrgWizard==='function')return renderOrgWizard(info);
 const params=new URLSearchParams(location.hash.slice(1)),setupToken=params.get('setup')||'';
 onboardShell(info.reset?'Восстановление доступа':'Добро пожаловать!',info.reset?'Укажите e-mail и новый пароль руководителя. Все данные CRM сохранятся.':'Создайте свою учётную запись — вы станете руководителем в CRM. Коллег пригласите потом по ссылке.',`<form id="ob-form" autocomplete="on">${personFields(!info.reset)}
  ${info.demo?`<label class="small ob-demo"><input type="checkbox" id="ob-clear" checked> Начать с чистой базы — убрать примеры (демо-компании, сделки, технику)</label>`:''}
  <button class="btn btn-primary w100 login-submit" id="ob-go">${info.reset?'Сохранить и войти':'Начать работу'}</button></form><p class="small"><a href="#" id="login-policy">Политика обработки персональных данных</a></p>`);
 const co=document.getElementById('ob-company');if(co&&info.company)co.value=info.company==='ПРОМЕТЕЙ'?'':info.company;if(info.name)document.getElementById('ob-name').value=info.name;
 wirePerson();document.getElementById('login-policy').onclick=e=>{e.preventDefault();if(typeof showPolicy==='function')showPolicy()};
 document.getElementById('ob-form').onsubmit=async e=>{e.preventDefault();const b=document.getElementById('ob-go');b.disabled=true;
  try{await afterRegister(await api('/api/setup',{method:'POST',body:JSON.stringify({...personBody(),company:document.getElementById('ob-company')?.value.trim()||'',clearDemo:document.getElementById('ob-clear')?.checked!==false,token:setupToken})}))}
  catch(err){toast(err.message,true);if(/уже создана/.test(err.message))setTimeout(renderLogin,1500)}finally{b.disabled=false}};
}

// Сотрудник открыл ссылку-приглашение.
async function renderInvite(inviteToken){
 let info;try{info=await (await fetch('/api/invite/'+encodeURIComponent(inviteToken))).json()}catch{info={error:'CRM не отвечает'}}
 if(!info||info.error){onboardShell('Ссылка не работает',esc(info?.error||'Приглашение недействительно'),`<button class="btn btn-primary w100 login-submit" id="ob-login">Перейти ко входу</button>`);document.getElementById('ob-login').onclick=()=>{history.replaceState(null,'',location.pathname);renderLogin()};return}
 onboardShell(`Вас приглашают в ${esc(info.company)}`,`${info.author?esc(info.author)+' приглашает вас':'Вас приглашают'} в CRM${info.roleName?` · роль: <b>${esc(info.roleName)}</b>`:''}${info.department?` · ${esc(info.department)}`:''}. Заполните поля — и сразу начнёте работу.`,
  `<form id="ob-form" autocomplete="on">${personFields(false)}<button class="btn btn-primary w100 login-submit" id="ob-go">Зарегистрироваться</button></form><p class="small">Уже есть учётная запись? <a href="#" id="ob-have">Войти</a> · <a href="#" id="login-policy">Политика обработки ПДн</a></p>`);
 wirePerson();
 document.getElementById('ob-have').onclick=e=>{e.preventDefault();history.replaceState(null,'',location.pathname);renderLogin()};
 document.getElementById('login-policy').onclick=e=>{e.preventDefault();if(typeof showPolicy==='function')showPolicy()};
 document.getElementById('ob-form').onsubmit=async e=>{e.preventDefault();const b=document.getElementById('ob-go');b.disabled=true;
  try{await afterRegister(await api('/api/invite/'+encodeURIComponent(inviteToken),{method:'POST',body:JSON.stringify(personBody())}))}catch(err){toast(err.message,true)}finally{b.disabled=false}};
}

// Запуск: приглашение → первая регистрация → вход.
async function startOnboardingOrLogin(){
 const params=new URLSearchParams(location.hash.slice(1));
 if(params.get('invite'))return renderInvite(params.get('invite'));
 if(params.get('reset'))return renderReset(params.get('reset'));
 try{const s=await (await fetch('/api/setup')).json();if(s.needed)return renderSetup(s)}catch{}
 renderLogin();
}

// ---------- Администрирование: приглашения ----------
const copyText=async t=>{try{await navigator.clipboard.writeText(t);toast('Ссылка скопирована')}catch{const ta=document.createElement('textarea');ta.value=t;document.body.append(ta);ta.select();try{document.execCommand('copy');toast('Ссылка скопирована')}catch{toast('Скопируйте ссылку вручную',true)}ta.remove()}};
function inviteLink(r){return r.url||(location.origin+'/'+(r.link||''))}
async function inviteDialog(){
 const info=await api('/api/admin/invites');
 const roles=info.roles.map(r=>[r.id,r.name]),def=info.roles.some(r=>r.id==='manager')?'manager':info.roles[0]?.id;
 modal('Пригласить сотрудника',`<p>Создайте ссылку и отправьте её сотруднику в WhatsApp, Telegram или по почте. Он откроет её, сам укажет имя, e-mail и пароль — и сразу начнёт работу.</p>
  <div class="form-grid">${select('inv-role','Роль',roles,def)}${select('inv-dep','Отдел',[['','—'],...info.departments.map(d=>[d.id,d.name])],'')}${input('inv-pos','Должность (необязательно)','')}${select('inv-multi','Ссылка для',[['0','одного человека'],['1','нескольких человек (7 дней)']],'0')}</div>
  ${info.networkOff?`<div class="code-note">Сейчас CRM открывается только на этом компьютере — по ссылке коллеги не зайдут. Включите доступ из офисной сети: «Администрирование → Сервер».</div>`:''}`,
 async()=>{const r=await api('/api/admin/invites',{method:'POST',body:JSON.stringify({role:val('inv-role'),departmentId:val('inv-dep'),position:val('inv-pos'),multi:val('inv-multi')==='1'})});setTimeout(()=>showInvite(r,info),60)},'Создать ссылку');
}
function showInvite(r,info={}){const link=inviteLink(r);
 sheet('Ссылка-приглашение готова',`<p>Отправьте эту ссылку сотруднику${r.multi?' (или нескольким)':''}. Роль: <b>${esc(r.roleName)}</b>. Действует до ${esc(new Date(r.expiresAt).toLocaleDateString('ru-RU'))}${r.multi?'':', один раз'}.</p><div class="invite-link" id="inv-link">${esc(link)}</div>
  ${info.networkOff||!r.url?`<p class="code-note">Ссылка ведёт на этот компьютер. Чтобы коллеги в офисе могли её открыть, включите «Администрирование → Сервер → Доступ из офисной сети».</p>`:''}`,
  [{text:'Скопировать ссылку',cls:'btn-primary',close:false,onClick:()=>copyText(link)},{text:'Готово',cls:'btn-light',onClick:()=>{if(current==='admin')renderPage()}}]);
}
async function adminInvites(box){
 let info;try{info=await api('/api/admin/invites')}catch{return}
 box.innerHTML=`<div class="panel invite-panel"><div class="invite-head"><div><b>Пригласить сотрудника по ссылке</b><div class="muted small">Сотрудник сам укажет имя, e-mail и пароль. Пароли передавать не нужно.</div></div><button class="btn btn-primary" data-invite-new>Создать ссылку</button></div>
 ${info.networkOff?`<div class="code-note">CRM сейчас открывается только на этом компьютере — включите «Доступ из офисной сети» во вкладке «Сервер», иначе коллеги не смогут перейти по ссылке.</div>`:''}
 ${info.invites.length?`<div class="table-wrap"><table class="table compact"><thead><tr><th>Ссылка</th><th>Роль</th><th>Действует до</th><th>Зарегистрировались</th><th></th></tr></thead><tbody>${info.invites.map(x=>`<tr><td>${x.multi?'Для нескольких':'Для одного'}${x.position?` · ${esc(x.position)}`:''}<div class="muted small">создал ${esc(x.author)}, ${esc(fmtDateTime(x.createdAt))}</div></td><td>${esc(x.roleName)}${x.department?`<div class="muted small">${esc(x.department)}</div>`:''}</td><td class="small">${esc(new Date(x.expiresAt).toLocaleDateString('ru-RU'))}</td><td class="small">${esc(x.used.join(', ')||'—')}</td><td><div class="actions">${x.url?`<button class="btn btn-light btn-sm" data-invite-copy="${esc(x.url)}">Скопировать</button>`:''}<button class="btn btn-ghost btn-sm" data-invite-revoke="${esc(x.id)}">Отозвать</button></div></td></tr>`).join('')}</tbody></table></div>`:''}</div>`;
 box.querySelector('[data-invite-new]').onclick=()=>inviteDialog().catch(e=>toast(e.message,true));
 box.querySelectorAll('[data-invite-copy]').forEach(b=>b.onclick=()=>copyText(b.dataset.inviteCopy));
 box.querySelectorAll('[data-invite-revoke]').forEach(b=>b.onclick=async()=>{try{await api('/api/admin/invites/'+b.dataset.inviteRevoke,{method:'DELETE'});toast('Ссылка отозвана');renderPage()}catch(e){toast(e.message,true)}});
}
// После первой регистрации руководителя — сразу предложить пригласить команду.
function welcomeOwner(){if(window.__recoveryCode){const c=window.__recoveryCode;window.__recoveryCode='';return showRecoveryCode(c,()=>setTimeout(welcomeOwner,60))}
 if(window.__orgSetup&&window.__justRegistered&&can('settings')){window.__justRegistered=false;adminTab='company';current='admin';renderApp();return}
 if(!window.__justRegistered||!can('users'))return;window.__justRegistered=false;
 sheet('Готово! Пригласите команду',`<p>Ваша CRM работает. Теперь пригласите коллег: создайте ссылку и отправьте её в WhatsApp, Telegram или по почте — каждый сам зарегистрируется.</p>`,[{text:'Пригласить сотрудника',cls:'btn-primary',onClick:()=>setTimeout(()=>inviteDialog().catch(e=>toast(e.message,true)),60)},{text:'Позже',cls:'btn-light',onClick:()=>{}}])}

// ---------- Восстановление пароля ----------
// Код восстановления показывается один раз — после регистрации, восстановления или смены в профиле.
function showRecoveryCode(code,then){
 const done=()=>{if(typeof then==='function')then()};
 sheet('Ваш код восстановления',`<p>Если забудете пароль, войти можно будет по этому коду: «Забыли пароль?» на странице входа.</p><div class="invite-link recovery-code" id="rc-code">${esc(code)}</div><p class="muted small">Запишите его или сохраните файлом и держите отдельно от пароля. Код показывается только сейчас. После использования выдаётся новый.</p>`,
  [{text:'Скопировать',cls:'btn-light',close:false,onClick:()=>copyText(code)},
   {text:'Сохранить файлом',cls:'btn-light',close:false,onClick:()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([`ПРОМЕТЕЙ CRM — код восстановления\r\n${me?.email||''}\r\n\r\n${code}\r\n\r\nВход без пароля: страница входа → «Забыли пароль?» → «У меня есть код».\r\n`],{type:'text/plain'}));a.download='prometey-kod-vosstanovleniya.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}},
   {text:'Я сохранил код',cls:'btn-primary',onClick:done}]);
}
function renderForgot(mode='code'){
 onboardShell('Забыли пароль?',mode==='code'?'Введите e-mail, код восстановления (выдаётся при регистрации) и новый пароль.':'Нет кода? Руководитель пришлёт вам ссылку для нового пароля.',
 `<div class="segmented forgot-tabs"><button type="button" data-fg="code" class="${mode==='code'?'active':''}">У меня есть код</button><button type="button" data-fg="ask" class="${mode==='ask'?'active':''}">Попросить руководителя</button></div>
 ${mode==='code'?`<form id="fg-form"><label for="ob-email">E-mail</label><input class="field" id="ob-email" type="email" required autocomplete="username">
  <label for="fg-code">Код восстановления</label><input class="field" id="fg-code" required autocomplete="off" placeholder="XXXX-XXXX-XXXX-XXXX" style="text-transform:uppercase;font-family:Consolas,monospace">
  <label for="ob-pass">Новый пароль</label><div class="pass-wrap"><input class="field" type="password" id="ob-pass" required autocomplete="new-password"><button type="button" class="pass-eye" id="ob-eye" aria-label="Показать пароль">👁</button></div><ul class="pw-checks" id="ob-checks"></ul>
  <button class="btn btn-primary w100 login-submit" id="fg-go">Задать пароль и войти</button></form>`
 :`<form id="fg-form"><label for="ob-email">Ваш e-mail (логин)</label><input class="field" id="ob-email" type="email" required autocomplete="username">
  <button class="btn btn-primary w100 login-submit" id="fg-go">Отправить запрос руководителю</button></form><p class="muted small">Руководитель увидит запрос в «Администрирование → Сотрудники» и пришлёт ссылку. Можно и просто написать ему.</p>`}
 <p class="small"><a href="#" id="fg-back">← Вернуться ко входу</a></p>`);
 document.querySelectorAll('[data-fg]').forEach(b=>b.onclick=()=>renderForgot(b.dataset.fg));
 document.getElementById('fg-back').onclick=e=>{e.preventDefault();renderLogin()};
 if(mode==='code')wirePerson();
 document.getElementById('fg-form').onsubmit=async e=>{e.preventDefault();const b=document.getElementById('fg-go');b.disabled=true;
  try{
   if(mode==='code'){const r=await api('/api/password/recover',{method:'POST',body:JSON.stringify({email:val('ob-email').trim(),code:val('fg-code'),password:document.getElementById('ob-pass').value})});await afterRegister(r)}
   else{const r=await api('/api/password/request',{method:'POST',body:JSON.stringify({email:val('ob-email').trim()})});onboardShell('Запрос отправлен',esc(r.message),`<button class="btn btn-primary w100 login-submit" id="fg-ok">Ко входу</button>`);document.getElementById('fg-ok').onclick=()=>renderLogin()}
  }catch(err){toast(err.message,true)}finally{b.disabled=false}};
}
// Открыта ссылка «новый пароль» от руководителя
async function renderReset(resetToken){
 let info;try{const r=await fetch('/api/password/reset/'+encodeURIComponent(resetToken));info=await r.json()}catch{info={error:'CRM не отвечает'}}
 if(!info||info.error){onboardShell('Ссылка не работает',esc(info?.error||'Ссылка недействительна'),`<button class="btn btn-primary w100 login-submit" id="ob-login">Ко входу</button>`);document.getElementById('ob-login').onclick=()=>{history.replaceState(null,'',location.pathname);renderLogin()};return}
 onboardShell(info.welcome?`Добро пожаловать в ${esc(info.company)}`:'Новый пароль',info.welcome?`${esc(info.name)}, для вас создана учётная запись. Ваш логин — ${esc(info.email)}. Придумайте пароль — и сразу начнёте работу.`:`${esc(info.name)} · ${esc(info.email)}. Придумайте новый пароль.`,`<form id="fg-form"><input type="hidden" id="ob-email" value="${esc(info.email)}">
  <label for="ob-pass">Новый пароль</label><div class="pass-wrap"><input class="field" type="password" id="ob-pass" required autocomplete="new-password"><button type="button" class="pass-eye" id="ob-eye" aria-label="Показать пароль">👁</button></div><ul class="pw-checks" id="ob-checks"></ul>
  <button class="btn btn-primary w100 login-submit" id="fg-go">Сохранить и войти</button></form>`);
 wirePerson();
 document.getElementById('fg-form').onsubmit=async e=>{e.preventDefault();const b=document.getElementById('fg-go');b.disabled=true;try{await afterRegister(await api('/api/password/reset/'+encodeURIComponent(resetToken),{method:'POST',body:JSON.stringify({password:document.getElementById('ob-pass').value})}))}catch(err){toast(err.message,true)}finally{b.disabled=false}};
}
// Руководитель: ссылка для нового пароля сотрудника
async function resetLinkFor(userId){
 const r=await api(`/api/admin/users/${encodeURIComponent(userId)}/reset-link`,{method:'POST',body:'{}'});const link=r.url||(location.origin+'/'+r.link);
 sheet('Ссылка для нового пароля',`<p>Отправьте ссылку сотруднику <b>${esc(r.name)}</b> в мессенджер. По ней он сам задаст новый пароль. Действует 24 часа, один раз.</p><div class="invite-link">${esc(link)}</div>${r.networkOff||!r.url?'<p class="code-note">Ссылка ведёт на этот компьютер — коллеги откроют её только если включён доступ из офисной сети.</p>':''}`,
  [{text:'Скопировать ссылку',cls:'btn-primary',close:false,onClick:()=>copyText(link)},{text:'Готово',cls:'btn-light',onClick:()=>{if(current==='admin')renderPage()}}]);
}
async function adminPasswordRequests(box){
 let list=[];try{list=await api('/api/admin/password-requests')}catch{return}
 if(!list.length){box.remove();return}
 box.innerHTML=`<div class="panel invite-panel" style="border-color:#f0a36d"><b>Просят новый пароль</b>${list.map(x=>`<div class="invite-head"><div>${esc(x.name)} <span class="muted small">${esc(x.email)} · ${esc(fmtDateTime(x.at))}</span></div><button class="btn btn-primary btn-sm" data-reset-for="${esc(x.userId)}">Создать ссылку</button></div>`).join('')}</div>`;
 box.querySelectorAll('[data-reset-for]').forEach(b=>b.onclick=()=>resetLinkFor(b.dataset.resetFor).catch(e=>toast(e.message,true)));
}
