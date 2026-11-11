#!/usr/bin/env node
'use strict';
// Удаление ПРОМЕТЕЙ CRM (Windows, установка для пользователя). Вызывается из «Параметры → Приложения».
//   node windows-uninstall.js          — удалить программу, данные (база, документы, резервные копии) оставить
//   node windows-uninstall.js --all    — удалить всё
const fs=require('node:fs'),path=require('node:path'),{spawn,spawnSync}=require('node:child_process');
const APP=path.resolve(__dirname,'..'),BASE=path.resolve(APP,'..'),DATA=path.join(BASE,'data');
const all=process.argv.includes('--all'),win=process.platform==='win32';
const reg=(...a)=>win&&spawnSync('reg',a,{windowsHide:true});
console.log('Удаление ПРОМЕТЕЙ CRM…');
spawnSync(process.execPath,[path.join(__dirname,'windows-launcher.js'),'--stop'],{windowsHide:true});
console.log('  сервер остановлен');
reg('delete','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','/v','PrometeyCRM','/f');
reg('delete','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PrometeyCRM','/f');
let info={};try{info=JSON.parse(fs.readFileSync(path.join(BASE,'install.json'),'utf8'))}catch{}
for(const f of info.shortcuts||[])fs.rmSync(f,{recursive:true,force:true});
console.log('  автозапуск и ярлыки удалены');
fs.rmSync(path.join(BASE,'install.json'),{force:true});
if(all){fs.rmSync(DATA,{recursive:true,force:true});fs.rmSync(path.join(BASE,'prometey.env'),{force:true})}
// node.exe, который выполняет этот скрипт, нельзя удалить, пока он работает, — удаляем через несколько секунд
const targets=all?[BASE]:[path.join(BASE,'app'),path.join(BASE,'runtime')];
if(win)spawn('cmd',['/c','ping 127.0.0.1 -n 4 >nul & '+targets.map(t=>`rmdir /s /q "${t}"`).join(' & ')],{detached:true,stdio:'ignore',windowsHide:true}).unref();
else for(const t of targets)fs.rmSync(t,{recursive:true,force:true});
console.log(all?'Готово. Программа и все данные удалены.':`Готово. Программа удалена. Данные сохранены в ${DATA} — при повторной установке они подключатся автоматически.`);
if(win)setTimeout(()=>{},4000);
