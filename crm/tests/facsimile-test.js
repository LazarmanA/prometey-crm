'use strict';
// 1.7.1: подпись и печать у каждой нашей организации, выпуск с факсимиле и без, документы из карточки компании,
// поля {{Подпись}} {{Печать}} в своих шаблонах Word.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readZip}=require('../lib/zip');const Docx=require('../lib/docx');const Documents=require('../lib/documents');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-fax-'));process.env.DATA_FILE=path.join(temp,'data.json');process.env.UPLOADS_DIR=path.join(temp,'up');process.env.DOCUMENTS_DIR=path.join(temp,'docs');process.env.PROMETEY_CHROMIUM='/nonexistent';
fs.copyFileSync(path.join(__dirname,'../storage/data.demo.json'),process.env.DATA_FILE);const server=require('../server');let base,checks=0;
const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
// 2×1 PNG (подпись) и 3×3 PNG (печать) с прозрачностью
const png=(w,h)=>{const zlib=require('node:zlib');const crc=b=>{let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}let x=0xffffffff;for(const v of b)x=t[(x^v)&255]^(x>>>8);return (x^0xffffffff)>>>0};const chunk=(type,data)=>{const l=Buffer.alloc(4);l.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])};const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*(w*4+1)+1+x*4;raw[i]=30;raw[i+1]=40;raw[i+2]=160;raw[i+3]=(x+y)%2?255:0}return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])};
const SIG=png(4,2),STAMP=png(3,3);const uri=b=>'data:image/png;base64,'+b.toString('base64');
async function req(p,token,method='GET',body){const r=await fetch(base+p,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const type=r.headers.get('content-type')||'';return {status:r.status,body:type.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer()),headers:r.headers}}
(async()=>{try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});base='http://127.0.0.1:'+server.address().port;
 const login=async role=>(await req('/api/login',null,'POST',{email:role+'@prometey.local',password:role})).body.token;const director=await login('director'),manager=await login('manager');
 for(const t of [director,manager]){const r=await req('/api/privacy',t);await req('/api/privacy/accept',t,'POST',{agree:true,version:r.body.version})}
 // ---- вторая наша организация со своей подписью и печатью ----
 let r=await req('/api/documents/legal-entities',director,'POST',{name:'ИП Петров Пётр Петрович',shortName:'ИП Петров П.П.',inn:'500100732259',address:'Москва',bankAccount:'40802810938000000002',bankName:'ПАО СБЕРБАНК',bik:'044525225',correspondentAccount:'30101810400000000225',signatoryName:'Петров Пётр Петрович',signatoryPosition:'Индивидуальный предприниматель',vatRate:0});
 ok(r.status===200||r.status===201,'second own organization (ИП) added');const ip=r.body.id||r.body.entity?.id;
 ok((await req('/api/files/logo',manager,'POST',{target:'legalEntity',id:ip,kind:'signature',data:uri(SIG)})).status===403,'manager cannot change the signature');
 for(const [kind,img] of [['signature',SIG],['stamp',STAMP]]){r=await req('/api/files/logo',director,'POST',{target:'legalEntity',id:ip,kind,data:uri(img)});assert.ok(r.status<300,JSON.stringify(r.body))}
 r=await req('/api/documents/legal-entities',director);const ipE=r.body.find(e=>e.id===ip),demo=r.body.find(e=>e.id==='le-demo');
 ok(ipE.signatureImage&&ipE.stampImage&&!demo.signatureImage,'each organization keeps its own signature and stamp');
 r=await req('/api/files/logos/'+ipE.stampImage.fileId,manager);ok(r.status===200&&r.body.equals(STAMP),'stamp image served to the team (for preview when issuing)');
 // ---- выпуск с факсимиле и без ----
 const pre=(await req('/api/documents/preview',manager,'POST',{type:'invoice',orderId:'o1',legalEntityId:ip,source:'plan',vatRate:0,vatIncluded:true})).body;
 ok(pre.facsimile.signature&&pre.facsimile.stamp,'preview tells the signature and stamp will be in the document');
 const issue=async(facsimile,type='invoice',extra={})=>{const r=await req('/api/documents/issue',manager,'POST',{type,orderId:'o1',legalEntityId:ip,source:'plan',vatRate:0,vatIncluded:true,items:type==='contract'?undefined:pre.items,facsimile,...extra});assert.ok([200,201].includes(r.status),JSON.stringify(r.body));return r.body.id};
 const withFax=await issue(true),noFax=await issue(false);
 Documents.configure({files:require('../lib/files').createFiles({dir:process.env.UPLOADS_DIR})});
 const readDoc=id=>{const d=structuredClone(server.store.read());return [d,d.documents.find(x=>x.id===id)]};
 let [d,doc]=readDoc(withFax);
 ok(doc.facsimile===true&&doc.legalEntityId===ip,'document issued by the selected organization with facsimile');
 let html=Documents.docHtml(d,doc,'chromium');const sigB64=SIG.toString('base64'),stB64=STAMP.toString('base64');
 ok(html.includes(sigB64)&&html.includes(stB64)&&html.includes('position:absolute'),'invoice: signature + stamp over it (browser PDF)');
 html=Documents.docHtml(d,doc,'libreoffice');ok(html.includes(stB64)&&!html.includes('position:absolute')&&html.includes('border="1"'),'LibreOffice fallback: stamp next to signature, table borders kept');
 [d,doc]=readDoc(noFax);html=Documents.docHtml(d,doc,'chromium');ok(doc.facsimile===false&&!html.includes(sigB64)&&!html.includes(stB64)&&html.includes('____________'),'«без факсимиле»: empty line for a handwritten signature');
 // договор-счёт и договор
 [d,doc]=readDoc(await issue(true,'contract_invoice'));html=Documents.docHtml(d,doc,'chromium');ok(html.includes('Договор-счёт')&&html.includes(stB64),'contract-invoice with signature and stamp');
 // ---- из карточки компании: рамочный договор без сделки ----
 const clientId=pre.client.id;
 ok((await req('/api/documents/preview',manager,'POST',{type:'invoice',clientId,legalEntityId:ip})).status===400,'invoice without a deal: asks to choose a deal');
 r=await req('/api/documents/preview',manager,'POST',{type:'contract',clientId,legalEntityId:ip});ok(r.status===200&&r.body.order===null&&r.body.client.id===clientId,'framework contract preview from the company card');
 r=await req('/api/documents/issue',manager,'POST',{type:'contract',clientId,legalEntityId:ip,facsimile:true});if(r.status>299)console.log(r.status,r.body);ok([200,201].includes(r.status),"framework contract issued without a deal");
 [d,doc]=readDoc(r.body.id);ok(doc.orderIds.length===0&&doc.clientId===clientId&&Documents.docHtml(d,doc,'chromium').includes(stB64),'contract belongs to the company, signed and stamped');
 r=await req('/api/documents/summary?kind=clients&id='+encodeURIComponent(clientId),manager);ok(r.body.recent.some(x=>x.id===doc.id),'contract listed in the company card');
 const foreign=d.clients.find(c=>c.managerId&&c.managerId!==d.users.find(u=>u.email==='manager@prometey.local').id&&!d.orders.some(o=>o.clientId===c.id&&o.managerId===d.users.find(u=>u.email==='manager@prometey.local').id));
 if(foreign)ok([403,404].includes((await req('/api/documents/issue',manager,'POST',{type:'contract',clientId:foreign.id,legalEntityId:ip})).status),'manager cannot issue a contract for someone else’s company');
 r=await req('/api/documents/'+withFax+'/file',manager);ok(r.status===200||r.status===503,'file endpoint still works');
 // ---- свой шаблон Word: {{Подпись}} {{Печать}} ----
 const ctx={doc:{number:'1',date:'2026-11-07'},entity:{signatoryName:'Петров Пётр Петрович'},client:{},order:{},object:{},items:[],totals:{},images:{signature:{...Docx.imageSize(SIG),buf:SIG},stamp:{...Docx.imageSize(STAMP),buf:STAMP}}};
 let zip=readZip(Docx.fill(Docx.sample(),ctx));const xml=zip.get('word/document.xml').toString();
 ok(Docx.fieldList().some(g=>g.fields.some(f=>f.code==='{{Печать}}')),'template field list includes {{Подпись}} and {{Печать}}');
 ok(xml.includes('<wp:inline')&&xml.includes('<wp:anchor')&&!xml.includes('⟦'),'Word template: signature inline, stamp floating over the text');
 ok(zip.get('word/media/prometey-signature.png').equals(SIG)&&/rIdPrmstamp/.test(zip.get('word/_rels/document.xml.rels').toString())&&/Extension="png"/.test(zip.get('[Content_Types].xml').toString()),'images packed into the .docx (media, links, types)');
 zip=readZip(Docx.fill(Docx.sample(),{...ctx,images:{}}));ok(zip.get('word/document.xml').toString().includes('Исполнитель ____________')&&![...zip.keys()].some(k=>k.startsWith('word/media')),'without facsimile: a blank line in the template');
 ok(Docx.inspect(Docx.sample()).unknown.length===0,'sample template has no unknown fields');
 console.log(`OK facsimile: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
