const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/database');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-db-'));
const seed=path.join(__dirname,'../storage/data.demo.json'),original=fs.readFileSync(seed,'utf8'),filename=path.join(root,'test.sqlite');
(async()=>{let store=new Store(filename,seed);try{
 assert.deepEqual(store.read(),JSON.parse(original),'lossless JSON migration');
 store.transaction(data=>{data.clients[0].name='Сохранённая компания';data.customSettings={timezone:'Europe/Moscow'};return {changed:true}});
 const before=store.read();
 assert.throws(()=>store.transaction(data=>{data.clients[0].name='Must roll back';data.orders.push({...data.orders[0]});return {changed:true}}),/duplicate/);
 assert.deepEqual(store.read(),before,'whole transaction rollback');
 store.close();store=new Store(filename,'missing.json');assert.deepEqual(store.read(),before,'restart without source JSON');
 const second=new Store(filename,'missing.json');second.transaction(data=>{data.clients[1].name='Second connection';return {changed:true}});second.close();
 store.transaction(data=>{assert.equal(data.clients[1].name,'Second connection');data.clients[0].phone='123';return {changed:true}});
 const dest=await store.backup(path.join(root,'backup.sqlite'));const restored=new Store(dest,'missing.json');assert.deepEqual(restored.read(),store.read(),'consistent SQLite backup');restored.close();
 await assert.rejects(store.backup(filename));await assert.rejects(store.backup(dest));
 assert.equal(fs.readFileSync(seed,'utf8'),original,'seed unchanged');
 assert.equal(store.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 console.log('PASS database migration, unknown fields, atomic rollback, restart, second connection, backup/restore, overwrite guard, integrity, seed preservation');
 }finally{store.close();fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
