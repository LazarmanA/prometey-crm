// Бухгалтерия: проверка работ, реализации (УПД), ЭДО XML/ZIP, PDF, оплаты, выписка банка, взаиморасчёты, акт сверки, отчёты, права.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-acc-'));
process.env.DB_FILE=path.join(temp,'db.sqlite');process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.RECORDINGS_DIR=path.join(temp,'recordings');
const server=require('../server');const {calcLine}=require('../lib/accounting');const Edo=require('../lib/edo');
let base,checks=0;const check=(ok,label)=>{assert.ok(ok,label);checks++;console.log('PASS',label)};
async function req(p,token,method='GET',body){const r=await fetch(base+p,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const type=r.headers.get('content-type')||'';return {status:r.status,body:type.includes('json')?await r.json():Buffer.from(await r.arrayBuffer()),headers:r.headers}}
// Сотрудник при первом входе принимает политику обработки ПДн (как в интерфейсе).
const login=async(email,password)=>{const t=(await req('/api/login',null,'POST',{email,password})).body?.token;if(t){const p=(await req('/api/privacy',t)).body;if(p?.required)await req('/api/privacy/accept',t,'POST',{agree:true,version:p.version})}return t};
const today=new Date(Date.now()+3*3600000).toISOString().slice(0,10);
function unzip(buf){const files={};let i=0;while(buf.readUInt32LE(i)===0x04034b50){const method=buf.readUInt16LE(i+8),size=buf.readUInt32LE(i+18),n=buf.readUInt16LE(i+26),e=buf.readUInt16LE(i+28);const name=buf.subarray(i+30,i+30+n).toString();const data=buf.subarray(i+30+n+e,i+30+n+e+size);files[name]=method===0?data:zlib.inflateRawSync(data);i+=30+n+e+size}return files}
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 // формула как в образце УПД из 1С
 const l=calcLine(8,4250,22,true);check(l.gross===34000&&l.net===27868.85&&l.vat===6131.15&&l.price===3483.61,'VAT math matches the 1C sample (8 × 4250 incl. 22% → 27 868,85 + 6 131,15)');
 const l2=calcLine(3,1000,22,false);check(l2.net===3000&&l2.vat===660&&l2.gross===3660,'prices without VAT');
 check(calcLine(2,500,'none',true).vat===0,'without VAT (USN)');

 const D=await login('director@prometey.local','director'),M=await login('manager@prometey.local','manager');
 let r=await req('/api/admin/users',D,'POST',{name:'Ольга Бух',email:'buh@firma.ru',role:'accountant',password:'Buh-Strong-2026!a'});let B=await login('buh@firma.ru','Buh-Strong-2026!a');await req('/api/profile/password',B,'POST',{current:'Buh-Strong-2026!a',next:'Buh-Strong-2026!b'});
 const ro=await req('/api/admin/roles',D,'POST',{name:'Аудитор',permissions:{accounting:'read',crm:'read'}});await req('/api/admin/users',D,'POST',{name:'Аудитор',email:'audit@firma.ru',role:ro.body.id,password:'Audit-Strong-2026!'});let A=await login('audit@firma.ru','Audit-Strong-2026!');await req('/api/profile/password',A,'POST',{current:'Audit-Strong-2026!',next:'Audit-Strong-2027!'});
 check((await req('/api/accounting/summary',M)).status===403,'manager has no access to accounting');
 check((await req('/api/accounting/work',A)).status===200&&(await req('/api/accounting/work/check',A,'POST',{ids:['s1'],status:'checked'})).status===403,'read-only accounting role can view, cannot act');

 // --- менеджер вносит работу, бухгалтер проверяет ---
 const obj=(await req('/api/objects',M)).body.find(o=>o.id==='obj1');const asg=obj.assignments[0];
 r=await req('/api/shifts',M,'POST',{assignmentId:asg.id,date:'2026-10-20',hours:8,downtime:0,overtime:2,overtimeSaleRate:5000,overtimePurchaseRate:3500,billableQuantity:1,unit:'shift',saleRate:30000,purchaseRate:22000,docRef:'ПЛ-120'});check(r.status===201,'manager records a priced shift');const s3=r.body.id;
 let work=(await req('/api/accounting/work?status=new',B)).body;check(work.rows.length===3&&work.totals.unpriced===2,'work journal: 3 shifts waiting, 2 without price');
 const w3=work.rows.find(x=>x.id===s3);check(w3.sum===40000&&w3.docRef==='ПЛ-120','sum includes overtime (30 000 + 2 × 5 000)');
 check((await req('/api/accounting/work/check',B,'POST',{ids:['s1'],status:'checked'})).status===409,'unpriced work cannot be marked checked');
 for(const id of ['s1','s2'])await req('/api/accounting/work/'+id,B,'PATCH',{unit:'hour',billableQuantity:8,saleRate:4250,purchaseRate:3000,docRef:'ПЛ-'+id});
 check((await req('/api/accounting/work/check',B,'POST',{ids:['s2'],status:'rejected'})).status===400,'returning work requires a comment');
 r=await req('/api/accounting/work/check',B,'POST',{ids:['s2'],status:'rejected',comment:'Нет путевого листа'});check(r.status===200,'work returned to the manager');
 const chat=(await req('/api/orders/o1/chat',M)).body.messages;check(chat.some(m=>m.text.includes('Нет путевого листа')),'manager sees the reason in the deal chat');
 r=await req('/api/shifts/s2',M,'PATCH',{comment:'Путевой лист приложен'});check(r.status===200&&r.body.check.status==='new','manager fixes it → back to «not checked»');
 await req('/api/accounting/work/'+'s2',B,'PATCH',{unit:'hour',billableQuantity:8,saleRate:4250,purchaseRate:3000});
 check((await req('/api/accounting/work/check',B,'POST',{ids:['s1','s2',s3],status:'checked'})).body.count===3,'batch check');

 // --- реквизиты ---
 r=await req('/api/accounting/realizations/fill',B,'POST',{clientId:'c1'});check(r.body.lines.length===4&&r.body.notReady===0,'fill from checked work: 2 hourly lines, 1 shift line, 1 overtime line');
 const fill=r.body;check(fill.lines.some(x=>/переработка/.test(x.name)&&x.unit==='hour'&&x.quantity===2),'overtime becomes its own hourly line');
 r=await req('/api/accounting/realizations',B,'POST',{clientId:'c1',date:today,lines:fill.lines,basis:{name:'Договор',number:'15',date:'2026-09-01'}});if(r.status!==201)console.log(r.status,r.body);check(r.status===201&&r.body.status==='draft','draft realization created');const R1=r.body;
 check(R1.totals.gross===108000&&R1.number==='1','totals: 34 000 + 34 000 + 30 000 + 10 000 = 108 000; number 1');
 r=await req(`/api/accounting/realizations/${R1.id}/post`,B,'POST',{});check(r.status===409&&/ИНН|КПП|адрес/.test(r.body.error),'posting requires buyer requisites');
 check((await req('/api/accounting/clients/c1',B,'PATCH',{kpp:'12345'})).status===400,'KPP validated');
 await req('/api/accounting/clients/c1',B,'PATCH',{kpp:'770101001',legalAddress:'125009, г. Москва, ул. Тверская, д. 1',fullName:'ООО «СтройПроект»'});

 // --- двойное выставление невозможно ---
 r=await req('/api/accounting/realizations',B,'POST',{clientId:'c1',lines:fill.lines});check(r.status===409,'the same work cannot go into two documents');
 r=await req('/api/accounting/realizations',B,'POST',{clientId:'c2',lines:[{...fill.lines[0]}]});check(r.status===409,'work of another buyer is rejected');
 check((await req('/api/shifts/s1',M,'PATCH',{hours:9})).status===409,'manager cannot change work that is in a document');

 r=await req(`/api/accounting/realizations/${R1.id}/post`,B,'POST',{});check(r.status===200&&r.body.status==='posted','realization posted');
 check((await req('/api/accounting/realizations',B,'POST',{clientId:'c1',number:'1',lines:[{name:'Доставка',unit:'trip',quantity:1,rate:5000}]})).status===409,'number uniqueness per year');
 check((await req(`/api/accounting/realizations/${R1.id}`,B,'PATCH',{comment:'x'})).status===409,'posted document is locked');

 // --- ЭДО ---
 r=await req(`/api/accounting/realizations/${R1.id}/xml`,A);check(r.status===200&&/windows-1251/.test(r.headers.get('content-type')),'XML for EDO (read role can download)');
 const xml=new TextDecoder('windows-1251').decode(r.body);const fname=decodeURIComponent(r.headers.get('content-disposition').match(/''(.+)$/)[1]);
 check(/^ON_NSCHFDOPPR_7701234567-770101001_7700000000-770001001_\d{8}_[0-9a-f-]{36}\.xml$/.test(fname),'file name ON_NSCHFDOPPR_<buyer>_<seller>_<date>_<guid>.xml');
 check(xml.includes('ВерсФорм="5.03"')&&xml.includes('Функция="СЧФДОП"')&&xml.includes('НомерДок="1"')&&xml.includes('СтТовУчНалВсего="108000.00"')&&xml.includes('НалСт="22%"'),'UPD 5.03: function, number, totals, VAT rate');
 check(xml.includes('ИННЮЛ="7701234567" КПП="770101001"')&&xml.includes('НаимОрг="ООО «СтройПроект»"'),'buyer requisites from «Контрагенты»');
 check(xml.includes('РеквНаимДок="Договор №15 от 1 сентября 2026\u00a0г." РеквНомерДок="15" РеквДатаДок="01.09.2026"'),'contract basis written like 1C');
 check(xml.includes('Фамилия="Андрей" Имя="Руководитель"')&&xml.includes('Должн="Генеральный директор"'),'signer from the organisation requisites');
 check(xml.includes('ОКЕИ_Тов="356"')&&!/ОКЕИ_Тов=""/.test(xml)&&xml.includes('НаимЕдИзм="смена"'),'OKEI code for hours; «смена» without a code');
 check((await req(`/api/accounting/realizations/${R1.id}`,B)).body.edoStatus==='none','read-only download does not change status');
 await req(`/api/accounting/realizations/${R1.id}/xml`,B);check((await req(`/api/accounting/realizations/${R1.id}`,B)).body.edoStatus==='exported','accountant download marks «exported»');
 r=await req('/api/accounting/realizations',B,'POST',{clientId:'c1',lines:[{name:'Доставка экскаватора трал',unit:'trip',quantity:1,rate:15000}],vatRate:'none'});const R2=r.body;await req(`/api/accounting/realizations/${R2.id}/post`,B,'POST',{});
 r=await req('/api/accounting/realizations/xml-zip',B,'POST',{ids:[R1.id,R2.id]});check(r.status===200&&r.headers.get('content-type')==='application/zip','ZIP for EDO');
 const files=unzip(r.body);check(Object.keys(files).length===2&&Object.keys(files).every(n=>n.startsWith('ON_NSCHFDOPPR_')),'ZIP holds 2 XML files');
 const x2=new TextDecoder('windows-1251').decode(Object.values(files).find(b=>new TextDecoder('windows-1251').decode(b).includes('Функция="ДОП"')));check(x2.includes('<БезНДС>без НДС</БезНДС>')&&x2.includes('НалСт="без НДС"'),'without VAT → function «ДОП», «без НДС»');
 check((await req('/api/accounting/realizations/xml-zip',B,'POST',{ids:[(await req('/api/accounting/realizations',B,'POST',{clientId:'c1',lines:[{name:'Черновик',unit:'unit',quantity:1,rate:1}]})).body.id]})).status===409,'drafts are not exported');
 r=await req(`/api/accounting/realizations/${R1.id}/pdf`,B);check(r.status===200&&r.body.subarray(0,4).toString()==='%PDF'&&r.body.length>5000,'printable UPD (PDF)');
 r=await req(`/api/accounting/realizations/${R1.id}/pdf?format=html`,B);check(r.status===200&&r.body.toString().includes('Счёт-фактура № 1')&&/default-src 'none'/.test(r.headers.get('content-security-policy')),'printable UPD (HTML, locked down)');
 await req(`/api/accounting/realizations/${R1.id}/edo`,B,'PATCH',{edoStatus:'signed'});
 check((await req(`/api/accounting/realizations/${R1.id}/unpost`,B,'POST',{})).status===409,'signed in EDO → cannot unpost (needs correction document)');
 await req(`/api/accounting/realizations/${R2.id}/edo`,B,'PATCH',{edoStatus:'sent'});
 check((await req(`/api/accounting/realizations/${R2.id}/unpost`,B,'POST',{})).body.status==='draft','unpost when not signed');await req(`/api/accounting/realizations/${R2.id}/post`,B,'POST',{});

 // --- оплаты, FIFO, долги ---
 await req('/api/accounting/payments',B,'POST',{clientId:'c1',date:today,amount:100000,number:'501'});
 let list=(await req('/api/accounting/realizations?clientId=c1&status=posted',B)).body;const v1=list.find(x=>x.id===R1.id),v2=list.find(x=>x.id===R2.id);
 check(v1.paid===100000&&v1.debt===8000&&v2.debt===15000,'payment closes the oldest document first (FIFO)');
 const bank=['1CClientBankExchange','ВерсияФормата=1.03','Кодировка=Windows','СекцияДокумент=Платежное поручение','Номер=777','Дата='+today.split('-').reverse().join('.'),'Сумма=23000.00','ПлательщикИНН=7701234567','Плательщик1=ООО СтройПроект','ПолучательИНН=7700000000','НазначениеПлатежа=Оплата по УПД 1 и 2','КонецДокумента','СекцияДокумент=Платежное поручение','Номер=12','Дата=01.10.2026','Сумма=5000.00','ПлательщикИНН=7700000000','ПолучательИНН=7799999999','НазначениеПлатежа=Аренда офиса','КонецДокумента','СекцияДокумент=Платежное поручение','Номер=13','Дата=02.10.2026','Сумма=700.00','ПлательщикИНН=5000000000','ПолучательИНН=7700000000','НазначениеПлатежа=Неизвестный','КонецДокумента','КонецФайла'].join('\r\n');
 r=await req('/api/accounting/bank/preview',B,'POST',{text:bank});check(r.body.summary.ready===1&&r.body.summary.outgoing===1&&r.body.summary.unknown===1,'bank statement: incoming matched by INN, outgoing and unknown separated');
 check(Edo.parseBankStatement(Edo.decodeText(Buffer.from(require('../lib/edo').encode1251(bank)))).length===3,'windows-1251 statement decoded');
 r=await req('/api/accounting/bank/import',B,'POST',{text:bank});check(r.body.created===1&&r.body.sum===23000,'bank payments imported');
 r=await req('/api/accounting/bank/preview',B,'POST',{text:bank});check(r.body.summary.duplicate===1&&r.body.summary.ready===0,'the same statement twice → duplicates detected');
 const debts=(await req('/api/accounting/debts',B)).body.find(x=>x.clientId==='c1');check(debts.realized===123000&&debts.paid===123000&&debts.debt===0,'buyer fully paid: 108 000 + 15 000 = 100 000 + 23 000');
 r=await req(`/api/accounting/reconciliation?clientId=c1&from=2026-01-01&to=${today}`,B);check(r.body.debit===123000&&r.body.credit===123000&&r.body.closing===0&&r.body.rows.length===4,'reconciliation act balances');
 r=await req(`/api/accounting/reconciliation?format=pdf&clientId=c1&from=2026-01-01&to=${today}`,B);check(r.body.subarray(0,4).toString()==='%PDF','reconciliation act PDF');

 // --- отчёты ---
 const sales=(await req(`/api/accounting/sales?from=2026-01-01&to=${today}`,B)).body;check(sales.totals.gross===123000&&sales.byRate.length===2&&sales.totals.vat===round(sales.byRate.find(x=>x.rate===22).vat),'sales and VAT by rate');
 r=await req(`/api/accounting/sales.csv?from=2026-01-01&to=${today}`,B);check(r.body.toString().startsWith('﻿Дата;Номер;Покупатель')&&r.body.toString().includes('108000'),'sales register CSV for Excel');
 r=await req('/api/accounting/work.csv',B);check(r.body.toString().includes('ПЛ-120'),'work journal CSV');
 const ctl=(await req('/api/accounting/orders',B)).body.find(o=>o.id==='o1');check(ctl.actual===108000&&ctl.billed===108000&&ctl.toBill===0,'deal control: actual = billed');
 const sum=(await req('/api/accounting/summary',B)).body;check(sum.work.unchecked===0&&sum.debt===0,'overview counters');
 console.log(`OK accounting: ${checks} checks`);
}finally{server.closeIdleConnections?.();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exit(1)});
function round(v){return Math.round(v*100)/100}
