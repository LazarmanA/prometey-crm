'use strict';
// 1.7.0: регистрация организации (реквизиты по ИНН/БИК, оформление, логотип), подпись и печать, импорт из Excel.
const {spawn}=require('node:child_process');const http=require('node:http');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const Sheet=require('../lib/sheet');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-company-'));
let checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
const port=44000+Math.floor(Math.random()*15000),BASE=`http://127.0.0.1:${port}`;
const PNG=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4f30000000049454e44ae426082','hex');
const KEY='0123456789abcdef0123456789abcdef01234567';
// поддельный DaData
const calls=[];
const dadata=http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{calls.push({url:req.url,auth:req.headers.authorization,body:b});
 if(req.headers.authorization!=='Token '+KEY){res.writeHead(403);return res.end('{}')}
 const q=JSON.parse(b).query;res.setHeader('content-type','application/json');
 if(req.url.endsWith('/findById/party'))return res.end(JSON.stringify({suggestions:q==='7707083893'?[{value:'ООО "КРАН-СЕРВИС"',data:{inn:'7707083893',kpp:'773601001',ogrn:'1027700132195',type:'LEGAL',name:{full_with_opf:'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "КРАН-СЕРВИС"',short_with_opf:'ООО "КРАН-СЕРВИС"'},management:{name:'Иванов Иван Иванович',post:'ГЕНЕРАЛЬНЫЙ ДИРЕКТОР'},address:{value:'г Москва, ул Вавилова, д 19',unrestricted_value:'117312, г Москва, ул Вавилова, д 19'},state:{status:'ACTIVE'}}}]:[]}));
 if(req.url.endsWith('/findById/bank'))return res.end(JSON.stringify({suggestions:q==='044525225'?[{value:'ПАО Сбербанк',data:{bic:'044525225',correspondent_account:'30101810400000000225',name:{payment:'ПАО СБЕРБАНК'},address:{value:'г Москва'}}}]:[]}));
 res.writeHead(404);res.end('{}')})});
