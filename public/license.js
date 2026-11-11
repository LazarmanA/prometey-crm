/* Подписка: строка-предупреждение для всех пользователей и вкладка «Администрирование → Подписка». */
async function mountLicenseBanner(){
 try{const l=await api('/api/license');const text=[l.banner,l.message].filter(Boolean).join(' · ');document.querySelector('.license-banner')?.remove();if(!l.enabled||!text)return;
  const page=document.getElementById('page');if(!page)return;
  const b=document.createElement('div');b.className='license-banner '+(l.readOnly?'bad':l.status==='grace'?'warn':'info');b.setAttribute('role','status');b.textContent=text;page.before(b);
 }catch{}
}
async function adminLicense(box){
 const l=await api('/api/admin/license');
 const cls={active:'badge-ok',trial:'badge-info',grace:'badge-warn',expired:'badge-bad',blocked:'badge-bad',off:'badge-muted'}[l.status]||'badge-muted';
 const date=v=>v?new Date(v).toLocaleDateString('ru-RU'):'—';
 box.innerHTML=`<div class="panel"><h3>Подписка ПРОМЕТЕЙ</h3>${!l.enabled?'<p class="muted">В этой сборке проверка подписки не включена — CRM работает без ограничений.</p>':`
 <dl class="ws-facts"><div><dt>Состояние</dt><dd><span class="badge ${cls}">${esc(l.statusText)}</span></dd></div><div><dt>${l.status==='trial'?'Пробный период до':'Оплачено до'}</dt><dd>${esc(date(l.until))}${l.daysLeft>0?` (осталось ${l.daysLeft} дн.)`:''}</dd></div>${l.companyName?`<div><dt>Компания в договоре</dt><dd>${esc(l.companyName)}</dd></div>`:''}${l.plan?`<div><dt>Тариф</dt><dd>${esc(l.plan)}${l.maxUsers?` · до ${l.maxUsers} пользователей`:''}</dd></div>`:''}<div><dt>Последняя проверка</dt><dd>${l.lastCheckAt?esc(new Date(l.lastCheckAt).toLocaleString('ru-RU')):'ещё не было'}</dd></div><div><dt>Номер установки</dt><dd><code>${esc(l.installId)}</code></dd></div></dl>
 ${l.banner?`<div class="code-note">${esc(l.banner)}</div>`:''}${l.message?`<div class="code-note"><b>Сообщение поставщика:</b> ${esc(l.message)}</div>`:''}${l.lastError?`<div class="code-note">Не удалось связаться с сервером подписки: ${esc(l.lastError)}. CRM продолжит работать по последнему подтверждённому сроку.</div>`:''}
 <div class="actions"><button class="btn btn-dark" id="lic-check">Проверить сейчас</button></div>
 <p class="muted small">Что передаётся поставщику: ${esc(l.sent)}</p>`}</div>`;
 box.querySelector('#lic-check')?.addEventListener('click',async e=>{e.target.disabled=true;try{await api('/api/admin/license/check',{method:'POST',body:'{}'});toast('Подписка проверена');mountLicenseBanner();adminLicense(box)}catch(x){toast(x.message,true);e.target.disabled=false}});
}
