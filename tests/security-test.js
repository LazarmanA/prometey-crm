const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Security=require('../lib/security');const {Store}=require('../lib/database');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-sec-')),seed=path.join(root,'seed.json');fs.copyFileSync(path.join(__dirname,'../storage/data.demo.json'),seed);
let store=new Store(path.join(root,'test.sqlite'),seed);
try{
 assert(Security.verifyPassword(Security.hashPassword('very-secret'),'very-secret'));
 assert(!Security.verifyPassword(Security.hashPassword('very-secret'),'wrong'));
 Security.bootstrapPasswords(store,{NODE_ENV:'test'});let d=store.read();assert(d.users.every(u=>!u.password&&/^scrypt\$/.test(u.passwordHash)),'passwords hashed at rest');assert(Security.verifyPassword(d.users.find(u=>u.role==='director').passwordHash,'director'));
 // Even a previously hashed demo password must never become a production credential.
 assert.throws(()=>Security.bootstrapPasswords(store,{NODE_ENV:'production'}),/Production launch blocked/);
 store.close();store=new Store(path.join(root,'prod.sqlite'),seed);assert.throws(()=>Security.bootstrapPasswords(store,{NODE_ENV:'production'}),/Production launch blocked/);store.close();
 store=new Store(path.join(root,'prod2.sqlite'),seed);Security.bootstrapPasswords(store,{NODE_ENV:'production',PROMETEY_ADMIN_EMAIL:'boss@example.test',PROMETEY_ADMIN_PASSWORD:'StrongAdminPassword!1',PROMETEY_MANAGER_EMAIL:'manager@example.test',PROMETEY_MANAGER_PASSWORD:'StrongManagerPassword!1'});d=store.read();
 const director=d.users.find(u=>u.role==='director'),manager=d.users.find(u=>u.role==='manager');
 assert.equal(director.email,'boss@example.test');assert.equal(manager.email,'manager@example.test');
 assert(Security.verifyPassword(director.passwordHash,'StrongAdminPassword!1'));assert(!Security.verifyPassword(director.passwordHash,'director'));
 assert.throws(()=>{const s=new Store(path.join(root,'weak.sqlite'),seed);try{Security.bootstrapPasswords(s,{NODE_ENV:'production',PROMETEY_ADMIN_EMAIL:'bad',PROMETEY_ADMIN_PASSWORD:'short',PROMETEY_MANAGER_EMAIL:'manager@example.test',PROMETEY_MANAGER_PASSWORD:'StrongManagerPassword!1'})}finally{s.close()}},/(password|email)/i);
 const s3=new Store(path.join(root,'prod3.sqlite'),seed);try{Security.bootstrapPasswords(s3,{NODE_ENV:'production',PROMETEY_ADMIN_EMAIL:'boss@example.test',PROMETEY_ADMIN_PASSWORD:'StrongAdminPassword!1'});const d3=s3.read();assert.equal(d3.users.find(u=>u.role==='manager').disabled,true,'demo manager disabled when no manager credentials');assert.equal(d3.users.find(u=>u.role==='director').email,'boss@example.test')}finally{s3.close()}
 console.log('PASS password hashing, hashed-demo production guard, role credential replacement, strong production overrides');
}finally{try{store.close()}catch{}fs.rmSync(root,{recursive:true,force:true})}
