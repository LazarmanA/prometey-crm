// «Администрирование → Сервер»: состояние, перезапуск, резервная копия, журнал, доступ из офисной сети.
// Перезапуск и смена настроек работают, когда CRM запущена сторожем установщика (PROMETEY_MANAGED=1):
// сервер завершается с кодом 75, и сторож сразу запускает его снова.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const Access=require('./access');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const RESTART_CODE=75;
const startedAt=new Date().toISOString();

function lanIPs(){return Object.values(os.networkInterfaces()).flat().filter(a=>a&&a.family==='IPv4'&&!a.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)).map(a=>a.address)}
function tail(file,lines=300){try{const st=fs.statSync(file);const fd=fs.openSync(file,'r');const len=Math.min(st.size,256*1024);const buf=Buffer.alloc(len);fs.readSync(fd,buf,0,len,st.size-len);fs.closeSync(fd);return buf.toString('utf8').split(/\r?\n/).slice(-lines).join('\n')}catch{return ''}}
function setEnv(file,key,value){let lines=[];try{lines=fs.readFileSync(file,'utf8').split(/\r?\n/)}catch{}let found=false;lines=lines.map(l=>{if(l.startsWith(key+'=')){found=true;return key+'='+value}return l});if(!found){while(lines.length&&!lines.at(-1))lines.pop();lines.push(key+'='+value)}const tmp=file+'.tmp';fs.writeFileSync(tmp,lines.join('\r\n').replace(/(\r\n)*$/,'\r\n'),{mode:0o600});fs.renameSync(tmp,file)}

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
   return {managed:managed(),version:require('../package.json').version,startedAt,platform:process.platform,host,port,network,urls,lanIPs:lanIPs(),backups:listBackups(),log:tail(process.env.PROMETEY_LAUNCHER_LOG||''),dataDir:path.dirname(dbFile)};
  }
  if(method!=='POST')fail('Операция не найдена',404);
  if(p==='/api/admin/server/backup'){await runBackup();return {ok:true,message:'Резервная копия создана',backups:listBackups()}}
  if(!managed())fail('Перезапуск и настройки доступны, когда CRM установлена установщиком ПРОМЕТЕЙ',409);
  const restart=()=>setTimeout(()=>process.exit(RESTART_CODE),400);
  if(p==='/api/admin/server/restart'){restart();return {ok:true,message:'CRM перезапускается — страница обновится через несколько секунд'}}
  if(p==='/api/admin/server/network'){const on=body.on===true;if(on&&process.env.NODE_ENV!=='production')fail('В демо-режиме доступ из сети закрыт: пароли director/director известны всем',409);setEnv(process.env.PROMETEY_ENV_FILE,'HOST',on?'0.0.0.0':'127.0.0.1');restart();return {ok:true,message:on?'Доступ из офисной сети включается. Если Windows спросит разрешение для Node.js — нажмите «Разрешить доступ».':'Доступ только с этого компьютера'}}
  fail('Операция не найдена',404);
 };
}
module.exports={createServerAdmin,RESTART_CODE,setEnv};
