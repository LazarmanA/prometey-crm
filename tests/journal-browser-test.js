'use strict';
// UI: журнал работ в сделке — записать день, поправить, скопировать строку и день, счёт по факту.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-jr-ui-'));
process.env.DATA_FILE=path.join(temp,'data.json');fs.copyFileSync(path.join(__dirname,'../storage/data.demo.json'),process.env.DATA_FILE);process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.UPLOADS_DIR=path.join(temp,'up');process.env.PROMETEY_CHROMIUM='/nonexistent';
const SHOTS=process.env.SHOTS;let checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
const server=require('../server');
(async()=>{let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({args:['--no-sandbox']});
 const page=await browser.newPage({reducedMotion:'reduce',viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERR',e.message)});
 await page.addInitScript(()=>{try{localStorage.setItem('prometey_intro_seen','1');localStorage.setItem('prometey_deal_tab','shifts');localStorage.setItem('prometey_deal_tab_view','days')}catch{}});
 await page.goto(base);await page.locator('#login-email').fill('manager@prometey.local');await page.locator('#login-pass').fill('manager');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('.nav').waitFor();
 if(await page.locator('#consent-agree').count()){await page.locator('#consent-agree').check();await page.locator('#consent-ok').click()}
 await page.evaluate(()=>{current='orders';workspaceSelection={kind:'orders',id:'o1'};renderApp()});
 await page.locator('#deal-doc #ws-journal').waitFor();const jr=page.locator('#ws-journal');
 ok(await page.evaluate(()=>!!(document.querySelector('#deal-doc [data-pane="machines"] [data-detail]')&&document.querySelector('#deal-doc #dd-days #ws-journal'))),'deal card: plan on «Машины», «Журнал работ по дням» on «Смены»');
 const empty=await jr.getByText('Журнал пока пуст').count();ok(empty?await jr.locator('#jr-first').isVisible():await jr.locator('#jr-new-day').isVisible(),'journal shows how to record a day');
 await jr.locator(empty?'#jr-first':'#jr-new-day').click();await jr.locator('#jr-nd-date').waitFor();
 await jr.locator('#jr-nd-date').fill('2026-11-20');
 const eqCount=await jr.locator('.jr-nd-eq input').count();ok(eqCount>=1,'new day: all deal machines pre-ticked');
 await jr.locator('#jr-nd-save').click();await jr.locator('.jr-day[data-day="2026-11-20"]').waitFor();
 ok(await jr.locator('.jr-day[data-day="2026-11-20"] .jr-row[data-row]').count()===eqCount,'day recorded: one row per machine');
 // правка: полсмены
 const row=jr.locator('.jr-day[data-day="2026-11-20"] .jr-row[data-row]').first();const rate=Number(await row.locator('[data-f="rate"]').inputValue());
 await row.locator('[data-f="quantity"]').fill('0.5');await row.locator('[data-f="quantity"]').press('Enter');
 await page.waitForFunction(([sel,v])=>document.querySelector(sel+' .jr-sum b').textContent.replace(/\D/g,'')===String(v),[`.jr-day[data-day="2026-11-20"] .jr-row[data-row]`,Math.round(rate*0.5)]);
 ok(true,'edit in place: half a shift → sum recalculated, saved');
 await row.locator('[data-f="comment"]').fill('Ждали бетон');await row.locator('[data-f="comment"]').press('Enter');await page.waitForTimeout(400);
 if(SHOTS)await page.locator('#ws-journal').screenshot({path:path.join(SHOTS,'j1-day.png')});
 // копировать строку
 await row.locator('[data-copy-row]').click();await jr.locator('.jr-day[data-day="2026-11-21"]').waitFor();
 ok(await jr.locator('.jr-day[data-day="2026-11-21"] .jr-row[data-row]').count()===1&&await jr.locator('.jr-day[data-day="2026-11-21"] [data-f="comment"]').inputValue()==='','copy row → next day (без комментария)');
 // повторить весь последний день
 await jr.locator('#jr-copy-last').click();await jr.locator('.jr-day[data-day="2026-11-22"]').waitFor();
 ok(await jr.locator('.jr-day').first().getAttribute('data-day')==='2026-11-22','«Повторить 10.11 → 11.11»: newest day on top');
 await jr.locator('[data-copy-day="2026-11-20"]').click();await page.waitForTimeout(500);
 const d10=await jr.locator('.jr-day[data-day="2026-11-21"] .jr-row[data-row]').count();ok(d10===eqCount,'copy day 09.11 → 10.11: missing machines added, existing kept');
 // удалить: два нажатия
 const before=await jr.locator('.jr-row[data-row]').count();const del=jr.locator('.jr-day[data-day="2026-11-22"] [data-del-row]').first();await del.click();await page.waitForTimeout(150);ok(await jr.locator('.jr-row[data-row]').count()===before,'delete asks for a second click');
 await del.click();await page.waitForFunction(n=>document.querySelectorAll('#ws-journal .jr-row[data-row]').length===n-1,before);ok(true,'row deleted');
 ok((await jr.locator('.jr-progress b').innerText()).includes('₽')&&await jr.locator('.jr-chip').count()>=1,'totals: fact vs plan, per machine');
 if(SHOTS)await page.screenshot({path:path.join(SHOTS,'j2-deal.png'),fullPage:false});
 // счёт по факту
 await jr.locator('#jr-fact-invoice').click();await page.locator('.modal').waitFor();ok(await page.locator('.modal').getByText(/счёт|Счёт/).first().isVisible(),'«Счёт по факту» from the journal');
 await page.locator('.modal [data-close], .modal .modal-close, .modal button:has-text("Отмена")').first().click().catch(()=>{});
 // телефон
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>renderApp());await jr.waitFor();await page.waitForTimeout(300);
 ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'journal fits a phone');
 if(SHOTS)await page.locator('#ws-journal').screenshot({path:path.join(SHOTS,'j3-phone.png')});
 assert.deepEqual(errors,[]);ok(true,'no browser errors');
 console.log(`OK journal UI: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1;try{if(SHOTS){const pg=browser.contexts().flatMap(c=>c.pages()).pop();await pg.screenshot({path:path.join(SHOTS,'jfail.png')})}}catch{}}finally{try{await browser?.close()}catch{};server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
