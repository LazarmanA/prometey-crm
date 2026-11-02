#!/usr/bin/env node
'use strict';
// Задаёт логины и пароли руководителя и менеджера для рабочего (production) запуска.
// Записывает PROMETEY_ADMIN_* и PROMETEY_MANAGER_* в файл настроек (по умолчанию /etc/prometey.env),
// остальные строки файла не трогает. При следующем запуске сервер заменит демо-пароли и закроет старые сессии.
//   node scripts/set-credentials.js [/etc/prometey.env]
const fs=require('node:fs');
const path=require('node:path');
const readline=require('node:readline');

const file=path.resolve(process.argv[2]||process.env.PROMETEY_ENV_FILE||'/etc/prometey.env');
const WEAK=new Set(['director','manager','password','qwerty','123456789012','change-me-at-least-12-chars']);

function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)&&v.length<=320}
function passwordProblem(p,email){
 if(p.length<12)return 'не короче 12 символов';
 if(p.length>200)return 'не длиннее 200 символов';
 if(/[\r\n'"`$\\]/.test(p))return 'без кавычек, знаков $ ` \\ и переводов строки';
 if(WEAK.has(p.toLowerCase())||p.toLowerCase()===email.toLowerCase())return 'слишком простой пароль';
 const kinds=[/[a-zа-яё]/,/[A-ZА-ЯЁ]/,/\d/,/[^\p{L}\p{N}]/u].filter(r=>r.test(p)).length;
 if(kinds<3)return 'используйте минимум три вида символов: строчные, заглавные, цифры, знаки';
 return '';
}
function ask(rl,question,{hidden=false}={}){
 return new Promise(resolve=>{
  if(!hidden)return rl.question(question,a=>resolve(a.trim()));
  const out=rl.output;let muted=false;
  rl._writeToOutput=function(s){if(!muted)out.write(s);else if(s.includes('\n'))out.write('\n')};
  rl.question(question,a=>{muted=false;rl._writeToOutput=s=>out.write(s);resolve(a)});muted=true;
 });
}
// Значение для env-файла: одинарные кавычки одинаково понимают systemd и bash (опасные символы запрещены выше).
function quote(v){return /^[A-Za-z0-9@._+\-]+$/.test(v)?v:"'"+v+"'"}

async function account(rl,label,other){
 for(;;){
  const email=(await ask(rl,`E-mail (логин) ${label}: `)).toLowerCase();
  if(!validEmail(email)){console.log('  Неверный e-mail, попробуйте ещё раз.');continue}
  if(other&&email===other){console.log('  Логины руководителя и менеджера должны различаться.');continue}
  for(;;){
   const password=await ask(rl,`Пароль ${label} (символы не видны): `,{hidden:true});
   const problem=passwordProblem(password,email);if(problem){console.log('  Пароль: '+problem+'.');continue}
   const again=await ask(rl,'Повторите пароль: ',{hidden:true});
   if(again!==password){console.log('  Пароли не совпали.');continue}
   return {email,password};
  }
 }
}

(async()=>{
 if(!process.stdin.isTTY){console.error('Запустите команду в терминале: нужен ввод с клавиатуры.');process.exit(2)}
 try{fs.accessSync(path.dirname(file),fs.constants.W_OK)}catch{console.error('Нет прав на запись '+file+'. Запустите от root (sudo).');process.exit(2)}
 const rl=readline.createInterface({input:process.stdin,output:process.stdout,terminal:true});
 console.log('Логины и пароли для входа в ПРОМЕТЕЙ CRM. Пароль: от 12 символов, буквы разного регистра, цифры или знаки.\n');
 const admin=await account(rl,'руководителя');
 const manager=await account(rl,'менеджера',admin.email);
 rl.close();
 const keys={PROMETEY_ADMIN_EMAIL:admin.email,PROMETEY_ADMIN_PASSWORD:admin.password,PROMETEY_MANAGER_EMAIL:manager.email,PROMETEY_MANAGER_PASSWORD:manager.password};
 let lines=[];try{lines=fs.readFileSync(file,'utf8').split(/\r?\n/)}catch{}
 lines=lines.filter(l=>!Object.keys(keys).some(k=>l.startsWith(k+'=')));
 while(lines.length&&!lines.at(-1).trim())lines.pop();
 lines.push('# Учётные записи (задаются командой: prometey passwords)');
 for(const [k,v] of Object.entries(keys))lines.push(k+'='+quote(v));
 const tmp=file+'.tmp-'+process.pid;
 let mode=0o640,uid=-1,gid=-1;try{const st=fs.statSync(file);mode=st.mode&0o777;uid=st.uid;gid=st.gid}catch{}
 fs.writeFileSync(tmp,lines.join('\n')+'\n',{mode:0o600});
 if(uid>=0)try{fs.chownSync(tmp,uid,gid)}catch{}
 fs.chmodSync(tmp,mode&0o770);fs.renameSync(tmp,file);
 console.log('\nСохранено в '+file+'. Перезапустите CRM, чтобы пароли вступили в силу.');
})().catch(e=>{console.error('Ошибка: '+e.message);process.exit(1)});
