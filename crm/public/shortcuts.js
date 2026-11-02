/* ПРОМЕТЕЙ CRM — быстрая работа: адреса разделов, кнопки «Назад/Вперёд», горячие клавиши.
   Подключается после app.js и использует его глобальные current, me, renderApp, renderPage. */
(function(){
 const PAGES=[...navItems.map(n=>n[0]),'about'];
 const allowed=page=>PAGES.includes(page)&&(typeof me==='undefined'||!me||pageAllowed(page));
 const fromHash=()=>decodeURIComponent(String(location.hash||'').replace(/^#\/?/,''));

 // 1. Раздел в адресной строке: обновление страницы и ссылки открывают тот же раздел.
 const initial=fromHash();if(PAGES.includes(initial))current=initial;
 const originalRenderPage=renderPage;
 renderPage=async function(){
  if(typeof me!=='undefined'&&me&&!allowed(current)&&current!=='search')current=homePage();
  if(current!=='search'&&fromHash()!==current){try{history[location.hash?'pushState':'replaceState'](null,'','#/'+current)}catch{}}
  return originalRenderPage.apply(this,arguments);
 };
 window.addEventListener('popstate',()=>{const page=fromHash();if(!me||!allowed(page)||page===current)return;current=page;if(typeof workspaceSelection!=='undefined')workspaceSelection=null;closeModalIfAny();renderApp()});

 // 2. Горячие клавиши.
 const SHORTCUTS=[
  ['/ или Ctrl+K','Поиск по компаниям и сделкам'],
  ['N','Создать запись в текущем разделе'],
  ['Alt+1 … Alt+9','Перейти к разделу меню по порядку'],
  ['Ctrl+Enter','Сохранить открытую форму'],
  ['Esc','Закрыть форму или окно'],
  ['?','Показать эту подсказку']
 ];
 const typing=t=>!!t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
 const modalOpen=()=>!!document.querySelector('#modal-root .modal, .shortcut-help');
 function closeModalIfAny(){document.querySelector('.shortcut-help')?.remove();const c=document.querySelector('#modal-root .modal .cancel');if(c)c.click()}
 function showHelp(){
  if(document.querySelector('.shortcut-help'))return;
  const previous=document.activeElement;
  const box=document.createElement('div');box.className='modal-backdrop shortcut-help';
  box.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="shortcut-title"><div class="modal-head"><h3 id="shortcut-title">Горячие клавиши</h3><button type="button" class="close-btn" aria-label="Закрыть">×</button></div><div class="modal-body"><table class="table shortcut-table"><tbody>${SHORTCUTS.map(([k,v])=>`<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')}</tbody></table></div></div>`;
  const close=()=>{box.remove();if(previous?.isConnected)previous.focus()};
  box.querySelector('.close-btn').onclick=close;box.onclick=e=>{if(e.target===box)close()};
  box.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}};
  document.body.appendChild(box);box.querySelector('.close-btn').focus();
 }
 window.showShortcutHelp=showHelp;
 document.addEventListener('keydown',e=>{
  if(!me||document.getElementById('prometey-intro'))return;
  const t=e.target;
  // Ctrl/Cmd+Enter — сохранить форму в модальном окне.
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){const f=t?.closest?.('#modal-root form.modal');if(f){e.preventDefault();f.requestSubmit?f.requestSubmit():f.querySelector('.save,[type=submit]')?.click()}return}
  // Ctrl/Cmd+K — поиск (работает и из полей ввода).
  if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.code==='KeyK'){e.preventDefault();focusSearch();return}
  if(typing(t)||modalOpen())return;
  if(e.altKey&&!e.ctrlKey&&!e.metaKey&&/^Digit[1-9]$/.test(e.code)){const buttons=[...document.querySelectorAll('.nav [data-page]')];const b=buttons[Number(e.code.slice(5))-1];if(b){e.preventDefault();b.click()}return}
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='/'||e.code==='Slash'&&!e.shiftKey){e.preventDefault();focusSearch();return}
  if(e.key==='?'||e.code==='Slash'&&e.shiftKey){e.preventDefault();showHelp();return}
  if(e.code==='KeyN'&&!e.shiftKey){const b=[...document.querySelectorAll('#page .page-head .btn-primary')].find(x=>!x.disabled&&x.offsetParent!==null);if(b){e.preventDefault();b.click()}}
 });
 function focusSearch(){const q=document.getElementById('global-query');if(q){q.focus();q.select()}}

 // 3. Кнопка-подсказка в верхней панели (добавляется при каждой отрисовке оболочки).
 const originalRenderApp=renderApp;
 renderApp=function(){const r=originalRenderApp.apply(this,arguments);const bar=document.querySelector('.topbar');if(bar&&!bar.querySelector('.shortcut-btn')){const b=document.createElement('button');b.type='button';b.className='btn btn-ghost btn-sm shortcut-btn';b.title='Горячие клавиши (?)';b.setAttribute('aria-label','Горячие клавиши');b.textContent='⌨';b.onclick=showHelp;bar.appendChild(b)}const q=document.getElementById('global-query');if(q&&!q.placeholder)q.placeholder='Поиск ( / )';return r};
})();
