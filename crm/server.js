const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const CRM=require('./lib/crm');
const Security=require('./lib/security');
const Access=require('./lib/access');
const Documents=require('./lib/documents');
const {pdfEngine}=require('./lib/pdf');
const integrations=require('./lib/integrations').createIntegrations();
const adminApi=require('./lib/admin').createAdmin();
const ROOT=__dirname,PUBLIC=path.join(ROOT,'public');
const DATA_FILE=process.env.DATA_FILE||path.join(ROOT,'storage/data.demo.json');
const DB_FILE=process.env.DB_FILE||(process.env.DATA_FILE?DATA_FILE+'.sqlite':path.join(ROOT,'storage/prometey.sqlite'));
const DOCUMENTS_DIR=process.env.DOCUMENTS_DIR||path.join(path.dirname(DB_FILE),'documents');
const store=new (require('./lib/database').Store)(DB_FILE,DATA_FILE);
const UPLOADS_DIR=process.env.UPLOADS_DIR||path.join(path.dirname(DB_FILE),'uploads');
const Files=require('./lib/files').createFiles({dir:UPLOADS_DIR});
const Feed=require('./lib/feed'),feedApi=Feed.createFeed({settings:require('./lib/admin').settings,dir:UPLOADS_DIR});Documents.configure({files:Files});
const Transfer=require('./lib/transfer').createTransfer({store,version:require('./package.json').version,dirs:{uploads:UPLOADS_DIR,documents:DOCUMENTS_DIR,recordings:process.env.RECORDINGS_DIR||path.join(path.dirname(DB_FILE),'recordings')},backupDir:process.env.BACKUP_DIR||path.join(path.dirname(DB_FILE),'backups')});
const Onboarding=require('./lib/onboarding').createOnboarding();const Recovery=require('./lib/recovery').createRecovery();store.transaction(d=>({changed:Onboarding.prepare(d)}));
Security.bootstrapPasswords(store,process.env);
const recordingHandler=require('./lib/recordings').createRecordings(store,CRM,process.env.RECORDINGS_DIR||path.join(path.dirname(DB_FILE),'recordings'));
const telephony=require('./lib/telephony').createTelephony(store,process.env,process.env.RECORDINGS_DIR||path.join(path.dirname(DB_FILE),'recordings'));
const accountingApi=require('./lib/accounting').createAccounting({store,renderForm:require('./lib/pdf').renderForm});
let serverAdminApi=null;
const config=JSON.parse(fs.readFileSync(path.join(ROOT,'config/config.json'),'utf8'));
const SESSION_MS=Number(process.env.SESSION_TTL_HOURS||24)*3600000;
const VERSION=require('./package.json').version;
const MAX_SESSIONS_PER_USER=20;
const Avito=require('./lib/avito').createAvito({dataDir:path.dirname(DB_FILE),store});
const LicenseLib=require('./lib/license');
const License=LicenseLib.createLicense({dataDir:path.dirname(DB_FILE),store,version:VERSION,collect:LicenseLib.collector({store,dbFile:DB_FILE,pdfEngine,backupsDir:()=>process.env.BACKUP_DIR||path.join(path.dirname(DB_FILE),'backups'),logFile:process.env.PROMETEY_LAUNCHER_LOG||'',extra:d=>Privacy.forVendor(d)})});
const QuickInvoice=require('./lib/quickinvoice').createQuickInvoice({CRM,Documents});
const Company=require('./lib/company').createCompany({license:License,files:Files,recovery:Recovery});
const Privacy=require('./lib/privacy').createPrivacy({store,license:License});
const limits={
 loginPair:Security.createLimiter({limit:8,windowMs:15*60000}),     // one address + one account
 loginIp:Security.createLimiter({limit:30,windowMs:15*60000}),      // one address, any accounts (password spraying)
 loginAccount:Security.createLimiter({limit:20,windowMs:15*60000}), // one account from many addresses
 api:Security.createLimiter({limit:Number(process.env.API_RATE_LIMIT_PER_MIN)||600,windowMs:60000}),
 anon:Security.createLimiter({limit:Number(process.env.ANON_RATE_LIMIT_PER_MIN)||300,windowMs:60000}),
 webhook:Security.createLimiter({limit:Number(process.env.WEBHOOK_RATE_LIMIT_PER_MIN)||600,windowMs:60000})
};
const tooMany=(limiter,key)=>Object.assign(new Error('Слишком много запросов. Повторите через '+Math.max(1,Math.ceil(limiter.retryAfter(key)/60))+' мин.'),{status:429,retryAfter:limiter.retryAfter(key)});

