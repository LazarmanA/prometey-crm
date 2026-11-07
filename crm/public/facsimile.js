/* Факсимиле: подпись и печать для каждой нашей организации.
   Фото или скан на белой бумаге → фон становится прозрачным, края обрезаются, картинка уменьшается.
   Используется в «Документы → Наши организации» и «Администрирование → Компания». */

// Очистка: бумага → прозрачно, чернила сохраняют цвет. Если у картинки уже есть прозрачность — только обрезка.
async function cleanFacsimile(file,kind,{removeBg=true}={}){
 if(!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type))throw new Error('Нужна картинка: фото или скан (PNG, JPG)');
 if(file.size>25*1024*1024)throw new Error('Картинка слишком большая (больше 25 МБ)');
 const bmp=await createImageBitmap(file);const max=kind==='stamp'?900:1400,k=Math.min(1,max/Math.max(bmp.width,bmp.height));
 const W=Math.max(1,Math.round(bmp.width*k)),H=Math.max(1,Math.round(bmp.height*k));
 const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(bmp,0,0,W,H);
 const img=g.getImageData(0,0,W,H),a=img.data,n=W*H;
 let transparent=0;for(let i=3;i<a.length;i+=4)if(a[i]<250)transparent++;
 if(removeBg&&transparent<n*0.02){
  // яркость бумаги — по краям картинки (светлая четверть)
  const lum=i=>0.299*a[i]+0.587*a[i+1]+0.114*a[i+2],edge=[];const step=Math.max(1,Math.floor(Math.min(W,H)/200));
  for(let x=0;x<W;x+=step){edge.push(lum(x*4),lum(((H-1)*W+x)*4))}for(let y=0;y<H;y+=step){edge.push(lum(y*W*4),lum((y*W+W-1)*4))}
  edge.sort((p,q)=>p-q);const bg=Math.max(150,edge[Math.floor(edge.length*0.75)]||255);
  const lo=bg-18,span=Math.max(40,bg*0.42);
  for(let p=0;p<n;p++){const i=p*4,l=lum(i);let al=(lo-l)/span;al=al<=0?0:al>=1?1:al;
   if(al===0){a[i+3]=0;continue}
   // «снимаем» бумагу с полупрозрачных краёв, чтобы цвет чернил не бледнел
   for(let ch=0;ch<3;ch++)a[i+ch]=Math.max(0,Math.min(255,Math.round((a[i+ch]-(1-al)*bg)/al)));a[i+3]=Math.round(al*255)}
 }
 // обрезка по содержимому
 let x0=W,y0=H,x1=-1,y1=-1;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(a[(y*W+x)*4+3]>24){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}
 if(x1<0)throw new Error('На картинке не видно подписи или печати — снимите крупнее, на белом листе');
 g.putImageData(img,0,0);const pad=Math.round(Math.max(W,H)*0.015)+2;x0=Math.max(0,x0-pad);y0=Math.max(0,y0-pad);x1=Math.min(W-1,x1+pad);y1=Math.min(H-1,y1+pad);
 const out=document.createElement('canvas');out.width=x1-x0+1;out.height=y1-y0+1;out.getContext('2d').drawImage(c,x0,y0,out.width,out.height,0,0,out.width,out.height);
 let url=out.toDataURL('image/png');
 if(url.length>1.9*1024*1024){const s=Math.sqrt(1.6*1024*1024/url.length),r=document.createElement('canvas');r.width=Math.round(out.width*s);r.height=Math.round(out.height*s);r.getContext('2d').drawImage(out,0,0,r.width,r.height);url=r.toDataURL('image/png')}
 return url;
}

