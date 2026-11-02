'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const CRM=require('../lib/crm'),{Store}=require('../lib/database');
const f=path.join(require('node:os').tmpdir(),'prometey-leads-'+process.pid+'.sqlite');
let store;
try{
 store=new Store(f,path.join(__dirname,'../storage/data.demo.json'));
 const data=store.read(),director=data.users.find(u=>u.role==='director');assert(director);
 const call=(method,p,body={})=>store.transaction(d=>CRM.handle(d,director,method,new URL(p,'http://localhost'),body));
 let err;try{call('POST','/api/leads',{name:'Тест'})}catch(e){err=e}assert.match(err.message,/следующее действие|следующее действие и срок/i);
 const created=call('POST','/api/leads',{name:'ООО Тест',source:'call',phone:'+7 (999) 999-99-99',nextAction:'Перезвонить',nextAt:'2030-01-01T13:00'});assert.equal(created.status,201);const id=created.body.id;
 assert.equal(call('GET','/api/leads').body.length,1);
 let dup;try{call('POST','/api/leads',{name:'Копия',phone:'89999999999',nextAction:'Позвонить',nextAt:'2030-01-01T13:00'})}catch(e){dup=e};assert.equal(dup.status,409);
 call('POST','/api/leads/'+id+'/events',{type:'call',text:'Обсудили ставки'});
 assert.equal(call('GET','/api/leads/'+id+'/events').body.length,2);
 const changed=call('PATCH','/api/leads/'+id,{status:'in_progress',nextAction:'Отправить КП',nextAt:'2030-01-02T11:00'});assert.equal(changed.body.status,'in_progress');
 const result=call('GET','/api/leads/'+id).body;assert.equal(result.nextAction,'Отправить КП');
 // Regression: manager must not convert own lead into another manager's inaccessible client.
 const manager=data.users.find(v=>v.role==='manager');
 const other=data.clients.find(v=>v.managerId&&v.managerId!==manager.id)||data.clients[1];
 other.managerId=director.id;
 const foreignInn='9922446688';other.inn=foreignInn;other.phone='+7 901 888-77-66';
 const managerCall=(method,p,body={})=>store.transaction(d=>CRM.handle(d,manager,method,new URL(p,'http://localhost'),body));
 const scoped=managerCall('POST','/api/leads',{name:'Проверка чужого клиента',source:'own',inn:foreignInn,nextAction:'Позвонить',nextAt:'2030-01-01T13:00'}).body;
 let denied;try{managerCall('POST','/api/leads/'+scoped.id+'/convert',{})}catch(e){denied=e}
 assert.equal(denied?.status,409,'Foreign client must not be linked to lead');

 console.log('PASS lead CRUD, duplicates, events, next action, status and SQLite persistence');
}finally{if(store)store.close();for(const suffix of ['','-wal','-shm'])try{fs.unlinkSync(f+suffix)}catch{}}
