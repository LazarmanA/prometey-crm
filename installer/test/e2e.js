// Сквозная проверка установщика 1.6.0 (Linux-сборка: те же шаги, что в Windows, кроме реестра и ярлыков).
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
 CRM=p.url.split('#')[0];ok(/^http:\/\/localhost:\d+\/#setup=[A-Za-z0-9_-]{20,}$/.test(p.url)&&p.setup===true&&p.password==='','final screen opens CRM registration; no passwords to copy');
 const setupToken=p.url.split('#setup=')[1];
 ok(p.steps.some(s=>s.name==='Доступ из офисной сети'&&s.status==='ok'),'office network step done');
 ok(fs.existsSync(path.join(base,'app','server.js'))&&fs.existsSync(path.join(base,'app','scripts','windows-launcher.js'))&&fs.existsSync(path.join(base,'app','scripts','windows-start.jscript'))&&fs.existsSync(path.join(base,'install.json')),'files in place');
 ok(!fs.readdirSync(base).some(f=>/\.exe$|^Prometey$/i.test(f)),'no own executable left after install (nothing for antivirus to block)');
 ok((fs.statSync(path.join(base,'prometey.env')).mode&0o077)===0,'settings file is private');
 const env=fs.readFileSync(path.join(base,'prometey.env'),'utf8');ok(env.includes('NODE_ENV=production')&&env.includes('HOST=0.0.0.0')&&env.includes('PROMETEY_SETUP=1')&&!env.includes('PROMETEY_ADMIN_PASSWORD'),'env: production, open to the office network, registration mode, no password in the file');
 ok((await login('director@prometey.local','director')).status===401&&(await login('manager@prometey.local','manager')).status===401,'demo passwords do not work');
 ok((await (await crm('/api/setup')).json()).needed===true,'CRM waits for the owner to register');
 let r=await crm('/api/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Иван Директоров',email:'boss@firm.ru',password:'Boss-Own-Pass-2026!',company:'ООО Тест',token:setupToken,clearDemo:false})});
 let t=(await r.json()).token;ok(r.status===200&&t,'owner registers and is signed in at once');
 r=await crm('/api/clients',{headers:H(t)});ok(r.status===403&&(await r.json()).code==='privacy_consent_required','first sign-in: privacy policy must be accepted');
 const pol=await (await crm('/api/privacy',{headers:H(t)})).json();ok((await crm('/api/privacy/accept',{method:'POST',headers:H(t),body:JSON.stringify({agree:true,version:pol.version})})).status===200,'policy accepted');
 ok((await crm('/api/clients',{headers:H(t)})).status===200,'owner works without changing any temporary password');
 r=await crm('/api/admin/invites',{method:'POST',headers:H(t),body:JSON.stringify({role:'manager'})});const inv=await r.json();ok(r.status===201&&inv.token,'owner creates an invite link');
 r=await crm('/api/invite/'+inv.token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Мария Менеджерова',email:'maria@firm.ru',password:'Maria-Pass-2026!'})});ok(r.status===200,'employee registers by the link');
 r=await crm('/api/clients',{method:'POST',headers:H(t),body:JSON.stringify({name:'Клиент до обновления',address:'Москва',equipmentType:'Кран',note:'проверка',ownership:'own',requestAt:'2026-10-29T10:00'})});ok(r.status===201,'data entered');
 // --- управление сервером из CRM ---
 let s=await (await crm('/api/admin/server',{headers:H(t)})).json();ok(s.managed&&s.version===require('../../crm/package.json').version&&s.network===true&&s.urls.length>=1,'Администрирование → Сервер: status (managed by supervisor, open to the office network)');
 r=await crm('/api/admin/server/backup',{method:'POST',headers:H(t),body:'{}'});ok(r.status===200,'backup now from CRM');
 for(let i=0;i<40&&!(s.backups||[]).length;i++){await sleep(500);s=await (await crm('/api/admin/server',{headers:H(t)})).json()}ok(s.backups.length>=1,'backup listed');
 r=await crm('/api/admin/server/network',{method:'POST',headers:H(t),body:JSON.stringify({on:false})});ok(r.status===200&&fs.readFileSync(path.join(base,'prometey.env'),'utf8').includes('HOST=127.0.0.1')&&fs.readFileSync(path.join(base,'prometey.env'),'utf8').includes('PROMETEY_NETWORK=off'),'office network switched off from CRM');
 r=await crm('/api/admin/server/restart',{method:'POST',headers:H(t),body:'{}'});ok(r.status===200,'restart from CRM');
 let up=false;for(let i=0;i<60&&!up;i++){await sleep(500);try{s=await (await crm('/api/admin/server',{headers:H(t)})).json();up=s.network===false&&s.host==='127.0.0.1'}catch{}}ok(up,'supervisor restarted server local-only');
 const pid=Number(fs.readFileSync(path.join(base,'data','node.pid'),'utf8'));process.kill(pid,'SIGKILL');
 up=false;for(let i=0;i<60&&!up;i++){await sleep(500);try{up=(await crm('/api/health')).ok&&Number(fs.readFileSync(path.join(base,'data','node.pid'),'utf8'))!==pid}catch{}}ok(up,'supervisor revives the server after a crash');
 ok(fs.readFileSync(path.join(base,'data','logs','prometey.log'),'utf8').includes('[сторож]'),'server log written');
 const other=await tokenOf(await login('boss@firm.ru','Boss-Own-Pass-2026!'));ok(other,'session ok');
 await call(ui,'/api/quit',{});
 // --- обновление: снова без вопросов, пароль не меняется ---
 ui=await launch(47103);ok((await call(ui,'/api/state')).body.existing!==null,'update detected');
 p=await installNow(ui);ok(!p.error&&p.updated&&p.password===''&&!p.setup&&!p.url.includes('#'),'update finished: straight to CRM, no registration, no passwords');ok(/сохранены/.test(p.steps[0].detail),'automatic backup before update');
 ok(fs.readFileSync(path.join(base,'prometey.env'),'utf8').includes('HOST=127.0.0.1'),'update keeps the office network switched off when the owner turned it off');
 t=await tokenOf(await login('boss@firm.ru','Boss-Own-Pass-2026!'));ok(t,'own password still works after update');
 ok((await (await crm('/api/clients',{headers:H(t)})).json()).some(c=>c.name==='Клиент до обновления'),'data survived the update');
 ok((await login('maria@firm.ru','Maria-Pass-2026!')).status===200,'invited employee still signs in after update');
 // --- забыли пароль руководителя ---
 r=await call(ui,'/api/reset-password',{});ok(r.status===200&&/^http:\/\/localhost:\d+\/#setup=/.test(r.body.url),'installer opens CRM page to set a new owner password');
 const rt=r.body.url.split('#setup=')[1];const info=await (await crm('/api/setup')).json();ok(info.needed&&info.reset&&!info.demo,'recovery page: no option to wipe data');
 r=await crm('/api/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Иван Директоров',email:'boss@firm.ru',password:'Boss-Own-Pass-2027!',token:rt})});ok(r.status===200,'owner sets a new password');
 ok((await login('boss@firm.ru','Boss-Own-Pass-2027!')).status===200&&(await login('boss@firm.ru','Boss-Own-Pass-2026!')).status===401,'new password works, old one does not');
 await call(ui,'/api/quit',{});
 // --- удаление (данные остаются) и повторная установка ---
 spawnSync(process.execPath,[path.join(base,'app','scripts','windows-uninstall.js')]);
 ok(!fs.existsSync(path.join(base,'app'))&&fs.existsSync(path.join(base,'data','prometey.sqlite')),'uninstall: program removed, data kept');
 let down=false;try{await crm('/api/health')}catch{down=true}ok(down,'server stopped after uninstall');
 ui=await launch(47105);p=await installNow(ui);ok(!p.error&&!p.setup,'reinstalled over kept data, no new registration');
 t=await tokenOf(await login('boss@firm.ru','Boss-Own-Pass-2027!'));ok(t,'reinstall keeps passwords');
 ok((await (await crm('/api/clients',{headers:H(t)})).json()).some(c=>c.name==='Клиент до обновления'),'reinstall picked up the old data');
 await call(ui,'/api/quit',{});
 spawnSync(process.execPath,[path.join(base,'app','scripts','windows-uninstall.js'),'--all']);
 ok(!fs.existsSync(base),'full uninstall removes everything');
 console.log(`OK installer e2e: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{try{spawnSync(process.execPath,[path.join(base,'app','scripts','windows-launcher.js'),'--stop'])}catch{};try{spawnSync('pkill',['-f',base])}catch{};fs.rmSync(base,{recursive:true,force:true})}})();
