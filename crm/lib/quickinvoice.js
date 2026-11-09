'use strict';
// «Сделки → Выставить счёт»: одна форма вместо цепочки объект → компания → сделка → счёт.
// Компания находится по ИНН (или создаётся), объект — по адресу, сделка — новая или выбранная; всё в одной транзакции.
const UNITS=['shift','hour','trip','unit','day','machine_hour','km','ton','m3'];
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e};
const str=v=>String(v??'').trim();
const digits=v=>String(v??'').replace(/\D/g,'');
const norm=v=>str(v).toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/g,' ').trim();
const blank=v=>!str(v)||/^[\s—–-]+$/.test(str(v));
const day=v=>/^\d{4}-\d{2}-\d{2}$/.test(str(v).slice(0,10))?str(v).slice(0,10):'';
const localNow=()=>{const n=new Date(Date.now()-new Date().getTimezoneOffset()*60000);return n.toISOString().slice(0,16)};

function createQuickInvoice({CRM,Documents}){
 const call=(d,u,method,path,body)=>{const r=CRM.handle(d,u,method,new URL('http://local'+path),body);if(!r||r.status>=400)fail(r?.body?.error||'Не удалось сохранить',r?.status||400);return r.body};
 const {clientScope,orderScope,objectScope}=CRM.scopes;
 const eqName=e=>[e?.type,e?.model,e?.plate].filter(Boolean).join(' · ');

 // Что подставить для выбранной компании: открытые сделки, адреса её объектов, последние ставки по технике.
 function context(d,u,clientId){
  const client=clientScope(d,u).find(c=>c.id===clientId&&!c.archivedAt);if(!client)fail('Компания не найдена',404);
  const deals=orderScope(d,u).filter(o=>o.clientId===client.id&&!o.archivedAt&&o.status!=='cancelled').sort((a,b)=>String(b.start).localeCompare(String(a.start)));
  const objects=new Map();for(const o of deals){const obj=d.objects.find(x=>x.id===o.objectId);if(obj&&!obj.archivedAt&&!objects.has(obj.id))objects.set(obj.id,{id:obj.id,name:obj.name,address:obj.address})}
  const rates={};for(const o of deals)for(const i of d.orderItems.filter(i=>i.orderId===o.id&&!i.archivedAt))if(!rates[i.equipmentId])rates[i.equipmentId]={rate:i.saleRate,unit:i.unit};
  const invoiced=new Set((d.documents||[]).filter(x=>['invoice','contract_invoice'].includes(x.type)&&x.status!=='cancelled').flatMap(x=>x.orderIds||[]));
  return {client:{id:client.id,name:client.name,inn:client.inn||'',kpp:client.kpp||'',legalAddress:client.legalAddress||'',phone:client.phone||'',email:client.email||''},
   deals:deals.slice(0,30).map(o=>{const items=d.orderItems.filter(i=>i.orderId===o.id&&!i.archivedAt);return {id:o.id,number:o.number,name:o.name,start:o.start,end:o.end,status:o.status,objectId:o.objectId,address:d.objects.find(x=>x.id===o.objectId)?.address||o.address||'',invoiced:invoiced.has(o.id),
    items:items.map(i=>({equipmentId:i.equipmentId,description:eqName(d.equipment.find(e=>e.id===i.equipmentId))||'Услуги спецтехники',quantity:i.quantity,unit:i.unit,rate:i.saleRate}))}}),
   objects:[...objects.values()],rates};
 }

 function resolveClient(d,u,b){
  if(b.clientId){const c=clientScope(d,u).find(c=>c.id===b.clientId);if(!c)fail('Компания не найдена',404);if(c.archivedAt)fail('Компания в архиве — восстановите её или выберите другую',409);return {client:c,created:false}}
  const x=b.client||{};const inn=digits(x.inn),name=str(x.name);
  if(!name&&!inn)fail('Укажите компанию: название или ИНН');
  if(inn&&!/^\d{10}(\d{2})?$/.test(inn))fail('ИНН должен содержать 10 или 12 цифр');
  const same=inn?d.clients.find(c=>c.inn===inn&&!c.archivedAt):null;
  if(same){if(!clientScope(d,u).some(c=>c.id===same.id))fail('Компания с этим ИНН уже есть в CRM у другого менеджера. Попросите руководителя открыть вам доступ',409);
   // дополняем пустые реквизиты тем, что пришло из DaData
   const patch={};for(const k of ['kpp','legalAddress','phone','email'])if(blank(same[k])&&!blank(x[k]))patch[k]=k==='kpp'?digits(x[k]):str(x[k]);
   if(Object.keys(patch).length&&CRM.canEdit(d,u,'clients',same))call(d,u,'PATCH','/api/clients/'+same.id,patch);
   return {client:d.clients.find(c=>c.id===same.id),created:false}}
  if(!name)fail('Не нашли компанию по ИНН — впишите название');
  const c=call(d,u,'POST','/api/clients',{name,inn,kpp:digits(x.kpp),legalAddress:str(x.legalAddress),phone:str(x.phone),email:str(x.email),
   address:str(x.legalAddress)||'—',equipmentType:str(b.equipmentType)||'Не указан',note:'Создана при выставлении счёта',ownership:'mixed',requestAt:localNow(),source:'invoice'});
  return {client:d.clients.find(z=>z.id===c.id),created:true};
 }

 function resolveObject(d,u,b,client){
  if(b.objectId){const o=objectScope(d,u).find(o=>o.id===b.objectId&&!o.archivedAt);if(!o)fail('Объект не найден',404);return {object:o,created:false}}
  const address=str(b.address)||(blank(client.legalAddress)?'':client.legalAddress);
  if(address){const same=objectScope(d,u).find(o=>!o.archivedAt&&norm(o.address)===norm(address));if(same)return {object:same,created:false}}
  const addr=address||'Адрес уточняется';
  const o=call(d,u,'POST','/api/objects',{name:(str(b.objectName)||addr).slice(0,120),address:addr,note:'Создан при выставлении счёта · '+client.name});
  return {object:d.objects.find(z=>z.id===o.id),created:true};
 }

 function cleanItems(d,items){
  if(!Array.isArray(items)||!items.length)fail('Добавьте хотя бы одну строку: технику или услугу');
  if(items.length>100)fail('Слишком много строк (больше 100)');
  return items.map((i,n)=>{const eq=i.equipmentId?d.equipment.find(e=>e.id===i.equipmentId):null;if(i.equipmentId&&!eq)fail(`Строка ${n+1}: техника не найдена`);
   const unit=UNITS.includes(i.unit)?i.unit:'shift',quantity=Number(i.quantity),rate=Number(i.rate);
   if(!(quantity>0))fail(`Строка ${n+1}: укажите количество`);if(!(rate>=0)||!Number.isFinite(rate))fail(`Строка ${n+1}: укажите цену`);
   const description=str(i.description)||eqName(eq);if(!description)fail(`Строка ${n+1}: выберите технику или опишите услугу`);
   return {equipmentId:eq?.id||'',equipment:eq,description:description.slice(0,300),quantity,unit,rate}});
 }

 // Всё сразу: компания → объект → сделка (+ строки техники) → счёт. Ошибка на любом шаге откатывает всё.
 function issue(d,u,b){
  const type=b.type==='contract_invoice'?'contract_invoice':'invoice';
  const items=cleanItems(d,b.items);
  const {client,created:clientCreated}=resolveClient(d,u,{...b,equipmentType:items.find(i=>i.equipment)?.equipment.type});
  let order,objectCreated=false,orderCreated=false;
  if(b.orderId){order=orderScope(d,u).find(o=>o.id===b.orderId&&!o.archivedAt);if(!order)fail('Сделка не найдена',404);if(order.clientId!==client.id)fail('Сделка относится к другой компании',409)}
  else{
   const r=resolveObject(d,u,b,client);objectCreated=r.created;
   const start=day(b.start)||localNow().slice(0,10),end=day(b.end)||start;if(end<start)fail('Окончание работ раньше начала');
   const first=items[0],types=[...new Set(items.map(i=>i.equipment?.type).filter(Boolean))];
   const o=call(d,u,'POST','/api/orders',{name:(str(b.dealName)||`${types.join(', ')||first.description} — ${client.name}`).slice(0,160),clientId:client.id,objectId:r.object.id,
    start:start+'T08:00',end:end+'T20:00',status:'working',address:r.object.address,equipmentType:types.join(', ')||'Услуги',note:'Создана в «Выставить счёт»',ownership:items.some(i=>i.equipment?.ownership==='rented')?(items.every(i=>i.equipment?.ownership==='rented')?'rented':'mixed'):'own'});
   order=d.orders.find(z=>z.id===o.id);orderCreated=true;
   for(const i of items)if(i.equipment){const line=call(d,u,'POST','/api/order-items',{orderId:order.id,equipmentId:i.equipmentId,unit:i.unit,start,end,quantity:i.quantity,saleRate:i.rate,purchaseRate:i.equipment.purchaseRate||0,extras:0});i.sourceId=line.id}
  }
  const doc=Documents.issue(d,u,{type,orderId:order.id,legalEntityId:b.legalEntityId,source:'plan',vatRate:b.vatRate,vatIncluded:b.vatIncluded!==false,facsimile:b.facsimile!==false,
   templateId:b.templateId||'',items:items.map(i=>({description:i.description,quantity:i.quantity,unit:i.unit,rate:i.rate,...(i.sourceId?{sourceType:'orderItem',sourceId:i.sourceId}:{})}))});
  return {documentId:doc.doc.id,orderId:order.id,clientId:client.id,created:{client:clientCreated,object:objectCreated,order:orderCreated}};
 }
 return {context,issue};
}
module.exports={createQuickInvoice};
