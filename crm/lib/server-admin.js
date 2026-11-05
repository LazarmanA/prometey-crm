// «Администрирование → Сервер»: состояние, перезапуск, резервная копия, журнал, доступ из офисной сети.
// Перезапуск и смена настроек работают, когда CRM запущена сторожем установщика (PROMETEY_MANAGED=1):
// сервер завершается с кодом 75, и сторож сразу запускает его снова.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn,spawnSync}=require('node:child_process');
const Access=require('./access');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const RESTART_CODE=75;
const startedAt=new Date().toISOString();

function lanIPs(){return Object.values(os.networkInterfaces()).flat().filter(a=>a&&a.family==='IPv4'&&!a.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)).map(a=>a.address)}
function tail(file,lines=300){try{const st=fs.statSync(file);const fd=fs.openSync(file,'r');const len=Math.min(st.size,256*1024);const buf=Buffer.alloc(len);fs.readSync(fd,buf,0,len,st.size-len);fs.closeSync(fd);return buf.toString('utf8').split(/\r?\n/).slice(-lines).join('\n')}catch{return ''}}
function setEnv(file,key,value){let lines=[];try{lines=fs.readFileSync(file,'utf8').split(/\r?\n/)}catch{}let found=false;lines=lines.map(l=>{if(l.startsWith(key+'=')){found=true;return key+'='+value}return l});if(!found){while(lines.length&&!lines.at(-1))lines.pop();lines.push(key+'='+value)}const tmp=file+'.tmp';fs.writeFileSync(tmp,lines.join('\r\n').replace(/(\r\n)*$/,'\r\n'),{mode:0o600});fs.renameSync(tmp,file)}

// Брандмауэр Windows: правило «PrometeyCRM» пускает к CRM компьютеры офисной сети (то же делает установщик).
const RULE='PrometeyCRM';
function firewallStatus(port){
 if(process.platform!=='win32')return 'n/a';
 try{const r=spawnSync('netsh',['advfirewall','firewall','show','rule','name='+RULE,'verbose'],{windowsHide:true,encoding:'latin1',timeout:15000});if(r.status!==0)return 'missing';const out=String(r.stdout||'');return out.includes(String(port))?'ok':'missing'}catch{return 'unknown'}
}
function firewallCommands(node,port){return [`netsh advfirewall firewall delete rule name="${RULE}" >nul 2>&1`,`netsh advfirewall firewall delete rule name=all program="${node}" >nul 2>&1`,`netsh advfirewall firewall add rule name="${RULE}" dir=in action=allow program="${node}" protocol=TCP localport=${port} remoteip=localsubnet,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16 profile=any`].join(' & ')}
// Права администратора Windows: на экране этого компьютера появится вопрос «Разрешить?».
function firewallFix(port){return new Promise((resolve,reject)=>{
 if(process.platform!=='win32')return resolve();
 const args='/c '+firewallCommands(process.execPath,port);
 const ps=`$p=Start-Process -FilePath 'cmd.exe' -ArgumentList '${args.replace(/'/g,"''")}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
 const c=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',ps],{windowsHide:true});
 let err='';c.stderr.on('data',d=>err+=d);c.on('error',reject);
 c.on('exit',code=>code===0?resolve():reject(Object.assign(new Error(/cancel|отмен/i.test(err)?'В окне Windows нажали «Нет» — доступ из сети не разрешён':'Windows не разрешил изменить брандмауэр. Запустите установщик ПРОМЕТЕЙ ещё раз и нажмите «Да»'),{status:409})));
 setTimeout(()=>{try{c.kill()}catch{};reject(Object.assign(new Error('Нет ответа на вопрос Windows. Подтвердите разрешение на экране компьютера, где установлена CRM'),{status:409}))},120000).unref();
})}

function createServerAdmin({root,dbFile,port:getPort}){
 const backupsDir=()=>process.env.BACKUP_DIR||path.join(path.dirname(dbFile),'backups');
 const managed=()=>process.env.PROMETEY_MANAGED==='1'&&!!process.env.PROMETEY_ENV_FILE;
 const listBackups=()=>{try{return fs.readdirSync(backupsDir(),{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name.startsWith('prometey-')).map(e=>{const p=path.join(backupsDir(),e.name);let size=0;const walk=d=>{for(const x of fs.readdirSync(d,{withFileTypes:true})){const q=path.join(d,x.name);if(x.isDirectory())walk(q);else size+=fs.statSync(q).size}};try{walk(p)}catch{}return {name:e.name,at:fs.statSync(p).mtime.toISOString(),size}}).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,15)}catch{return []}};
 const runBackup=()=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,['--disable-warning=ExperimentalWarning',path.join(root,'scripts','full-backup.js')],{cwd:root,env:{...process.env,BACKUP_DIR:backupsDir()},windowsHide:true});let out='',err='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>err+=d);c.on('exit',code=>code===0?resolve(out):reject(new Error(err.trim()||'резервная копия не создана')))});
 return async function handle(user,method,url,body,data){
  if(!Access.at(Access.perms(data,user),'settings','yes'))fail('Раздел доступен администратору',403);
  const p=url.pathname,host=process.env.HOST||'127.0.0.1',port=getPort(),network=!['127.0.0.1','localhost','::1'].includes(host);
  if(p==='/api/admin/server'&&method==='GET'){
   const urls=[`http://localhost:${port}/`,...(network?lanIPs().map(ip=>`http://${ip}:${port}/`):[])];
   return {managed:managed(),version:require('../package.json').version,startedAt,platform:process.platform,host,port,network,urls,firewall:network?firewallStatus(port):'n/a',lanIPs:lanIPs(),backups:listBackups(),log:tail(process.env.PROMETEY_LAUNCHER_LOG||''),dataDir:path.dirname(dbFile)};
  }
  if(method!=='POST')fail('Операция не найдена',404);
  if(p==='/api/admin/server/backup'){await runBackup();return {ok:true,message:'Резервная копия создана',backups:listBackups()}}
  if(!managed())fail('Перезапуск и настройки доступны, когда CRM установлена установщиком ПРОМЕТЕЙ',409);
  const restart=()=>setTimeout(()=>process.exit(RESTART_CODE),400);
  if(p==='/api/admin/server/restart'){restart();return {ok:true,message:'CRM перезапускается — страница обновится через несколько секунд'}}
  if(p==='/api/admin/server/firewall'){await firewallFix(port);return {ok:true,message:'Брандмауэр Windows пропускает к CRM компьютеры офисной сети',firewall:firewallStatus(port)}}
  if(p==='/api/admin/server/network'){const on=body.on===true;if(on&&process.env.NODE_ENV!=='production')fail('В демо-режиме доступ из сети закрыт: пароли director/director известны всем',409);
   let note='';if(on&&firewallStatus(port)==='missing'){try{await firewallFix(port)}catch(e){note=' '+e.message}}
   setEnv(process.env.PROMETEY_ENV_FILE,'HOST',on?'0.0.0.0':'127.0.0.1');setEnv(process.env.PROMETEY_ENV_FILE,'PROMETEY_NETWORK',on?'on':'off');restart();
   return {ok:true,message:(on?'Доступ из офисной сети включается — через несколько секунд коллеги смогут открыть CRM.':'Доступ только с этого компьютера')+note}}
  fail('Операция не найдена',404);
 };
}
module.exports={createServerAdmin,RESTART_CODE,setEnv,lanIPs,firewallCommands};
