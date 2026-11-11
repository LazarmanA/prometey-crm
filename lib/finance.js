'use strict';
// Деньги и подрядчики — как в 1С «Управление спецтехникой»:
//  • реестр заказов для бухгалтерии: сумма, прибыль, баланс заказчика, счета и акты (с подсветкой расхождений);
//  • смены поставщиков: что отработала наёмная техника, по каким сменам ещё нет документов;
//  • поступление услуг (УПД/акт/СФ от подрядчика) — из выделенных смен одной кнопкой; материалы и ГСМ — строками;
//  • движение денег: поступления от заказчиков и расходы (оплата подрядчикам, прочие расходы по статьям);
//  • взаиморасчёты с поставщиками, доходы и расходы по месяцам.
const crypto=require('node:crypto');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const str=v=>String(v??'').trim();
const round=v=>Math.round((Number(v)+Number.EPSILON)*100)/100;
const isDay=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const digits=v=>String(v??'').replace(/\D/g,'');
const UNITS=['shift','hour','trip','unit','day','machine_hour','km','ton','m3','l','kg'];
const VAT=[22,20,10,7,5,0,'none'];
// Статьи расходов. «Оплата подрядчикам» и «ГСМ и материалы» гасят документы поступления; остальные — сразу расход периода.
const CATEGORIES=[['suppliers','Оплата подрядчикам (техника)'],['materials','ГСМ, запчасти, материалы'],['salary','Зарплата и подотчёт'],['taxes','Налоги и взносы'],['rent','Аренда, связь, сервисы'],['bank','Банк и комиссии'],['loan','Займы и возвраты'],['other','Прочие расходы']];
const SETTLEMENT=new Set(['suppliers','materials']);
const PURCHASE_KINDS=[['services','Услуги подрядчика (техника)'],['materials','ГСМ, запчасти, материалы'],['other','Прочее']];
const unitRu={shift:'смена',hour:'час',trip:'рейс',unit:'шт',day:'сутки',machine_hour:'маш.-ч',km:'км',ton:'т',m3:'м³',l:'л',kg:'кг'};
const ru=iso=>iso?String(iso).slice(0,10).split('-').reverse().join('.'):'';

