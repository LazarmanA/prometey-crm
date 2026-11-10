'use strict';
// КП — коммерческое предложение: строки техники со ставкой за час / смену / рейс, условия, подпись и печать.
// Файл — PDF (как на экране) или Word (.docx), по желанию.
const crypto=require('node:crypto');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {writeZip}=require('./zip');

const UNITS={hour:'час',shift:'смена',trip:'рейс',machine_hour:'маш.-час',day:'сутки',km:'км',ton:'тонна',m3:'м³',unit:'ед.'};
const PER={hour:'за час',shift:'за смену',trip:'за рейс',machine_hour:'за маш.-час',day:'за сутки',km:'за км',ton:'за тонну',m3:'за м³',unit:'за ед.'};
const DEFAULT_INTRO='Благодарим за интерес к нашей компании. Предлагаем услуги спецтехники с экипажем на следующих условиях:';
const DEFAULT_TERMS=['Смена — 8 часов работы + 1 час на подачу техники.','Минимальный заказ — 1 смена (для почасовой техники — 4 часа).','Доставка техники на объект — по согласованию.','Оплата: 100% предоплата или по договору.','ГСМ и работа оператора включены в стоимость.'].join('\n');
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e};
const str=(v,max=500)=>String(v??'').trim().slice(0,max);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>{const s=str(v,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))?s:''};
const ru=s=>s?s.split('-').reverse().join('.'):'';
const money=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(n)||0).replace(/ /g,' ')+' ₽';
const todayLocal=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const plusDays=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const short=n=>{const p=String(n||'').trim().split(/\s+/);return p.length>1?p[0]+' '+p.slice(1).map(x=>x[0]+'.').join(''):(n||'')};

