#!/usr/bin/env node
'use strict';
// Сторож сервера ПРОМЕТЕЙ CRM для Windows (и для проверки на Linux).
// Запускается подписанным node.exe — антивирусы его не блокируют, отдельного exe не нужно.
//
//   node windows-launcher.js --detach   — запуск в фоне без окна (так стартует автозагрузка Windows)
//   node windows-launcher.js            — работа сторожа: держит server.js запущенным, пишет журнал,
//                                         раз в сутки делает резервную копию
//   node windows-launcher.js --stop     — остановить сервер и сторожа
//
// Раскладка: <база>\app\scripts\windows-launcher.js, <база>\prometey.env, <база>\data\...
const fs=require('node:fs'),path=require('node:path'),{spawn,spawnSync}=require('node:child_process');

const APP=path.resolve(__dirname,'..'),BASE=path.resolve(APP,'..'),DATA=path.join(BASE,'data');
const ENV_FILE=process.env.PROMETEY_ENV_FILE||path.join(BASE,'prometey.env');
const LOGS=path.join(DATA,'logs'),BACKUPS=path.join(DATA,'backups');
const PID=path.join(DATA,'launcher.pid'),NODE_PID=path.join(DATA,'node.pid'),LOG=path.join(LOGS,'prometey.log');
const RESTART_CODE=75; // сервер завершился с этим кодом — просьба перезапустить (смена настроек из CRM)

function readEnv(){const out={};let text='';try{text=fs.readFileSync(ENV_FILE,'utf8')}catch{}for(const raw of text.split(/\r?\n/)){const line=raw.replace(/^﻿/,'').trim();if(!line||line.startsWith('#'))continue;const i=line.indexOf('=');if(i<=0)continue;let v=line.slice(i+1);if(v.length>=2&&v[0]==="'"&&v.at(-1)==="'")v=v.slice(1,-1);out[line.slice(0,i).trim()]=v}return out}
const alive=pid=>{try{process.kill(pid,0);return true}catch(e){return e.code==='EPERM'}};
const readPid=f=>{try{const n=Number(fs.readFileSync(f,'utf8'));return Number.isInteger(n)&&n>0?n:0}catch{return 0}};

// ---------- журнал с ротацией 10 МБ ----------
let logFd=null,logSize=0;
function log(text){try{fs.mkdirSync(LOGS,{recursive:true});if(logFd===null){logFd=fs.openSync(LOG,'a');logSize=fs.fstatSync(logFd).size}const b=Buffer.from(text);if(logSize+b.length>10*1024*1024){fs.closeSync(logFd);try{fs.rmSync(LOG+'.1',{force:true});fs.renameSync(LOG,LOG+'.1')}catch{}logFd=fs.openSync(LOG,'a');logSize=0}fs.writeSync(logFd,b);logSize+=b.length}catch{}}
const note=msg=>log(`${new Date().toLocaleString('sv-SE').replace('T',' ')} [сторож] ${msg}\n`);

function stop(){
 for(const f of [PID,NODE_PID]){const pid=readPid(f);if(pid&&alive(pid)){try{if(process.platform==='win32')spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true});else process.kill(pid,'SIGTERM')}catch{}}}
 const sleep=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
 for(let i=0;i<50&&[PID,NODE_PID].some(f=>{const p=readPid(f);return p&&alive(p)});i++)sleep(100);
 for(const f of [PID,NODE_PID])fs.rmSync(f,{force:true});
}

if(process.argv.includes('--stop')){stop();process.exit(0)}

if(process.argv.includes('--detach')){
 // Окно консоли автозагрузки закрывается сразу: сторож продолжает работу отдельным скрытым процессом.
 const pid=readPid(PID);if(pid&&alive(pid))process.exit(0);
 const child=spawn(process.execPath,[__filename],{detached:true,stdio:'ignore',windowsHide:true,cwd:APP});child.unref();process.exit(0);
}

// ---------- сторож ----------
fs.mkdirSync(DATA,{recursive:true});
{const pid=readPid(PID);if(pid&&pid!==process.pid&&alive(pid)){process.exit(0)}}
fs.writeFileSync(PID,String(process.pid));
let child=null,stopping=false;
const cleanup=()=>{stopping=true;if(child&&!child.killed){try{child.kill()}catch{}}fs.rmSync(NODE_PID,{force:true});if(readPid(PID)===process.pid)fs.rmSync(PID,{force:true})};
process.on('exit',cleanup);for(const s of ['SIGINT','SIGTERM','SIGHUP'])process.on(s,()=>{note('получен сигнал остановки');cleanup();process.exit(0)});

let delay=2000;
function startServer(){
 if(stopping)return;
 const env={...process.env,...readEnv(),PROMETEY_ENV_FILE:ENV_FILE,PROMETEY_LAUNCHER_LOG:LOG,PROMETEY_MANAGED:'1'};
 const started=Date.now();
 child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',path.join(APP,'server.js')],{cwd:APP,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 fs.writeFileSync(NODE_PID,String(child.pid));
 note(`сервер запущен, процесс ${child.pid}`);
 child.stdout.on('data',log);child.stderr.on('data',log);
 child.on('exit',(code,signal)=>{
  fs.rmSync(NODE_PID,{force:true});child=null;if(stopping)return;
  const restart=code===RESTART_CODE;note(restart?'перезапуск по команде из CRM':`сервер остановился (код ${code??signal})`);
  if(Date.now()-started>5*60*1000||restart)delay=restart?300:2000;
  setTimeout(startServer,delay);if(!restart)delay=Math.min(delay*2,60000);
 });
}
note(`запуск, папка ${BASE}`);
startServer();

// ---------- ежедневная резервная копия после 03:30, хранение 30 дней (не меньше 7 копий) ----------
function backups(){try{return fs.readdirSync(BACKUPS,{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name.startsWith('prometey-')).map(e=>({name:e.name,at:fs.statSync(path.join(BACKUPS,e.name)).mtimeMs})).sort((a,b)=>b.at-a.at)}catch{return []}}
function backupIfDue(){
 const list=backups(),last=list[0]?.at||0,now=new Date(),today=now.toDateString();
 const due=(now.getHours()*60+now.getMinutes()>=210&&new Date(last).toDateString()!==today)||Date.now()-last>26*3600*1000;
 if(!due||!fs.existsSync(path.join(DATA,'prometey.sqlite')))return;
 const r=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning',path.join(APP,'scripts','full-backup.js')],{cwd:APP,env:{...process.env,...readEnv(),BACKUP_DIR:BACKUPS},windowsHide:true,encoding:'utf8',timeout:10*60*1000});
 note(r.status===0?'резервная копия создана':'резервная копия не создана: '+String(r.stderr||r.error||'').trim().slice(-300));
 for(const [i,b] of backups().entries())if(i>=7&&Date.now()-b.at>30*24*3600*1000)fs.rmSync(path.join(BACKUPS,b.name),{recursive:true,force:true});
}
setTimeout(backupIfDue,2*60*1000);
setInterval(backupIfDue,10*60*1000);
