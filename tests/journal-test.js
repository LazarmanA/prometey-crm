'use strict';
// Журнал работ сделки: ежедневные строки, копирование строки и дня, связь со «Счётом по факту».
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-journal-'));process.env.DATA_FILE=path.join(temp,'data.json');process.env.UPLOADS_DIR=path.join(temp,'up');process.env.DOCUMENTS_DIR=path.join(temp,'docs');process.env.PROMETEY_CHROMIUM='/nonexistent';
fs.copyFileSync(path.join(__dirname,'../storage/data.demo.json'),process.env.DATA_FILE);const server=require('../server');let base,checks=0;
const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
async function req(p,token,method='GET',body){const r=await fetch(base+p,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const type=r.headers.get('content-type')||'';return {status:r.status,body:type.includes('application/json')?await r.json():null}}
(async()=>{try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});base='http://127.0.0.1:'+server.address().port;
 const login=async role=>(await req('/api/login',null,'POST',{email:role+'@prometey.local',password:role})).body.token;
 const manager=await login('manager'),director=await login('director');
 for(const t of [manager,director]){const r=await req('/api/privacy',t);await req('/api/privacy/accept',t,'POST',{agree:true,version:r.body.version})}
 const st=server.store.read();const order=st.orders.find(o=>o.id==='o1');const plan=st.orderItems.filter(i=>i.orderId==='o1'&&!i.archivedAt);
 let r=await req('/api/deals/o1/journal',manager);ok(r.status===200&&r.body.equipment.length>=plan.length&&r.body.order.canEdit,'journal opens with the deal’s equipment');
 const e1=plan[0],e2=plan[1]||null;const before=r.body.totals.rows;
 r=await req('/api/deals/o1/journal',manager,'POST',{date:'2026-11-09',equipmentId:e1.equipmentId});
 ok(r.status===201,'row added for a day');let row=r.body.journal.days.find(g=>g.date==='2026-11-09').rows.find(x=>x.equipmentId===e1.equipmentId);
 ok(row.rate===e1.saleRate&&row.unit===e1.unit&&row.quantity===1&&row.sum===e1.saleRate,'rate and unit taken from the deal plan');
 r=await req('/api/deals/o1/journal',manager,'POST',{date:'2026-11-09',equipmentId:e1.equipmentId});ok(r.status===409&&/уже есть строка/.test(r.body.error),'same machine, same day → «уже есть строка»');
 // копировать строку → следующий день, ещё раз → следующий свободный
 r=await req('/api/deals/o1/journal/copy',manager,'POST',{shiftId:row.id});ok(r.status===201&&r.body.date==='2026-11-10','copy row → next day');
 r=await req('/api/deals/o1/journal/copy',manager,'POST',{shiftId:row.id});ok(r.status===201&&r.body.date==='2026-11-11','copy again → next free day');
 // правка: полсмены + переработка
 r=await req('/api/deals/o1/journal/'+row.id,manager,'PATCH',{quantity:0.5,overtime:2,overtimeRate:5000,comment:'Дождь после обеда'});row=r.body.journal.days.find(g=>g.date==='2026-11-09').rows[0];
 ok(r.status===200&&row.quantity===0.5&&row.sum===e1.saleRate*0.5+10000&&row.comment==='Дождь после обеда','edit: half shift + 2 h overtime → sum recalculated');
 // вторая машина и копирование всего дня
 if(e2){await req('/api/deals/o1/journal',manager,'POST',{date:'2026-11-09',equipmentId:e2.equipmentId,quantity:1});
  r=await req('/api/deals/o1/journal/copy',manager,'POST',{date:'2026-11-09',to:'2026-11-10'});
  ok(r.status===201&&r.body.created.length===1&&r.body.skipped.length===1,'copy whole day: new rows created, existing ones skipped');
  r=await req('/api/deals/o1/journal/copy',manager,'POST',{date:'2026-11-11'});ok(r.status===201&&r.body.date==='2026-11-12','copy day → next day by default')}
 // копия не тащит переработку и комментарий
 const v=(await req('/api/deals/o1/journal',manager)).body;const d10=v.days.find(g=>g.date==='2026-11-10').rows.find(x=>x.equipmentId===e1.equipmentId);
 ok(d10.overtime===0&&!d10.comment,'copied row has no overtime/comment of the original');
 ok(v.days[0].date>=v.days.at(-1).date&&v.totals.rows>before&&v.totals.fact>0&&v.byEq[0].days>=3,'days newest first; totals and per-machine counters');
 // удалить
 const last=v.days[0].rows[0];r=await req('/api/deals/o1/journal/'+last.id,manager,'DELETE');ok(r.status===200&&!r.body.journal.days.some(g=>g.rows.some(x=>x.id===last.id)),'row deleted');
 // «Счёт по факту» берёт строки журнала
 r=await req('/api/documents/preview',manager,'POST',{type:'invoice',orderId:'o1',source:'actual',vatRate:22,vatIncluded:true});
 ok(r.status===200&&r.body.items.some(i=>i.description.includes('2026-11-09'))&&r.body.items.some(i=>i.description.startsWith('Переработка')),'«Счёт по факту» picks up journal days and overtime');
 // бухгалтерия видит работы
 const acc=await req('/api/accounting/works?orderId=o1',director);if(acc.status===200)ok((acc.body.rows||[]).some(w=>w.date==='2026-11-09'),'accounting sees the journal rows');
 // права
 const other=server.store.read().orders.find(o=>o.managerId&&o.managerId!=='u-manager'&&!o.archivedAt);
 if(other){r=await req('/api/deals/'+other.id+'/journal',manager,'POST',{date:'2026-11-09',equipmentId:e1.equipmentId});ok([403,404].includes(r.status),'manager cannot fill someone else’s deal')}
 r=await req('/api/deals/o1/journal',manager,'POST',{date:'2026-13-40',equipmentId:e1.equipmentId});ok(r.status===400,'bad date refused');
 console.log(`OK journal: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
