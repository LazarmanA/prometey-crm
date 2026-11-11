'use strict';
// Проверка на XSS: во все текстовые поля записываются HTML-вставки, затем открываются все разделы
// и рабочие столы. Ни одна вставка не должна превратиться в элемент страницы; политика CSP не должна
// мешать обычной работе (нет нарушений при штатном использовании).
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-xss-'));
process.env.DB_FILE=path.join(temp,'prometey.sqlite');
process.env.DOCUMENTS_DIR=path.join(temp,'documents');
process.env.RECORDINGS_DIR=path.join(temp,'recordings');
process.env.NODE_ENV='test';
const server=require('../server');
const P=n=>`X${n}<b data-xss="${n}">x</b>"'><svg data-xss="${n}s"></svg><img data-xss="${n}i" src=x>`;

(async()=>{let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const api=async(token,p,method='GET',body)=>{const r=await fetch(base+p,{method,headers:{'content-type':'application/json',authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();if(r.status>=400)throw new Error(p+' '+r.status+' '+JSON.stringify(j));return j};
 const token=(await (await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'director@prometey.local',password:'director'})})).json()).token;
 const common={address:P('addr'),equipmentType:P('eqtype'),ownership:'own',note:P('note')};
 const client=await api(token,'/api/clients','POST',{...common,name:P('client'),phone:'+7 999 000 11 22',email:'a@b.ru',legalAddress:P('legal'),requestAt:'2026-11-01T08:30'});
 const object=await api(token,'/api/objects','POST',{name:P('object'),address:P('objaddr'),note:P('objnote')});
 const eq=await api(token,'/api/equipment','POST',{type:P('type'),model:P('model'),plate:P('plate'),ownership:'own',driver:P('driver'),ownerName:P('owner')});
 const order=await api(token,'/api/orders','POST',{...common,name:P('order'),clientId:client.id,objectId:object.id,start:'2026-11-01T08:30',end:'2026-11-03T17:00'});
 await api(token,'/api/order-items','POST',{orderId:order.id,equipmentId:eq.id,unit:'shift',quantity:2,saleRate:1000,purchaseRate:500,extras:0,note:P('line')});
 await api(token,'/api/assignments','POST',{objectId:object.id,equipmentId:eq.id,orderId:order.id,status:'working',details:P('assign')});
 for(const [kind,id] of [['clients',client.id],['orders',order.id]]){
  await api(token,`/api/workspaces/${kind}/${id}/items`,'POST',{type:'note',title:P(kind+'wt'),content:P(kind+'wc')});
  await api(token,`/api/workspaces/${kind}/${id}/items`,'POST',{type:'task',title:P(kind+'task'),due:'2026-11-05'});
  await api(token,`/api/workspaces/${kind}/${id}/items`,'POST',{type:'link',title:P(kind+'link'),url:'https://example.com/?q="><b data-xss=url>'});
  await api(token,`/api/calls/${kind}/${id}`,'POST',{phone:P(kind+'ph'),at:new Date().toISOString(),direction:'incoming',status:'completed',duration:10,note:P(kind+'call')});
 }
 await api(token,`/api/orders/${order.id}/chat`,'POST',{text:P('chat'),nonce:'xss-test-nonce-1'});
 const post=await api(token,'/api/feed','POST',{text:P('feed'),important:true});await api(token,`/api/feed/${post.id}/comments`,'POST',{text:P('fcomment')});
 await api(token,'/api/admin/departments','POST',{name:P('dep').slice(0,70)});await api(token,'/api/admin/roles','POST',{name:P('role').slice(0,60)});
 await api(token,'/api/admin/users','POST',{name:P('user').slice(0,110),email:'x@x.ru',position:P('pos').slice(0,110),role:'accountant'});
 await api(token,'/api/accounting/clients/'+client.id,'PATCH',{fullName:P('full'),inn:'7701234567',kpp:'770101001',legalAddress:P('legaladdr')});
 const shift=(await api(token,'/api/shifts','POST',{assignmentId:(await api(token,'/api/objects/'+object.id)).assignments[0].id,date:'2026-10-20',hours:8,billableQuantity:1,unit:'shift',saleRate:1000,purchaseRate:500,comment:P('shiftc'),docRef:P('docref').slice(0,90)}));
 await api(token,'/api/accounting/payments','POST',{clientId:client.id,amount:100,number:P('payno').slice(0,35),purpose:P('purpose')});
 await api(token,'/api/accounting/realizations','POST',{clientId:client.id,comment:P('rcomment'),basis:{number:P('bn').slice(0,50)},lines:[{name:P('rline'),unit:'unit',quantity:1,rate:100}]});
 await api(token,'/api/leads','POST',{name:P('lead'),company:P('leadco'),phone:'+79991112233',note:P('leadnote'),nextAt:new Date(Date.now()+864e5).toISOString(),nextAction:P('next')});

 browser=await chromium.launch({headless:true,executablePath:process.env.PROMETEY_CHROME,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1400,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI))});
 await page.goto(base);await page.locator('#login-email').fill('director@prometey.local');await page.locator('#login-pass').fill('director');
 await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('.nav').waitFor();
 const injected=()=>page.evaluate(()=>[...document.querySelectorAll('[data-xss]')].map(e=>e.getAttribute('data-xss')));
 const pages=await page.locator('.nav [data-page]').evaluateAll(b=>b.map(x=>x.dataset.page));
 let visited=0,seen=false;
 for(const name of pages){
  await page.locator(`.nav [data-page="${name}"]`).click();await page.waitForTimeout(350);visited++;
  assert.deepEqual(await injected(),[],'HTML injected on page '+name);
  seen||=(await page.evaluate(()=>document.body.innerText)).includes('Xclient<b data-xss');
  for(const sel of ['.company-card button:has-text("Рабочий стол")','button:has-text("Рабочий стол")']){
   const btn=page.locator(sel).first();
   if(await btn.count()&&await btn.isVisible()){await btn.click();await page.waitForTimeout(500);assert.deepEqual(await injected(),[],'HTML injected in workspace from '+name);await page.keyboard.press('Escape');await page.waitForTimeout(150);break}
  }
 }
 for(const [pageName,tabAttr] of [['accounting','data-acc-tab'],['admin','data-admin-tab']]){
  await page.locator(`.nav [data-page="${pageName}"]`).click();await page.waitForTimeout(300);
  const tabs=await page.locator(`[${tabAttr}]`).evaluateAll((b,a)=>b.map(x=>x.getAttribute(a)),tabAttr);
  for(const t of tabs){await page.locator(`[${tabAttr}="${t}"]`).click();await page.waitForTimeout(350);visited++;assert.deepEqual(await injected(),[],`HTML injected in ${pageName}/${t}`)}
 }
 await page.locator('[data-acc-tab]').first().waitFor({state:'detached'}).catch(()=>{});
 await page.locator('.nav [data-page="accounting"]').click();await page.locator('[data-acc-tab="real"]').click();await page.locator('[data-real]').first().click();await page.waitForTimeout(400);assert.deepEqual(await injected(),[],'HTML injected in realization card');await page.locator('.modal .cancel').click();
 const csp=await page.evaluate(()=>window.__csp);
 assert.ok(seen,'payload must be visible as plain text');
 assert.deepEqual(errors,[],'page errors');
 assert.deepEqual(csp,[],'CSP violations during normal use');
 console.log(`PASS XSS probe: ${visited} sections + workspaces, payloads shown as plain text, no injected elements, no CSP violations`);
}finally{await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
