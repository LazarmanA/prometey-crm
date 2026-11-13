'use strict';
// Журнал работ сделки: что техника отработала в каждый день.
// Строка журнала = смена CRM (shifts) по назначению техники на объект сделки. Назначение создаётся само.
// Менеджер копирует строку или целый день на следующую дату.
const UNITS=['shift','hour','trip','unit','day','machine_hour','km','ton','m3'];
const HOURLY=['hour','machine_hour'];
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e};
const str=v=>String(v??'').trim();
const round=n=>Math.round((Number(n)||0)*100)/100;
const day=v=>{const s=str(v).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return '';const d=new Date(s+'T00:00:00Z');return Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==s?'':s};
const addDays=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};

function createJournal({CRM}){
 const call=(d,u,method,path,body)=>{const r=CRM.handle(d,u,method,new URL('http://local'+path),body);if(!r||r.status>=400)fail(r?.body?.error||'Не удалось сохранить',r?.status||400);return r.body};
 const {orderScope,sharedOrderScope}=CRM.scopes;
 const eqName=e=>[e?.type,e?.model,e?.plate].filter(Boolean).join(' · ')||'Техника';

 function orderFor(d,u,id,write){const o=(write?orderScope(d,u):sharedOrderScope(d,u)).find(o=>o.id===id);if(!o)fail('Сделка не найдена',404);
  if(write){if(!CRM.canEdit(d,u,'orders',o))fail('Журнал заполняет ответственный менеджер или руководитель',403);if(o.archivedAt)fail('Сделка в архиве',409)}return o}
 const assignmentsOf=(d,o)=>d.assignments.filter(a=>a.orderId===o.id);
 const shiftsOf=(d,o)=>{const ids=new Set(assignmentsOf(d,o).map(a=>a.id));return d.shifts.filter(s=>ids.has(s.assignmentId))};
 // строка плана сделки по технике — откуда брать ставки по умолчанию
 const planLine=(d,o,eqId)=>d.orderItems.find(i=>i.orderId===o.id&&!i.archivedAt&&i.equipmentId===eqId);

 function row(d,s){const a=d.assignments.find(a=>a.id===s.assignmentId),eq=d.equipment.find(e=>e.id===a?.equipmentId);const r=(d.realizations||[]).find(x=>x.id===s.realizationId);
  const qty=s.billableQuantity??null,sum=qty!=null&&s.saleRate!=null?round(qty*s.saleRate+(Number(s.overtime)||0)*(Number(s.overtimeSaleRate)||0)):0,cost=qty!=null&&s.purchaseRate!=null?round(qty*s.purchaseRate+(Number(s.overtime)||0)*(Number(s.overtimePurchaseRate)||0)+(Number(s.extras)||0)):0;
  return {id:s.id,date:s.date,equipmentId:a?.equipmentId||'',equipment:eqName(eq),ownership:eq?.ownership||'',quantity:qty,unit:s.unit||'shift',rate:s.saleRate??null,purchaseRate:s.purchaseRate??null,hours:s.hours,overtime:s.overtime||0,overtimeRate:s.overtimeSaleRate||0,overtimePurchaseRate:s.overtimePurchaseRate||0,downtime:s.downtime||0,comment:s.comment||'',sum,cost,partnerId:s.partnerId??(eq?.ownership==='rented'?eq.partnerId||'':''),purchase:s.purchaseId?((d.purchases||[]).find(x=>x.id===s.purchaseId)?.updNumber||(d.purchases||[]).find(x=>x.id===s.purchaseId)?.number||'док.'):'',
   check:s.check?.status||'new',checkComment:s.check?.comment||'',locked:!!s.realizationId,realization:r?r.number:'',
   object:d.objects.find(o=>o.id===a?.objectId)?.name||'',service:s.service??'Услуги аренды техники',attachment:s.attachment||'',driver:s.driver??(eq?.driver||''),driverRate:s.driverRate??null,driverHours:s.driverHours??null,driverPay:round((Number(s.driverRate)||0)*(Number(s.driverHours)||0)),responsibleId:s.responsibleId||'',responsible:d.users.find(x=>x.id===s.responsibleId)?.name||'',
   partner:(d.partners||[]).find(p=>p.id===(s.partnerId??(eq?.ownership==='rented'?eq.partnerId:'')))?.name||'',profit:round(sum-cost),margin:sum?Math.round((sum-cost)/sum*100):0,scan:!!s.supplierScan,original:!!s.supplierOriginal}}

 function view(d,u,id){const o=orderFor(d,u,id,false);
  const rows=shiftsOf(d,o).map(s=>row(d,s)).sort((a,b)=>a.date.localeCompare(b.date)||a.equipment.localeCompare(b.equipment));
  const days=[];for(const r of rows){let g=days.at(-1);if(!g||g.date!==r.date){g={date:r.date,rows:[],sum:0};days.push(g)}g.rows.push(r);g.sum=round(g.sum+r.sum)}
  const plan=d.orderItems.filter(i=>i.orderId===o.id&&!i.archivedAt);
  const equipment=[...new Map([...plan.map(i=>[i.equipmentId,i]),...assignmentsOf(d,o).map(a=>[a.equipmentId,null])]).entries()].map(([eqId,i])=>{const e=d.equipment.find(x=>x.id===eqId);return e&&{id:e.id,name:eqName(e),ownership:e.ownership,unit:i?.unit||'shift',rate:i?.saleRate??e.saleRate??0,purchaseRate:i?.purchaseRate??e.purchaseRate??0,planQuantity:i?.quantity||0}}).filter(Boolean);
  const byEq=equipment.map(e=>{const r=rows.filter(x=>x.equipmentId===e.id);return {id:e.id,name:e.name,unit:e.unit,plan:e.planQuantity,fact:round(r.reduce((s,x)=>s+(x.quantity||0),0)),days:new Set(r.map(x=>x.date)).size}});
  const planSum=round(plan.reduce((s,i)=>s+i.saleRate*i.quantity,0)),fact=round(rows.reduce((s,r)=>s+r.sum,0));
  const partners=(d.partners||[]).filter(p=>!p.archivedAt).map(p=>({id:p.id,name:p.name})).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  const client=d.clients.find(c=>c.id===o.clientId);
  const paid=round((d.payments||[]).filter(x=>x.clientId===o.clientId&&!x.deletedAt).reduce((a,x)=>a+(Number(x.amount)||0),0)),realized=round((d.realizations||[]).filter(r=>r.clientId===o.clientId&&r.status==='posted').reduce((a,r)=>a+(Number(r.totals?.gross)||0),0));
  const people=d.users.filter(x=>!x.disabled).map(x=>({id:x.id,name:x.name}));
  return {partners,people,legalEntities:(d.legalEntities||[]).map(x=>({id:x.id,name:x.shortName||x.name})),order:{id:o.id,number:o.number,name:o.name,start:String(o.start||'').slice(0,10),end:String(o.end||'').slice(0,10),canEdit:CRM.canEdit(d,u,'orders',o)&&!o.archivedAt,
   createdAt:o.createdAt||'',status:o.status,client:client?.name||'',clientId:o.clientId,object:d.objects.find(x=>x.id===o.objectId)?.name||'',paymentForm:o.paymentForm||'cashless',intermediary:!!o.intermediary,legalEntityId:o.legalEntityId||(d.legalEntities||[])[0]?.id||'',contract:o.contract||'',managerId:o.managerId||'',manager:d.users.find(x=>x.id===o.managerId)?.name||'',note:o.note||'',balance:round(paid-realized),canAssign:CRM.canEdit(d,u,'orders',o)&&!!CRM.scopes.editsAll?.(d,u)},equipment,days:days.reverse(),byEq,
   totals:{plan:planSum,fact,cost:round(rows.reduce((s,r)=>s+r.cost,0)),qty:round(rows.reduce((s,r)=>s+(r.quantity||0),0)),profit:round(fact-rows.reduce((s,r)=>s+r.cost,0)),driverPay:round(rows.reduce((s,r)=>s+r.driverPay,0)),rows:rows.length,days:days.length,unchecked:rows.filter(r=>!r.locked&&r.check==='new').length,rejected:rows.filter(r=>!r.locked&&r.check==='rejected').length,invoiced:rows.filter(r=>r.locked).length}};
 }

 // назначение техники на объект сделки — создаём, если ещё нет
 function assignment(d,u,o,eqId){let a=assignmentsOf(d,o).find(a=>a.equipmentId===eqId);if(a)return a;
  const e=d.equipment.find(x=>x.id===eqId);if(!e)fail('Техника не найдена');
  const r=call(d,u,'POST','/api/assignments',{objectId:o.objectId,equipmentId:eqId,orderId:o.id,start:String(o.start||'').slice(0,10),end:String(o.end||'').slice(0,10),status:'planned',details:'Из журнала работ сделки'});
  return d.assignments.find(x=>x.id===r.id)}

 function values(d,o,eqId,b,old={}){
  const pl=planLine(d,o,eqId),e=d.equipment.find(x=>x.id===eqId);
  const unit=UNITS.includes(b.unit)?b.unit:(old.unit||pl?.unit||'shift');
  const qty=b.quantity===''||b.quantity==null?(old.billableQuantity??1):Number(b.quantity);
  if(!(qty>0))fail('Укажите, сколько отработано');
  const rate=b.rate===''||b.rate==null?(old.saleRate??pl?.saleRate??e?.saleRate??0):Number(b.rate);
  const purchaseRate=b.purchaseRate===''||b.purchaseRate==null?(old.purchaseRate??pl?.purchaseRate??e?.purchaseRate??0):Number(b.purchaseRate);
  if(!(rate>=0)||!(purchaseRate>=0))fail('Проверьте ставку');
  const hours=b.hours===''||b.hours==null?(old.hours??(HOURLY.includes(unit)?Math.min(24,qty):8)):Number(b.hours);
  const partnerId=b.partnerId===undefined?(old.partnerId??(pl?.partnerId||(e?.ownership==='rented'?e.partnerId||'':''))):str(b.partnerId);
  return {unit,billableQuantity:qty,saleRate:rate,purchaseRate,partnerId,hours,overtime:Number(b.overtime??old.overtime??0)||0,overtimeSaleRate:Number(b.overtimeRate??old.overtimeSaleRate??(pl?Math.round(pl.saleRate/8):0))||0,
   overtimePurchaseRate:Number(b.overtimePurchaseRate??old.overtimePurchaseRate??(pl?Math.round(pl.purchaseRate/8):0))||0,downtime:Number(b.downtime??old.downtime??0)||0,extras:Number(old.extras||0),comment:str(b.comment??old.comment??'').slice(0,500)};
 }

 // поля строки как в 1С, которых нет в смене CRM: услуга, навесное, водитель, тариф ЗП, часы сотрудника, ответственный, скан, оригинал
 const CORE=['date','equipmentId','unit','quantity','rate','purchaseRate','partnerId','hours','overtime','overtimeRate','overtimePurchaseRate','downtime','comment'];
 const num=(v,label)=>{if(v===''||v==null)return null;const n=Number(v);if(!(n>=0))fail('Проверьте поле «'+label+'»');return n};
 function extras(d,s,b,defaults){const e=defaults||{};
  if(b.service!==undefined||e.service!==undefined)s.service=str(b.service??e.service).slice(0,200);
  if(b.attachment!==undefined)s.attachment=str(b.attachment).slice(0,200);
  if(b.driver!==undefined||e.driver!==undefined)s.driver=str(b.driver??e.driver).slice(0,200);
  if(b.driverRate!==undefined)s.driverRate=num(b.driverRate,'Тариф ЗП');
  if(b.driverHours!==undefined){s.driverHours=num(b.driverHours,'Часы сотр.');if(s.driverHours>24)fail('Часы сотрудника не больше 24')}
  if(b.responsibleId!==undefined||e.responsibleId!==undefined){const r=str(b.responsibleId??e.responsibleId);if(r&&!d.users.some(x=>x.id===r))fail('Ответственный не найден');s.responsibleId=r}
  if(b.scan!==undefined)s.supplierScan=b.scan===true||b.scan==='true';
  if(b.original!==undefined)s.supplierOriginal=b.original===true||b.original==='true'}
 function add(d,u,id,b){const o=orderFor(d,u,id,true);const date=day(b.date);if(!date)fail('Укажите дату');if(!b.equipmentId)fail('Выберите технику');
  const a=assignment(d,u,o,b.equipmentId);
  if(d.shifts.some(s=>s.assignmentId===a.id&&s.date===date))fail(`${eqName(d.equipment.find(e=>e.id===b.equipmentId))}: на ${date.split('-').reverse().join('.')} уже есть строка — измените её`,409);
  const r=call(d,u,'POST','/api/shifts',{assignmentId:a.id,date,...values(d,o,b.equipmentId,b)});const e=d.equipment.find(x=>x.id===b.equipmentId);extras(d,d.shifts.find(x=>x.id===r.id),b,{service:'Услуги аренды техники',driver:e?.driver||'',responsibleId:o.managerId||u.id});return {id:r.id}}

 function update(d,u,id,shiftId,b){const o=orderFor(d,u,id,true);const s=shiftsOf(d,o).find(s=>s.id===shiftId);if(!s)fail('Строка не найдена',404);
  if(!CORE.some(k=>b[k]!==undefined)){const docOnly=Object.keys(b).every(k=>['scan','original'].includes(k));if(s.realizationId&&!docOnly)fail('Строка уже в реализации — изменить её может бухгалтерия',409);extras(d,s,b);s.updatedAt=new Date().toISOString();return {id:s.id}}
  const a=d.assignments.find(a=>a.id===s.assignmentId);let target=a;
  if(b.equipmentId&&b.equipmentId!==a.equipmentId)target=assignment(d,u,o,b.equipmentId);
  const date=b.date?day(b.date):s.date;if(!date)fail('Проверьте дату');
  const r=call(d,u,'PATCH','/api/shifts/'+s.id,{assignmentId:target.id,date,...values(d,o,target.equipmentId,b,s)});extras(d,s,b);return {id:r.id}}

 function remove(d,u,id,shiftId){const o=orderFor(d,u,id,true);const s=shiftsOf(d,o).find(s=>s.id===shiftId);if(!s)fail('Строка не найдена',404);
  if(s.realizationId)fail('Строка уже в реализации — удалить её может бухгалтерия после отмены реализации',409);
  d.shifts=d.shifts.filter(x=>x.id!==s.id);d.audit.unshift({id:'log_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8),at:new Date().toISOString(),userId:u.id,action:'delete',entity:'shifts',entityId:s.id,details:'Журнал '+o.number+' · '+s.date});return {ok:true}}

 // Копировать: одну строку или весь день → на указанную дату или на следующий свободный день
 function copy(d,u,id,b){const o=orderFor(d,u,id,true);const all=shiftsOf(d,o);
  const src=b.shiftId?all.filter(s=>s.id===b.shiftId):all.filter(s=>s.date===day(b.date));
  if(!src.length)fail('Нечего копировать',404);
  const from=src[0].date,to=day(b.to)||addDays(from,1);if(to<=from&&!b.to)fail('Проверьте дату');
  const created=[],skipped=[];
  for(const s of src){const a=d.assignments.find(a=>a.id===s.assignmentId);let date=to;
   if(b.shiftId&&!b.to)while(all.some(x=>x.assignmentId===a.id&&x.date===date))date=addDays(date,1);
   if(d.shifts.some(x=>x.assignmentId===a.id&&x.date===date)){skipped.push(eqName(d.equipment.find(e=>e.id===a.equipmentId)));continue}
   const r=call(d,u,'POST','/api/shifts',{assignmentId:a.id,date,unit:s.unit||'shift',billableQuantity:s.billableQuantity??1,saleRate:s.saleRate??0,purchaseRate:s.purchaseRate??0,partnerId:s.partnerId||'',extras:0,hours:s.hours,downtime:0,overtime:0,overtimeSaleRate:s.overtimeSaleRate||0,overtimePurchaseRate:s.overtimePurchaseRate||0,comment:''});
   const n=d.shifts.find(x=>x.id===r.id);for(const k of ['service','attachment','driver','driverRate','driverHours','responsibleId'])if(s[k]!==undefined)n[k]=s[k];
   created.push({id:r.id,date})}
  if(!created.length)fail('На эту дату строки уже есть: '+skipped.join(', '),409);
  return {created,skipped,date:created[0].date}}

 return {view,add,update,remove,copy};
}
module.exports={createJournal};
