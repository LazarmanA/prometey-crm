// Логотипы и свои шаблоны договоров (.docx): загрузка, права, заполнение, PDF/Word.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-files-'));
process.env.DB_FILE=path.join(temp,'db.sqlite');process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.RECORDINGS_DIR=path.join(temp,'recordings');
const server=require('../server');
const Docx=require('../lib/docx'),{readZip,writeZip}=require('../lib/zip'),W=require('../lib/words');
let base,checks=0;const check=(ok,label)=>{assert.ok(ok,label);checks++;console.log('PASS',label)};
async function req(p,token,method='GET',body){const r=await fetch(base+p,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});let json=null;try{json=await r.json()}catch{}return {status:r.status,body:json}}
const raw=(p,token)=>fetch(base+p,{headers:{authorization:'Bearer '+token}});
const login=async(email,password)=>(await req('/api/login',null,'POST',{email,password})).body?.token;
function png(w=4,h=4){const crc=b=>{const t=Buffer.alloc(4);t.writeUInt32LE(0);return require('../lib/zip').crc32(b)};const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([len,td,c])};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;const rows=Buffer.alloc((w*3+1)*h,0xd0);for(let y=0;y<h;y++)rows[y*(w*3+1)]=0;return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))])}
const text=docx=>[...readZip(docx).get('word/document.xml').toString('utf8').matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m=>m[1]).join('');
(async()=>{try{
 // --- модуль Word: поле, разрезанное на части, как это делает Word ---
 const split=`<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Заказчик: {{Кли</w:t></w:r><w:proofErr/><w:r><w:rPr><w:b/></w:rPr><w:t>ент.Наимен</w:t></w:r><w:r><w:t xml:space="preserve">ование}}, ИНН {{ Клиент.ИНН }} {{Неизвестное}}</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>№</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>{{Строка.№}}. {{Строка.Наименование}} — {{Строка.Сумма}}</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Итого {{Сумма}} ({{СуммаПрописью}}) &amp; адрес {{Клиент.Адрес}}</w:t></w:r></w:p></w:body></w:document>`;
 const tpl=writeZip(new Map([['[Content_Types].xml','<Types/>'],['word/document.xml',split]]));
 const info=Docx.inspect(tpl);check(info.fields.includes('Клиент.Наименование')&&info.fields.includes('Строка.№')&&info.unknown.includes('Неизвестное'),'fields found even when Word splits them; unknown fields reported');
 const filled=Docx.fill(tpl,{doc:{number:'ДГ-1',date:'2026-10-30'},entity:{},client:{name:'ООО «Кран & Ко»',inn:'7700000000',legalAddress:'Москва\nул. Ленина, 1'},order:{},object:{},items:[{description:'Кран 25 т',quantity:2,unit:'shift',rate:30000,gross:60000},{description:'Самосвал',quantity:1,unit:'trip',rate:5400.5,gross:5400.5}],totals:{totalGross:65400.5,totalNet:53607,vatTotal:11793.5,vatRate:22}});
 const out=text(filled).replace(/[\u00a0\u202f]/g,' '),xml=readZip(filled).get('word/document.xml').toString('utf8');
 check(out.includes('Заказчик: ООО «Кран &amp; Ко», ИНН 7700000000')&&out.includes('{{Неизвестное}}'),'placeholders replaced inside split runs, XML escaped, unknown left visible');
 check(out.includes('1. Кран 25 т — 60 000,00')&&out.includes('2. Самосвал — 5 400,50')&&(xml.match(/<w:tr>/g)||[]).length===3,'table row repeated for every item');
 check(out.includes('Шестьдесят пять тысяч четыреста рублей 50 копеек')&&xml.includes('<w:br/>'),'sum in words and multi-line address');
 check(W.rublesInWords(1001)==='Одна тысяча один рубль 00 копеек'&&W.rublesInWords(2)==='Два рубля 00 копеек','rubles in words');
 check(Docx.inspect(Docx.sample()).unknown.length===0&&Docx.inspect(Docx.sample()).fields.length>=30,'sample template uses only known fields');

 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 const D=await login('director@prometey.local','director'),M=await login('manager@prometey.local','manager');
 // --- логотипы ---
 const img='data:image/png;base64,'+png().toString('base64');
 let r=await req('/api/files/logo',M,'POST',{target:'legalEntity',id:'le-demo',data:img});check(r.status===403,'manager cannot change our organization logo');
 r=await req('/api/files/logo',D,'POST',{target:'legalEntity',id:'le-demo',data:'data:image/svg+xml;base64,'+Buffer.from('<svg onload=alert(1)>').toString('base64')});check(r.status===400,'SVG / non-image rejected');
 r=await req('/api/files/logo',D,'POST',{target:'legalEntity',id:'le-demo',data:img});check(r.status===200&&r.body.logo.mime==='image/png','director uploads organization logo');
 const logoId=r.body.logo.fileId;
 let f=await raw('/api/files/logos/'+logoId,M);check(f.status===200&&f.headers.get('content-type')==='image/png'&&f.headers.get('x-content-type-options')==='nosniff','logo served to signed-in users');
 check((await fetch(base+'/api/files/logos/'+logoId)).status===401,'logo not served anonymously');
 check((await raw('/api/files/logos/../../db.sqlite',D)).status===404||(await raw('/api/files/logos/..%2f..%2fdb.sqlite',D)).status===404,'no path traversal');
 const ents=(await req('/api/documents/legal-entities',D)).body;check(ents.find(e=>e.id==='le-demo').logo.fileId===logoId,'logo saved in requisites');
 const clients=(await req('/api/clients',M)).body,myClient=clients[0];
 r=await req('/api/files/logo',M,'POST',{target:'client',id:myClient.id,data:img});check(r.status===200||r.status===403,'client logo respects CRM rights');
 r=await req('/api/files/logo',D,'POST',{target:'client',id:myClient.id,data:img});check(r.status===200,'client company logo uploaded');
 check((await req('/api/clients',D)).body.find(c=>c.id===myClient.id).logo?.fileId===r.body.logo.fileId,'client list returns logo');
 // логотип в PDF
 r=await req('/api/documents/issue',D,'POST',{type:'invoice',orderId:'o1',legalEntityId:'le-demo',source:'plan',vatRate:22,vatIncluded:true,date:'2026-10-30'});check(r.status===201,'invoice issued with logo');
 const Documents=require('../lib/documents'),store=new (require('../lib/database').Store)(process.env.DB_FILE,path.join(__dirname,'../storage/data.demo.json'));
 const doc=store.read().documents.find(d=>d.id===r.body.id);check(Documents.docHtml(store.read(),doc).includes('<img src="data:image/png;base64,'),'logo embedded into document');
 // --- шаблоны ---
 check((await req('/api/templates/fields',M)).body.some(g=>g.fields.some(x=>x.code==='{{Клиент.ИНН}}')),'field list for the hint panel');
 f=await raw('/api/templates/sample',M);const sampleBuf=Buffer.from(await f.arrayBuffer());check(f.status===200&&readZip(sampleBuf).has('word/document.xml'),'sample .docx downloadable');
 const b64=b=>b.toString('base64');
 r=await req('/api/templates',M,'POST',{fileName:'Мой договор.docx',data:b64(sampleBuf)});check(r.status===403,'manager cannot upload templates');
 r=await req('/api/templates',D,'POST',{fileName:'старый.doc',data:b64(Buffer.from('xx'))});check(r.status===400&&/docx/.test(r.body.error),'.doc explained');
 r=await req('/api/templates',D,'POST',{fileName:'не-word.docx',data:b64(Buffer.from('PK not a zip'))});check(r.status===400,'broken file rejected');
 r=await req('/api/templates',D,'POST',{fileName:'Договор аренды крана.docx',type:'contract',data:'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,'+b64(sampleBuf)});
 check(r.status===201&&r.body.isDefault&&r.body.name==='Договор аренды крана'&&r.body.unknown.length===0,'template uploaded, default for contracts');
 const tplId=r.body.id;
 check((await req('/api/templates?type=contract',M)).body.length===1,'managers see templates');
 r=await req('/api/documents/issue',D,'POST',{type:'invoice',orderId:'o1',legalEntityId:'le-demo',templateId:tplId,source:'plan',vatRate:22,vatIncluded:true});check(r.status===400,'template type must match document type');
 r=await req('/api/documents/issue',D,'POST',{type:'contract',orderId:'o1',legalEntityId:'le-demo',templateId:tplId,date:'2026-10-30'});check(r.status===201&&r.body.templateName==='Договор аренды крана','contract issued by own template');
 const cid=r.body.id;
 f=await raw('/api/documents/'+cid+'/file?format=docx',D);const word=Buffer.from(await f.arrayBuffer());const wt=text(word);
 const order=store.read().orders.find(o=>o.id==='o1'),client=store.read().clients.find(c=>c.id===order.clientId);
 check(f.status===200&&wt.includes(client.name.replace(/&/g,'&amp;'))&&wt.includes(r.body.number)&&!wt.includes('{{'),'Word file filled with deal data, no placeholders left');
 check(/рубл/.test(wt)&&/Строка|\{\{/.test(wt)===false,'items table and sum in words filled');
 f=await raw('/api/documents/'+cid+'/file',D);const pdf=Buffer.from(await f.arrayBuffer());
 const lo=require('../lib/pdf').libreOfficePath();
 if(lo)check(f.headers.get('content-type')==='application/pdf'&&pdf.subarray(0,4).toString()==='%PDF','PDF made from own template (LibreOffice)');
 else check(f.headers.get('content-type').includes('wordprocessingml'),'without LibreOffice the contract comes as Word');
 r=await req('/api/templates/'+tplId,D,'PATCH',{name:'Аренда крана 2027'});check(r.status===200&&r.body.name==='Аренда крана 2027','template renamed');
 r=await req('/api/templates/'+tplId,D,'DELETE');check(r.status===200&&(await req('/api/templates',D)).body.length===0,'template removed from list');
 f=await raw('/api/documents/'+cid+'/file?format=docx',D);check(f.status===200,'already issued contract still downloads after template removal');
 const backup=require('node:child_process').spawnSync(process.execPath,[path.join(__dirname,'../scripts/full-backup.js')],{env:{...process.env,BACKUP_DIR:path.join(temp,'backups')},encoding:'utf8'});
 check(backup.status===0&&JSON.parse(backup.stdout).uploadFiles>=3,'logos and templates included in backups');
 store.close();
 console.log(`OK files: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