function createFinance({calcLine,csv}){
 const eqName=e=>[e?.type,e?.model].filter(Boolean).join(' ')||'Техника';
 function index(d){const by=list=>new Map((list||[]).map(v=>[v.id,v]));return {a:by(d.assignments),o:by(d.orders),c:by(d.clients),e:by(d.equipment),obj:by(d.objects),u:by(d.users),p:by(d.partners),pu:by(d.purchases)}}
 const shiftCost=s=>s.billableQuantity==null?null:round(Number(s.billableQuantity)*Number(s.purchaseRate||0)+(Number(s.overtime)>0?Number(s.overtime)*Number(s.overtimePurchaseRate||0):0)+Number(s.extras||0));
 const shiftSum=s=>s.billableQuantity==null||s.saleRate==null?null:round(Number(s.billableQuantity)*Number(s.saleRate)+(Number(s.overtime)>0?Number(s.overtime)*Number(s.overtimeSaleRate||0):0));
 // Поставщик смены: явно указанный в строке журнала или владелец наёмной техники.
 const supplierId=(I,s)=>{if(s.partnerId)return s.partnerId;const a=I.a.get(s.assignmentId),e=a&&I.e.get(a.equipmentId);return e?.ownership==='rented'?(e.partnerId||''):''};
 const isSupplierShift=(I,s)=>{if(s.partnerId)return true;const a=I.a.get(s.assignmentId),e=a&&I.e.get(a.equipmentId);return e?.ownership==='rented'};
 const entities=d=>d.legalEntities||[];
 const entityName=(d,id)=>(entities(d).find(e=>e.id===id)||entities(d)[0]||{}).name||'';

 // ---------- поставщики (контрагенты-подрядчики) ----------
 function partnerView(d,p){return {id:p.id,name:p.name,inn:p.inn||'',kpp:p.kpp||'',phone:p.phone||'',email:p.email||'',address:p.address||'',contact:p.contact||'',vatPayer:p.vatPayer!==false,comment:p.comment||'',rating:p.rating??null,archivedAt:p.archivedAt||'',equipment:(d.equipment||[]).filter(e=>e.partnerId===p.id&&!e.archivedAt).length}}
 function savePartner(d,b,old){
  const name=str(b.name??old?.name);if(!name||name.length>200)fail('Укажите название поставщика');
  const inn=digits(b.inn??old?.inn);if(inn&&!/^\d{10}(\d{2})?$/.test(inn))fail('ИНН поставщика — 10 или 12 цифр');
  if(inn&&(d.partners||[]).some(p=>p.id!==old?.id&&p.inn===inn&&!p.archivedAt))fail('Поставщик с таким ИНН уже есть',409);
  const kpp=digits(b.kpp??old?.kpp);if(kpp&&!/^\d{9}$/.test(kpp))fail('КПП — 9 цифр');
  const x={name,inn,kpp,phone:str(b.phone??old?.phone).slice(0,40),email:str(b.email??old?.email).slice(0,120),address:str(b.address??old?.address).slice(0,300),contact:str(b.contact??old?.contact).slice(0,120),vatPayer:(b.vatPayer??old?.vatPayer)!==false,comment:str(b.comment??old?.comment).slice(0,1000)};
  if(b.archived!==undefined)x.archivedAt=b.archived?(old?.archivedAt||new Date().toISOString()):'';
  if(old){Object.assign(old,x);return old}const p={id:'p_'+crypto.randomUUID(),...x,rating:null,createdAt:new Date().toISOString()};(d.partners||=[]).push(p);return p;
 }

 // ---------- смены поставщиков ----------
 function supplierRow(d,I,s){const a=I.a.get(s.assignmentId)||{},o=I.o.get(a.orderId)||{},c=I.c.get(o.clientId)||{},e=I.e.get(a.equipmentId)||{},obj=I.obj.get(a.objectId)||{},pid=supplierId(I,s),p=I.p.get(pid)||null,pu=s.purchaseId?I.pu.get(s.purchaseId):null;
  return {id:s.id,date:s.date,orderId:o.id||'',order:o.number||'—',client:c.name||'—',object:obj.address||obj.name||o.address||'',equipment:eqName(e),plate:e.plate||'',partnerId:pid,partner:p?.name||'',phone:p?.phone||'',email:p?.email||'',inn:p?.inn||'',
   quantity:s.billableQuantity??null,unit:s.unit||'shift',purchaseRate:s.purchaseRate??null,cost:shiftCost(s),sum:shiftSum(s),manager:I.u.get(o.managerId)?.name||'—',organization:entityName(d,o.legalEntityId),
   purchaseId:pu?.id||'',purchase:pu?{id:pu.id,number:pu.number,upd:pu.updNumber||'',date:pu.date}:null,scan:!!s.supplierScan,original:!!s.supplierOriginal,comment:s.comment||''}}
 function supplierShifts(d,q){const I=index(d);const from=q.get('from')||'',to=q.get('to')||'';if((from&&!isDay(from))||(to&&!isDay(to)))fail('Проверьте период');
  let rows=d.shifts.filter(s=>isSupplierShift(I,s)&&(!from||s.date>=from)&&(!to||s.date<=to)).map(s=>supplierRow(d,I,s));
  const pid=q.get('partnerId');if(pid==='none')rows=rows.filter(r=>!r.partnerId);else if(pid)rows=rows.filter(r=>r.partnerId===pid);
  if(q.get('noDocs')==='1')rows=rows.filter(r=>!r.purchaseId);
  if(q.get('orderId'))rows=rows.filter(r=>r.orderId===q.get('orderId'));
  const s=str(q.get('q')).toLocaleLowerCase('ru');if(s)rows=rows.filter(r=>[r.client,r.order,r.object,r.equipment,r.plate,r.partner,r.comment].some(v=>String(v).toLocaleLowerCase('ru').includes(s)));
  rows.sort((a,b)=>b.date.localeCompare(a.date)||a.partner.localeCompare(b.partner,'ru'));
  return {rows,totals:{count:rows.length,quantity:round(rows.reduce((a,r)=>a+(r.quantity||0),0)),cost:round(rows.reduce((a,r)=>a+(r.cost||0),0)),noDocs:rows.filter(r=>!r.purchaseId).length,noSupplier:rows.filter(r=>!r.partnerId).length}};
 }
 function markShifts(d,b){const ids=Array.isArray(b.ids)?b.ids.map(String):[];if(!ids.length||ids.length>2000)fail('Выберите смены');const I=index(d);let n=0;
  if(b.partnerId!==undefined&&b.partnerId&&!I.p.has(b.partnerId))fail('Поставщик не найден',404);
  for(const id of ids){const s=d.shifts.find(x=>x.id===id);if(!s||!isSupplierShift(I,s)&&!b.partnerId)continue;
   if(b.partnerId!==undefined){if(s.purchaseId&&b.partnerId!==supplierId(I,s))fail(`Смена ${ru(s.date)} уже в поступлении — сначала уберите её из документа`,409);s.partnerId=str(b.partnerId)}
   if(b.scan!==undefined)s.supplierScan=!!b.scan;if(b.original!==undefined)s.supplierOriginal=!!b.original;
   if(b.purchaseRate!==undefined){if(s.purchaseId)fail(`Смена ${ru(s.date)} уже в поступлении — цену меняют в документе`,409);const r=Number(b.purchaseRate);if(!(r>=0)||r>1e9)fail('Проверьте цену поставщика');s.purchaseRate=r}
   n++}
  return {updated:n};
 }

 // ---------- поступление услуг / материалов ----------
 function nextNumber(d){const nums=(d.purchases||[]).map(x=>Number(String(x.number).replace(/\D/g,''))).filter(Number.isFinite);return 'ПУ-'+String((nums.length?Math.max(...nums):0)+1).padStart(6,'0')}
 function buildPurchase(d,u,b,old){const I=index(d);
  const partner=I.p.get(str(b.partnerId??old?.partnerId));if(!partner)fail('Выберите поставщика');
  const date=str(b.date??old?.date)||today();if(!isDay(date))fail('Укажите дату документа поставщика');
  const kind=PURCHASE_KINDS.some(([k])=>k===(b.kind??old?.kind))?(b.kind??old?.kind):'services';
  const vatRate=b.vatRate===undefined?(old?old.vatRate:(partner.vatPayer===false?'none':22)):(b.vatRate==='none'?'none':Number(b.vatRate));if(!VAT.includes(vatRate))fail('Некорректная ставка НДС');
  const pricesIncludeVat=b.pricesIncludeVat===undefined?(old?old.pricesIncludeVat:true):b.pricesIncludeVat!==false;
  const shiftIds=[...new Set((b.shiftIds??old?.lines?.filter(l=>l.shiftId).map(l=>l.shiftId)??[]).map(String))];
  const manual=b.lines??old?.lines?.filter(l=>!l.shiftId)??[];if(!Array.isArray(manual))fail('Некорректные строки');
  if(!shiftIds.length&&!manual.length)fail('Добавьте смены поставщика или строки документа');if(shiftIds.length+manual.length>1000)fail('Не больше 1000 строк');
  const lines=[];
  for(const id of shiftIds){const s=d.shifts.find(x=>x.id===id);if(!s)fail('Смена не найдена: '+id,404);
   const pid=supplierId(I,s);if(pid&&pid!==partner.id)fail(`Смена ${ru(s.date)} — поставщик «${I.p.get(pid)?.name||'другой'}», а документ от «${partner.name}»`,409);
   if(s.purchaseId&&s.purchaseId!==old?.id){const other=I.pu.get(s.purchaseId);fail(`Смена ${ru(s.date)} уже в поступлении ${other?.number||''}${other?.updNumber?' (УПД № '+other.updNumber+')':''}`,409)}
   if(s.billableQuantity==null)fail(`Смена ${ru(s.date)}: не указано количество`);
   const a=I.a.get(s.assignmentId)||{},e=I.e.get(a.equipmentId)||{},obj=I.obj.get(a.objectId)||{},o=I.o.get(a.orderId)||{};
   const base={shiftId:s.id,orderId:o.id||'',name:`Услуги ${eqName(e)}${e.plate?' ('+e.plate+')':''} ${ru(s.date)}${obj.address?', '+obj.address:''}`.slice(0,500),unit:s.unit||'shift'};
   lines.push({id:'pl_'+crypto.randomUUID().slice(0,8),...base,...calcLine(s.billableQuantity,Number(s.purchaseRate||0),vatRate,pricesIncludeVat)});
   if(Number(s.overtime)>0&&Number(s.overtimePurchaseRate)>0)lines.push({id:'pl_'+crypto.randomUUID().slice(0,8),...base,part:'overtime',name:('Переработка: '+base.name).slice(0,500),unit:'hour',...calcLine(Number(s.overtime),Number(s.overtimePurchaseRate),vatRate,pricesIncludeVat)});
  }
  manual.forEach((l,i)=>{const name=str(l.name);if(!name||name.length>500)fail(`Строка ${i+1}: укажите наименование`);lines.push({id:str(l.id)||'pl_'+crypto.randomUUID().slice(0,8),shiftId:'',orderId:str(l.orderId),name,unit:UNITS.includes(l.unit)?l.unit:'unit',...calcLine(l.quantity,l.rate,vatRate,pricesIncludeVat)})});
  const totals={net:round(lines.reduce((s,l)=>s+l.net,0)),vat:round(lines.reduce((s,l)=>s+l.vat,0)),gross:round(lines.reduce((s,l)=>s+l.gross,0))};
  const entity=entities(d).find(e=>e.id===str(b.legalEntityId??old?.legalEntityId))||entities(d)[0]||null;
  const field=(k,max=40)=>str(b[k]??old?.[k]).slice(0,max);
  return {partnerId:partner.id,date,kind,vatRate,pricesIncludeVat,lines,totals,legalEntityId:entity?.id||'',updNumber:field('updNumber'),actNumber:field('actNumber'),sfNumber:field('sfNumber'),
   originalReceived:(b.originalReceived??old?.originalReceived)===true,scanReceived:(b.scanReceived??old?.scanReceived??true)===true,comment:field('comment',1000)};
 }
 function linkShifts(d,x){for(const s of d.shifts)if(s.purchaseId===x.id)s.purchaseId='';for(const l of x.lines)if(l.shiftId){const s=d.shifts.find(z=>z.id===l.shiftId);if(s){s.purchaseId=x.id;if(!s.partnerId)s.partnerId=x.partnerId;if(x.originalReceived)s.supplierOriginal=true;if(x.scanReceived)s.supplierScan=true}}}
 function supplierPayState(d){const by=new Map();
  for(const x of [...(d.purchases||[])].sort((a,b)=>a.date.localeCompare(b.date)||a.number.localeCompare(b.number)))(by.get(x.partnerId)||by.set(x.partnerId,{docs:[],paid:0}).get(x.partnerId)).docs.push(x);
  for(const e of d.expenses||[])if(e.partnerId&&SETTLEMENT.has(e.category)){const z=by.get(e.partnerId)||by.set(e.partnerId,{docs:[],paid:0}).get(e.partnerId);z.paid=round(z.paid+e.amount)}
  const state=new Map(),advance=new Map();for(const [pid,z] of by){let left=z.paid;for(const x of z.docs){const paid=round(Math.min(left,x.totals.gross));left=round(left-paid);state.set(x.id,{paid,debt:round(x.totals.gross-paid)})}advance.set(pid,round(left))}
  return {state,advance};
 }
 function purchaseView(d,x,ps=supplierPayState(d)){const p=(d.partners||[]).find(z=>z.id===x.partnerId)||{},st=ps.state.get(x.id)||{paid:0,debt:x.totals.gross};
  return {...x,partner:p.name||'—',partnerInn:p.inn||'',organization:entityName(d,x.legalEntityId),kindName:(PURCHASE_KINDS.find(([k])=>k===x.kind)||[])[1]||'',paid:st.paid,debt:st.debt,shifts:x.lines.filter(l=>l.shiftId).length,author:d.users.find(z=>z.id===x.createdBy)?.name||'—',
   orders:[...new Set(x.lines.map(l=>l.orderId).filter(Boolean))].map(id=>{const o=d.orders.find(z=>z.id===id);return o?{id:o.id,number:o.number}:null}).filter(Boolean)}}
 function purchaseList(d,q){const ps=supplierPayState(d);let list=(d.purchases||[]).map(x=>purchaseView(d,x,ps));const from=q.get('from'),to=q.get('to');if(from)list=list.filter(x=>x.date>=from);if(to)list=list.filter(x=>x.date<=to);
  if(q.get('partnerId'))list=list.filter(x=>x.partnerId===q.get('partnerId'));if(q.get('kind'))list=list.filter(x=>x.kind===q.get('kind'));
  if(q.get('original')==='no')list=list.filter(x=>!x.originalReceived);if(q.get('pay')==='debt')list=list.filter(x=>x.debt>0);
  const s=str(q.get('q')).toLocaleLowerCase('ru');if(s)list=list.filter(x=>[x.number,x.partner,x.updNumber,x.sfNumber,x.actNumber,x.comment].some(v=>String(v).toLocaleLowerCase('ru').includes(s)));
  list.sort((a,b)=>b.date.localeCompare(a.date)||b.number.localeCompare(a.number));
  return {rows:list,totals:{count:list.length,net:round(list.reduce((a,x)=>a+x.totals.net,0)),vat:round(list.reduce((a,x)=>a+x.totals.vat,0)),gross:round(list.reduce((a,x)=>a+x.totals.gross,0)),debt:round(list.reduce((a,x)=>a+x.debt,0)),noOriginal:list.filter(x=>!x.originalReceived).length}}}

 // ---------- расходы и движение денег ----------
 function saveExpense(d,u,b){const date=str(b.date)||today();if(!isDay(date))fail('Укажите дату расхода');const amount=round(Number(b.amount));if(!(amount>0)||amount>1e12)fail('Сумма расхода должна быть больше нуля');
  const partner=b.partnerId?(d.partners||[]).find(p=>p.id===b.partnerId):null;if(b.partnerId&&!partner)fail('Поставщик не найден',404);
  const category=CATEGORIES.some(([k])=>k===b.category)?b.category:(partner?'suppliers':'other');
  if(SETTLEMENT.has(category)&&!partner&&category==='suppliers')fail('Для оплаты подрядчику выберите поставщика');
  const x={id:'exp_'+crypto.randomUUID(),date,amount,partnerId:partner?.id||'',payee:partner?partner.name:str(b.payee).slice(0,200),category,number:str(b.number).slice(0,40),purpose:str(b.purpose).slice(0,500),method:b.method==='cash'?'cash':'bank',source:b.source==='bank'?'bank':'manual',bankRef:str(b.bankRef),createdBy:u.id,createdAt:new Date().toISOString()};
  (d.expenses||=[]).push(x);return x}
 function cash(d,q){const from=q.get('from')||'',to=q.get('to')||'';if((from&&!isDay(from))||(to&&!isDay(to)))fail('Проверьте период');const I=index(d);
  const all=[...(d.payments||[]).map(p=>({id:p.id,kind:'in',date:p.date,amount:p.amount,counterpartyId:p.clientId,counterparty:I.c.get(p.clientId)?.name||'—',category:'customers',categoryName:'Оплата от заказчика',number:p.number||'',purpose:p.purpose||'',source:p.source||'manual'})),
   ...(d.expenses||[]).map(e=>({id:e.id,kind:'out',date:e.date,amount:e.amount,counterpartyId:e.partnerId||'',counterparty:e.partnerId?(I.p.get(e.partnerId)?.name||e.payee||'—'):(e.payee||'—'),category:e.category,categoryName:(CATEGORIES.find(([k])=>k===e.category)||[])[1]||'Прочие расходы',number:e.number||'',purpose:e.purpose||'',source:e.source||'manual',method:e.method||'bank'}))];
  const opening=round(all.filter(r=>from&&r.date<from).reduce((s,r)=>s+(r.kind==='in'?r.amount:-r.amount),0));
  let rows=all.filter(r=>(!from||r.date>=from)&&(!to||r.date<=to));
  if(q.get('dir')==='in'||q.get('dir')==='out')rows=rows.filter(r=>r.kind===q.get('dir'));if(q.get('category'))rows=rows.filter(r=>r.category===q.get('category'));
  const s=str(q.get('q')).toLocaleLowerCase('ru');if(s)rows=rows.filter(r=>[r.counterparty,r.number,r.purpose,r.categoryName].some(v=>String(v).toLocaleLowerCase('ru').includes(s)));
  rows.sort((a,b)=>b.date.localeCompare(a.date)||(a.kind===b.kind?0:a.kind==='in'?-1:1));
  const inSum=round(rows.filter(r=>r.kind==='in').reduce((a,r)=>a+r.amount,0)),outSum=round(rows.filter(r=>r.kind==='out').reduce((a,r)=>a+r.amount,0));
  const byCategory=CATEGORIES.map(([k,name])=>({key:k,name,sum:round(rows.filter(r=>r.kind==='out'&&r.category===k).reduce((a,r)=>a+r.amount,0))})).filter(x=>x.sum);
  return {rows,totals:{in:inSum,out:outSum,net:round(inSum-outSum),opening,closing:round(opening+inSum-outSum)},byCategory,categories:CATEGORIES.map(([key,name])=>({key,name}))}}

 // ---------- взаиморасчёты с поставщиками ----------
 function suppliers(d){const I=index(d),ps=supplierPayState(d);const map=new Map();const get=pid=>map.get(pid)||map.set(pid,{partnerId:pid,partner:I.p.get(pid)?.name||'Поставщик не указан',inn:I.p.get(pid)?.inn||'',phone:I.p.get(pid)?.phone||'',noDocsCount:0,noDocsSum:0,purchased:0,paid:0,debt:0,advance:0,noOriginal:0,last:''}).get(pid);
  for(const s of d.shifts){if(!isSupplierShift(I,s)||s.purchaseId)continue;const x=get(supplierId(I,s));x.noDocsCount++;x.noDocsSum=round(x.noDocsSum+(shiftCost(s)||0))}
  for(const p of d.purchases||[]){const x=get(p.partnerId);x.purchased=round(x.purchased+p.totals.gross);x.debt=round(x.debt+(ps.state.get(p.id)?.debt||0));if(!p.originalReceived)x.noOriginal++;if(p.date>x.last)x.last=p.date}
  for(const e of d.expenses||[])if(e.partnerId&&SETTLEMENT.has(e.category)){const x=get(e.partnerId);x.paid=round(x.paid+e.amount)}
  for(const [pid,a] of ps.advance)if(map.has(pid))map.get(pid).advance=a;
  return [...map.values()].sort((a,b)=>(b.debt+b.noDocsSum)-(a.debt+a.noDocsSum))}
 function supplierReconciliation(d,partnerId,from,to){const p=(d.partners||[]).find(x=>x.id===partnerId);if(!p)fail('Поставщик не найден',404);if(!isDay(from)||!isDay(to)||from>to)fail('Проверьте период');
  const docs=(d.purchases||[]).filter(x=>x.partnerId===partnerId),pays=(d.expenses||[]).filter(e=>e.partnerId===partnerId&&SETTLEMENT.has(e.category));
  const opening=round(docs.filter(x=>x.date<from).reduce((s,x)=>s+x.totals.gross,0)-pays.filter(e=>e.date<from).reduce((s,e)=>s+e.amount,0));
  const rows=[...docs.filter(x=>x.date>=from&&x.date<=to).map(x=>({date:x.date,doc:`Поступление ${x.updNumber?'(УПД № '+x.updNumber+')':x.number} от ${ru(x.date)}`,credit:x.totals.gross,debit:0})),...pays.filter(e=>e.date>=from&&e.date<=to).map(e=>({date:e.date,doc:`Оплата${e.number?' (п/п № '+e.number+')':''} от ${ru(e.date)}`,debit:e.amount,credit:0}))].sort((a,b)=>a.date.localeCompare(b.date));
  const credit=round(rows.reduce((s,r)=>s+r.credit,0)),debit=round(rows.reduce((s,r)=>s+r.debit,0));
  return {partner:{id:p.id,name:p.name,inn:p.inn||''},from,to,opening,rows,credit,debit,closing:round(opening+credit-debit)}}

 // ---------- реестр заказов (как «Заказы» в 1С) ----------
 function registry(d,q){const I=index(d);const from=q.get('from')||'',to=q.get('to')||'';
  const shiftsBy=new Map();for(const s of d.shifts){const a=I.a.get(s.assignmentId);if(!a?.orderId)continue;(shiftsBy.get(a.orderId)||shiftsBy.set(a.orderId,[]).get(a.orderId)).push(s)}
  const docsBy=new Map();for(const x of d.documents||[])if(['invoice','contract_invoice'].includes(x.type)&&x.status!=='cancelled')for(const id of x.orderIds||[])(docsBy.get(id)||docsBy.set(id,[]).get(id)).push(x);
  const actsBy=new Map();for(const r of (d.realizations||[]).filter(r=>r.status==='posted'))for(const id of r.orderIds||[])(actsBy.get(id)||actsBy.set(id,[]).get(id)).push(r);
  // баланс заказчика: оплаты минус реализации (плюс — аванс, минус — долг)
  const bal=new Map();for(const r of (d.realizations||[]).filter(r=>r.status==='posted'))bal.set(r.clientId,round((bal.get(r.clientId)||0)-r.totals.gross));for(const p of d.payments||[])bal.set(p.clientId,round((bal.get(p.clientId)||0)+p.amount));
  const items=new Map();for(const i of d.orderItems||[])if(!i.archivedAt)(items.get(i.orderId)||items.set(i.orderId,[]).get(i.orderId)).push(i);
  let rows=d.orders.filter(o=>!o.archivedAt).map(o=>{const sh=(shiftsBy.get(o.id)||[]).sort((a,b)=>a.date.localeCompare(b.date)),plan=items.get(o.id)||[];
   const fact=sh.some(s=>shiftSum(s)!=null);
   const sum=fact?round(sh.reduce((a,s)=>a+(shiftSum(s)||0),0)):round(plan.reduce((a,i)=>a+i.saleRate*i.quantity,0));
   const cost=fact?round(sh.reduce((a,s)=>a+(shiftCost(s)||0),0)):round(plan.reduce((a,i)=>a+(i.purchaseRate||0)*i.quantity+(i.extras||0),0));
   const quantity=fact?round(sh.reduce((a,s)=>a+(Number(s.billableQuantity)||0),0)):round(plan.reduce((a,i)=>a+Number(i.quantity||0),0));
   const eqIds=[...new Set([...sh.map(s=>I.a.get(s.assignmentId)?.equipmentId),...plan.map(i=>i.equipmentId)].filter(Boolean))];
   const partnerIds=[...new Set([...sh.map(s=>supplierId(I,s)),...plan.map(i=>{const e=I.e.get(i.equipmentId);return e?.ownership==='rented'?e.partnerId:''})].filter(Boolean))];
   const invs=docsBy.get(o.id)||[],acts=actsBy.get(o.id)||[];
   const invSum=round(invs.reduce((a,x)=>a+Number(x.totalGross||0),0));
   const actSum=round(acts.reduce((a,r)=>a+r.lines.filter(l=>l.orderId===o.id||(!l.orderId&&(r.orderIds||[]).length===1)).reduce((z,l)=>z+l.gross,0),0));
   const start=sh[0]?.date||String(o.start||'').slice(0,10),end=sh.at(-1)?.date||String(o.end||o.start||'').slice(0,10);
   const supplierDocs=sh.filter(s=>isSupplierShift(I,s));
   const legalEntityId=o.legalEntityId||invs[0]?.legalEntityId||acts[0]?.legalEntityId||'';
   return {id:o.id,number:o.number,name:o.name||'',date:String(o.createdAt||o.start||'').slice(0,10),start,end,status:o.status,clientId:o.clientId,client:I.c.get(o.clientId)?.name||'—',object:I.obj.get(o.objectId)?.address||I.obj.get(o.objectId)?.name||o.address||'',
    suppliers:partnerIds.map(id=>I.p.get(id)?.name).filter(Boolean),equipment:[...new Set(eqIds.map(id=>eqName(I.e.get(id))))],quantity,sum,cost,profit:round(sum-cost),balance:bal.get(o.clientId)||0,
    invoices:invs.map(x=>x.number),invoiceSum:invSum,acts:acts.map(r=>r.number),actSum,managerId:o.managerId||'',manager:I.u.get(o.managerId)?.name||'—',comment:o.note||'',legalEntityId,organization:entityName(d,legalEntityId),
    supplierShifts:supplierDocs.length,supplierNoDocs:supplierDocs.filter(s=>!s.purchaseId).length,
    invoiceMismatch:invs.length>0&&Math.abs(invSum-sum)>=1,actMismatch:acts.length>0&&Math.abs(actSum-sum)>=1,noInvoice:!invs.length&&sum>0&&o.status!=='cancelled',noAct:!acts.length&&sum>0&&['done','working'].includes(o.status)}});
  if(from)rows=rows.filter(r=>r.end>=from);if(to)rows=rows.filter(r=>r.start<=to);
  for(const k of ['clientId','managerId','status','legalEntityId'])if(q.get(k))rows=rows.filter(r=>r[k]===q.get(k));
  if(q.get('noActs')==='1')rows=rows.filter(r=>!r.acts.length&&r.status!=='cancelled');
  if(q.get('mismatch')==='1')rows=rows.filter(r=>r.invoiceMismatch||r.actMismatch);
  const s=str(q.get('q')).toLocaleLowerCase('ru');if(s)rows=rows.filter(r=>[r.number,r.name,r.client,r.object,r.manager,...r.suppliers,...r.equipment,...r.invoices,...r.acts].some(v=>String(v).toLocaleLowerCase('ru').includes(s)));
  rows.sort((a,b)=>String(b.start).localeCompare(String(a.start))||String(b.number).localeCompare(String(a.number),'ru',{numeric:true}));
  const live=rows.filter(r=>r.status!=='cancelled');
  return {rows,totals:{count:rows.length,sum:round(live.reduce((a,r)=>a+r.sum,0)),profit:round(live.reduce((a,r)=>a+r.profit,0)),invoiceSum:round(live.reduce((a,r)=>a+r.invoiceSum,0)),actSum:round(live.reduce((a,r)=>a+r.actSum,0)),mismatch:live.filter(r=>r.invoiceMismatch||r.actMismatch).length,noActs:live.filter(r=>r.noAct).length},
   filters:{managers:[...new Map(d.orders.filter(o=>o.managerId).map(o=>[o.managerId,I.u.get(o.managerId)?.name||'—'])).entries()].map(([id,name])=>({id,name})),organizations:entities(d).map(e=>({id:e.id,name:e.name}))}};
 }

 // ---------- доходы и расходы ----------
 function pnl(d,from,to){if((from&&!isDay(from))||(to&&!isDay(to)))fail('Проверьте период');const inP=x=>(!from||x>=from)&&(!to||x<=to);const I=index(d);
  const months=new Map();const m=k=>months.get(k)||months.set(k,{month:k,revenue:0,revenueVat:0,services:0,materials:0,other:0,cashIn:0,cashOut:0,accrued:0}).get(k);
  for(const r of (d.realizations||[]).filter(r=>r.status==='posted'&&inP(r.date))){const x=m(r.date.slice(0,7));x.revenue=round(x.revenue+r.totals.net);x.revenueVat=round(x.revenueVat+r.totals.vat)}
  for(const p of (d.purchases||[]).filter(p=>inP(p.date))){const x=m(p.date.slice(0,7)),k=p.kind==='materials'?'materials':p.kind==='services'?'services':'other';x[k]=round(x[k]+p.totals.net)}
  const other={};for(const e of (d.expenses||[]).filter(e=>inP(e.date))){const x=m(e.date.slice(0,7));x.cashOut=round(x.cashOut+e.amount);if(!SETTLEMENT.has(e.category)&&e.category!=='loan'){x.other=round(x.other+e.amount);other[e.category]=round((other[e.category]||0)+e.amount)}}
  for(const p of (d.payments||[]).filter(p=>inP(p.date))){const x=m(p.date.slice(0,7));x.cashIn=round(x.cashIn+p.amount)}
  // начислено по сменам поставщиков без документов — расход, который ещё придёт
  for(const s of d.shifts)if(isSupplierShift(I,s)&&!s.purchaseId&&inP(s.date)){const x=m(s.date.slice(0,7));x.accrued=round(x.accrued+(shiftCost(s)||0))}
  const list=[...months.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(x=>({...x,costs:round(x.services+x.materials+x.other),profit:round(x.revenue-x.services-x.materials-x.other)}));
  const t=k=>round(list.reduce((a,x)=>a+x[k],0));
  return {from,to,months:list,totals:{revenue:t('revenue'),revenueVat:t('revenueVat'),services:t('services'),materials:t('materials'),other:t('other'),costs:t('costs'),profit:t('profit'),cashIn:t('cashIn'),cashOut:t('cashOut'),accrued:t('accrued')},
   otherByCategory:CATEGORIES.filter(([k])=>other[k]).map(([k,name])=>({key:k,name,sum:other[k]}))}}

 const supplierCsv=x=>csv([['Дата','Организация','Поставщик','ИНН','Объект','Телефон','E-mail','Машина','Госномер','Количество','Ед.','Тариф суб.','Сумма суб.','Менеджер','Заказ','Заказчик','Поступление','Скан','Оригинал'],...x.rows.map(r=>[ru(r.date),r.organization,r.partner,r.inn,r.object,r.phone,r.email,r.equipment,r.plate,String(r.quantity??'').replace('.',','),unitRu[r.unit]||r.unit,String(r.purchaseRate??'').replace('.',','),String(r.cost??'').replace('.',','),r.manager,r.order,r.client,r.purchase?(r.purchase.upd?'УПД '+r.purchase.upd:r.purchase.number):'',r.scan?'да':'',r.original?'да':''])]);
 const registryCsv=x=>csv([['Номер','Смены с','по','Статус','Заказчик','Объект','Поставщик','Машина','Кол-во','Сумма','Прибыль','Баланс заказчика','Счета','Сумма счетов','Акты','Сумма актов','Менеджер'],...x.rows.map(r=>[r.number,ru(r.start),ru(r.end),r.status,r.client,r.object,r.suppliers.join(', '),r.equipment.join(', '),String(r.quantity).replace('.',','),String(r.sum).replace('.',','),String(r.profit).replace('.',','),String(r.balance).replace('.',','),r.invoices.join(', '),String(r.invoiceSum).replace('.',','),r.acts.join(', '),String(r.actSum).replace('.',','),r.manager])]);

 // ---------- маршруты (внутри /api/accounting/...) ----------
 return async function handle({p,q,method,b,u,tx,read,need,audit,file,send}){
  if(p==='/api/accounting/registry'&&method==='GET')return send(200,read(d=>registry(d,q)));
  if(p==='/api/accounting/registry.csv'&&method==='GET'){const x=read(d=>registry(d,q));return file(`Заказы_${today()}.csv`,'text/csv; charset=utf-8',Buffer.from(registryCsv(x)))}
  if(p==='/api/accounting/partners'&&method==='GET')return send(200,read(d=>(d.partners||[]).filter(x=>q.get('all')==='1'||!x.archivedAt).map(x=>partnerView(d,x)).sort((a,b)=>a.name.localeCompare(b.name,'ru'))));
  if(p==='/api/accounting/partners'&&method==='POST')return send(201,tx((d,c)=>{need(c,'edit');const x=savePartner(d,b,null);audit(d,'partner.create',x.id,'Поставщик '+x.name);return partnerView(d,x)}));
  const pm=p.match(/^\/api\/accounting\/partners\/([^/]+)$/);
  if(pm&&method==='PATCH')return send(200,tx((d,c)=>{need(c,'edit');const old=(d.partners||[]).find(x=>x.id===pm[1]);if(!old)fail('Поставщик не найден',404);const x=savePartner(d,b,old);audit(d,'partner.update',x.id,'Поставщик '+x.name);return partnerView(d,x)}));
  if(p==='/api/accounting/supplier-shifts'&&method==='GET')return send(200,read(d=>supplierShifts(d,q)));
  if(p==='/api/accounting/supplier-shifts.csv'&&method==='GET'){const x=read(d=>supplierShifts(d,q));return file(`Смены_поставщиков_${today()}.csv`,'text/csv; charset=utf-8',Buffer.from(supplierCsv(x)))}
  if(p==='/api/accounting/supplier-shifts'&&method==='PATCH')return send(200,tx((d,c)=>{need(c,'edit');const r=markShifts(d,b);audit(d,'supplier.shifts',String(b.ids?.length||0),`Смены поставщиков: отмечено ${r.updated}`);return r}));
  if(p==='/api/accounting/purchases'&&method==='GET')return send(200,read(d=>purchaseList(d,q)));
  if(p==='/api/accounting/purchases'&&method==='POST')return send(201,tx((d,c)=>{need(c,'edit');const v=buildPurchase(d,u,b,null);const x={id:'pu_'+crypto.randomUUID(),number:nextNumber(d),...v,createdBy:u.id,createdAt:new Date().toISOString()};(d.purchases||=[]).push(x);linkShifts(d,x);audit(d,'purchase.create',x.id,`Поступление ${x.number} от ${(d.partners.find(p=>p.id===x.partnerId)||{}).name}: ${x.totals.gross} ₽`);return purchaseView(d,x)}));
  const pu=p.match(/^\/api\/accounting\/purchases\/([^/]+)$/);
  if(pu&&method==='GET')return send(200,read(d=>{const x=(d.purchases||[]).find(z=>z.id===pu[1]);if(!x)fail('Документ не найден',404);return purchaseView(d,x)}));
  if(pu&&method==='PATCH')return send(200,tx((d,c)=>{need(c,'edit');const x=(d.purchases||[]).find(z=>z.id===pu[1]);if(!x)fail('Документ не найден',404);Object.assign(x,buildPurchase(d,u,b,x),{updatedAt:new Date().toISOString()});linkShifts(d,x);audit(d,'purchase.update',x.id,'Поступление '+x.number);return purchaseView(d,x)}));
  if(pu&&method==='DELETE')return send(200,tx((d,c)=>{need(c,'edit');const x=(d.purchases||[]).find(z=>z.id===pu[1]);if(!x)fail('Документ не найден',404);for(const s of d.shifts)if(s.purchaseId===x.id)s.purchaseId='';d.purchases=d.purchases.filter(z=>z!==x);audit(d,'purchase.delete',x.id,'Удалено поступление '+x.number);return {ok:true}}));
  if(p==='/api/accounting/expenses'&&method==='POST')return send(201,tx((d,c)=>{need(c,'edit');const x=saveExpense(d,u,b);audit(d,'expense.create',x.id,`Расход ${x.amount} ₽ · ${x.payee}`);return x}));
  const em=p.match(/^\/api\/accounting\/expenses\/([^/]+)$/);
  if(em&&method==='DELETE')return send(200,tx((d,c)=>{need(c,'edit');const x=(d.expenses||[]).find(z=>z.id===em[1]);if(!x)fail('Расход не найден',404);d.expenses=d.expenses.filter(z=>z!==x);audit(d,'expense.delete',x.id,`Удалён расход ${x.amount} ₽`);return {ok:true}}));
  if(p==='/api/accounting/cash'&&method==='GET')return send(200,read(d=>cash(d,q)));
  if(p==='/api/accounting/cash.csv'&&method==='GET'){const x=read(d=>cash(d,q));return file(`Движение_денег_${today()}.csv`,'text/csv; charset=utf-8',Buffer.from(csv([['Дата','Вид','Контрагент','Статья','Поступление','Расход','П/п №','Назначение'],...x.rows.map(r=>[ru(r.date),r.kind==='in'?'Поступление':'Расход',r.counterparty,r.categoryName,r.kind==='in'?String(r.amount).replace('.',','):'',r.kind==='out'?String(r.amount).replace('.',','):'',r.number,r.purpose])])))}
  if(p==='/api/accounting/suppliers'&&method==='GET')return send(200,read(d=>suppliers(d)));
  if(p==='/api/accounting/supplier-reconciliation'&&method==='GET')return send(200,read(d=>supplierReconciliation(d,q.get('partnerId'),q.get('from'),q.get('to'))));
  if(p==='/api/accounting/pnl'&&method==='GET')return send(200,read(d=>pnl(d,q.get('from')||'',q.get('to')||'')));
  return undefined;
 };
}
module.exports={createFinance,CATEGORIES,PURCHASE_KINDS,SETTLEMENT};
