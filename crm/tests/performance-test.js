'use strict';
// 1.3.1: кэш снимка БД — корректность (внешний писатель, откат, изоляция копий) и скорость API на большой базе.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/database');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-perf-'));
const seedFile=path.join(__dirname,'../storage/data.demo.json');

// --- Корректность кэша ---
const dbFile=path.join(temp,'cache.sqlite');
const a=new Store(dbFile,seedFile),b=new Store(dbFile,seedFile);
const n0=a.read().clients.length;
// копии изолированы: изменение прочитанных данных не портит кэш
const tmp=a.read();tmp.clients.push({id:'ghost',name:'Не сохранять'});tmp.users.length=0;
assert.equal(a.read().clients.length,n0);assert(a.read().users.length>0,'cache must not leak mutations');
// откат транзакции не оставляет изменений ни в БД, ни в кэше
assert.throws(()=>a.transaction(d=>{d.clients.push({id:'rolled',name:'Откат'});a.save(d);throw new Error('boom')}),/boom/);
assert(!a.read().clients.some(c=>c.id==='rolled'));assert(!b.read().clients.some(c=>c.id==='rolled'));
// запись через A видна в B, запись через B видна в A (data_version)
a.transaction(d=>{d.clients.push({id:'from_a',name:'Из A'});return {changed:true}});
assert(b.read().clients.some(c=>c.id==='from_a'),'B must see A');
b.transaction(d=>{d.clients.find(c=>c.id==='from_a').name='Изменено в B';return {changed:true}});
assert.equal(a.read().clients.find(c=>c.id==='from_a').name,'Изменено в B','A must see B');
// удаление и порядок
a.transaction(d=>{d.clients=d.clients.filter(c=>c.id!=='from_a');d.clients.reverse();return {changed:true}});
const fresh=new Store(dbFile,seedFile);
assert.deepEqual(fresh.read().clients.map(c=>c.id),a.read().clients.map(c=>c.id));
assert(!fresh.read().clients.some(c=>c.id==='from_a'));
// неизменённые таблицы не перезаписываются, но изменения в непрочитанных полях extras сохраняются
a.transaction(d=>{d.customSetting={x:1};return {changed:true}});
assert.deepEqual(b.read().customSetting,{x:1});
assert.equal(fresh.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
a.close();b.close();fresh.close();
console.log('PASS cache: isolated copies, rollback, cross-connection invalidation, delete/order, extras, integrity');

// --- Скорость на большой базе ---
const seed=JSON.parse(fs.readFileSync(seedFile,'utf8'));
const N=2000,manager=seed.users.find(u=>u.role==='manager')||seed.users[0];
for(let i=0;i<N;i++)seed.clients.push({id:'perf_c'+i,name:'Клиент '+i,inn:String(7700000000+i),phone:'+7 900 000 '+String(i).padStart(4,'0'),address:'Москва',managerId:manager.id,createdAt:new Date().toISOString()});
seed.audit=seed.audit||[];for(let i=0;i<N*3;i++)seed.audit.push({id:'perf_a'+i,at:new Date(Date.now()-i*1000).toISOString(),userId:seed.users[0].id,action:'update',entity:'client',entityId:'perf_c'+(i%N),details:'Тестовая запись журнала '+i});
const bigSeed=path.join(temp,'big.json');fs.writeFileSync(bigSeed,JSON.stringify(seed));
process.env.DATA_FILE=bigSeed;process.env.DB_FILE=path.join(temp,'big.sqlite');process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.RECORDINGS_DIR=path.join(temp,'recordings');process.env.NODE_ENV='test';
const server=require('../server');
(async()=>{
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const login=await (await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'director@prometey.local',password:'director'})})).json();
  const H={authorization:'Bearer '+login.token,'content-type':'application/json','accept-encoding':'gzip'};
  const time=async(fn,n=15)=>{await fn();const s=process.hrtime.bigint();for(let i=0;i<n;i++)await fn();return Number(process.hrtime.bigint()-s)/1e6/n};
  const session=await time(()=>fetch(base+'/api/session',{headers:H}).then(r=>r.json()));
  const dashboard=await time(()=>fetch(base+'/api/dashboard',{headers:H}).then(r=>r.json()));
  const auditPage=await time(()=>fetch(base+'/api/audit?limit=201',{headers:H}).then(r=>r.json()));
  const audit=await (await fetch(base+'/api/audit?limit=201&offset=200',{headers:H})).json();
  assert.equal(audit.length,201);
  const found=await (await fetch(base+'/api/audit?q='+encodeURIComponent('журнала 1234'),{headers:H})).json();
  assert(found.length>=1&&found.every(x=>x.details.includes('журнала 1234')));
  const big=await fetch(base+'/api/clients',{headers:H});assert.equal(big.headers.get('content-encoding'),'gzip');const list=await big.json();assert(list.length>=N);
  const common={address:'Москва, Тестовая, 1',equipmentType:'Экскаватор',ownership:'rented',note:'Проверка скорости',requestAt:'2026-11-01T08:30'};const created=await fetch(base+'/api/clients',{method:'POST',headers:H,body:JSON.stringify({...common,name:'Скорость Тест',inn:'7709876543',phone:'+7 (999) 765-43-21'})});assert.equal(created.status,201,await created.clone().text());const target=await created.json();
  const patch=await time(()=>fetch(base+'/api/clients/'+encodeURIComponent(target.id),{method:'PATCH',headers:H,body:JSON.stringify({...common,name:target.name,inn:target.inn,phone:target.phone,address:'Москва, '+Math.random()})}).then(async r=>{assert.equal(r.status,200,await r.text())}),5);
  console.log(`  session ${session.toFixed(1)} ms · dashboard ${dashboard.toFixed(1)} ms · audit page ${auditPage.toFixed(1)} ms · client PATCH ${patch.toFixed(1)} ms  (${N} компаний, ${N*3} записей журнала)`);
  assert(session<15,'session check too slow: '+session);
  assert(dashboard<60,'dashboard too slow: '+dashboard);
  assert(auditPage<120,'audit page too slow: '+auditPage);
  console.log('PASS performance: cached snapshot, gzip, paged audit');
 }finally{server.close()}
})().catch(e=>{console.error(e);process.exit(1)});
