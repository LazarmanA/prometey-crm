// Сквозная проверка установщика 1.4.2 (Linux-сборка: те же шаги, что в Windows, кроме реестра и ярлыков).
const {spawn,spawnSync}=require('node:child_process');const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const BIN=path.resolve(__dirname,'../dist/prometey-setup-linux');
const base=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-inst-'));
let checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function launch(uiPort){return new Promise((res,rej)=>{const p=spawn(BIN,['--base',base,'--no-browser','--ui-port',String(uiPort)],{env:{...process.env,PROMETEY_TEST_NODE:process.execPath}});let out='';p.stdout.on('data',d=>{out+=d;const m=out.match(/(http:\/\/127\.0\.0\.1:\d+\/\?t=([0-9a-f]+))/);if(m)res({proc:p,url:m[1],token:m[2],base:m[1].split('/?')[0]})});p.stderr.on('data',d=>out+=d);p.on('exit',c=>rej(new Error('exit '+c+' '+out)));setTimeout(()=>rej(new Error('timeout '+out)),15000)})}
const call=(ui,p,body,headers={})=>fetch(ui.base+p,{method:body?'POST':'GET',headers:{'X-Token':ui.token,'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}));
async function installNow(ui){const r=await call(ui,'/api/install',{});assert.equal(r.status,200);for(let i=0;i<300;i++){const p=(await call(ui,'/api/progress')).body;if(p.done)return p;await sleep(500)}throw new Error('install timeout')}
let CRM='';
const crm=(p,opt={})=>fetch(CRM+p.replace(/^\//,''),opt);
const login=async(e,pw)=>crm('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:e,password:pw})});
const tokenOf=async r=>(await r.json()).token;
const H=t=>({authorization:'Bearer '+t,'content-type':'application/json'});
(async()=>{try{
 // --- установка: ни одного вопроса ---
 let ui=await launch(47101);
 ok((await fetch(ui.base+'/')).headers.get('content-security-policy').includes("default-src 'none'"),'setup page served with strict CSP');
 ok((await call(ui,'/api/state',null,{'X-Token':'wrong'})).status===403,'API refuses requests without the one-time key');
 ok(await new Promise(res=>{const u=new URL(ui.base);require('node:http').get({host:u.hostname,port:u.port,path:'/api/state',headers:{'X-Token':ui.token,Host:'evil.example'}},r=>res(r.statusCode===403))}),'API refuses foreign Host (DNS rebinding)');
 ok((await call(ui,'/api/state')).body.existing===null,'fresh install detected');
 let p=await installNow(ui);if(p.error)console.log(JSON.stringify(p,null,1));
 ok(!p.error&&p.steps.every(s=>['ok','warn'].includes(s.status)),'install without any input: '+p.steps.map(s=>s.name).join(' → '));
 CRM=p.url;ok(/^http:\/\/localhost:\d+\/$/.test(CRM)&&p.login==='admin@prometey.local'&&p.password.length>=12,'final screen: address, login and temporary password');
 ok(fs.existsSync(path.join(base,'app','server.js'))&&fs.existsSync(path.join(base,'app','scripts','windows-launcher.js'))&&fs.existsSync(path.join(base,'install.json')),'files in place');
 ok(!fs.readdirSync(base).some(f=>/\.exe$|^Prometey$/i.test(f)),'no own executable left after install (nothing for antivirus to block)');
 ok((fs.statSync(path.join(base,'prometey.env')).mode&0o077)===0,'settings file with passwords is private');
 const env=fs.readFileSync(path.join(base,'prometey.env'),'utf8');ok(env.includes('NODE_ENV=production')&&env.includes('HOST=127.0.0.1')&&env.includes('PROMETEY_ADMIN_MUST_CHANGE=1'),'env: production, local only, temp password must be changed');
 ok((await login('director@prometey.local','director')).status===401&&(await login('manager@prometey.local','manager')).status===401,'demo passwords do not work');
 let t=await tokenOf(await login('admin@prometey.local',p.password));ok(t,'administrator logs in with the temporary password');
 let r=await crm('/api/clients',{headers:H(t)});ok(r.status===403&&(await r.json()).code==='privacy_consent_required','first sign-in: privacy policy must be accepted');
 const pol=await (await crm('/api/privacy',{headers:H(t)})).json();ok((await crm('/api/privacy/accept',{method:'POST',headers:H(t),body:JSON.stringify({agree:true,version:pol.version})})).status===200,'policy accepted');
 r=await crm('/api/clients',{headers:H(t)});ok(r.status===403&&(await r.json()).code==='password_change_required','CRM requires changing the temporary password first');
 r=await crm('/api/profile/password',{method:'POST',headers:H(t),body:JSON.stringify({current:p.password,next:'Boss-Own-Pass-2026!'})});ok(r.status===200,'administrator sets own password');
 t=await tokenOf(await login('admin@prometey.local','Boss-Own-Pass-2026!'));
 r=await crm('/api/clients',{method:'POST',headers:H(t),body:JSON.stringify({name:'Клиент до обновления',address:'Москва',equipmentType:'Кран',note:'проверка',ownership:'own',requestAt:'2026-10-29T10:00'})});ok(r.status===201,'data entered');
 // --- управление сервером из CRM ---
 let s=await (await crm('/api/admin/server',{headers:H(t)})).json();ok(s.managed&&s.version===require('../../crm/package.json').version&&s.network===false&&s.urls.length>=1,'Администрирование → Сервер: status (managed by supervisor)');
 r=await crm('/api/admin/server/backup',{method:'POST',headers:H(t),body:'{}'});ok(r.status===200,'backup now from CRM');
 for(let i=0;i<40&&!(s.backups||[]).length;i++){await sleep(500);s=await (await crm('/api/admin/server',{headers:H(t)})).json()}ok(s.backups.length>=1,'backup listed');
 r=await crm('/api/admin/server/network',{method:'POST',headers:H(t),body:JSON.stringify({on:true})});ok(r.status===200&&fs.readFileSync(path.join(base,'prometey.env'),'utf8').includes('HOST=0.0.0.0'),'LAN access switched on from CRM');
 r=await crm('/api/admin/server/restart',{method:'POST',headers:H(t),body:'{}'});ok(r.status===200,'restart from CRM');
 let up=false;for(let i=0;i<60&&!up;i++){await sleep(500);try{s=await (await crm('/api/admin/server',{headers:H(t)})).json();up=s.network===true&&s.host==='0.0.0.0'}catch{}}ok(up,'supervisor restarted server with LAN access');
 const pid=Number(fs.readFileSync(path.join(base,'data','node.pid'),'utf8'));process.kill(pid,'SIGKILL');
 up=false;for(let i=0;i<60&&!up;i++){await sleep(500);try{up=(await crm('/api/health')).ok&&Number(fs.readFileSync(path.join(base,'data','node.pid'),'utf8'))!==pid}catch{}}ok(up,'supervisor revives the server after a crash');
 ok(fs.readFileSync(path.join(base,'data','logs','prometey.log'),'utf8').includes('[сторож]'),'server log written');
 await crm('/api/admin/server/network',{method:'POST',headers:H(t),body:JSON.stringify({on:false})});
 const other=await tokenOf(await login('admin@prometey.local','Boss-Own-Pass-2026!'));ok(other,'session ok');
 await call(ui,'/api/quit',{});
 // --- обновление: снова без вопросов, пароль не меняется ---
 ui=await launch(47103);ok((await call(ui,'/api/state')).body.existing?.adminEmail==='admin@prometey.local','update detected');
 p=await installNow(ui);ok(!p.error&&p.updated&&p.password==='','update finished, no new password shown');ok(/сохранены/.test(p.steps[0].detail),'automatic backup before update');
 t=await tokenOf(await login('admin@prometey.local','Boss-Own-Pass-2026!'));ok(t,'own password still works after update');
 ok((await (await crm('/api/clients',{headers:H(t)})).json()).some(c=>c.name==='Клиент до обновления'),'data survived the update');
 // --- забыли пароль ---
 r=await call(ui,'/api/reset-password',{});ok(r.status===200&&r.body.password.length>=12,'installer issues a new temporary password');
 ok((await login('admin@prometey.local',r.body.password)).status===200&&(await login('admin@prometey.local','Boss-Own-Pass-2026!')).status===401,'new temporary password works, old one does not');
 const temp2=r.body.password;await call(ui,'/api/quit',{});
 // --- удаление (данные остаются) и повторная установка ---
 spawnSync(process.execPath,[path.join(base,'app','scripts','windows-uninstall.js')]);
 ok(!fs.existsSync(path.join(base,'app'))&&fs.existsSync(path.join(base,'data','prometey.sqlite')),'uninstall: program removed, data kept');
 let down=false;try{await crm('/api/health')}catch{down=true}ok(down,'server stopped after uninstall');
 ui=await launch(47105);p=await installNow(ui);ok(!p.error,'reinstalled over kept data');
 t=await tokenOf(await login('admin@prometey.local',temp2));ok(t,'reinstall keeps passwords');
 await crm('/api/profile/password',{method:'POST',headers:H(t),body:JSON.stringify({current:temp2,next:'Boss-Own-Pass-2027!'})});t=await tokenOf(await login('admin@prometey.local','Boss-Own-Pass-2027!'));
 ok((await (await crm('/api/clients',{headers:H(t)})).json()).some(c=>c.name==='Клиент до обновления'),'reinstall picked up the old data');
 await call(ui,'/api/quit',{});
 spawnSync(process.execPath,[path.join(base,'app','scripts','windows-uninstall.js'),'--all']);
 ok(!fs.existsSync(base),'full uninstall removes everything');
 console.log(`OK installer e2e: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{try{spawnSync(process.execPath,[path.join(base,'app','scripts','windows-launcher.js'),'--stop'])}catch{};try{spawnSync('pkill',['-f',base])}catch{};fs.rmSync(base,{recursive:true,force:true})}})();