function createProposals({Access,files,Docx,renderPdf}){
 const perms=(d,u)=>Access.perms(d,u);
 const canAny=(d,u)=>Access.at(perms(d,u),'documents','own');
 const canAll=(d,u)=>Access.at(perms(d,u),'documents','all');
 const list=d=>(d.proposals||=[]);
 const visible=(d,u)=>list(d).filter(p=>!p.deletedAt&&(canAll(d,u)||p.managerId===u.id));
 const find=(d,u,id)=>{if(!canAny(d,u))fail('Нет доступа к КП',403);const p=visible(d,u).find(p=>p.id===id);if(!p)fail('КП не найдено',404);return p};

 function clean(d,u,b,old={}){
  const items=(Array.isArray(b.items)?b.items:old.items||[]).slice(0,60).map((i,n)=>{
   const eq=i.equipmentId?d.equipment.find(e=>e.id===i.equipmentId):null;
   const name=str(i.name,200)||[eq?.type,eq?.model].filter(Boolean).join(' ');
   if(!name)fail(`Строка ${n+1}: укажите название техники`);
   const unit=UNITS[i.unit]?i.unit:'shift';const rate=Number(i.rate);
   if(i.rate===''||i.rate==null||!Number.isFinite(rate)||rate<0)fail(`Строка ${n+1}: укажите стоимость`);
   return {equipmentId:eq?.id||'',name,specs:str(i.specs,300),unit,rate:Math.round(rate*100)/100,minOrder:str(i.minOrder,60),note:str(i.note,200)}});
  if(!items.length)fail('Добавьте хотя бы одну строку техники');
  let client={};if(b.clientId||old.clientId&&b.clientId===undefined){const c=d.clients.find(c=>c.id===(b.clientId??old.clientId));if(c)client={clientId:c.id,clientName:c.name,clientInn:c.inn||''}}
  if(!client.clientId)client={clientId:'',clientName:str(b.clientName??old.clientName,200),clientInn:str(b.clientInn??old.clientInn,12).replace(/\D/g,'')};
  const entities=d.legalEntities||[];const entity=entities.find(e=>e.id===(b.legalEntityId??old.legalEntityId))||entities[0];
  const date=day(b.date??old.date)||todayLocal();
  const vat=Number(b.vatRate??old.vatRate??entity?.vatRate??22);
  return {...client,contactName:str(b.contactName??old.contactName,120),title:str(b.title??old.title,200)||'Коммерческое предложение',
   legalEntityId:entity?.id||'',date,validUntil:day(b.validUntil??old.validUntil)||plusDays(date,14),
   intro:str(b.intro??old.intro??DEFAULT_INTRO,2000),terms:str(b.terms??old.terms??DEFAULT_TERMS,4000),
   vatRate:[0,5,7,10,20,22].includes(vat)?vat:22,vatIncluded:(b.vatIncluded??old.vatIncluded)!==false,facsimile:(b.facsimile??old.facsimile)!==false,
   managerPhone:str(b.managerPhone??old.managerPhone,40),items};
 }
 function nextNumber(d,date){const y=date.slice(0,4);d.proposalSequences||={};d.proposalSequences[y]=(d.proposalSequences[y]||0)+1;return `КП-${y}-${String(d.proposalSequences[y]).padStart(4,'0')}`}
 function summary(p,d){const u=d.users.find(x=>x.id===p.managerId);return {id:p.id,number:p.number,date:p.date,validUntil:p.validUntil,clientName:p.clientName,clientId:p.clientId,title:p.title,items:p.items.length,
  minRate:Math.min(...p.items.map(i=>i.rate)),manager:u?.name||'',updatedAt:p.updatedAt,sentAt:p.sentAt||'',expired:p.validUntil<todayLocal()}}

 return {
  defaults(d,u){const e=(d.legalEntities||[])[0]||{};const mine=list(d).filter(p=>p.managerId===u.id&&!p.deletedAt).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
   return {intro:mine?.intro||DEFAULT_INTRO,terms:mine?.terms||DEFAULT_TERMS,vatRate:e.vatRate??22,date:todayLocal(),validUntil:plusDays(todayLocal(),14),managerPhone:mine?.managerPhone||u.phone||'',units:UNITS}},
  list(d,u,q=''){if(!canAny(d,u))fail('Нет доступа к КП',403);const s=str(q).toLowerCase();return visible(d,u).filter(p=>!s||[p.number,p.clientName,p.title,...p.items.map(i=>i.name)].join(' ').toLowerCase().includes(s)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(p=>summary(p,d))},
  get(d,u,id){return find(d,u,id)},
  create(d,u,b){if(!canAny(d,u))fail('Нет доступа к КП',403);const v=clean(d,u,b);const now=new Date().toISOString();
   const p={id:'kp_'+crypto.randomUUID(),number:nextNumber(d,v.date),...v,managerId:u.id,createdAt:now,updatedAt:now};list(d).push(p);return p},
  update(d,u,id,b){const p=find(d,u,id);Object.assign(p,clean(d,u,b,p),{updatedAt:new Date().toISOString()});return p},
  copy(d,u,id){const src=find(d,u,id);const t=todayLocal();const now=new Date().toISOString();
   const p={...structuredClone(src),id:'kp_'+crypto.randomUUID(),date:t,validUntil:plusDays(t,14),managerId:u.id,createdAt:now,updatedAt:now,sentAt:''};p.number=nextNumber(d,t);list(d).push(p);return p},
  remove(d,u,id){const p=find(d,u,id);p.deletedAt=new Date().toISOString();return {ok:true}},
  markSent(d,u,id){const p=find(d,u,id);p.sentAt=p.sentAt||new Date().toISOString();return p},
  html:(d,p,engine)=>html(d,p,engine),
  async file(d,u,id,format){const p=find(d,u,id);const base=`${p.number} ${p.clientName||''}`.replace(/[\\/:*?"<>|«»]+/g,' ').replace(/\s+/g,' ').trim().slice(0,90);
   if(format==='docx')return {buffer:docx(d,p),name:base+'.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
   const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-kp-'));const out=path.join(dir,'kp.pdf');
   try{await renderPdf(engine=>html(d,p,engine),out);return {buffer:fs.readFileSync(out),name:base+'.pdf',type:'application/pdf'}}finally{fs.rmSync(dir,{recursive:true,force:true})}},
  preview(d,u,b){if(!canAny(d,u))fail('Нет доступа к КП',403);const v=clean(d,u,{...b,items:(b.items||[]).filter(i=>str(i.name)||i.equipmentId).map(i=>({...i,rate:i.rate===''||i.rate==null?0:i.rate}))||[]},{});return html(d,{...v,number:b.number||'КП-…',managerId:u.id},'chromium').replace('<body>','<body style="padding:18px 20px">')},
  UNITS,DEFAULT_TERMS,DEFAULT_INTRO,
 };

 function parts(d,p){const e=(d.legalEntities||[]).find(x=>x.id===p.legalEntityId)||(d.legalEntities||[])[0]||{};const m=d.users.find(x=>x.id===p.managerId)||{};
  const vatNote=p.vatRate?(p.vatIncluded?`Цены указаны с НДС ${p.vatRate}%.`:`Цены указаны без НДС, НДС ${p.vatRate}% начисляется сверху.`):'НДС не облагается.';
  return {e,m,vatNote,to:[p.clientName,p.clientInn&&('ИНН '+p.clientInn)].filter(Boolean).join(', '),contact:p.contactName}}

 function html(d,p,engine){const lo=engine==='libreoffice';const {e,m,vatNote,to,contact}=parts(d,p);
  const img=ref=>files&&ref?files.logoDataUri(ref):'';const logo=img(e.logo),sig=p.facsimile!==false?img(e.signatureImage):'',st=p.facsimile!==false?img(e.stampImage):'';
  const accent=/^#[0-9a-f]{6}$/i.test(d.settings?.brandColor||'')?d.settings.brandColor:'#ea5b0c';
  const sign=lo?`${sig?`<img src="${sig}" height="42">`:'____________'}${st?` <img src="${st}" height="110" align="middle">`:''}`:`<span style="position:relative;display:inline-block;min-width:120px;vertical-align:bottom">${sig?`<img src="${sig}" style="height:44px;vertical-align:bottom">`:'<span style="display:inline-block;width:120px;border-bottom:1px solid #111">&nbsp;</span>'}${st?`<img src="${st}" style="position:absolute;left:40px;top:-50px;height:124px;opacity:.9">`:''}</span>`;
  const rows=p.items.map((i,n)=>`<tr><td class="c">${n+1}</td><td><b>${esc(i.name)}</b>${i.specs?`<div class="sp">${esc(i.specs)}</div>`:''}${i.note?`<div class="sp">${esc(i.note)}</div>`:''}</td><td class="r nw"><b>${money(i.rate)}</b></td><td class="nw">${esc(PER[i.unit]||'')}</td><td class="nw">${esc(i.minOrder||'—')}</td></tr>`).join('');
  const contacts=[e.phone&&'тел. '+e.phone,e.email,e.address].filter(Boolean).map(esc).join(' · ');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(p.number)}</title><style>@page{size:A4;margin:14mm 16mm}*{box-sizing:border-box}body{font-family:Arial,'DejaVu Sans',sans-serif;color:#111;font-size:12.5px;line-height:1.5;margin:0}
  .head{display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:3px solid ${accent};padding-bottom:10px}.head img{max-height:60px;max-width:220px}.org{text-align:right;font-size:11px;color:#444}.org b{font-size:13px;color:#111}
  h1{font-size:22px;margin:22px 0 2px}.meta{color:#555;margin:0 0 14px}.to{margin:0 0 12px}table{width:100%;border-collapse:collapse;margin:10px 0}th{background:${accent};color:#fff;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.03em;padding:7px 8px}td{border-bottom:1px solid #ddd;padding:8px;vertical-align:top}tr:nth-child(even) td{background:#fafafa}.c{text-align:center;width:28px}.r{text-align:right}.nw{white-space:nowrap}.sp{color:#555;font-size:11.5px;margin-top:2px}
  .vat{color:#444;font-size:11.5px}.terms{margin:14px 0;padding:10px 14px;border-left:3px solid ${accent};background:#f7f7f7}.terms h3{margin:0 0 4px;font-size:13px}.terms p{margin:2px 0}.valid{font-weight:bold;margin:12px 0}
  .sign{margin-top:64px;display:flex;align-items:flex-end;gap:14px}.mgr{margin-top:18px;color:#444;font-size:11.5px}</style></head><body>
  <div class="head"><div>${logo?`<img src="${logo}" alt="">`:`<b style="font-size:18px">${esc(e.shortName||e.name||'')}</b>`}</div><div class="org"><b>${esc(e.shortName||e.name||'')}</b><br>${e.inn?'ИНН '+esc(e.inn)+(e.kpp?' / КПП '+esc(e.kpp):''):''}${contacts?'<br>'+contacts:''}</div></div>
  <h1>${esc(p.title||'Коммерческое предложение')}</h1><p class="meta">№ ${esc(p.number)} от ${ru(p.date)}</p>
  ${to||contact?`<p class="to"><b>Кому:</b> ${esc(to)}${contact?(to?'<br>':'')+'<b>Вниманию:</b> '+esc(contact):''}</p>`:''}
  ${p.intro?`<p>${esc(p.intro).replace(/\n/g,'<br>')}</p>`:''}
  <table${lo?' border="1" cellspacing="0" cellpadding="6"':''}><thead><tr><th class="c">№</th><th>Техника</th><th class="r">Стоимость</th><th>Ед.</th><th>Мин. заказ</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="vat">${esc(vatNote)}</p>
  ${p.terms?`<div class="terms"><h3>Условия</h3>${p.terms.split('\n').filter(s=>s.trim()).map(s=>`<p>• ${esc(s.replace(/^[-•*]\s*/,''))}</p>`).join('')}</div>`:''}
  <p class="valid">Предложение действительно до ${ru(p.validUntil)}.</p>
  <div class="sign"><span>${esc(e.signatoryPosition||'Генеральный директор')}</span>${sign}<span>/ ${esc(short(e.signatoryName))} /</span></div>
  ${m.name?`<p class="mgr">Ваш менеджер: ${esc(m.name)}${p.managerPhone?', '+esc(p.managerPhone):''}${m.email?', '+esc(m.email):''}</p>`:''}
  </body></html>`}

 function docx(d,p){const {e,m,vatNote,to,contact}=parts(d,p);
  const enc=s=>String(s??'').replace(/\{\{/g,'{ {').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
  const run=(t,{b,sz,color,raw}={})=>`<w:r>${b||sz||color?`<w:rPr>${b?'<w:b/>':''}${color?`<w:color w:val="${color}"/>`:''}${sz?`<w:sz w:val="${sz}"/>`:''}</w:rPr>`:''}<w:t xml:space="preserve">${raw?t:enc(t)}</w:t></w:r>`;
  const para=(runs,{jc,after}={})=>`<w:p>${jc||after!=null?`<w:pPr>${after!=null?`<w:spacing w:after="${after}"/>`:''}${jc?`<w:jc w:val="${jc}"/>`:''}</w:pPr>`:''}${runs}</w:p>`;
  const p1=(t,o={},po={})=>para(run(t,o),po);
  const accent=(/^#[0-9a-f]{6}$/i.test(d.settings?.brandColor||'')?d.settings.brandColor:'#ea5b0c').slice(1).toUpperCase();
  const W=[500,4700,1700,1300,1450];
  const cell=(content,i,{fill,bold,color,jc}={})=>`<w:tc><w:tcPr><w:tcW w:w="${W[i]}" w:type="dxa"/>${fill?`<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`:''}</w:tcPr>${typeof content==='string'?para(run(content,{b:bold,color,sz:bold&&color?18:undefined}),{jc,after:0}):content.join('')}</w:tc>`;
  const border='<w:tblBorders>'+['top','bottom','insideH'].map(s=>`<w:${s} w:val="single" w:sz="4" w:space="0" w:color="DDDDDD"/>`).join('')+'</w:tblBorders>';
  const head=`<w:tr><w:trPr><w:tblHeader/></w:trPr>${['№','Техника','Стоимость','Ед.','Мин. заказ'].map((t,i)=>cell(t,i,{fill:accent,bold:true,color:'FFFFFF',jc:i===2?'right':undefined})).join('')}</w:tr>`;
  const body=p.items.map((i,n)=>`<w:tr>${cell(String(n+1),0,{jc:'center'})}${cell([para(run(i.name,{b:true}),{after:0}),...(i.specs?[para(run(i.specs,{sz:19,color:'555555'}),{after:0})]:[]),...(i.note?[para(run(i.note,{sz:19,color:'555555'}),{after:0})]:[])],1)}${cell([para(run(money(i.rate),{b:true}),{jc:'right',after:0})],2)}${cell(PER[i.unit]||'',3)}${cell(i.minOrder||'—',4)}</w:tr>`).join('');
  const table=`<w:tbl><w:tblPr><w:tblW w:w="9650" w:type="dxa"/><w:tblLayout w:type="fixed"/>${border}<w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${W.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${head}${body}</w:tbl>`;
  const org=[e.shortName||e.name,e.inn&&('ИНН '+e.inn+(e.kpp?' / КПП '+e.kpp:'')),[e.phone&&'тел. '+e.phone,e.email].filter(Boolean).join(' · '),e.address].filter(Boolean);
  const content=[
   e.logo?para(run('{{Логотип}}',{raw:true})):'' ,
   ...org.map((t,n)=>p1(t,{b:n===0,sz:n?18:22,color:n?'444444':undefined},{after:0})),
   para(`<w:pPr><w:pBdr><w:bottom w:val="single" w:sz="18" w:space="4" w:color="${accent}"/></w:pBdr></w:pPr>`),
   p1(p.title||'Коммерческое предложение',{b:true,sz:40},{after:40}),
   p1(`№ ${p.number} от ${ru(p.date)}`,{color:'555555'}),
   to?para(run('Кому: ',{b:true})+run(to)):'',contact?para(run('Вниманию: ',{b:true})+run(contact)):'',
   ...(p.intro?p.intro.split('\n').map(s=>p1(s)):[]),
   table,
   p1(vatNote,{sz:19,color:'444444'}),
   ...(p.terms?[p1('Условия',{b:true},{after:40}),...p.terms.split('\n').filter(s=>s.trim()).map(s=>p1('• '+s.replace(/^[-•*]\s*/,''),{},{after:20}))]:[]),
   p1(`Предложение действительно до ${ru(p.validUntil)}.`,{b:true}),
   p1(''),p1(''),
   para(run((e.signatoryPosition||'Генеральный директор')+'   ')+run(p.facsimile!==false?'{{Подпись}}{{Печать}}':'____________',{raw:true})+run(`   / ${short(e.signatoryName)} /`)),
   m.name?p1(`Ваш менеджер: ${m.name}${p.managerPhone?', '+p.managerPhone:''}${m.email?', '+m.email:''}`,{sz:19,color:'444444'}):'',
  ].join('');
  const doc=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${content}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;
  const pkg=writeZip(new Map([
   ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'],
   ['_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
   ['word/_rels/document.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
   ['word/document.xml',doc],['word/styles.xml',styles]].map(([k,v])=>[k,Buffer.from(v,'utf8')])));
  // подпись, печать, логотип — тем же механизмом, что и в шаблонах договоров
  const images={};if(files)for(const [k,f] of [['logo','logo'],['signature','signatureImage'],['stamp','stampImage']]){if(k!=='logo'&&p.facsimile===false)continue;try{const file=files.logoFile(e[f]);if(!file)continue;const buf=fs.readFileSync(file),size=Docx.imageSize(buf);if(size)images[k]={...size,buf}}catch{}}
  return Docx.fill(pkg,{doc:{number:p.number,date:p.date},entity:e,client:{},order:{},object:{},items:[],totals:{},images});
 }
}
module.exports={createProposals,UNITS};