const acceptsGzip=res=>/\bgzip\b/.test(String(res.req?.headers?.['accept-encoding']||''));
const json=(res,status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');let out=JSON.stringify(body);if(out.length>2048&&acceptsGzip(res)){res.setHeader('Content-Encoding','gzip');res.setHeader('Vary','Accept-Encoding');out=zlib.gzipSync(out,{level:4})}res.end(out)};
// Static files: kept in memory with gzip copy and ETag; browsers revalidate (304) so updates are picked up immediately.
const staticCache=new Map();
function staticEntry(file){const st=fs.statSync(file),hit=staticCache.get(file);if(hit&&hit.mtimeMs===st.mtimeMs&&hit.size===st.size)return hit;const raw=fs.readFileSync(file),etag='"'+crypto.createHash('sha1').update(raw).digest('base64url')+'"';const entry={mtimeMs:st.mtimeMs,size:st.size,raw,etag,gz:raw.length>1024?zlib.gzipSync(raw,{level:9}):null};staticCache.set(file,entry);return entry}
function readBody(req,limit=4*1024*1024){return new Promise((resolve,reject)=>{let raw='',size=0,failed=false;req.on('data',c=>{if(failed)return;size+=c.length;if(size>limit){failed=true;reject(Object.assign(new Error('Слишком большой запрос'),{status:413}));req.resume();return}raw+=c});req.on('end',()=>{if(failed)return;let value;try{value=raw?JSON.parse(raw):{}}catch{return reject(Object.assign(new Error('Некорректный JSON'),{status:400}))}if(!value||typeof value!=='object'||Array.isArray(value))return reject(Object.assign(new Error('Ожидается объект JSON'),{status:400}));resolve(value)});req.on('error',reject);req.on('aborted',()=>reject(Object.assign(new Error('Запрос прерван'),{status:400})))})}
const secureRequest=req=>Security.secureRequest(req);
const clientIp=req=>Security.clientIp(req);
function loginKeys(req,email){const ip=clientIp(req),account=String(email||'').trim().toLowerCase().slice(0,320);return {pair:ip+'|'+account,ip,account}}
function loginAllowed(req,email){const k=loginKeys(req,email);for(const [limiter,key] of [[limits.loginPair,k.pair],[limits.loginIp,k.ip],[limits.loginAccount,k.account]])if(!limiter.check(key))throw Object.assign(new Error('Слишком много попыток входа. Повторите через '+Math.max(1,Math.ceil(limiter.retryAfter(key)/60))+' мин.'),{status:429,retryAfter:limiter.retryAfter(key)})}
function loginFailed(req,email){const k=loginKeys(req,email);limits.loginPair.hit(k.pair);limits.loginIp.hit(k.ip);limits.loginAccount.hit(k.account);console.warn(`[security] failed login: ip=${k.ip} account=${JSON.stringify(k.account.slice(0,80))}`)}
function loginSucceeded(req,email){limits.loginPair.reset(loginKeys(req,email).pair)}
function currentSession(req,data){const raw=(req.headers.authorization||'').replace(/^Bearer\s+/,'')||Security.cookieToken(req);if(!raw)return null;const hash=Security.tokenHash(raw),now=Date.now();const session=(data.sessions||[]).find(s=>s.tokenHash===hash&&Date.parse(s.expiresAt)>now);if(!session)return null;const user=data.users.find(u=>u.id===session.userId);if(!user||user.disabled)return null;user.perms=Access.perms(data,user);return {raw,session,user}}
function authenticate(req){const data=store.read(),auth=currentSession(req,data);if(!auth)throw Object.assign(new Error('Требуется вход'),{status:401});return {...auth,data}}
function pruneSessions(data){const now=Date.now();data.sessions=(data.sessions||[]).filter(s=>Date.parse(s.expiresAt)>now);if(data.sessions.length>5000)data.sessions=data.sessions.slice(-5000)}

// Новый сеанс после входа, первой регистрации или регистрации по приглашению.
function startSession(req,res,user,data,password,extra={}){const raw=crypto.randomBytes(32).toString('base64url'),now=new Date(),expires=new Date(now.getTime()+SESSION_MS);store.transaction(d=>{pruneSessions(d);const mine=d.sessions.filter(s=>s.userId===user.id);if(mine.length>=MAX_SESSIONS_PER_USER){const drop=new Set(mine.slice(0,mine.length-MAX_SESSIONS_PER_USER+1).map(s=>s.id));d.sessions=d.sessions.filter(s=>!drop.has(s.id))}const u=d.users.find(x=>x.id===user.id);if(u&&password!==undefined&&!Security.isHash(u.passwordHash)){u.passwordHash=Security.hashPassword(password);delete u.password}if(u)u.lastLoginAt=now.toISOString();d.sessions.push({id:'sess_'+crypto.randomUUID(),tokenHash:Security.tokenHash(raw),userId:user.id,createdAt:now.toISOString(),expiresAt:expires.toISOString(),ip:clientIp(req),agent:String(req.headers['user-agent']||'').slice(0,160)});return {changed:true}});Security.setSessionCookie(res,raw,{secure:secureRequest(req),maxAge:Math.floor(SESSION_MS/1000)});const fresh=store.read(),u=fresh.users.find(x=>x.id===user.id)||user;return json(res,200,{token:raw,user:{...Security.publicUser(u),perms:Access.perms(fresh,u)},...extra})}
// Запрос с этого же компьютера (не через прокси): только так можно создать первую учётную запись без ссылки из установщика.
const isLoopback=req=>/^(127\.|::1$|::ffff:127\.)/.test(String(req.socket?.remoteAddress||''))&&!req.headers['x-forwarded-for']&&!req.headers['x-real-ip']&&!req.headers.forwarded;
// Адрес CRM для ссылок-приглашений: как открыли (если не localhost), иначе адрес в офисной сети.
function publicBase(req){const host=String(req.headers.host||'');const proto=secureRequest(req)?'https':'http';if(host&&!/^(localhost|127\.|\[::1\])/i.test(host))return {base:`${proto}://${host}`};const h=process.env.HOST||'127.0.0.1';if(['127.0.0.1','localhost','::1'].includes(h))return {base:'',networkOff:true};const ip=require('./lib/server-admin').lanIPs()[0];const port=server.address()?.port||Number(process.env.PORT||3030);return ip?{base:`http://${ip}:${port}`}:{base:'',networkOff:true}}

async function documentsApi(req,res,url,user,body){
 const p=url.pathname;
 if(p==='/api/documents/units'&&req.method==='GET')return json(res,200,Documents.UNITS);
 if(p==='/api/documents/legal-entities'&&req.method==='GET'){const d=store.read();return json(res,200,d.legalEntities||[])}
 const le=p.match(/^\/api\/documents\/legal-entities(?:\/([^/]+))?$/);if(le&&['POST','PATCH'].includes(req.method)){const result=store.transaction(d=>({changed:true,body:Documents.saveLegalEntity(d,user,body,le[1])}));return json(res,le[1]?200:201,result.body)}
 if(p==='/api/documents/summary'&&req.method==='GET'){const d=store.read();return json(res,200,Documents.summary(d,user,url.searchParams.get('kind'),url.searchParams.get('id')))}
 if(p==='/api/documents/preview'&&req.method==='POST')return json(res,200,Documents.preview(store.read(),user,body));
 if(p==='/api/quick-invoice/context'&&req.method==='GET'){const d=store.read();return json(res,200,QuickInvoice.context(d,user,url.searchParams.get('clientId')||''))}
 if(p==='/api/quick-invoice'&&req.method==='POST'){
  const r=store.transaction(d=>({changed:true,body:QuickInvoice.issue(d,user,body)})).body;
  try{await Documents.generateFile(store,r.documentId,DOCUMENTS_DIR)}catch(e){Documents.markFileError(store,r.documentId,e)}
  const d=store.read();return json(res,201,{...r,document:Documents.decorate(d,d.documents.find(x=>x.id===r.documentId))});
 }
 if(p==='/api/documents/issue'&&req.method==='POST'){
  const issued=store.transaction(d=>{const x=Documents.issue(d,user,body);return {changed:true,body:{id:x.doc.id}}}).body;
  try{await Documents.generateFile(store,issued.id,DOCUMENTS_DIR)}catch(e){Documents.markFileError(store,issued.id,e);throw e}
  const d=store.read();return json(res,201,Documents.decorate(d,d.documents.find(x=>x.id===issued.id)));
 }
 if(p==='/api/documents/bundle'&&req.method==='POST'){
  const issued=store.transaction(d=>{const contract=Documents.issue(d,user,{...body,type:'contract',templateId:body.contractTemplateId||''}).doc;const invoice=Documents.issue(d,user,{...body,type:'invoice',templateId:''}).doc;return {changed:true,body:{contractId:contract.id,invoiceId:invoice.id}}}).body;
  for(const id of [issued.contractId,issued.invoiceId])try{await Documents.generateFile(store,id,DOCUMENTS_DIR)}catch(e){Documents.markFileError(store,id,e);throw e}
  const d=store.read();return json(res,201,{contract:Documents.decorate(d,d.documents.find(x=>x.id===issued.contractId)),invoice:Documents.decorate(d,d.documents.find(x=>x.id===issued.invoiceId))});
 }
 const file=p.match(/^\/api\/documents\/([^/]+)\/file$/);if(file&&req.method==='GET'){
  let d=store.read(),doc=(d.documents||[]).find(x=>x.id===file[1]);if(!doc||!Documents.visible(d,user,doc))throw Object.assign(new Error('Документ не найден'),{status:404});const meta=await Documents.generateFile(store,doc.id,DOCUMENTS_DIR);store.transaction(current=>{const x=current.documents.find(x=>x.id===doc.id);current.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),userId:user.id,action:'document.download',entity:'documents',entityId:doc.id,details:doc.number});current.audit=current.audit.slice(0,1000);return {changed:true}});const safe=(doc.number||doc.id).replace(/[^\p{L}\p{N}._-]+/gu,'_');const wantDocx=url.searchParams.get('format')==='docx'&&meta.docxPath&&fs.existsSync(meta.docxPath);const filePath=wantDocx?meta.docxPath:meta.path,mime=wantDocx?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':meta.mime||'application/pdf',ext=wantDocx?'docx':meta.ext||'pdf';return sendFile(res,filePath,mime,safe+'.'+ext)
 }
 const regen=p.match(/^\/api\/documents\/([^/]+)\/regenerate$/);if(regen&&req.method==='POST'){const d=store.read(),doc=(d.documents||[]).find(x=>x.id===regen[1]);if(!doc||!Documents.visible(d,user,doc))throw Object.assign(new Error('Документ не найден'),{status:404});if(!Access.at(user.perms,'documents','all')&&doc.createdBy!==user.id)throw Object.assign(new Error('Нет права перегенерировать документ'),{status:403});if(doc.file?.path)try{fs.unlinkSync(doc.file.path)}catch{};store.transaction(x=>{const z=x.documents.find(z=>z.id===doc.id);z.file=null;z.fileError='';return {changed:true}});await Documents.generateFile(store,doc.id,DOCUMENTS_DIR);return json(res,200,{ok:true})}
 const link=p.match(/^\/api\/documents\/([^/]+)\/link-order$/);if(link&&req.method==='POST'){const r=store.transaction(d=>({changed:true,body:Documents.linkOrder(d,user,link[1],body.orderId)}));return json(res,200,r.body)}
 const status=p.match(/^\/api\/documents\/([^/]+)\/status$/);if(status&&req.method==='PATCH'){const r=store.transaction(d=>({changed:true,body:Documents.updateStatus(d,user,status[1],body)}));return json(res,200,r.body)}
 const one=p.match(/^\/api\/documents\/([^/]+)$/);if(one&&req.method==='GET'){const d=store.read(),doc=(d.documents||[]).find(x=>x.id===one[1]);if(!doc||!Documents.visible(d,user,doc))throw Object.assign(new Error('Документ не найден'),{status:404});return json(res,200,Documents.decorate(d,doc))}
 if(p==='/api/documents'&&req.method==='GET')return json(res,200,Documents.list(store.read(),user,url.searchParams));
 throw Object.assign(new Error('Операция документов не найдена'),{status:404});
}

