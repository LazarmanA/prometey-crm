'use strict';
// «Сделки → Выставить счёт»: компания по ИНН, объект по адресу, сделка и счёт — одним действием.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-qi-'));process.env.DATA_FILE=path.join(temp,'data.json');process.env.UPLOADS_DIR=path.join(temp,'up');process.env.DOCUMENTS_DIR=path.join(temp,'docs');process.env.PROMETEY_CHROMIUM='/nonexistent';
fs.copyFileSync(path.join(__dirname,'../storage/data.demo.json'),process.env.DATA_FILE);const server=require('../server');let base,checks=0;
const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
async function req(p,token,method='GET',body){const r=await fetch(base+p,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const type=r.headers.get('content-type')||'';return {status:r.status,body:type.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer())}}
(async()=>{try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});base='http://127.0.0.1:'+server.address().port;
 const login=async role=>(await req('/api/login',null,'POST',{email:role+'@prometey.local',password:role})).body.token;
 const manager=await login('manager'),director=await login('director');
 for(const t of [manager,director]){const r=await req('/api/privacy',t);await req('/api/privacy/accept',t,'POST',{agree:true,version:r.body.version})}
 const D=()=>structuredClone(server.store.read());const before=D();
 const eq=before.equipment.find(e=>!e.archivedAt&&e.ownership==='own');
 const base1={type:'invoice',client:{name:'ООО "Новострой"',inn:'7728168971',kpp:'772801001',legalAddress:'Москва, ул. Профсоюзная, 1'},address:'Москва, Ленинский пр., 30 — стройплощадка',start:'2026-11-10',end:'2026-11-12',
  items:[{equipmentId:eq.id,unit:'shift',quantity:3,rate:30000},{description:'Доставка техники на объект',unit:'trip',quantity:1,rate:15000}],vatRate:22,vatIncluded:true};
 // пустые строки — ничего не создаётся
 let r=await req('/api/quick-invoice',manager,'POST',{...base1,items:[]});ok(r.status===400&&D().clients.length===before.clients.length&&D().objects.length===before.objects.length,'no items → error, nothing created');
 r=await req('/api/quick-invoice',manager,'POST',{...base1,items:[{description:'Кран',unit:'shift',quantity:0,rate:1}]});ok(r.status===400&&/Строка 1/.test(r.body.error)&&D().clients.length===before.clients.length,'bad row → error names the row, rolled back');
 // новая компания, новый объект, новая сделка, счёт
 r=await req('/api/quick-invoice',manager,'POST',base1);ok(r.status===201&&r.body.created.client&&r.body.created.object&&r.body.created.order,'one action: company + object + deal + invoice');
 let d=D();const c=d.clients.find(x=>x.id===r.body.clientId),o=d.orders.find(x=>x.id===r.body.orderId),doc=d.documents.find(x=>x.id===r.body.documentId);
 ok(c.inn==='7728168971'&&c.kpp==='772801001'&&c.managerId===d.users.find(u=>u.email==='manager@prometey.local').id,'company saved with requisites, manager is responsible');
 ok(o.clientId===c.id&&o.start==='2026-11-10T08:00'&&o.end==='2026-11-12T20:00'&&o.name.includes('Новострой')&&d.objects.find(x=>x.id===o.objectId).address.includes('Ленинский'),'deal: dates, name, object by address');
 const lines=d.orderItems.filter(i=>i.orderId===o.id);ok(lines.length===1&&lines[0].equipmentId===eq.id&&lines[0].saleRate===30000&&lines[0].quantity===3,'equipment row added to the deal (free-text row only in the invoice)');
 ok(doc.type==='invoice'&&doc.totalGross===105000&&doc.items.length===2&&doc.orderIds[0]===o.id&&doc.clientId===c.id,'invoice: 2 rows, 105 000 ₽, linked to deal and company');
 ok(r.body.document&&r.body.document.number,'response carries the invoice for download');
 // тот же ИНН и адрес → компания и объект те же, новая сделка
 r=await req('/api/quick-invoice',manager,'POST',{...base1,client:{inn:'7728168971'},type:'contract_invoice'});d=D();
 ok(r.status===201&&!r.body.created.client&&!r.body.created.object&&r.body.created.order&&r.body.clientId===c.id,'same INN + address: existing company and object reused');
 ok(d.documents.find(x=>x.id===r.body.documentId).type==='contract_invoice','contract-invoice the same way');
 ok(d.clients.filter(x=>x.inn==='7728168971').length===1,'no duplicate company');
 // контекст компании: сделки, адреса, ставки
 r=await req('/api/quick-invoice/context?clientId='+c.id,manager);ok(r.status===200&&r.body.deals.length===2&&r.body.deals.every(x=>x.invoiced)&&r.body.objects.length===1&&r.body.rates[eq.id].rate===30000,'company context: deals (already invoiced), addresses, last rates');
 // по существующей сделке — новая сделка не создаётся
 const dealId=r.body.deals[0].id,orders=d.orders.length;
 r=await req('/api/quick-invoice',manager,'POST',{type:'invoice',clientId:c.id,orderId:dealId,items:[{description:'Простой крана',unit:'hour',quantity:4,rate:3000}],vatRate:22});d=D();
 ok(r.status===201&&!r.body.created.order&&d.orders.length===orders&&r.body.orderId===dealId,'invoice for an existing deal: no new deal');
 r=await req('/api/quick-invoice',manager,'POST',{type:'invoice',clientId:c.id,orderId:'o1',items:[{description:'x',unit:'hour',quantity:1,rate:1}]});ok(r.status===409||r.status===404,'deal of another company refused');
 // реквизиты дополняются, если в карточке пусто
 const bare=await req('/api/clients',manager,'POST',{name:'ИП Сидоров',inn:'500100732259',address:'—',equipmentType:'—',note:'—',ownership:'mixed',requestAt:'2026-11-09T10:00'});
 r=await req('/api/quick-invoice',manager,'POST',{...base1,client:{inn:'500100732259',name:'ИП Сидоров',legalAddress:'Подольск, ул. Ленина, 5',phone:'+7 900 000-00-00'},address:''});d=D();
 const sid=d.clients.find(x=>x.id===bare.body.id);ok(r.status===201&&sid.legalAddress==='Подольск, ул. Ленина, 5'&&sid.phone,'empty requisites of an existing company filled in');
 ok(d.objects.find(x=>x.id===d.orders.find(o=>o.id===r.body.orderId).objectId).address==='Подольск, ул. Ленина, 5','no work address → company address used');
 // чужая компания по ИНН у другого менеджера
 const other=await req('/api/clients',director,'POST',{name:'ООО Чужая',inn:'7707083893',address:'—',equipmentType:'—',note:'—',ownership:'mixed',requestAt:'2026-11-09T10:00'});
 const foreignVisible=(await req('/api/clients/'+other.body.id,manager)).status===200;
 r=await req('/api/quick-invoice',manager,'POST',{...base1,client:{inn:'7707083893',name:'ООО Чужая'}});ok(foreignVisible?r.status===201:(r.status===409&&/другого менеджера/.test(r.body.error)),'company of another manager: not duplicated');
 // без права на CRM — нельзя
 const acc=await login('accountant').catch(()=>null);if(acc){r=await req('/api/quick-invoice',acc,'POST',base1);ok(r.status>=400,'no CRM rights → refused')}
 // свой счёт и свой договор (шаблоны Word)
 const Docx=require('../lib/docx');const {readZip}=require('../lib/zip');
 const up=async(type,buf,name)=>req('/api/templates',director,'POST',{fileName:name,type,data:'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,'+buf.toString('base64')});
 r=await up('invoice',Docx.sampleInvoice(),'Наш счёт.docx');ok(r.status===201&&r.body.type==='invoice'&&r.body.isDefault&&r.body.fields.includes('Документ.Номер')&&!r.body.unknown.length,'own invoice template uploaded (sample has all fields)');const invTpl=r.body.id;
 r=await up('contract',Docx.sample(),'Наш договор.docx');const conTpl=r.body.id;ok(r.status===201&&r.body.type==='contract','own contract template uploaded');
 r=await req('/api/quick-invoice',director,'POST',{...base1,client:{inn:'7728168971'},templateId:invTpl,withContract:true,contractTemplateId:conTpl});
 ok(r.status===201&&r.body.document.templateId===invTpl&&r.body.contract&&r.body.contract.templateId===conTpl&&r.body.contract.type==='contract','one click: invoice by own template + contract by own template');
 let f=await req('/api/documents/'+r.body.documentId+'/file?format=docx',director);const x=readZip(f.body).get('word/document.xml').toString();
 ok(f.status===200&&x.includes(r.body.document.number)&&x.includes('Новострой')&&x.includes('Доставка техники на объект')&&!x.includes('{{'),'own invoice filled: number, client, rows; no placeholders left');
 r=await req('/api/quick-invoice',director,'POST',{...base1,client:{inn:'7728168971'},templateId:conTpl});ok(r.status>=400&&/другого вида/.test(r.body.error),'contract template cannot be used for an invoice');
 r=await req('/api/templates/sample?type=invoice',director);ok(r.status===200&&readZip(r.body).get('word/document.xml').toString().includes('Счёт на оплату'),'sample invoice .docx downloadable');
 console.log(`OK quick invoice: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
