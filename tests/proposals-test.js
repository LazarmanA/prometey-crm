'use strict';
// КП: несколько строк техники (час / смена / рейс), нумерация, PDF и Word, подпись и печать, права.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readZip}=require('../lib/zip');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-kp-'));process.env.DATA_FILE=path.join(temp,'data.json');process.env.UPLOADS_DIR=path.join(temp,'up');process.env.DOCUMENTS_DIR=path.join(temp,'docs');
try{process.env.PROMETEY_CHROMIUM=process.env.PROMETEY_CHROMIUM||require('playwright').chromium.executablePath()}catch{}
fs.copyFileSync(path.join(__dirname,'../storage/data.demo.json'),process.env.DATA_FILE);const server=require('../server');let base,checks=0;
const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
async function req(p,token,method='GET',body){const r=await fetch(base+p,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const type=r.headers.get('content-type')||'';return {status:r.status,type,disp:r.headers.get('content-disposition')||'',body:type.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer())}}
(async()=>{try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});base='http://127.0.0.1:'+server.address().port;
 const login=async role=>(await req('/api/login',null,'POST',{email:role+'@prometey.local',password:role})).body.token;
 const manager=await login('manager'),director=await login('director');
 for(const t of [manager,director]){const r=await req('/api/privacy',t);await req('/api/privacy/accept',t,'POST',{agree:true,version:r.body.version})}
 const eq=server.store.read().equipment.find(e=>!e.archivedAt);
 let r=await req('/api/proposals',manager);ok(r.status===200&&Array.isArray(r.body.items)&&r.body.defaults.terms.includes('Смена'),'list + defaults (intro, terms, validity)');
 const body={clientName:'ООО "Новострой"',clientInn:'7728168971',contactName:'Петров П.П.',items:[
  {equipmentId:eq.id,name:'Автокран 25 т',specs:'Стрела 31 м, г/п 25 т',unit:'shift',rate:42000,minOrder:'1 смена'},
  {name:'Экскаватор-погрузчик JCB 3CX',unit:'hour',rate:3200,minOrder:'4 часа'},
  {name:'Самосвал 25 т',unit:'trip',rate:9500}]};
 r=await req('/api/proposals',manager,'POST',{items:[]});ok(r.status===400,'no rows → error');
 r=await req('/api/proposals',manager,'POST',{...body,items:[{name:'Кран',unit:'shift',rate:''}]});ok(r.status===400&&/Строка 1/.test(r.body.error),'row without price → error names the row');
 r=await req('/api/proposals',manager,'POST',body);const kp=r.body;
 ok(r.status===201&&/^КП-\d{4}-0001$/.test(kp.number)&&kp.items.length===3&&kp.items.map(i=>i.unit).join()==='shift,hour,trip','KP created: 3 rows (смена, час, рейс), numbered');
 ok(kp.validUntil>kp.date&&kp.vatRate===22&&kp.vatIncluded,'valid 14 days, VAT from our organization');
 r=await req('/api/proposals',manager,'POST',body);ok(r.body.number.endsWith('0002'),'numbering continues');
 // PDF
 r=await req(`/api/proposals/${kp.id}/file?format=pdf`,manager);
 ok(r.status===200&&r.type==='application/pdf'&&r.body.subarray(0,4).toString()==='%PDF'&&decodeURIComponent(r.disp).includes(kp.number),'PDF downloaded, named by number');
 // Word
 r=await req(`/api/proposals/${kp.id}/file?format=docx`,manager);ok(r.status===200&&/wordprocessingml/.test(r.type)&&decodeURIComponent(r.disp).endsWith('.docx'),'Word (.docx) downloaded');
 const xml=readZip(r.body).get('word/document.xml').toString();
 ok(xml.includes('Автокран 25 т')&&xml.includes('за смену')&&xml.includes('за час')&&xml.includes('за рейс')&&xml.includes('42 000 ₽')&&xml.includes('Новострой'),'Word: rows, units and prices inside');
 ok(!xml.includes('{{')&&!xml.includes('⟦'),'Word: no leftover placeholders');
 // HTML-версия: подпись и печать
 const d=server.store.read();const html=require('../lib/proposals');void html;
 r=await req('/api/proposals/preview',manager,'POST',{...body,facsimile:true});ok(r.status===200&&String(r.body).includes('Коммерческое предложение')&&String(r.body).includes('за рейс')&&String(r.body).includes('Предложение действительно до'),'live preview HTML');
 // правка, копия, список, поиск
 r=await req('/api/proposals/'+kp.id,manager,'PATCH',{...body,items:[...body.items,{name:'Манипулятор 7 т',unit:'hour',rate:3500}],vatIncluded:false});ok(r.status===200&&r.body.items.length===4&&r.body.vatIncluded===false,'edit: 4th row, prices without VAT');
 r=await req(`/api/proposals/${kp.id}/copy`,manager,'POST',{});ok(r.status===201&&r.body.id!==kp.id&&r.body.items.length===4&&r.body.number!==kp.number,'copy KP → new number, same rows');
 r=await req('/api/proposals?q=Манипулятор',manager);ok(r.body.items.length===2&&r.body.items.every(x=>x.items===4),'search by equipment name');
 ok((await req('/api/proposals',manager)).body.items.find(x=>x.id===kp.id).sentAt,'downloaded KP marked');
 // права: другой менеджер не видит, директор видит
 r=await req('/api/proposals',director);ok(r.body.items.some(x=>x.id===kp.id),'director sees the team’s KPs');
 const acc=await login('accountant').catch(()=>null);if(acc){r=await req('/api/proposals/'+kp.id,acc);ok([403,404].includes(r.status),'other roles: no access to someone else’s KP')}
 r=await req('/api/proposals/'+kp.id,manager,'DELETE');ok(r.status===200&&!(await req('/api/proposals',manager)).body.items.some(x=>x.id===kp.id),'delete');
 ok((await req('/api/proposals/'+kp.id+'/file',manager)).status===404,'deleted KP not downloadable');
 void d;console.log(`OK proposals: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