const req=async(p,{method='GET',body,token,headers={}}={})=>{const r=await fetch(BASE+p,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});const ct=r.headers.get('content-type')||'';return {status:r.status,headers:r.headers,body:ct.includes('json')?await r.json():Buffer.from(await r.arrayBuffer())}};
const consent=async t=>{const r=await req('/api/privacy',{token:t});await req('/api/privacy/accept',{method:'POST',token:t,body:{agree:true,version:r.body.version}})};
const xlsx=rows=>Sheet.writeXlsx(rows).toString('base64');
(async()=>{let p;try{
 await new Promise(r=>dadata.listen(0,'127.0.0.1',r));
 p=spawn(process.execPath,['--disable-warning=ExperimentalWarning','server.js'],{cwd:root,env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),PROMETEY_SETUP:'1',PROMETEY_SETUP_TOKEN:'co-token-1234567890',PROMETEY_DADATA_URL:`http://127.0.0.1:${dadata.address().port}`,DB_FILE:path.join(temp,'db.sqlite'),UPLOADS_DIR:path.join(temp,'up'),DOCUMENTS_DIR:path.join(temp,'docs'),COOKIE_SECURE:'false'},stdio:['ignore','pipe','pipe']});
 await new Promise((res,rej)=>{let o='';p.stdout.on('data',d=>{o+=d;if(o.includes('ПРОМЕТЕЙ'))res()});p.stderr.on('data',d=>o+=d);setTimeout(()=>rej(new Error(o)),15000)});
 // ---------- поиск реквизитов до регистрации ----------
 let r=await req('/api/setup/lookup',{method:'POST',body:{kind:'inn',query:'7707083893'}});ok(r.status===409&&r.body.code==='no_key'&&/DaData/.test(r.body.error),'no DaData key: clear message, manual entry');
 ok((await req('/api/setup/lookup',{method:'POST',body:{kind:'inn',query:'7707083893'},headers:{'x-forwarded-for':'203.0.113.5'}})).status===403,'lookup before registration only from this computer or with the installer link');
 // ключ от сервера (переменная окружения) — перезапускать не будем: проверим через настройки после регистрации; здесь — подставной ключ в env отсутствует
 // ---------- регистрация организации ----------
 r=await req('/api/setup',{method:'POST',body:{name:'Иван Иванов',email:'boss@kran.ru',password:'Kran-Boss-2026!',clearDemo:true,organization:{
  company:{inn:'7707083893',name:'ООО «Кран-Сервис»',shortName:'ООО «Кран-Сервис»',kpp:'773601001',ogrn:'1027700132195',address:'117312, г Москва, ул Вавилова, д 19',signatoryName:'Иванов Иван Иванович',signatoryPosition:'Генеральный директор',phone:'+7 495 000-00-00',email:'info@kran.ru'},
  bank:{bik:'044525225',bankName:'ПАО СБЕРБАНК',correspondentAccount:'30101810400000000225',bankAccount:'40702810938000000001',vatRate:22},
  brand:{appName:'Кран-Сервис CRM',color:'#1570ef',logo:'data:image/png;base64,'+PNG.toString('base64')}}}});
 ok(r.status===200&&r.body.token&&r.body.recoveryCode,'organization registered in one step: owner signed in, recovery code issued');
 const boss=r.body.token;await consent(boss);
 r=await req('/api/config');ok(r.body.brand.appName==='Кран-Сервис CRM'&&r.body.brand.color==='#1570ef'&&r.body.brand.logoUrl.startsWith('/api/brand/logo'),'brand (name, colour, logo) published for every screen incl. login');
 r=await req(r.body.brand.logoUrl);ok(r.status===200&&r.body.equals(PNG),'logo served on the login page');
 r=await req('/api/company',{token:boss});const e=r.body.entity;
 ok(e.inn==='7707083893'&&e.ogrn==='1027700132195'&&e.bankAccount==='40702810938000000001'&&e.bik==='044525225'&&e.email==='info@kran.ru'&&e.logo,'company card: requisites, bank, contacts and logo saved');
 ok(r.body.entity.id==='le-demo'&&!(await req('/api/documents/legal-entities',{token:boss})).body.some(x=>x.name.includes('ДЕМО')),'demo organisation replaced by the real one');
 ok((await req('/api/clients',{token:boss})).body.length===0,'demo data cleared');
 // ---------- DaData с ключом ----------
 ok((await req('/api/company/brand',{method:'PATCH',token:boss,body:{appName:'Кран-Сервис CRM',color:'#1570ef',dadataKey:'bad'}})).status===400,'wrong key format refused');
 r=await req('/api/company/brand',{method:'PATCH',token:boss,body:{appName:'Кран-Сервис CRM',color:'#1570ef',dadataKey:KEY}});ok(r.status===200&&r.body.dadata,'DaData key saved');
 r=await req('/api/company/lookup',{method:'POST',token:boss,body:{kind:'inn',query:'7707083893'}});
 ok(r.status===200&&r.body.kpp==='773601001'&&r.body.signatoryName==='Иванов Иван Иванович'&&r.body.address.startsWith('117312')&&r.body.status==='действующая','INN lookup fills name, KPP, OGRN, address, director');
 ok(calls.at(-1).auth==='Token '+KEY&&JSON.parse(calls.at(-1).body).query==='7707083893','key sent only in the Authorization header');
 r=await req('/api/company/lookup',{method:'POST',token:boss,body:{kind:'bik',query:'044525225'}});ok(r.body.bankName==='ПАО СБЕРБАНК'&&r.body.correspondentAccount==='30101810400000000225','BIK lookup fills bank and correspondent account');
 ok((await req('/api/company/lookup',{method:'POST',token:boss,body:{kind:'inn',query:'7700000001'}})).status===404,'unknown INN: «не найдена»');
 ok((await req('/api/company/lookup',{method:'POST',token:boss,body:{kind:'inn',query:'123'}})).status===400,'invalid INN refused before calling DaData');
 ok(!JSON.stringify((await req('/api/company',{token:boss})).body).includes(KEY),'key never shown back');
 // ---------- подпись и печать в документах ----------
 for(const kind of ['signature','stamp'])ok((await req('/api/files/logo',{method:'POST',token:boss,body:{target:'legalEntity',id:e.id,kind,data:PNG.toString('base64')}})).status===200,kind+' uploaded');
 r=await req('/api/company',{token:boss});ok(r.body.entity.signatureImage&&r.body.entity.stampImage&&r.body.entity.logo,'logo, signature and stamp stored separately');
 const docHtml=require('../lib/documents').docHtml;require('../lib/documents').configure?.({files:require('../lib/files').createFiles({dir:path.join(temp,'up')})});
 const html=docHtml({legalEntities:[r.body.entity],clients:[],orders:[],objects:[]},{type:'invoice',number:'1',date:'2026-11-07',items:[],totals:{},legalEntityId:r.body.entity.id,renderContext:{legalEntity:r.body.entity,client:{name:'Клиент'},items:[],totals:{total:0,vat:0,net:0}}});
 ok((html.match(/data:image\/png;base64/g)||[]).length>=2,'signature and stamp printed in the invoice');
 // ---------- импорт из Excel ----------
 r=await req('/api/import/template/clients',{token:boss});ok(r.status===200&&Sheet.readTable(r.body.toString('base64'),'t.xlsx')[0][0]==='Название компании*','Excel template downloads');
 const clientsX=xlsx([['Название компании','ИНН','КПП','Юридический адрес','Телефон','E-mail','Контактное лицо'],['ООО Стройка','7701234567','770101001','Москва','+7 900','a@b.ru','Пётр'],['ООО Мост','12345','','','','',''],['ООО Стройка дубль','7701234567','','','','',''],['ИП Петров','','','','','','']]);
 r=await req('/api/import/clients',{method:'POST',token:boss,body:{name:'clients.xlsx',data:clientsX,dryRun:true}});
 ok(r.body.created===2&&r.body.errors.length===1&&r.body.errors[0].row===3&&r.body.skipped.length===1,'preview: 2 to add, 1 error (bad INN, row 3), 1 duplicate');
 ok((await req('/api/clients',{token:boss})).body.length===0,'preview changes nothing');
 r=await req('/api/import/clients',{method:'POST',token:boss,body:{name:'clients.xlsx',data:clientsX}});ok(r.body.created===2,'clients imported');
 let list=(await req('/api/clients',{token:boss})).body;ok(list.length===2&&list.find(c=>c.inn==='7701234567').note.includes('Пётр'),'imported clients visible with contact');
 r=await req('/api/import/clients',{method:'POST',token:boss,body:{name:'clients.xlsx',data:clientsX}});ok(r.body.created===0&&r.body.skipped.length===3,'re-import does not duplicate');
 const csv=Buffer.from(new TextEncoder().encode('')).length;// заглушка
 const cp1251=Buffer.from([0xc2,0xe8,0xe4,0x20,0xf2,0xe5,0xf5,0xed,0xe8,0xea,0xe8,0x3b,0xcc,0xee,0xe4,0xe5,0xeb,0xfc,0x3b,0xd1,0xe2,0xee,0xff,0x20,0xe8,0xeb,0xe8,0x20,0xed,0xe0,0xb8,0xec,0xed,0xe0,0xff,0x3b,0xd1,0xf2,0xe0,0xe2,0xea,0xe0,0x0d,0x0a,0xca,0xf0,0xe0,0xed,0x3b,0x4c,0x69,0x65,0x62,0x68,0x65,0x72,0x72,0x3b,0xed,0xe0,0xb8,0xec,0xed,0xe0,0xff,0x3b,0x34,0x35,0x20,0x30,0x30,0x30,0x0d,0x0a]);
 r=await req('/api/import/equipment',{method:'POST',token:boss,body:{name:'tech.csv',data:cp1251.toString('base64')}});
 const eq=(await req('/api/equipment',{token:boss})).body.find(x=>x.model==='Liebherr');
 ok(r.body.created===1&&eq&&eq.type==='Кран'&&eq.ownership==='rented'&&eq.saleRate===45000,'equipment from a Russian Excel CSV (Windows-1251): type, rented, rate 45 000');
 r=await req('/api/import/equipment',{method:'POST',token:boss,body:{name:'x.xlsx',data:xlsx([['Колонка1','Колонка2'],['a','b']])}});ok(r.status===400&&/Вид техники/.test(r.body.error),'wrong columns: tells which are missing');
 ok((await req('/api/import/clients',{method:'POST',token:boss,body:{name:'old.xls',data:Buffer.from('not zip').toString('base64')}})).status===400,'old .xls explained');
 // сотрудники → ссылки для входа
 r=await req('/api/import/employees',{method:'POST',token:boss,body:{name:'staff.xlsx',data:xlsx([['Имя и фамилия','E-mail','Телефон','Должность','Роль'],['Мария Счётова','buh@kran.ru','+7 900','Бухгалтер','Бухгалтер'],['Олег Водитель','oleg@kran.ru','','Водитель',''],['Без почты','','','',''],['Иван Иванов','boss@kran.ru','','','']])}});
 ok(r.body.created===2&&r.body.errors.length===1&&r.body.skipped.length===1&&r.body.links.length===2&&r.body.linksFile,'2 employees created, each with a personal sign-in link; links table to download');
 const buh=r.body.links.find(x=>x.email==='buh@kran.ru');ok(buh.role==='Бухгалтер','role taken from the table');
 const token=buh.link.split('#reset=')[1];r=await req('/api/password/reset/'+token);ok(r.body.welcome===true&&r.body.company.includes('Кран'),'employee link greets: «Добро пожаловать»');
 r=await req('/api/password/reset/'+token,{method:'POST',body:{password:'Buh-Kran-2026!!'}});ok(r.status===200&&r.body.user.role==='accountant','accountant sets own password and is inside');
 const users=(await req('/api/admin/users',{token:boss})).body;ok(users.some(u=>u.email==='oleg@kran.ru'&&u.role==='manager'),'empty role → «Менеджер»');
 const buhToken=r.body.token;await consent(buhToken);
 ok((await req('/api/import/clients',{method:'POST',token:buhToken,body:{name:'c.xlsx',data:clientsX}})).status===403,'accountant cannot import');
 ok((await req('/api/company/brand',{method:'PATCH',token:buhToken,body:{appName:'Hack',color:'#000000'}})).status===403,'accountant cannot change branding');
 console.log(`OK company: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{try{p?.kill()}catch{};dadata.close();fs.rmSync(temp,{recursive:true,force:true})}})();
