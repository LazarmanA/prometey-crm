'use strict';
// Выбор подрядчика (поставщика) из всех компаний CRM: поиск по названию и ИНН, «Своя техника», «+ Новая компания-подрядчик».
// Новый подрядчик сразу сохраняется в «Компании». Возвращает {id, name, inn} поставщика или null (своя техника).
let cpOpen=null;
function cpLabel(v,own='Своя техника'){return v&&v.id?`<span class="cp-name">${esc(v.name||'Подрядчик')}</span>${v.inn?`<span class="cp-inn">ИНН ${esc(v.inn)}</span>`:''}`:`<span class="cp-own">${esc(own)}</span>`}
function contractorPicker(host,{value=null,onChange,disabled=false,own='Своя техника'}={}){
 let cur=value&&value.id?value:null;
 host.classList.add('cp');host.innerHTML=`<button type="button" class="cp-btn"${disabled?' disabled':''} aria-haspopup="listbox">${cpLabel(cur,own)}<span class="cp-caret">▾</span></button>`;
 const btn=host.querySelector('.cp-btn');
 const set=v=>{cur=v;btn.innerHTML=cpLabel(cur,own)+'<span class="cp-caret">▾</span>'};
 const close=()=>{cpOpen?.remove();cpOpen=null;document.removeEventListener('mousedown',outside,true)};
 const outside=e=>{if(cpOpen&&!cpOpen.contains(e.target)&&!host.contains(e.target))close()};
 const choose=async item=>{try{let v=null;if(item){const r=await api('/api/partners',{method:'POST',body:JSON.stringify(item.clientId?{clientId:item.clientId}:item.partnerId?{partnerId:item.partnerId}:item)});v={id:r.id,name:r.name,inn:r.inn||''}}close();set(v);await onChange?.(v)}catch(e){toast(e.message,true)}};
 btn.onclick=()=>{if(cpOpen){close();return}const pop=document.createElement('div');pop.className='cp-pop';cpOpen=pop;
  pop.innerHTML=`<input class="field cp-q" type="search" placeholder="Название или ИНН компании" autocomplete="off"><div class="cp-list" role="listbox"></div><div class="cp-foot"><button type="button" class="cp-opt cp-ownbtn">${esc(own)}</button><button type="button" class="cp-opt cp-newbtn">+ Новая компания-подрядчик</button></div>
   <form class="cp-new" hidden><b>Новый подрядчик</b><input class="field" name="name" placeholder="Название *" maxlength="200" required><div class="cp-new-row"><input class="field" name="inn" placeholder="ИНН" inputmode="numeric" maxlength="12"><button type="button" class="btn btn-light btn-sm cp-find">Найти по ИНН</button></div><input class="field" name="phone" placeholder="Телефон" maxlength="60"><div class="cp-new-row"><button type="submit" class="btn btn-primary btn-sm">Сохранить в «Компании» и выбрать</button><button type="button" class="btn btn-light btn-sm cp-back">Назад</button></div></form>`;
  document.body.append(pop);const r=btn.getBoundingClientRect(),w=Math.min(window.innerWidth-16,Math.max(400,r.width));pop.style.width=w+'px';pop.style.left=Math.max(8,Math.min(r.left,window.innerWidth-w-8))+'px';
  const below=window.innerHeight-r.bottom>360;pop.style.top=(below?r.bottom+4:Math.max(8,r.top-364))+'px';
  const q=pop.querySelector('.cp-q'),list=pop.querySelector('.cp-list');let timer=0,seq=0;
  const load=async()=>{const n=++seq;list.innerHTML='<p class="cp-msg">Загрузка…</p>';try{const res=await api('/api/contractors?q='+encodeURIComponent(q.value.trim()));if(n!==seq)return;
   list.innerHTML=res.items.length?res.items.map((x,i)=>`<button type="button" class="cp-opt${cur&&x.partnerId===cur.id?' on':''}" data-i="${i}"><span class="cp-name">${esc(x.name)}</span><span class="cp-inn">${x.inn?'ИНН '+esc(x.inn):'ИНН не указан'}</span>${x.contractor?'<span class="cp-tag">подрядчик</span>':''}</button>`).join('')+(res.total>res.items.length?`<p class="cp-msg">Показаны ${res.items.length} из ${res.total} — уточните поиск</p>`:''):'<p class="cp-msg">Ничего не найдено. Добавьте новую компанию-подрядчика.</p>';
   list.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>choose(res.items[+b.dataset.i]))}catch(e){list.innerHTML=`<p class="cp-msg">${esc(e.message)}</p>`}};
  q.oninput=()=>{clearTimeout(timer);timer=setTimeout(load,200)};q.onkeydown=e=>{if(e.key==='Escape')close();if(e.key==='Enter'){e.preventDefault();list.querySelector('[data-i]')?.click()}};
  pop.querySelector('.cp-ownbtn').onclick=()=>choose(null);
  const form=pop.querySelector('.cp-new');
  pop.querySelector('.cp-newbtn').onclick=()=>{form.hidden=false;pop.querySelector('.cp-foot').hidden=true;list.hidden=true;q.hidden=true;form.name.value=/\d{10}/.test(q.value)?'':q.value;form.inn.value=(q.value.match(/\d{10,12}/)||[''])[0];form.name.focus()};
  pop.querySelector('.cp-back').onclick=()=>{form.hidden=true;pop.querySelector('.cp-foot').hidden=false;list.hidden=false;q.hidden=false;q.focus()};
  pop.querySelector('.cp-find').onclick=async e=>{const inn=form.inn.value.replace(/\D/g,'');if(!/^\d{10}(\d{2})?$/.test(inn))return toast('ИНН — 10 или 12 цифр',true);e.target.disabled=true;try{const r=await api('/api/company/lookup',{method:'POST',body:JSON.stringify({kind:'inn',query:inn})});const x=r.company||r.result||r;if(x?.name||x?.shortName){form.name.value=x.shortName||x.name;form.dataset.kpp=x.kpp||'';form.dataset.address=x.address||'';if(x.phone&&!form.phone.value)form.phone.value=x.phone;toast('Нашли: '+form.name.value)}}catch(err){toast(err.message,true)}e.target.disabled=false};
  form.onsubmit=e=>{e.preventDefault();choose({name:form.name.value.trim(),inn:form.inn.value.replace(/\D/g,''),phone:form.phone.value.trim(),kpp:form.dataset.kpp||'',legalAddress:form.dataset.address||''})};
  setTimeout(()=>document.addEventListener('mousedown',outside,true));q.focus();load()};
 return {get:()=>cur,set};
}
