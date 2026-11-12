'use strict';
// Загрузка компаний из Excel/CSV любой CRM (Битрикс24): больше 500 строк, все телефоны и e-mail, ИНН из названия и комментария.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-cimp-'));process.env.DATA_FILE=path.join(temp,'data.json');process.env.UPLOADS_DIR=path.join(temp,'up');process.env.PROMETEY_CHROMIUM='/nonexistent';
fs.copyFileSync(path.join(__dirname,'../storage/data.demo.json'),process.env.DATA_FILE);const server=require('../server');const Sheet=require('../lib/sheet');let base,checks=0;
const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
async function req(p,token,method='GET',body){const r=await fetch(base+p,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)}}
(async()=>{try{await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 const t=(await req('/api/login',null,'POST',{email:'manager@prometey.local',password:'manager'})).body.token;const pv=await req('/api/privacy',t);await req('/api/privacy/accept',t,'POST',{agree:true,version:pv.body.version});
 // как выгрузка компаний из Битрикс24: 1200 строк, телефоны в разных колонках, ИНН в названии или в комментарии
 const head=['ID','Название компании','Тип компании','Рабочий телефон','Мобильный телефон','Рабочий e-mail','Частный e-mail','Ответственный','Комментарий'];
 const rows=[head];for(let i=0;i<1200;i++)rows.push([String(3000+i),`Клиент ${i} Автокран Видное`,'Клиент',i%3?String(79000000000+i):'',i%5===0?`+7 926 ${String(100+i%900).padStart(3,'0')}-00-${String(i%100).padStart(2,'0')} Якуб`:'',i===7?'buh@firma.ru':'',i===7?'boss@firma.ru':'','Андрей',i===9?'7723897850':i===11?'89771679693':'']);
 rows.push(['5000','ООО "7ВЫСОТ", ИНН 9728117530','Клиент','79162970589','','','','Андрей','']);
 rows.push(['5001','ООО "7ВЫСОТ", ИНН 9728117530','Клиент','79162970589','','','','Андрей','']);
 const xlsx=Sheet.writeXlsx(rows);
 let r=await req('/api/contacts/parse',t,'POST',{name:'COMPANY.xlsx',data:'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,'+xlsx.toString('base64')});
 ok(r.status===200&&r.body.total===1202&&r.body.columns.name==='Название компании'&&r.body.columns.phone.length===2&&r.body.columns.email.length===2,'Bitrix24 export recognised: name, two phone and two e-mail columns, 1202 rows');
 const p=r.body.rows;
 ok(p[7].email==='buh@firma.ru, boss@firma.ru'&&p[5].phone.includes('79000000005')&&p[5].phone.includes('Якуб'),'all phones and e-mails gathered into one field');
 ok(p[9].inn==='7723897850'&&!p[9].note&&p[11].phone.includes('89771679693'),'INN and phone moved out of the comment');
 ok(p[1200].name==='ООО "7ВЫСОТ"'&&p[1200].inn==='9728117530','INN taken out of the name');
 const pre=await req('/api/contacts/preview',t,'POST',{rows:p});ok(pre.status===200&&pre.body.summary.create===1201&&pre.body.summary.skip===1,'more than 500 rows accepted; exact duplicate skipped');
 r=await req('/api/contacts/import',t,'POST',{rows:p,expected:pre.body.expected});ok(r.status===200&&r.body.created===1201,'1201 companies imported in one go');
 const d=server.store.read();const c=d.clients.find(x=>x.inn==='9728117530');ok(c&&c.phone==='79162970589'&&c.managerId==='u-manager'&&c.source==='import','imported company is assigned to the manager');
 r=await req('/api/contacts/preview',t,'POST',{rows:p});ok(r.body.summary.create===0&&r.body.summary.skip===1202,'second upload of the same file adds nothing');
 const big=Array.from({length:3000},(_,i)=>({name:'Ж'.repeat(150)+i,inn:'',phone:'',note:'ё'.repeat(300)}));r=await req('/api/contacts/preview',t,'POST',{rows:big});
 ok(r.status===200&&r.body.plan.every((x,i)=>x.contact.name===big[i].name&&x.contact.note===big[i].note),'large Cyrillic request body arrives intact (no broken letters at chunk boundaries)');
 r=await req('/api/contacts/parse',t,'POST',{name:'x.xlsx',data:Sheet.writeXlsx([['Телефон'],['1']]).toString('base64')});ok(r.status===400&&/названием/.test(r.body.error),'file without a name column explained');
 r=await req('/api/contacts/parse',null,'POST',{name:'x.xlsx',data:''});ok(r.status===401,'requires login');
 console.log(`OK contacts import: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
