const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const seed=JSON.parse(fs.readFileSync(path.join(root,'storage/data.demo.json'),'utf8'));
let app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const a=app.indexOf('async function api('),b=app.indexOf('function logout()',a);
const adapter=`
function migrateLegacy(old){
 if(!old||!Array.isArray(old.eq)||!Array.isArray(old.orders)||!Array.isArray(old.users))throw new Error('Не удалось прочитать старую демо-базу');
 const users=old.users.map(u=>({...u,password:u.pass}));
 const objects=old.objects.map(o=>({...o,managerId:o.manager,address:o.address||'',status:'active'}));
 const equipment=old.eq.map(e=>({...e,ownership:e.own,saleRate:e.sale||0,purchaseRate:e.buy||0,lat:55.75,lng:37.61}));
 const orders=old.orders.map(o=>({...o,name:o.name||o.num,number:o.num,clientId:o.client,objectId:o.object,managerId:o.manager,start:o.start||'',end:o.end||''}));
 const orderItems=old.orders.flatMap(o=>(o.items||[]).map(([id,quantity],index)=>{const e=equipment.find(e=>e.id===id);return {id:'legacy_'+o.id+'_'+index,orderId:o.id,equipmentId:id,quantity,saleRate:e?.saleRate||0,purchaseRate:e?.purchaseRate||0,extras:0,unit:'shift'}}));
 const assignments=old.eq.filter(e=>e.object).map(e=>({id:'legacy_a_'+e.id,objectId:e.object,equipmentId:e.id,orderId:orders.find(o=>o.objectId===e.object)?.id||'',status:e.status}));
 return {users,objects,equipment,orders,orderItems,assignments,clients:old.clients,partners:[],shifts:[],audit:[],modules:PORTABLE_SEED.modules};
}
function readDemo(){const saved=localStorage.getItem('prometey_demo_v04');if(saved)return JSON.parse(saved);const old=localStorage.getItem('pdemo');const initial=old?migrateLegacy(JSON.parse(old)):structuredClone(PORTABLE_SEED);localStorage.setItem('prometey_demo_v04',JSON.stringify(initial));return initial}
async function api(path,opts={}){
 const data=readDemo(),url=new URL(path,'http://demo.local'),method=opts.method||'GET',body=opts.body?JSON.parse(opts.body):{};
 if(path==='/api/config')return {yandexMapsApiKey:''};
 if(path==='/api/session'){const u=data.users.find(u=>'demo:'+u.id===token);if(!u)return {user:null};const {password,pass,...safe}=u;return {user:{...safe,perms:PrometeyAccess.perms(data,u)}}}
 if(path==='/api/login'){const user=data.users.find(u=>u.email===body.email&&u.password===body.password);if(!user)throw new Error('Неверный логин или пароль');const {password,pass,...safe}=user;return {token:'demo:'+user.id,user:{...safe,perms:PrometeyAccess.perms(data,user)}}}
 const user=data.users.find(u=>'demo:'+u.id===token);if(!user)throw new Error('Требуется вход');
 if(path==='/api/integrations'){if(user.role!=='director')throw new Error('Доступно руководителю');return {offline:true,providers:[{id:'onec',configured:false},{id:'bitrix24',configured:false}],logs:[]}}
 if(path.startsWith('/api/feed/unread'))return {unread:0,important:0};
 if(['/api/documents','/api/telephony','/api/feed','/api/admin','/api/accounting','/api/profile'].some(x=>path.startsWith(x)))throw new Error('Раздел доступен только в серверной версии (npm start)');
 if(path.startsWith('/api/integrations/')){if(user.role!=='director')throw new Error('Доступно руководителю');if(path.endsWith('/preview'))return {id:'offline',payload:portableSnapshot(data)};throw new Error('Нужна серверная сборка')}
 const result=PrometeyCRM.handle(data,user,method,url,body);if(result.changed)localStorage.setItem('prometey_demo_v04',JSON.stringify(data));return result.body;
}
`;
app=app.slice(0,a)+adapter+app.slice(b);
// Demo has no cookie session: keep the demo token in this browser and restore it on reload.
const loginOld="token='';me=r.user;";if(!app.includes(loginOld))throw new Error('build-demo: login hook not found in app.js');
app=app.replace(loginOld,"token=r.token||'';try{localStorage.setItem('prometey_demo_session',token)}catch{}me=r.user;");
const meOld="api('/api/session')";if(!app.includes(meOld))throw new Error('build-demo: /api/me bootstrap not found in app.js');
const outOld="localStorage.removeItem('prometey_user');";if(!app.includes(outOld))throw new Error('build-demo: logout hook not found in app.js');
app=app.replace(outOld,outOld+"try{localStorage.removeItem('prometey_demo_session')}catch{}");
app=app.replace(meOld,"(token=(()=>{try{return localStorage.getItem('prometey_demo_session')||''}catch{return ''}})(),api('/api/session'))");
app=app.replace("if(token)fetch('/api/logout',{method:'POST',headers:{Authorization:'Bearer '+token}}).catch(()=>{});",'');
app=app.replace('Build 0.10','Build 0.10').replace('/ Test 0.10','/ Демо 0.10 · данные в этом браузере');
const script='const PORTABLE_SEED='+JSON.stringify(seed).replace(/</g,'\\u003c')+';\n'+fs.readFileSync(path.join(root,'lib/contacts.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'lib/access.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'lib/crm.js'),'utf8')+'\nconst portableSnapshot='+require('../lib/integrations').snapshot.toString()+';\n'+fs.readFileSync(path.join(root,'public/integrations.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'public/contacts.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'public/documents.js'),'utf8')+'\n'+['feed','admin','accounting'].map(f=>fs.readFileSync(path.join(root,'public/'+f+'.js'),'utf8')).join('\n')+'\n'+fs.readFileSync(path.join(root,'public/calls.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'public/collaboration.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'public/workspaces.js'),'utf8')+'\n'+app+'\n'+fs.readFileSync(path.join(root,'public/shortcuts.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'public/intro.js'),'utf8');
const html='<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ПРОМЕТЕЙ CRM 0.10</title><style>'+fs.readFileSync(path.join(root,'public/styles.css'),'utf8')+fs.readFileSync(path.join(root,'public/intro.css'),'utf8')+fs.readFileSync(path.join(root,'public/workspaces.css'),'utf8')+fs.readFileSync(path.join(root,'public/office.css'),'utf8')+fs.readFileSync(path.join(root,'public/collaboration.css'),'utf8')+fs.readFileSync(path.join(root,'public/documents.css'),'utf8')+'</style></head><body><div id="app"></div><div id="modal-root"></div><div id="toast-root" class="toast-root"></div><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
fs.writeFileSync(path.join(root,'../PROMETEY_DEMO_0.10.html'),html);
console.log('Built PROMETEY_DEMO_0.10.html ('+Buffer.byteLength(html)+' bytes)');
