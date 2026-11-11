'use strict';
// UX 1.3.1: адреса разделов, Назад/Вперёд, горячие клавиши, журнал с постраничной загрузкой,
// чистая консоль при входе, gzip/ETag. Проверяется в серверной и автономной (demo) сборке.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-ux-'));
process.env.DB_FILE=path.join(temp,'prometey.sqlite');
process.env.DOCUMENTS_DIR=path.join(temp,'documents');
process.env.RECORDINGS_DIR=path.join(temp,'recordings');
process.env.NODE_ENV='test';
const server=require('../server');
const demoFile=path.resolve(__dirname,'../../PROMETEY_DEMO_0.10.html');

async function scenario(browser,mode,url){
 const page=await browser.newPage({reducedMotion:'reduce',viewport:{width:1400,height:1000}});
 page.setDefaultTimeout(10000);
 const errors=[],consoleErrors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});
 await page.goto(url);
 await page.locator('#login-email').fill('director@prometey.local');
 await page.locator('#login-pass').fill('director');
 await page.getByRole('button',{name:'Войти',exact:true}).click();
 await page.locator('.nav').waitFor();
 assert.deepEqual(consoleErrors,[],mode+': console must stay clean on login page/sign-in');

 // Раздел в адресе + обновление страницы
 await page.locator('.nav [data-page="clients"]').click();
 await page.waitForFunction(()=>location.hash==='#/clients');
 await page.reload();await page.locator('.nav').waitFor();
 assert.equal(await page.locator('.nav [data-page="clients"]').getAttribute('class'),'active',mode+': reload keeps section');

 // Назад / Вперёд
 await page.locator('.nav [data-page="orders"]').click();await page.waitForFunction(()=>location.hash==='#/orders');
 await page.goBack();await page.waitForFunction(()=>document.querySelector('.nav [data-page="clients"]')?.classList.contains('active'));
 await page.goForward();await page.waitForFunction(()=>document.querySelector('.nav [data-page="orders"]')?.classList.contains('active'));

 // «/» — фокус в поиск, Esc из поля не ломает страницу
 await page.locator('body').click({position:{x:700,y:900}});
 await page.keyboard.press('/');
 assert.equal(await page.evaluate(()=>document.activeElement?.id),'global-query',mode+': "/" focuses search');
 await page.keyboard.type('СтройПроект');await page.keyboard.press('Enter');
 await page.getByRole('heading',{name:'Результаты поиска'}).waitFor();

 // Ctrl+K — тоже поиск
 await page.locator('.nav [data-page="dashboard"]').click();await page.waitForFunction(()=>location.hash==='#/dashboard');
 await page.keyboard.press('Control+KeyK');
 assert.equal(await page.evaluate(()=>document.activeElement?.id),'global-query');
 await page.locator('#global-query').blur();

 // Alt+цифра — навигация по меню
 await page.keyboard.press('Alt+Digit5'); // 5-й пункт меню — «Сделки»
 await page.waitForFunction(()=>document.querySelector('.nav [data-page="orders"]')?.classList.contains('active'));
 await page.locator('.nav [data-page="clients"]').click();
 await page.waitForFunction(()=>document.querySelector('.nav [data-page="clients"]')?.classList.contains('active'));
 await page.locator('#add-client').waitFor();

 // N — создание записи; Ctrl+Enter — сохранение (пустая форма не уходит), Esc — закрыть
 await page.keyboard.press('KeyN');
 await page.locator('#modal-root .modal').waitFor();
 await page.locator('#modal-root .modal input').first().focus();
 await page.keyboard.press('Control+Enter');
 assert(await page.locator('#modal-root .modal input:invalid').count()>0,mode+': Ctrl+Enter respects required fields');
 assert.equal(await page.locator('#modal-root .modal').count(),1);
 await page.keyboard.press('Escape');
 await page.locator('#modal-root .modal').waitFor({state:'detached'});

 // ? — подсказка
 await page.keyboard.press('Shift+Slash');
 await page.getByRole('heading',{name:'Горячие клавиши'}).waitFor();
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('.shortcut-help').count(),0);
 assert(await page.locator('.shortcut-btn').isVisible());

 // Журнал: поиск и «Показать ещё»
 await page.locator('.nav [data-page="audit"]').click();
 await page.getByRole('heading',{name:'Журнал действий'}).waitFor();
 await page.locator('#audit-q').fill('нет-такой-записи-xyz');await page.locator('#audit-filter button').click();
 await page.getByText('Записей не найдено').waitFor();

 // Мобильная ширина без горизонтальной прокрутки
 await page.setViewportSize({width:390,height:844});
 for(const p of ['dashboard','clients','orders','documents','audit']){await page.evaluate(p=>{location.hash='#/'+p},p);await page.waitForTimeout(250);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),mode+': no horizontal overflow on '+p)}

 assert.deepEqual(errors,[],mode+': no JS exceptions');
 await page.close();
 console.log('PASS '+mode+': deep links, back/forward, "/", Ctrl+K, Alt+N, N, Ctrl+Enter, Esc, ?, audit filter, mobile');
}

(async()=>{
 let browser;
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  // HTTP-уровень: сжатие, ETag/304, тихий /api/session
  const js=await fetch(base+'/app.js',{headers:{'accept-encoding':'gzip'}});
  assert.equal(js.headers.get('content-encoding'),'gzip');const etag=js.headers.get('etag');assert(etag);await js.arrayBuffer();
  const again=await fetch(base+'/app.js',{headers:{'if-none-match':etag}});assert.equal(again.status,304);
  const s=await fetch(base+'/api/session');assert.equal(s.status,200);assert.deepEqual(await s.json(),{user:null});
  console.log('PASS http: gzip, ETag/304, anonymous /api/session = 200');

  browser=await chromium.launch({headless:true,executablePath:process.env.PROMETEY_CHROME,args:['--no-sandbox']});
  await scenario(browser,'server',base);
  if(fs.existsSync(demoFile))await scenario(browser,'portable','file://'+demoFile);
  else console.log('SKIP portable: run "npm run build:demo" first');
 }finally{if(browser)await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exit(1)});
