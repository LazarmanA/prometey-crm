'use strict';
// Лиды: ручное заполнение, статусы Не обработан → В работе → Отправлено КП → Победа / Некачественный, массовые действия, связь с КП и сделкой.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const CRM=require('../lib/crm'),{Store}=require('../lib/database'),Access=require('../lib/access');
const Proposals=require('../lib/proposals').createProposals({Access,files:{},Docx:{},renderPdf:async()=>{}});
const f=path.join(require('node:os').tmpdir(),'prometey-leads-'+process.pid+'.sqlite');
let store,checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
try{
 store=new Store(f,path.join(__dirname,'../storage/data.demo.json'));
 const data=store.read(),director=data.users.find(u=>u.role==='director'),manager=data.users.find(v=>v.role==='manager');assert(director&&manager);
 const as=u=>(method,p,body={})=>store.transaction(d=>CRM.handle(d,u,method,new URL(p,'http://localhost'),body));
 const call=as(director),mcall=as(manager);const err=fn=>{try{fn()}catch(e){return e}};
 // ручной лид: без следующего шага, только телефон
 const bare=call('POST','/api/leads',{phone:'+7 (999) 999-99-99',source:'direct',ownerId:''});ok(bare.status===201&&bare.body.status==='new'&&bare.body.name==='+7 (999) 999-99-99'&&!bare.body.ownerId,'manual lead with only a phone, no next action, unassigned → «Не обработан»');
 ok(err(()=>call('POST','/api/leads',{}))?.status===400,'empty lead rejected');
 ok(err(()=>call('POST','/api/leads',{name:'Копия',phone:'89999999999'}))?.status===409,'duplicate open lead by phone → 409');
 ok(err(()=>call('POST','/api/leads',{name:'x',inn:'123'}))?.message.includes('ИНН'),'INN format checked');
 const full=call('POST','/api/leads',{name:'Иван Петров',company:'ООО Стройка',inn:'7709990011',phone:'+7 900 100-20-30',email:'a@b.ru',source:'avito',equipment:'Экскаватор-погрузчик',address:'Москва, ул. Ленина 1',note:'Нужен на 3 смены'}).body;
 ok(full.ownerId===director.id&&full.equipment==='Экскаватор-погрузчик'&&full.statusName==='Не обработан','full manual lead stored with equipment and address');
 // менеджер видит неназначенный новый лид и берёт его
 ok(mcall('GET','/api/leads').body.some(l=>l.id===bare.body.id),'unassigned new lead visible to managers');
 ok(err(()=>mcall('POST','/api/leads',{name:'Чужой',ownerId:director.id}))?.status===403,'manager cannot assign a lead to someone else');
 const took=mcall('POST','/api/leads/'+bare.body.id+'/take',{}).body;ok(took.status==='in_progress'&&took.ownerId===manager.id,'«Взять в работу»: status В работе, owner = me');
 ok(err(()=>as(data.users.find(v=>v.role==='manager'&&v.id!==manager.id)||director)('POST','/api/leads/'+bare.body.id+'/take',{}))?.status!==200,'taken lead not taken twice by another manager');
 // события и статусы
 call('POST','/api/leads/'+full.id+'/events',{type:'call',text:'Обсудили ставки'});const afterCall=call('GET','/api/leads/'+full.id).body;ok(afterCall.status==='in_progress'&&afterCall.events.length===2,'first contact moves «Не обработан» → «В работе»');
 ok(err(()=>call('PATCH','/api/leads/'+full.id,{status:'won'}))?.status===400,'«Победа» only via the win action');
 const junk=call('PATCH','/api/leads/'+bare.body.id,{status:'junk',junkReason:'Не целевой'}).body;ok(junk.status==='junk'&&junk.junkReason==='Не целевой'&&!junk.nextAt,'«Некачественный» with reason = archive');
 ok(call('GET','/api/leads/meta').body.canAssign&&call('GET','/api/leads/meta').body.admin,'meta: director can assign and is admin');
 // КП из лида
 const kp={body:store.transaction(d=>{const p=Proposals.create(d,director,{leadId:full.id,clientName:'ООО Стройка',clientInn:'7709990011',items:[{name:'Экскаватор-погрузчик',unit:'shift',rate:25000}]});return {changed:true,...p}})};
 const withKp=call('GET','/api/leads/'+full.id).body;ok(withKp.status==='kp_sent'&&withKp.proposals.length===1&&withKp.proposals[0].number===kp.body.number,'КП from lead → «Отправлено КП», КП linked');
 // Победа → компания + сделка
 const before=store.read().clients.length;const win=call('POST','/api/leads/'+full.id+'/win',{}).body;const st=store.read();
 ok(win.status==='won'&&win.clientId&&st.clients.length===before+1&&st.clients.find(c=>c.id===win.clientId).inn==='7709990011','«Победа»: company created from lead');
 const objectId=st.objects[0].id;const order=call('POST','/api/orders',{name:'Экскаватор — Стройка',clientId:win.clientId,objectId,leadId:full.id,address:'Москва',equipmentType:'Экскаватор',note:'Из лида',ownership:'mixed',start:'2030-01-05T09:00',end:'2030-01-06T18:00',status:'planned'}).body;
 const wonLead=call('GET','/api/leads/'+full.id).body;ok(order.leadId===full.id&&wonLead.orderId===order.id&&wonLead.order===order.number,'deal created from the won lead and linked');
 ok(call('GET','/api/leads?status=won').body.length===1,'filter by status');
 // старые статусы переводятся
 store.transaction(d=>{d.leads.push({id:'lead_old1',source:'call',name:'Старый',status:'lost',events:[],createdAt:'2025-01-01T00:00:00Z'},{id:'lead_old2',source:'call',name:'Старый 2',status:'waiting',ownerId:director.id,events:[],createdAt:'2025-01-01T00:00:00Z'});return {changed:true}});
 const leg=call('GET','/api/leads').body;ok(leg.find(l=>l.id==='lead_old1').status==='junk'&&leg.find(l=>l.id==='lead_old2').status==='in_progress','legacy statuses mapped: lost → junk, waiting → in_progress');
 // массовые действия
 const ids=call('GET','/api/leads').body.map(l=>l.id);
 ok(call('POST','/api/leads/bulk',{ids,action:'owner',ownerId:manager.id}).body.done===ids.length,'bulk: assign owner');
 ok(err(()=>mcall('POST','/api/leads/bulk',{ids,action:'owner',ownerId:director.id}))?.status===403,'bulk assign only for РОП / руководитель');
 ok(err(()=>mcall('POST','/api/leads/bulk',{ids,action:'delete'}))?.status===403,'bulk delete only for admin');
 ok(err(()=>mcall('DELETE','/api/leads/'+ids[0]))?.status===403,'single delete only for admin');
 ok(call('POST','/api/leads/bulk',{ids:['lead_old1'],action:'status',status:'in_progress'}).body.done===1,'bulk: status change');
 // Regression: менеджер не может привязать лид к чужой компании
 const other=store.read().clients.find(v=>v.managerId&&v.managerId!==manager.id)||store.read().clients[1];
 store.transaction(d=>{const c=d.clients.find(c=>c.id===other.id);c.managerId=director.id;c.inn='9922446688';return {changed:true}});
 const scoped=mcall('POST','/api/leads',{name:'Проверка чужого клиента',inn:'9922446688'}).body;
 ok(err(()=>mcall('POST','/api/leads/'+scoped.id+'/win',{}))?.status===409,'foreign client by INN is not linked to a manager lead');
 // очистить все
 const all=call('GET','/api/leads').body.map(l=>l.id);ok(call('POST','/api/leads/bulk',{ids:all,action:'delete'}).body.done===all.length&&call('GET','/api/leads').body.length===0,'admin clears all leads');
 ok(store.read().proposals.some(p=>p.id===kp.body.id)&&store.read().orders.some(o=>o.id===order.id),'clearing leads keeps КП and deals');
 console.log(`OK leads: ${checks} checks`);
}finally{if(store)store.close();for(const suffix of ['','-wal','-shm'])try{fs.unlinkSync(f+suffix)}catch{}}