// Блок «Подпись и печать» для одной организации. entity: {id,name,signatoryName,signatoryPosition,signatureImage,stampImage}
function facsimileEditor(entity,{onChange}={}){
 const wrap=document.createElement('div');wrap.className='fax';let e={...entity};
 const fio=s=>{const p=String(s||'').trim().split(/\s+/);return p.length>1?p[0]+' '+p.slice(1).map(x=>x[0]+'.').join(''):(s||'Фамилия И.О.')};
 const slot=(kind,title,hint)=>{const ref=kind==='signature'?e.signatureImage:e.stampImage;return `<div class="fax-slot" data-slot="${kind}"><div class="fax-head"><b>${title}</b>${ref?'<span class="fax-ok">✓ загружена</span>':''}</div><div class="fax-pic${ref?'':' empty'}">${ref?`<img src="${esc(logoUrl(ref))}" alt="${title}">`:`<span>${hint}</span>`}</div><div class="actions"><button type="button" class="btn ${ref?'btn-light':'btn-primary'} btn-sm" data-fax-pick="${kind}">${ref?'Заменить':'Загрузить'}</button>${ref?`<button type="button" class="btn btn-ghost btn-sm" data-fax-del="${kind}">Убрать</button>`:''}</div></div>`};
 const draw=()=>{
  const sig=e.signatureImage?`<img class="fax-s-sig" src="${esc(logoUrl(e.signatureImage))}" alt="">`:'<span class="fax-s-line"></span>',st=e.stampImage?`<img class="fax-s-stamp" src="${esc(logoUrl(e.stampImage))}" alt="">`:'';
  wrap.innerHTML=`<div class="fax-slots">${slot('signature','Подпись','Распишитесь синей ручкой на белом листе и сфотографируйте')}${slot('stamp','Печать','Поставьте печать на белый лист и сфотографируйте или отсканируйте')}</div>
  <label class="fax-clean"><input type="checkbox" id="fax-clean-${esc(e.id)}" checked> Убрать белый фон и обрезать края автоматически</label>
  <div class="fax-sample" aria-label="Так будет в счёте"><div class="fax-sample-cap">Так будет в счёте и договоре</div><div class="fax-sample-row"><span>${esc(e.signatoryPosition||'Генеральный директор')}</span><span class="fax-s-place">${sig}${st}</span><span>/ ${esc(fio(e.signatoryName))}</span></div></div>
  <input type="file" accept="image/png,image/jpeg,image/webp" hidden>`;
  const file=wrap.querySelector('input[type=file]');let kind='';
  wrap.querySelectorAll('[data-fax-pick]').forEach(b=>b.onclick=()=>{kind=b.dataset.faxPick;file.click()});
  file.onchange=async()=>{const f=file.files[0];file.value='';if(f)await upload(kind,f)};
  wrap.querySelectorAll('[data-fax-del]').forEach(b=>b.onclick=async()=>{try{await api('/api/files/logo',{method:'POST',body:JSON.stringify({target:'legalEntity',id:e.id,kind:b.dataset.faxDel,remove:true})});e[b.dataset.faxDel==='signature'?'signatureImage':'stampImage']=null;toast(b.dataset.faxDel==='signature'?'Подпись убрана':'Печать убрана');draw();onChange?.(e)}catch(err){toast(err.message,true)}});
  // перетаскивание картинки прямо на ячейку
  wrap.querySelectorAll('.fax-slot').forEach(s=>{s.ondragover=ev=>{ev.preventDefault();s.classList.add('drag')};s.ondragleave=()=>s.classList.remove('drag');s.ondrop=async ev=>{ev.preventDefault();s.classList.remove('drag');const f=ev.dataTransfer.files[0];if(f)await upload(s.dataset.slot,f)}});
 };
 async function upload(kind,f){
  const pic=wrap.querySelector(`[data-slot="${kind}"] .fax-pic`);pic?.classList.add('busy');
  try{const removeBg=wrap.querySelector('.fax-clean input')?.checked!==false;const data=await cleanFacsimile(f,kind,{removeBg});
   const r=await api('/api/files/logo',{method:'POST',body:JSON.stringify({target:'legalEntity',id:e.id,kind,data})});
   const field=kind==='signature'?'signatureImage':'stampImage';e[field]=r[field];toast((kind==='signature'?'Подпись':'Печать')+' сохранена — появится в новых документах');draw();onChange?.(e)}
  catch(err){toast(err.message,true);pic?.classList.remove('busy')}
 }
 draw();return wrap;
}
