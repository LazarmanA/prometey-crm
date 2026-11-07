#!/usr/bin/env node
'use strict';
// Runs every test suite (backend + browser) one by one and prints a summary table.
// Usage: npm run test:full            — everything
//        npm run test:full -- --no-browser   — backend only (no Chromium needed)
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.join(__dirname,'..');
const noBrowser=process.argv.includes('--no-browser');

const backend=[
 ['Синтаксис + release gate','tests/release-test.js'],
 ['Лиды','tests/leads-test.js'],
 ['Документы: три типа','tests/documents-three-types-test.js'],
 ['Логотипы и свои шаблоны договоров','tests/files-test.js'],
 ['Подписка и пульт продавца','tests/license-test.js'],
 ['Авито → Лиды','tests/avito-test.js'],
 ['Согласие с политикой ПДн, список e-mail','tests/privacy-test.js'],
 ['Команда: регистрация, приглашения, файлы в ленте','tests/team-test.js'],
 ['Перенос данных и архив ленты','tests/transfer-test.js'],
 ['Восстановление пароля','tests/recovery-test.js'],
 ['Организация: реквизиты, стиль, импорт Excel','tests/company-test.js'],
 ['Подпись и печать в документах','tests/facsimile-test.js'],
 ['Производительность API','tests/performance-test.js']
];
const browser=[
 ['Сборка демо','scripts/build-demo.js'],
 ['UI: основной сценарий','tests/browser-test.js'],
 ['UI: CDP smoke','tests/browser-smoke-cdp.js'],
 ['UI: заставка','tests/intro-test.js'],
 ['UI: звонки','tests/calls-browser-test.js'],
 ['UI: рабочие столы','tests/workspaces-browser-test.js'],
 ['UI: чат и контакты','tests/chat-contacts-browser-test.js'],
 ['UI: телефония','tests/telephony-browser-test.js'],
 ['UI: удобство (горячие клавиши, поиск)','tests/ux-browser-test.js'],
 ['UI: защита от XSS','tests/xss-browser-test.js'],
 ['UI: лента, администрирование, бухгалтерия','tests/office-browser-test.js'],
 ['UI: перетаскивание файлов','tests/files-browser-test.js'],
 ['UI: вход, согласие, почта, Авито','tests/onboarding-browser-test.js'],
 ['UI: регистрация, приглашение, файлы в ленте','tests/team-browser-test.js'],
 ['UI: регистрация организации и импорт','tests/org-browser-test.js'],
 ['UI: подпись и печать, документы из карточки компании','tests/facsimile-browser-test.js']
];
const suites=noBrowser?backend:[...backend,...browser];
const results=[];
for(const [name,file] of suites){
 const started=Date.now();
 const r=spawnSync(process.execPath,['--no-warnings',path.join(root,file)],{cwd:root,encoding:'utf8',timeout:10*60*1000,env:{...process.env,NODE_NO_WARNINGS:'1'}});
 const ok=r.status===0;const sec=((Date.now()-started)/1000).toFixed(1);
 results.push({name,file,ok,sec});
 process.stdout.write(`${ok?'✔':'✘'} ${name} (${sec} с)\n`);
 if(!ok)process.stdout.write(String(r.stdout||'').split('\n').slice(-15).join('\n')+'\n'+String(r.stderr||'').split('\n').slice(-25).join('\n')+'\n');
}
const failed=results.filter(r=>!r.ok);
console.log(`\nИтого: ${results.length-failed.length}/${results.length} пройдено`+(failed.length?`; упали: ${failed.map(f=>f.file).join(', ')}`:''));
process.exit(failed.length?1:0);