function sendBuffer(res,buf,mime,name){res.statusCode=200;res.setHeader('Content-Type',mime);res.setHeader('Content-Length',buf.length);res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(name)}`);res.end(buf)}
// Тело запроса как есть (архив переноса) — во временный файл, с ограничением размера.
function readRaw(req,limit){return new Promise((resolve,reject)=>{const chunks=[];let size=0,failed=false;req.on('data',c=>{if(failed)return;size+=c.length;if(size>limit){failed=true;reject(Object.assign(new Error('Архив больше 900 МБ'),{status:413}));req.resume();return}chunks.push(c)});req.on('end',()=>{if(!failed)resolve(Buffer.concat(chunks))});req.on('error',reject)})}
function sendFile(res,file,mime,name,{inline=false,cache='private, no-store'}={}){res.statusCode=200;res.setHeader('Content-Type',mime);res.setHeader('Content-Length',fs.statSync(file).size);res.setHeader('Cache-Control',cache);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Disposition',`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);return fs.createReadStream(file).pipe(res)}
async function filesApi(req,res,url,user,body){
 const p=url.pathname,m=req.method;
 const logo=p.match(/^\/api\/files\/logos\/(f_[0-9a-f-]{36})$/);
 if(logo&&m==='GET'){for(const [mime,ext] of [['image/png','.png'],['image/jpeg','.jpg'],['image/webp','.webp']]){const f=Files.logoFile({fileId:logo[1],mime});if(f)return sendFile(res,f,mime,'logo'+ext,{inline:true,cache:'private, max-age=31536000, immutable'})}throw Object.assign(new Error('Логотип не найден'),{status:404})}
 if(p==='/api/files/logo'&&m==='POST'){const r=store.transaction(d=>({changed:true,body:Files.setLogo(d,user,body,CRM)}));return json(res,200,r.body)}
 if(p==='/api/templates/fields'&&m==='GET')return json(res,200,require('./lib/docx').fieldList());
 if(p==='/api/templates/sample'&&m==='GET'){const tmp=path.join(UPLOADS_DIR,'sample-'+crypto.randomUUID()+'.docx');fs.mkdirSync(UPLOADS_DIR,{recursive:true,mode:0o700});fs.writeFileSync(tmp,require('./lib/docx').sample());res.on('close',()=>fs.rmSync(tmp,{force:true}));return sendFile(res,tmp,'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Образец договора ПРОМЕТЕЙ.docx')}
 if(p==='/api/templates'&&m==='GET')return json(res,200,Files.listTemplates(store.read(),url.searchParams.get('type')||''));
 if(p==='/api/templates'&&m==='POST'){const r=store.transaction(d=>({changed:true,body:Files.uploadTemplate(d,user,body)}));return json(res,201,r.body)}
 const one=p.match(/^\/api\/templates\/(tpl_[0-9a-f-]{36})(\/file)?$/);
 if(one&&one[2]&&m==='GET'){const t=(store.read().templates||[]).find(x=>x.id===one[1]&&!x.archivedAt);if(!t)throw Object.assign(new Error('Шаблон не найден'),{status:404});return sendFile(res,Files.templateFile(t),'application/vnd.openxmlformats-officedocument.wordprocessingml.document',t.fileName)}
 if(one&&!one[2]&&m==='PATCH'){const r=store.transaction(d=>({changed:true,body:Files.updateTemplate(d,user,one[1],body)}));return json(res,200,r.body)}
 if(one&&!one[2]&&m==='DELETE'){const r=store.transaction(d=>({changed:true,body:Files.removeTemplate(d,user,one[1])}));return json(res,200,r.body)}
 throw Object.assign(new Error('Операция не найдена'),{status:404});
}
async function api(req,res,url){
 if(url.pathname==='/api/health'&&req.method==='GET'){let db='ok',storage='ok';try{store.read()}catch{db='error'}try{fs.mkdirSync(DOCUMENTS_DIR,{recursive:true,mode:0o700});fs.mkdirSync(process.env.RECORDINGS_DIR||path.join(path.dirname(DB_FILE),'recordings'),{recursive:true,mode:0o700});fs.accessSync(path.dirname(DB_FILE),fs.constants.W_OK);fs.accessSync(DOCUMENTS_DIR,fs.constants.W_OK)}catch{storage='error'}const engine=pdfEngine(),ok=db==='ok'&&storage==='ok'&&engine.available;return json(res,ok?200:503,{ok,version:VERSION,database:db,storage,pdfReady:engine.available,pdfEngine:engine.type,time:new Date().toISOString()})}
 const avitoHook=url.pathname.match(/^\/api\/integrations\/avito\/webhook\/([A-Za-z0-9_-]{20,80})$/);
 const isWebhook=url.pathname.startsWith('/api/telephony/webhooks/')||!!avitoHook;
 if(isWebhook){const key=clientIp(req);if(!limits.webhook.hit(key))throw tooMany(limits.webhook,key)}
 else{
  const bearer=/^Bearer\s+\S/.test(String(req.headers.authorization||''));
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!bearer&&!Security.sameOrigin(req))throw Object.assign(new Error('Запрос отклонён: другой источник (CSRF)'),{status:403});
  const token=bearer?String(req.headers.authorization).replace(/^Bearer\s+/,''):Security.cookieToken(req);
  const [limiter,key]=token?[limits.api,'t:'+Security.tokenHash(token)]:[limits.anon,'ip:'+clientIp(req)];
  if(!limiter.hit(key))throw tooMany(limiter,key);
 }
 const phoneRecording=url.pathname.match(/^\/api\/telephony\/webhooks\/([a-z][a-z0-9_-]{0,39})\/([a-f0-9-]{36})\/recording$/);
 if(phoneRecording){telephony.authorize(req,phoneRecording[1]);if(req.method!=='PUT')return json(res,405,{error:'Требуется PUT'});return json(res,200,await telephony.recording(req,phoneRecording[1],phoneRecording[2]))}
 if(avitoHook){if(req.method!=='POST')return json(res,405,{error:'Требуется POST'});return json(res,200,Avito.webhook(avitoHook[1],await readBody(req,64*1024)))}
 const webhook=url.pathname.match(/^\/api\/telephony\/webhooks\/([a-z][a-z0-9_-]{0,39})$/);
 if(webhook){telephony.authorize(req,webhook[1]);if(req.method!=='POST')return json(res,405,{error:'Требуется POST'});return json(res,200,telephony.ingest(webhook[1],await readBody(req)))}
 if(url.pathname==='/api/config'&&req.method==='GET')return json(res,200,{yandexMapsApiKey:process.env.YANDEX_MAPS_API_KEY||config.yandexMapsApiKey||'',version:VERSION,installer:process.env.PROMETEY_ADMIN_MUST_CHANGE==='1',setup:Onboarding.setupNeeded(store.read()),brand:Company.brand(store.read())});
 const recordingRoute=url.pathname.match(/^\/api\/calls\/(clients|orders)\/([^/]+)\/([^/]+)\/recording$/);
 const transferImport=url.pathname==='/api/admin/transfer/import';
 const needsBody=!recordingRoute&&!transferImport&&['POST','PATCH','PUT'].includes(req.method);const bigBody=url.pathname.startsWith('/api/import/')||url.pathname==='/api/setup'||url.pathname==='/api/feed/files'||url.pathname==='/api/templates'||url.pathname.startsWith('/api/templates/')||url.pathname==='/api/files/logo';
 const body=needsBody?await readBody(req,url.pathname==='/api/feed/files'?28*1024*1024:bigBody?16*1024*1024:undefined):{};
 if(url.pathname==='/api/privacy/policy'&&req.method==='GET')return json(res,200,Privacy.publicPolicy());
 if(url.pathname==='/api/login'&&req.method==='POST'){
  if(typeof body.email!=='string'||typeof body.password!=='string'||body.email.length>320||body.password.length>Security.MAX_PASSWORD_LENGTH)return json(res,400,{error:'Укажите e-mail и пароль'});
  loginAllowed(req,body.email);const data=store.read();const user=data.users.find(u=>String(u.email||'').toLowerCase()===body.email.trim().toLowerCase());const stored=user&&(user.passwordHash||user.password);
  const valid=user&&!user.disabled&&stored?Security.verifyPassword(stored,body.password):Security.burnPasswordCheck(body.password);
  if(!valid){loginFailed(req,body.email);return json(res,401,{error:'Неверный логин или пароль'})}
  loginSucceeded(req,body.email);return startSession(req,res,user,data,body.password)
 }
 if(url.pathname==='/api/brand/logo'&&req.method==='GET'){const e=(store.read().legalEntities||[])[0];const f=e?.logo?Files.logoFile(e.logo):null;if(!f)throw Object.assign(new Error('Логотип не загружен'),{status:404});return sendFile(res,f,e.logo.mime,'logo',{inline:true,cache:'public, max-age=86400'})}
 // мастер регистрации: поиск реквизитов до входа — только пока CRM ждёт первую регистрацию и только с этого компьютера или по ссылке установщика
 if(url.pathname==='/api/setup/lookup'&&req.method==='POST'){const d=store.read();if(!Onboarding.setupNeeded(d))throw Object.assign(new Error('Регистрация уже завершена'),{status:409});if(!isLoopback(req)&&!Onboarding.setupTokenOk?.(body.token))throw Object.assign(new Error('Поиск доступен на компьютере, где установлена CRM'),{status:403});return json(res,200,body.kind==='bik'?await Company.lookupBik(d,body.query):await Company.lookupInn(d,body.query))}
 if(url.pathname==='/api/setup'&&req.method==='GET')return json(res,200,Onboarding.setupInfo(store.read()));
 if(url.pathname==='/api/setup'&&req.method==='POST'){const r=store.transaction(d=>{const owner=Onboarding.setup(d,body,{local:isLoopback(req)});if(body.organization)Company.applyOrganization(d,{...owner,perms:Access.perms(d,owner)},body.organization,{saveLegalEntity:Documents.saveLegalEntity});return {changed:true,body:{owner,code:Recovery.issueCode(owner)}}}).body;return startSession(req,res,r.owner,store.read(),undefined,{recoveryCode:r.code})}
 const invite=url.pathname.match(/^\/api\/invite\/([A-Za-z0-9_-]{16,64})$/);
 if(invite&&req.method==='GET')return json(res,200,Onboarding.inviteInfo(store.read(),invite[1]));
 if(invite&&req.method==='POST'){const r=store.transaction(d=>{const nu=Onboarding.accept(d,invite[1],body,{canAddUser:n=>License.canAddUser(n)});return {changed:true,body:{nu,code:Recovery.issueCode(nu)}}}).body;return startSession(req,res,r.nu,store.read(),undefined,{recoveryCode:r.code})}
 // восстановление пароля (без входа)
 if(url.pathname==='/api/password/recover'&&req.method==='POST'){const email=String(body.email||'');loginAllowed(req,email);let r;try{r=store.transaction(d=>({changed:true,body:Recovery.recover(d,body)})).body}catch(e){if(e.code==='recovery_invalid')loginFailed(req,email);throw e}loginSucceeded(req,email);return startSession(req,res,r.user,store.read(),undefined,{recoveryCode:r.recoveryCode})}
 if(url.pathname==='/api/password/request'&&req.method==='POST'){const email=String(body.email||'');loginAllowed(req,email);loginFailed(req,'request:'+email);return json(res,200,store.transaction(d=>({changed:true,body:Recovery.request(d,body,{ip:clientIp(req)})})).body)}
 const resetRoute=url.pathname.match(/^\/api\/password\/reset\/([A-Za-z0-9_-]{16,64})$/);
 if(resetRoute&&req.method==='GET')return json(res,200,Recovery.resetInfo(store.read(),resetRoute[1]));
 if(resetRoute&&req.method==='POST'){const r=store.transaction(d=>({changed:true,body:Recovery.resetByLink(d,resetRoute[1],body)})).body;return startSession(req,res,r.user,store.read(),undefined,{recoveryCode:r.recoveryCode})}
 if(url.pathname==='/api/session'&&req.method==='GET'){const data=store.read(),auth=currentSession(req,data);return json(res,200,{user:auth?Security.publicUser(auth.user):null})}
 const {raw,user}=authenticate(req);
 // Согласие с политикой обработки персональных данных — до любой работы в CRM.
 if(url.pathname==='/api/privacy'&&req.method==='GET')return json(res,200,Privacy.get(user));
 if(url.pathname==='/api/privacy/accept'&&req.method==='POST'){const r=store.transaction(d=>({changed:true,body:Privacy.accept(d,user,body,{ip:clientIp(req),agent:req.headers['user-agent']})}));return json(res,200,r.body)}
 Privacy.guard(user,url.pathname);
 if(url.pathname==='/api/admin/emails'&&req.method==='GET'){const d=store.read();if(url.searchParams.get('format')==='csv'){const out=Privacy.emailsCsv(d,user);res.statusCode=200;res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent('Сотрудники и согласия.csv')}`);return res.end(out)}return json(res,200,Privacy.emails(d,user))}
 // Временный пароль от администратора: до смены пароля доступны только профиль и выход.
 if(user.mustChangePassword&&!['/api/profile','/api/profile/password','/api/logout','/api/me','/api/feed/unread'].includes(url.pathname))throw Object.assign(new Error('Смените временный пароль, чтобы продолжить работу'),{status:403,code:'password_change_required'});
 // Подписка: при неоплате — только просмотр.
 License.guard(req.method,url.pathname);
 if(url.pathname==='/api/license'&&req.method==='GET'){const c=License.current();return json(res,200,{enabled:c.enabled,status:c.status,statusText:c.statusText,readOnly:c.readOnly,banner:c.banner,message:c.message,until:c.until})}
 if(url.pathname==='/api/admin/license'||url.pathname==='/api/admin/license/check')return json(res,200,await License.admin(user,req.method,url,store.read()));
 if(url.pathname==='/api/admin/users'&&req.method==='POST'){const n=store.read().users.filter(u=>!u.disabled).length;if(!License.canAddUser(n))throw Object.assign(new Error(`По вашему тарифу доступно пользователей: ${License.current().maxUsers}. Отключите неактивного сотрудника или расширьте тариф.`),{status:402,code:'license_users_limit'})}
 if(url.pathname==='/api/admin/transfer/export'&&req.method==='GET'){const r=Transfer.exportArchive(user);return sendBuffer(res,r.zip,'application/zip',r.name)}
 if(transferImport&&req.method==='POST'){if(!Access.perms(store.read(),user).admin)throw Object.assign(new Error('Загружать данные может администратор'),{status:403});return json(res,200,await Transfer.importArchive(user,await readRaw(req,Transfer.MAX_ARCHIVE)))}
 if(url.pathname==='/api/archive/messages'&&req.method==='GET'){const d=store.read();const r=Transfer.personalArchive(user,{orders:CRM.scopes?CRM.scopes.sharedOrderScope(d,user):[]});return sendBuffer(res,Buffer.from(r.html),'text/html; charset=utf-8',r.name)}
 if(url.pathname==='/api/company'&&req.method==='GET')return json(res,200,Company.info(store.read()));
 if(url.pathname==='/api/company/brand'&&req.method==='PATCH')return json(res,200,store.transaction(d=>({changed:true,body:Company.saveBrand(d,user,body)})).body);
 if(url.pathname==='/api/company/lookup'&&req.method==='POST'){const d=store.read();return json(res,200,body.kind==='bik'?await Company.lookupBik(d,body.query):await Company.lookupInn(d,body.query))}
 const tpl=url.pathname.match(/^\/api\/import\/template\/(clients|equipment|employees)$/);
 if(tpl&&req.method==='GET'){const t=Company.template(tpl[1]);return sendBuffer(res,t.buf,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',t.name)}
 const imp=url.pathname.match(/^\/api\/import\/(clients|equipment|employees)$/);
 if(imp&&req.method==='POST'){const ctx={...publicBase(req),canAddUser:n=>License.canAddUser(n)};if(body.dryRun){const d=structuredClone(store.read());return json(res,200,Company.importTable(d,user,imp[1],body,ctx))}const r=store.transaction(d=>{const rep=Company.importTable(d,user,imp[1],body,ctx);return {changed:rep.created>0,body:rep}}).body;if(r.links.length)r.linksFile=Company.linksTable(r).toString('base64');return json(res,200,r)}
 const resetLink=url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-link$/);
 if(resetLink&&req.method==='POST')return json(res,201,store.transaction(d=>({changed:true,body:Recovery.adminLink(d,user,decodeURIComponent(resetLink[1]),publicBase(req))})).body);
 if(url.pathname==='/api/admin/password-requests'&&req.method==='GET')return json(res,200,Recovery.requests(store.read(),user));
 if(url.pathname==='/api/profile/recovery-code'&&req.method==='POST')return json(res,200,store.transaction(d=>({changed:true,body:Recovery.profileCode(d,user,body)})).body);
 if(url.pathname==='/api/admin/invites'||url.pathname.startsWith('/api/admin/invites/')){const r=store.transaction(d=>({changed:req.method!=='GET',body:Onboarding.admin(d,user,req.method,url,body,publicBase(req))}));return json(res,req.method==='POST'?201:200,r.body)}
 if(url.pathname==='/api/admin/server'||url.pathname.startsWith('/api/admin/server/')){serverAdminApi||=require('./lib/server-admin').createServerAdmin({root:ROOT,dbFile:DB_FILE,port:()=>server.address()?.port||Number(process.env.PORT||3030)});return json(res,200,await serverAdminApi(user,req.method,url,body,store.read()))}
 if(url.pathname==='/api/admin'||url.pathname.startsWith('/api/admin/')||url.pathname.startsWith('/api/profile')){const r=store.transaction(d=>adminApi(d,user,req.method,url,body,{tokenHash:Security.tokenHash(raw)}));return json(res,r.status,r.body)}
 const feedFile=url.pathname.match(/^\/api\/feed\/files\/(f_[0-9a-f-]{36})$/);
 if(feedFile&&req.method==='GET'){const f=Feed.feedFile(store.read(),UPLOADS_DIR,feedFile[1]);if(!f)throw Object.assign(new Error('Файл не найден'),{status:404});const inline=f.inline&&url.searchParams.get('download')!=='1';return sendFile(res,f.file,inline?f.mime:'application/octet-stream',f.name,{inline,cache:'private, max-age=86400'})}
 if(url.pathname==='/api/feed'||url.pathname.startsWith('/api/feed/')){const r=store.transaction(d=>feedApi(d,user,req.method,url,body));return json(res,r.status,r.body)}
 if(url.pathname.startsWith('/api/accounting/'))return accountingApi(req,res,url,user,body,(status,b)=>json(res,status,b));
 if(recordingRoute)return await recordingHandler(req,res,recordingRoute,user);
 if(url.pathname.startsWith('/api/files/')||url.pathname==='/api/templates'||url.pathname.startsWith('/api/templates/'))return filesApi(req,res,url,user,body);
 if(url.pathname.startsWith('/api/documents')||url.pathname.startsWith('/api/quick-invoice'))return documentsApi(req,res,url,user,body);
 if(url.pathname.startsWith('/api/telephony'))return json(res,200,telephony.admin(user,req.method,url,body));
 if(url.pathname==='/api/logout'&&req.method==='POST'){store.transaction(d=>{const h=Security.tokenHash(raw);d.sessions=(d.sessions||[]).filter(s=>s.tokenHash!==h);return {changed:true}});Security.clearSessionCookie(res,{secure:secureRequest(req)});return json(res,200,{ok:true})}
 if(url.pathname==='/api/integrations/avito'||url.pathname.startsWith('/api/integrations/avito/'))return json(res,200,await Avito.admin(user,req.method,url,body,store.read()));
 if(url.pathname.startsWith('/api/integrations'))return json(res,200,await integrations(user,req.method,url,body,store.read()));
 const result=store.transaction(current=>CRM.handle(current,user,req.method,url,body));return json(res,result.status,result.body);
}

const MAPS_ENABLED=!!(process.env.YANDEX_MAPS_API_KEY||config.yandexMapsApiKey);
const STATIC_TYPES={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json; charset=utf-8','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{Security.securityHeaders(res,{secure:secureRequest(req),maps:MAPS_ENABLED});try{if(!['GET','HEAD','POST','PATCH','PUT','DELETE','OPTIONS'].includes(req.method))return json(res,405,{error:'Метод не поддерживается'});if(String(req.url||'').length>8192)return json(res,414,{error:'Слишком длинный адрес'});const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/'))return await api(req,res,url);if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Метод не поддерживается'});let decoded;try{decoded=decodeURIComponent(url.pathname)}catch{return json(res,400,{error:'Некорректный адрес'})}if(decoded.includes('\0')||/(^|\/)\.[^/]/.test(decoded))return json(res,404,{error:'Not found'});let file=path.resolve(PUBLIC,'.'+decoded);if(!file.startsWith(PUBLIC+path.sep)&&file!==PUBLIC)return json(res,403,{error:'Forbidden'});if(file===PUBLIC)file=path.join(PUBLIC,'index.html');if(!fs.existsSync(file)||fs.statSync(file).isDirectory())return json(res,404,{error:'Not found'});const ext=path.extname(file);res.statusCode=200;if(!STATIC_TYPES[ext])return json(res,404,{error:'Not found'});res.setHeader('Content-Type',STATIC_TYPES[ext]);const entry=staticEntry(file);res.setHeader('Cache-Control','no-cache');res.setHeader('ETag',entry.etag);res.setHeader('Vary','Accept-Encoding');if(req.headers['if-none-match']===entry.etag){res.statusCode=304;return res.end()}if(entry.gz&&acceptsGzip(res)){res.setHeader('Content-Encoding','gzip');return res.end(req.method==='HEAD'?undefined:entry.gz)}return res.end(req.method==='HEAD'?undefined:entry.raw)}catch(e){if(res.headersSent){res.destroy();if(!e.status)console.error(e);return}if(e.retryAfter)res.setHeader('Retry-After',String(e.retryAfter));json(res,e.status||500,{error:e.status?e.message:'Внутренняя ошибка',...(e.status&&typeof e.code==='string'&&/^[a-z_]+$/.test(e.code)?{code:e.code}:{})});if(!e.status)console.error(e)}});
// Slow-client protection (slowloris) and sane limits on headers.
server.headersTimeout=20000;server.requestTimeout=180000;server.keepAliveTimeout=5000;server.maxHeadersCount=100;server.maxRequestsPerSocket=1000;
if(require.main===module){server.listen(Number(process.env.PORT||config.port||3030),process.env.HOST||'127.0.0.1',()=>console.log(`ПРОМЕТЕЙ ${VERSION}: http://${server.address().address}:${server.address().port}`));const shutdown=signal=>{console.log(`${signal}: graceful shutdown`);server.closeIdleConnections?.();server.close(()=>process.exit(0));setTimeout(()=>{server.closeAllConnections?.();process.exit(1)},10000).unref()};process.once('SIGTERM',()=>shutdown('SIGTERM'));process.once('SIGINT',()=>shutdown('SIGINT'))}
server.on('listening',()=>{License.start();Avito.start()});
server.on('close',()=>{License.stop();Avito.stop();store.close()});
server.store=store;module.exports=server;
