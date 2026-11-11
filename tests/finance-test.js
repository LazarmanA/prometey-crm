'use strict';
// Бухгалтерия как в 1С: реестр заказов, смены поставщиков → поступление услуг, деньги (поступления и расходы),
// поставщики и взаиморасчёты, доходы и расходы, выписка банка со списаниями.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-fin-'));process.env.DATA_FILE=path.join(temp,'data.json');process.env.UPLOADS_DIR=path.join(temp,'up');process.env.DOCUMENTS_DIR=path.join(temp,'docs');process.env.PROMETEY_CHROMIUM='/nonexistent';
fs.copyFileSync(path.join(__dirname,'../storage/data.demo.json'),process.env.DATA_FILE);const server=require('../server');let base,checks=0;
const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
async function req(p,token,method='GET',body){const r=await fetch(base+p,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const type=r.headers.get('content-type')||'';return {status:r.status,body:type.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer())}}
(async()=>{try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});base='http://127.0.0.1:'+server.address().port;
 const login=async role=>(await req('/api/login',null,'POST',{email:role+'@prometey.local',password:role})).body.token;
 const director=await login('director'),manager=await login('manager');
 for(const t of [director,manager]){const r=await req('/api/privacy',t);await req('/api/privacy/accept',t,'POST',{agree:true,version:r.body.version})}
 const D=()=>structuredClone(server.store.read());
 // ---------- поставщики ----------
 let r=await req('/api/accounting/partners',manager);ok(r.status===403,'manager has no access to accounting suppliers');
 r=await req('/api/accounting/partners',director,'PATCH');ok(r.status===404||r.status===405||r.status===400,'unknown method refused');
 r=await req('/api/accounting/partners/p1',director,'PATCH',{inn:'7707083893',kpp:'770701001',phone:'+7 928 035-03-03',email:'spec@yug.ru'});ok(r.status===200&&r.body.inn==='7707083893','supplier INN and contacts saved');
 r=await req('/api/accounting/partners',director,'POST',{name:'ООО "МЕРИДИАН"',inn:'7728168971',vatPayer:true});ok(r.status===201,'new supplier created');const meridian=r.body.id;
 r=await req('/api/accounting/partners',director,'POST',{name:'Двойник',inn:'7728168971'});ok(r.status===409,'duplicate INN refused');
 r=await req('/api/accounting/partners',director,'POST',{name:'Плохой',inn:'123'});ok(r.status===400,'bad INN refused');
 // ---------- журнал: смены наёмной техники с поставщиком ----------
 const o1='o1';
 for(const date of ['2026-11-02','2026-11-03','2026-11-04']){r=await req(`/api/deals/${o1}/journal`,manager,'POST',{date,equipmentId:'e3'});assert.equal(r.status,201,JSON.stringify(r.body))}
 let d=D();const e3shifts=d.shifts.filter(s=>d.assignments.find(a=>a.id===s.assignmentId)?.equipmentId==='e3'&&s.date>='2026-11-02');
 ok(e3shifts.length===3&&e3shifts.every(s=>s.partnerId==='p1'),'journal rows of rented equipment get the supplier of the machine');
 r=await req(`/api/deals/${o1}/journal/${e3shifts[2].id}`,manager,'PATCH',{partnerId:meridian,purchaseRate:30000,quantity:1});d=D();
 ok(r.status===200&&d.shifts.find(s=>s.id===e3shifts[2].id).partnerId===meridian,'manager sets another supplier for one day (like 1С: supplier per shift)');
 r=await req(`/api/deals/${o1}/journal`,manager);ok(r.status===200&&r.body.partners.some(p=>p.id===meridian),'journal offers the supplier list');
 // ---------- смены поставщиков ----------
 r=await req('/api/accounting/supplier-shifts?noDocs=1&partnerId=p1',director);
 const p1rows=r.body.rows.filter(x=>x.date>='2026-11-02');ok(r.status===200&&p1rows.length===2&&p1rows.every(x=>x.partner.includes('ТехРесурс')&&x.cost>0&&x.phone),'supplier shifts without documents, with phone and sum');
 r=await req('/api/accounting/supplier-shifts.csv?partnerId=p1',director);ok(r.status===200&&r.body.toString().includes('Тариф суб.'),'supplier shifts export (Вывести список)');
 r=await req('/api/accounting/supplier-shifts',director,'PATCH',{ids:[p1rows[0].id],scan:true});d=D();ok(r.status===200&&d.shifts.find(s=>s.id===p1rows[0].id).supplierScan===true,'scan flag set on a shift');
 // поступление из выделенных смен
 r=await req('/api/accounting/purchases',director,'POST',{partnerId:meridian,shiftIds:p1rows.map(x=>x.id),updNumber:'1'});ok(r.status===409,'shifts of another supplier refused');
 r=await req('/api/accounting/purchases',director,'POST',{partnerId:'p1',date:'2026-11-05',shiftIds:p1rows.map(x=>x.id),updNumber:'298',sfNumber:'298',vatRate:22,originalReceived:false});
 const pu=r.body;const cost=p1rows.reduce((a,x)=>a+x.cost,0);
 ok(r.status===201&&pu.number.startsWith('ПУ-')&&Math.abs(pu.totals.gross-cost)<0.01&&pu.lines.length===2&&pu.totals.vat>0,'purchase (Поступление услуг) from selected shifts: sum equals supplier cost, VAT inside');
 d=D();ok(p1rows.every(x=>d.shifts.find(s=>s.id===x.id).purchaseId===pu.id),'shifts linked to the purchase');
 r=await req('/api/accounting/supplier-shifts?noDocs=1&partnerId=p1',director);ok(!r.body.rows.some(x=>p1rows.some(y=>y.id===x.id)),'documented shifts leave the «Без документов» list');
 r=await req('/api/accounting/purchases',director,'POST',{partnerId:'p1',shiftIds:[p1rows[0].id]});ok(r.status===409&&/уже в поступлении/.test(r.body.error),'same shift cannot go into two documents');
 r=await req(`/api/deals/${o1}/journal/${p1rows[0].id}`,manager,'PATCH',{purchaseRate:1});ok(r.status===409,'manager cannot change supplier price after the supplier document');
 // материалы (ГСМ) строками
 r=await req('/api/accounting/purchases',director,'POST',{partnerId:meridian,date:'2026-11-06',kind:'materials',updNumber:'90102',lines:[{name:'Топливо дизельное ЕВРО',quantity:199.91,unit:'l',rate:105}]});
 ok(r.status===201&&Math.abs(r.body.totals.gross-20990.55)<0.01&&Math.abs(r.body.totals.vat-3785.18)<0.01,'fuel receipt: 199,91 л × 105 = 20 990,55, VAT 22% 3 785,18 (as in 1С)');const fuel=r.body;
 r=await req('/api/accounting/purchases?kind=materials',director);ok(r.body.rows.length===1&&r.body.totals.debt===fuel.totals.gross,'purchases list with debt');
 // ---------- деньги ----------
 r=await req('/api/accounting/expenses',director,'POST',{category:'suppliers',amount:10000,date:'2026-11-07'});ok(r.status===400,'supplier payment requires a supplier');
 r=await req('/api/accounting/expenses',director,'POST',{category:'suppliers',partnerId:'p1',amount:pu.totals.gross,date:'2026-11-07',number:'55'});ok(r.status===201,'payment to supplier');
 r=await req('/api/accounting/expenses',director,'POST',{category:'rent',payee:'Офис',amount:30000,date:'2026-11-08'});ok(r.status===201,'other expense by article');
 r=await req('/api/accounting/payments',director,'POST',{clientId:'c1',amount:150000,date:'2026-11-08',number:'777'});ok(r.status===201,'payment from customer');
 r=await req('/api/accounting/cash?from=2026-11-01&to=2026-11-30',director);
 ok(r.status===200&&r.body.totals.in===150000&&Math.abs(r.body.totals.out-(pu.totals.gross+30000))<0.01&&r.body.rows.some(x=>x.kind==='in')&&r.body.rows.some(x=>x.kind==='out'&&x.categoryName.includes('Аренда')),'cash: incoming from customers and outgoing to suppliers and other');
 r=await req('/api/accounting/cash?dir=out&category=rent',director);ok(r.body.rows.length===1,'cash filter by direction and article');
 r=await req('/api/accounting/cash.csv?from=2026-11-01',director);ok(r.status===200&&r.body.toString().includes('Поступление'),'cash export');
 // ---------- взаиморасчёты с поставщиками ----------
 r=await req('/api/accounting/suppliers',director);const s1=r.body.find(x=>x.partnerId==='p1'),s2=r.body.find(x=>x.partnerId===meridian);
 ok(s1&&s1.debt===0&&s1.paid===pu.totals.gross&&s1.noOriginal===1,'supplier p1 paid in full; original not yet received');
 ok(s2&&Math.abs(s2.debt-fuel.totals.gross)<0.01&&s2.noDocsCount===1&&s2.noDocsSum===30000,'supplier МЕРИДИАН: fuel debt and one shift without documents');
 r=await req(`/api/accounting/supplier-reconciliation?partnerId=${meridian}&from=2026-01-01&to=2026-12-31`,director);ok(r.status===200&&Math.abs(r.body.closing-fuel.totals.gross)<0.01,'reconciliation with supplier');
 r=await req('/api/accounting/purchases/'+pu.id,director,'PATCH',{originalReceived:true});d=D();ok(r.status===200&&r.body.originalReceived&&d.shifts.find(s=>s.id===p1rows[0].id).supplierOriginal===true,'original received → shifts marked');
 // ---------- реестр заказов ----------
 r=await req('/api/accounting/registry',director);const row=r.body.rows.find(x=>x.id===o1);
 ok(r.status===200&&row&&row.sum>0&&row.suppliers.length>=2&&row.balance===150000&&!row.acts.length&&row.supplierNoDocs===1,'registry: sum, suppliers, customer balance (advance), no acts, supplier shifts without docs');
 r=await req('/api/quick-invoice',director,'POST',{type:'invoice',clientId:'c1',orderId:o1,items:[{description:'Аванс',unit:'unit',quantity:1,rate:1000}],vatRate:22});
 r=await req('/api/accounting/registry?mismatch=1',director);ok(r.body.rows.some(x=>x.id===o1&&x.invoiceMismatch&&x.invoices.length===1),'invoice sum ≠ order sum is flagged (pink in 1С)');
 r=await req('/api/accounting/registry?noActs=1&managerId=u-manager',director);ok(r.body.rows.every(x=>!x.acts.length)&&r.body.filters.managers.length>0,'filters: without acts, by manager');
 r=await req('/api/accounting/registry.csv',director);ok(r.status===200&&r.body.toString().includes('Сумма актов'),'registry export');
 // ---------- доходы и расходы ----------
 r=await req('/api/accounting/pnl?from=2026-11-01&to=2026-11-30',director);const m=r.body.months.find(x=>x.month==='2026-11');
 ok(r.status===200&&m&&m.services>0&&m.materials>0&&m.other===30000&&m.accrued===30000&&m.cashIn===150000,'P&L by month: services, materials, other costs, supplier shifts awaiting documents, cash');
 // ---------- выписка банка: списания поставщикам ----------
 const le=D().legalEntities[0];
 const stmt=['1CClientBankExchange','ВерсияФормата=1.03',
  'СекцияДокумент=Платежное поручение','Номер=901','Дата=10.11.2026','Сумма=20990.55',`ПлательщикИНН=${le.inn}`,`ПлательщикСчет=${le.bankAccount||''}`,'Плательщик1=Мы','ПолучательИНН=7728168971','Получатель1=ООО МЕРИДИАН','НазначениеПлатежа=Оплата по УПД 90102','КонецДокумента',
  'СекцияДокумент=Платежное поручение','Номер=902','Дата=10.11.2026','Сумма=1500',`ПлательщикИНН=${le.inn}`,'ПолучательИНН=7710140679','Получатель1=Банк','НазначениеПлатежа=Комиссия','КонецДокумента','КонецФайла'].join('\r\n');
 r=await req('/api/accounting/bank/preview',director,'POST',{text:stmt});
 ok(r.status===200&&r.body.summary.outReady===1&&r.body.summary.outOther===1,'bank statement: supplier payment recognized by INN, other outgoing offered');
 const other=r.body.rows.find(x=>x.status==='out_other');
 r=await req('/api/accounting/bank/import',director,'POST',{text:stmt,refs:r.body.rows.map(x=>x.bankRef),categories:{[other.bankRef]:'bank'}});
 ok(r.status===200&&r.body.outCreated===2,'outgoing payments imported');
 r=await req('/api/accounting/suppliers',director);ok(r.body.find(x=>x.partnerId===meridian).debt===0,'bank payment closed the fuel debt');
 r=await req('/api/accounting/bank/import',director,'POST',{text:stmt});ok(r.body.outCreated===0,'statement re-import does not duplicate');
 r=await req('/api/accounting/cash?category=bank',director);ok(r.body.rows.length===1&&r.body.rows[0].amount===1500,'bank fee filed under its article');
 // ---------- удаление документа освобождает смены ----------
 r=await req('/api/accounting/purchases/'+pu.id,director,'DELETE');d=D();ok(r.status===200&&p1rows.every(x=>!d.shifts.find(s=>s.id===x.id).purchaseId),'deleting a purchase frees its shifts');
 ok(d.audit.some(a=>a.action==='purchase.create')&&d.audit.some(a=>a.action==='expense.create'),'actions logged in the journal');
 console.log(`OK finance: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
