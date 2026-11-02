'use strict';
// ПРОМЕТЕЙ · Пульт продавца.
// Отдельный сервер разработчика: видит все установленные CRM, их подписки и оплаты, состояние подключённых
// сервисов; блокирует при неоплате и показывает сообщения в CRM. Только стандартная библиотека Node.js 22+.
//
// Переменные окружения:
//   PORT=8090  HOST=127.0.0.1  DATA_DIR=./data  TRUST_PROXY=1 (за nginx)
//   VENDOR_ADMIN_EMAIL, VENDOR_ADMIN_PASSWORD — учётная запись разработчика (пароль ≥ 12 символов, применяется при первом запуске)
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const VERSION=require('./package.json').version;
const ROOT=__dirname,PUBLIC=path.join(ROOT,'public');
const DATA_DIR=path.resolve(process.env.DATA_DIR||path.join(ROOT,'data'));
const PORT=Number(process.env.PORT||8090),HOST=process.env.HOST||'127.0.0.1',TRUST_PROXY=process.env.TRUST_PROXY==='1';
const DAY=86400000;
fs.mkdirSync(DATA_DIR,{recursive:true,mode:0o700});

// ---------------- хранилище ----------------
const db=new DatabaseSync(path.join(DATA_DIR,'vendor.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
const COLLECTIONS=['companies','installs','payments','events','sessions'];
for(const c of COLLECTIONS)db.exec(`CREATE TABLE IF NOT EXISTS ${c}(id TEXT PRIMARY KEY, data TEXT NOT NULL, at TEXT NOT NULL DEFAULT '')`);
db.exec('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
const S={
 all:c=>db.prepare(`SELECT data FROM ${c} ORDER BY at DESC`).all().map(r=>JSON.parse(r.data)),
 get:(c,id)=>{const r=db.prepare(`SELECT data FROM ${c} WHERE id=?`).get(id);return r?JSON.parse(r.data):null},
 put:(c,x)=>{db.prepare(`INSERT INTO ${c}(id,data,at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, at=excluded.at`).run(x.id,JSON.stringify(x),x.createdAt||x.at||'');return x},
 del:(c,id)=>db.prepare(`DELETE FROM ${c} WHERE id=?`).run(id),
 setting:(k,d)=>{const r=db.prepare('SELECT value FROM settings WHERE key=?').get(k);return r?JSON.parse(r.value):d},
 setSetting:(k,v)=>db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,JSON.stringify(v)),
 tx:fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}},
};
const now=()=>new Date().toISOString();
const uid=p=>p+'_'+crypto.randomUUID();
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const str=(v,max=200)=>String(v??'').trim().slice(0,max);
function event(type,text,ref=''){S.put('events',{id:uid('ev'),at:now(),createdAt:now(),type,text:String(text).slice(0,500),ref});const old=db.prepare('SELECT id FROM events ORDER BY at DESC LIMIT -1 OFFSET 5000').all();for(const r of old)S.del('events',r.id)}

// ---------------- ключ подписи лицензий (Ed25519) ----------------
const KEY_FILE=path.join(DATA_DIR,'license-signing-key.pem');
if(!fs.existsSync(KEY_FILE)){const {privateKey}=crypto.generateKeyPairSync('ed25519');fs.writeFileSync(KEY_FILE,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600})}
const PRIVATE_KEY=crypto.createPrivateKey(fs.readFileSync(KEY_FILE));
const PUBLIC_KEY=crypto.createPublicKey(PRIVATE_KEY).export({type:'spki',format:'der'}).toString('base64');
const sign=payload=>{const p=Buffer.from(JSON.stringify(payload)).toString('base64url');return {payload:p,signature:crypto.sign(null,Buffer.from(p),PRIVATE_KEY).toString('base64url')}};

// ---------------- пароль разработчика ----------------
const hashPassword=(pw,salt=crypto.randomBytes(16))=>'scrypt$'+salt.toString('base64')+'$'+crypto.scryptSync(pw,salt,64,{N:16384,r:8,p:1}).toString('base64');
function verifyPassword(stored,pw){const [k,s,h]=String(stored).split('$');if(k!=='scrypt'||!s||!h)return false;const a=Buffer.from(h,'base64'),b=crypto.scryptSync(String(pw),Buffer.from(s,'base64'),64,{N:16384,r:8,p:1});return a.length===b.length&&crypto.timingSafeEqual(a,b)}
(function bootstrapAdmin(){
 const email=str(process.env.VENDOR_ADMIN_EMAIL).toLowerCase(),pw=String(process.env.VENDOR_ADMIN_PASSWORD||'');
 const admin=S.setting('admin',null);
 if(email&&pw){if(pw.length<12)throw new Error('VENDOR_ADMIN_PASSWORD: не короче 12 символов');const fp=crypto.createHash('sha256').update(email+'\n'+pw).digest('hex');if(!admin||admin.envFingerprint!==fp){S.setSetting('admin',{email,hash:hashPassword(pw),envFingerprint:fp,updatedAt:now()});console.log('[пульт] учётная запись разработчика:',email)}}
 else if(!admin)throw new Error('Задайте VENDOR_ADMIN_EMAIL и VENDOR_ADMIN_PASSWORD для первого запуска');
})();

// ---------------- правила подписки ----------------
const defaults={trialDays:14,graceDays:7,checkHours:6,offlineWarnDays:3};
const rules=()=>({...defaults,...S.setting('rules',{})});
const endOfDay=d=>d?new Date(String(d).slice(0,10)+'T23:59:59.999Z').getTime():0;
const addMonths=(iso,n)=>{const d=new Date(String(iso).slice(0,10)+'T00:00:00Z');const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10)};
const isoDay=t=>new Date(t).toISOString().slice(0,10);
// Состояние установки на сейчас: trial | active | grace | expired | blocked
function licenseOf(inst,company=inst.companyId?S.get('companies',inst.companyId):null,at=Date.now()){
 const r=rules();
 if(inst.blocked)return {status:'blocked',reason:'Установка заблокирована',until:0};
 if(company?.blocked)return {status:'blocked',reason:'Подписка компании приостановлена',until:0};
 if(company){const until=endOfDay(company.paidUntil),grace=until+r.graceDays*DAY;if(until&&at<=until)return {status:'active',until,grace};if(until&&at<=grace)return {status:'grace',until,grace};return {status:'expired',until,grace}}
 const trialUntil=endOfDay(inst.trialUntil||isoDay(Date.parse(inst.firstSeen)+r.trialDays*DAY));
 return at<=trialUntil?{status:'trial',until:trialUntil,grace:trialUntil}:{status:'expired',until:trialUntil,grace:trialUntil};
}
function licensePayload(inst){
 const company=inst.companyId?S.get('companies',inst.companyId):null,l=licenseOf(inst,company),r=rules();
 return {v:1,installId:inst.id,status:l.status,kind:company?'paid':'trial',companyName:company?.name||'',plan:company?.plan||'',maxUsers:Number(company?.maxUsers||0),
  until:l.until?new Date(l.until).toISOString():'',graceUntil:l.grace?new Date(l.grace).toISOString():'',blocked:l.status==='blocked',reason:l.reason||'',
  message:str(inst.message||company?.message,500),issuedAt:now(),nextCheckSec:r.checkHours*3600,...(policySetting()?{policy:policySetting()}:{})};
}

// Политика обработки ПДн: реквизиты разработчика и (необязательно) свой текст — уходят во все CRM.
function policySetting(){const p=S.setting('policy',null);if(!p)return null;const out={vendor:{name:p.name||'',inn:p.inn||'',email:p.email||''}};if(p.text&&p.version)Object.assign(out,{version:p.version,title:p.title||'Политика обработки персональных данных',text:p.text});return out}
// ---------------- приём отметок от CRM ----------------
const ID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,SECRET_RE=/^[A-Za-z0-9_-]{32,128}$/;
const num=v=>Number.isFinite(Number(v))?Math.max(0,Math.min(1e12,Number(v))):0;
function cleanServices(list){return (Array.isArray(list)?list:[]).slice(0,40).map(s=>({key:str(s.key,40),name:str(s.name,80),status:['on','off','error','warn'].includes(s.status)?s.status:'off',detail:str(s.detail,200)})).filter(s=>s.key)}
function checkin(b,ip){
 const id=str(b.installId,40),secret=String(b.secret||'');
 if(!ID_RE.test(id)||!SECRET_RE.test(secret))fail('Некорректная установка',400);
 const secretHash=crypto.createHash('sha256').update(secret).digest('hex');
 return S.tx(()=>{
  let inst=S.get('installs',id),fresh=false;
  if(!inst){inst={id,secretHash,firstSeen:now(),createdAt:now(),companyId:'',blocked:false,message:'',note:'',history:[]};fresh=true}
  else if(!crypto.timingSafeEqual(Buffer.from(inst.secretHash,'hex'),Buffer.from(secretHash,'hex')))fail('Ключ установки не совпадает',403);
  const st=b.stats||{};
  Object.assign(inst,{lastSeen:now(),lastIp:str(ip,64),version:str(b.version,20),
   reported:{companyName:str(b.company?.name,200),inn:str(b.company?.inn,12).replace(/\D/g,'')},
   stats:{users:num(st.users),activeUsers:num(st.activeUsers),clients:num(st.clients),orders:num(st.orders),documents:num(st.documents),templates:num(st.templates),dbBytes:num(st.dbBytes),lastLoginAt:str(st.lastLoginAt,40)},
   services:cleanServices(b.services),host:{os:str(b.host?.os,80),node:str(b.host?.node,20),hostname:str(b.host?.hostname,80),lan:!!b.host?.lan},
   lastBackupAt:str(b.lastBackupAt,40),errors24h:num(b.errors24h),
   users:(Array.isArray(b.users)?b.users:[]).slice(0,500).map(u=>({name:str(u.name,120),email:str(u.email,200).toLowerCase(),role:str(u.role,60),disabled:!!u.disabled,lastLoginAt:str(u.lastLoginAt,40),consentAt:str(u.consentAt,40)})).filter(u=>u.email),
   policyVersion:str(b.policyVersion,40),withoutConsent:num(b.withoutConsent)});
  // История: одна точка в день
  const day=isoDay(Date.now());inst.history=(inst.history||[]).filter(h=>h.day!==day).concat([{day,users:inst.stats.users,activeUsers:inst.stats.activeUsers,version:inst.version}]).slice(-90);
  // Автопривязка по ИНН, если такая компания уже заведена
  if(!inst.companyId&&inst.reported.inn){const c=S.all('companies').find(c=>c.inn&&c.inn===inst.reported.inn&&!c.archived);if(c){inst.companyId=c.id;event('install.bind',`Установка ${id.slice(0,8)} привязана к «${c.name}» по ИНН`,id)}}
  S.put('installs',inst);
  if(fresh)event('install.new',`Новая установка: ${inst.reported.companyName||'без названия'} (${inst.version||'?'})`,id);
  return sign(licensePayload(inst));
 });
}

// ---------------- представления для пульта ----------------
function companyView(c,installs=S.all('installs'),payments=S.all('payments')){
 const mine=installs.filter(i=>i.companyId===c.id),l=mine.length?licenseOf(mine[0],c):licenseOf({firstSeen:c.createdAt,companyId:c.id},c);
 const pays=payments.filter(p=>p.companyId===c.id&&!p.cancelled);
 return {...c,status:c.blocked?'blocked':l.status,installCount:mine.length,lastSeen:mine.map(i=>i.lastSeen).sort().at(-1)||'',users:mine.reduce((s,i)=>s+(i.stats?.users||0),0),paidTotal:pays.reduce((s,p)=>s+p.amount,0),lastPaymentAt:pays.map(p=>p.date).sort().at(-1)||''};
}
function installView(i,companies){const c=companies.find(c=>c.id===i.companyId)||null;const l=licenseOf(i,c);const {secretHash,...rest}=i;return {...rest,companyName:c?.name||'',status:l.status,until:l.until?new Date(l.until).toISOString():'',online:Date.now()-Date.parse(i.lastSeen||0)<rules().checkHours*3600000*1.5+600000,offlineDays:Math.floor((Date.now()-Date.parse(i.lastSeen||0))/DAY)}}
function overview(){
 const companies=S.all('companies').filter(c=>!c.archived),installs=S.all('installs'),payments=S.all('payments').filter(p=>!p.cancelled),r=rules();
 const cv=companies.map(c=>companyView(c,installs,payments)),iv=installs.map(i=>installView(i,companies));
 const month=isoDay(Date.now()).slice(0,7),prev=addMonths(isoDay(Date.now()),-1).slice(0,7);
 const soon=cv.filter(c=>c.status==='active'&&endOfDay(c.paidUntil)-Date.now()<7*DAY);
 return {
  companies:{total:cv.length,active:cv.filter(c=>c.status==='active').length,grace:cv.filter(c=>c.status==='grace').length,expired:cv.filter(c=>c.status==='expired').length,blocked:cv.filter(c=>c.status==='blocked').length},
  installs:{total:iv.length,online:iv.filter(i=>i.online).length,trial:iv.filter(i=>!i.companyId&&i.status==='trial').length,unbound:iv.filter(i=>!i.companyId).length,silent:iv.filter(i=>i.offlineDays>=r.offlineWarnDays).length,users:iv.reduce((s,i)=>s+(i.stats?.users||0),0)},
  money:{mrr:cv.filter(c=>['active','grace'].includes(c.status)).reduce((s,c)=>s+Number(c.price||0),0),thisMonth:payments.filter(p=>p.date.startsWith(month)).reduce((s,p)=>s+p.amount,0),prevMonth:payments.filter(p=>p.date.startsWith(prev)).reduce((s,p)=>s+p.amount,0),total:payments.reduce((s,p)=>s+p.amount,0)},
  attention:[
   ...cv.filter(c=>c.status==='grace').map(c=>({kind:'grace',text:`«${c.name}»: оплата просрочена, льготный период до ${isoDay(endOfDay(c.paidUntil)+r.graceDays*DAY)}`,ref:c.id})),
   ...cv.filter(c=>c.status==='expired').map(c=>({kind:'expired',text:`«${c.name}»: подписка закончилась ${c.paidUntil||''} — CRM только для просмотра`,ref:c.id})),
   ...soon.map(c=>({kind:'soon',text:`«${c.name}»: оплачено до ${c.paidUntil}`,ref:c.id})),
   ...iv.filter(i=>!i.companyId).map(i=>({kind:'new',text:`Новая установка «${i.reported?.companyName||'без названия'}» — привяжите к компании (${i.status==='trial'?'пробный период до '+isoDay(Date.parse(i.until)):'пробный период закончился'})`,ref:i.id,install:true})),
   ...iv.filter(i=>i.offlineDays>=r.offlineWarnDays).map(i=>({kind:'silent',text:`«${i.companyName||i.reported?.companyName||i.id.slice(0,8)}» не выходит на связь ${i.offlineDays} дн.`,ref:i.id,install:true})),
   ...iv.flatMap(i=>(i.services||[]).filter(s=>s.status==='error').map(s=>({kind:'service',text:`«${i.companyName||i.reported?.companyName||i.id.slice(0,8)}»: ${s.name} — ${s.detail||'ошибка'}`,ref:i.id,install:true}))),
  ],
  events:S.all('events').slice(0,15),
 };
}

// ---------------- действия пульта ----------------
function saveCompany(b,id){
 const c=id?S.get('companies',id):{id:uid('co'),createdAt:now(),blocked:false,paidUntil:''};if(!c)fail('Компания не найдена',404);
 const name=str(b.name??c.name);if(!name)fail('Укажите название компании');
 const inn=str(b.inn??c.inn,12).replace(/\D/g,'');if(inn&&!/^\d{10}(\d{2})?$/.test(inn))fail('Проверьте ИНН');
 Object.assign(c,{name,inn,contact:str(b.contact??c.contact),phone:str(b.phone??c.phone,40),email:str(b.email??c.email,120),plan:str(b.plan??c.plan,60)||'Стандарт',price:num(b.price??c.price),maxUsers:Math.floor(num(b.maxUsers??c.maxUsers)),note:str(b.note??c.note,2000),message:str(b.message??c.message,500),updatedAt:now()});
 if(b.paidUntil!==undefined){const d=str(b.paidUntil,10);if(d&&!/^\d{4}-\d{2}-\d{2}$/.test(d))fail('Дата оплаты: ГГГГ-ММ-ДД');if(d!==c.paidUntil)event('company.paid-until',`«${c.name}»: оплачено до ${d||'—'} (вручную)`,c.id);c.paidUntil=d}
 if(b.blocked!==undefined&&!!b.blocked!==!!c.blocked){c.blocked=!!b.blocked;event(c.blocked?'company.block':'company.unblock',`«${c.name}» ${c.blocked?'заблокирована':'разблокирована'}`,c.id)}
 if(!id)event('company.new',`Новая компания «${c.name}»`,c.id);
 return S.put('companies',c);
}
function addPayment(companyId,b){
 return S.tx(()=>{const c=S.get('companies',companyId);if(!c)fail('Компания не найдена',404);
  const amount=Math.round(num(b.amount)*100)/100;if(!amount)fail('Укажите сумму');
  const months=Math.max(0,Math.min(36,Math.floor(num(b.months??1))));const date=str(b.date,10)||isoDay(Date.now());if(!/^\d{4}-\d{2}-\d{2}$/.test(date))fail('Дата платежа: ГГГГ-ММ-ДД');
  const from=c.paidUntil&&c.paidUntil>=isoDay(Date.now())?c.paidUntil:isoDay(Date.now()-DAY);
  const before=c.paidUntil;if(months)c.paidUntil=addMonths(from,months);c.updatedAt=now();S.put('companies',c);
  const p=S.put('payments',{id:uid('pay'),companyId,date,amount,months,method:str(b.method,40)||'Счёт',comment:str(b.comment,300),paidUntilBefore:before,paidUntilAfter:c.paidUntil,createdAt:now(),at:date});
  event('payment',`«${c.name}»: оплата ${amount.toLocaleString('ru-RU')} ₽${months?` за ${months} мес., оплачено до ${c.paidUntil}`:''}`,companyId);
  return {payment:p,company:c};
 });
}
function cancelPayment(id){
 return S.tx(()=>{const p=S.get('payments',id);if(!p||p.cancelled)fail('Платёж не найден',404);const c=S.get('companies',p.companyId);
  p.cancelled=now();S.put('payments',p);
  if(c&&p.months&&c.paidUntil===p.paidUntilAfter){c.paidUntil=p.paidUntilBefore||'';S.put('companies',c)}
  event('payment.cancel',`Отменён платёж ${p.amount.toLocaleString('ru-RU')} ₽ (${c?.name||''})`,p.companyId);return {ok:true}});
}
function updateInstall(id,b){
 const i=S.get('installs',id);if(!i)fail('Установка не найдена',404);
 if(b.companyId!==undefined){const cid=str(b.companyId,60);if(cid&&!S.get('companies',cid))fail('Компания не найдена',404);i.companyId=cid;event('install.bind',cid?`Установка ${id.slice(0,8)} привязана к «${S.get('companies',cid).name}»`:`Установка ${id.slice(0,8)} отвязана`,id)}
 if(b.blocked!==undefined&&!!b.blocked!==!!i.blocked){i.blocked=!!b.blocked;event(i.blocked?'install.block':'install.unblock',`Установка ${i.reported?.companyName||id.slice(0,8)} ${i.blocked?'заблокирована':'разблокирована'}`,id)}
 if(b.message!==undefined)i.message=str(b.message,500);
 if(b.note!==undefined)i.note=str(b.note,2000);
 if(b.trialUntil!==undefined){const d=str(b.trialUntil,10);if(d&&!/^\d{4}-\d{2}-\d{2}$/.test(d))fail('Дата: ГГГГ-ММ-ДД');i.trialUntil=d;event('install.trial',`Пробный период ${i.reported?.companyName||id.slice(0,8)} до ${d}`,id)}
 return S.put('installs',i);
}
function csv(rows){return '﻿'+rows.map(r=>r.map(v=>{let s=String(v??'');if(/^\s*[=+@-]/.test(s)&&!/^-?\d/.test(s.trim()))s="'"+s;return /[;"\n']/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}).join(';')).join('\r\n')}

// ---------------- HTTP ----------------
const limiter=(limit,windowMs)=>{const m=new Map();return key=>{const t=Date.now();let e=m.get(key);if(!e||e.reset<t){e={n:0,reset:t+windowMs};m.set(key,e)}e.n++;if(m.size>20000)for(const [k,v] of m)if(v.reset<t)m.delete(k);return e.n<=limit}};
const loginLimit=limiter(10,15*60000),apiLimit=limiter(600,60000),checkinLimit=limiter(120,60000);
const ipOf=req=>TRUST_PROXY?String(req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress:req.socket.remoteAddress;
const secure=req=>TRUST_PROXY?req.headers['x-forwarded-proto']==='https':!!req.socket.encrypted;
function headers(res){res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")}
const json=(res,status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body))};
function readBody(req,limit=256*1024){return new Promise((resolve,reject)=>{let raw='',size=0;req.on('data',c=>{size+=c.length;if(size>limit){reject(Object.assign(new Error('Слишком большой запрос'),{status:413}));req.destroy();return}raw+=c});req.on('end',()=>{try{const v=raw?JSON.parse(raw):{};if(!v||typeof v!=='object'||Array.isArray(v))throw 0;resolve(v)}catch{reject(Object.assign(new Error('Некорректный JSON'),{status:400}))}});req.on('error',reject)})}
const cookie=req=>{const m=/(?:^|;\s*)pv_session=([A-Za-z0-9_-]{20,})/.exec(String(req.headers.cookie||''));return m?m[1]:''};
const tokenHash=t=>crypto.createHash('sha256').update(t).digest('hex');
function session(req){const t=cookie(req);if(!t)return null;const s=S.get('sessions',tokenHash(t));if(!s||Date.parse(s.expiresAt)<Date.now())return null;return s}
const STATIC={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};

async function consoleApi(req,res,url){
 const p=url.pathname,m=req.method;
 if(p==='/api/login'&&m==='POST'){
  const ip=ipOf(req);if(!loginLimit(ip))fail('Слишком много попыток. Повторите через 15 минут',429);
  const b=await readBody(req,8192),admin=S.setting('admin',{});
  const ok=String(b.email||'').trim().toLowerCase()===admin.email&&verifyPassword(admin.hash,String(b.password||'').slice(0,256));
  if(!ok){event('login.fail','Неудачный вход в пульт с '+ip);fail('Неверный e-mail или пароль',401)}
  const raw=crypto.randomBytes(32).toString('base64url');S.put('sessions',{id:tokenHash(raw),createdAt:now(),expiresAt:new Date(Date.now()+12*3600000).toISOString(),ip});
  res.setHeader('Set-Cookie',`pv_session=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure(req)?'; Secure':''}`);
  event('login','Вход в пульт с '+ip);return json(res,200,{ok:true,email:admin.email});
 }
 const s=session(req);if(!s)fail('Требуется вход',401);
 if(!apiLimit(s.id))fail('Слишком много запросов',429);
 if(m!=='GET'){
  // Защита от подделки запросов с чужих сайтов: свой заголовок + тот же источник.
  const origin=req.headers.origin;if(req.headers['x-prometey']!=='1'||(origin&&new URL(origin).host!==req.headers.host))fail('Запрос отклонён',403);
 }
 const body=['POST','PATCH','PUT'].includes(m)?await readBody(req):{};
 if(p==='/api/logout'&&m==='POST'){S.del('sessions',s.id);res.setHeader('Set-Cookie','pv_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return json(res,200,{ok:true})}
 if(p==='/api/me'&&m==='GET')return json(res,200,{email:S.setting('admin',{}).email,version:VERSION});
 if(p==='/api/password'&&m==='POST'){const a=S.setting('admin',{});if(!verifyPassword(a.hash,String(body.current||'')))fail('Текущий пароль неверный');const n=String(body.next||'');if(n.length<12)fail('Новый пароль — не короче 12 символов');a.hash=hashPassword(n);a.updatedAt=now();S.setSetting('admin',a);db.prepare('DELETE FROM sessions WHERE id<>?').run(s.id);event('password','Пароль пульта изменён');return json(res,200,{ok:true})}
 if(p==='/api/overview'&&m==='GET')return json(res,200,overview());
 const companies=()=>S.all('companies');
 if(p==='/api/companies'&&m==='GET'){const ins=S.all('installs'),pays=S.all('payments');return json(res,200,companies().filter(c=>url.searchParams.get('archived')==='1'||!c.archived).map(c=>companyView(c,ins,pays)))}
 if(p==='/api/companies'&&m==='POST')return json(res,201,saveCompany(body));
 let r=p.match(/^\/api\/companies\/(co_[0-9a-f-]{36})$/);
 if(r&&m==='GET'){const c=S.get('companies',r[1]);if(!c)fail('Компания не найдена',404);const all=companies();return json(res,200,{company:companyView(c),installs:S.all('installs').filter(i=>i.companyId===c.id).map(i=>installView(i,all)),payments:S.all('payments').filter(x=>x.companyId===c.id)})}
 if(r&&m==='PATCH')return json(res,200,saveCompany(body,r[1]));
 if(r&&m==='DELETE'){const c=S.get('companies',r[1]);if(!c)fail('Компания не найдена',404);c.archived=now();S.put('companies',c);event('company.archive',`«${c.name}» в архиве`,c.id);return json(res,200,{ok:true})}
 r=p.match(/^\/api\/companies\/(co_[0-9a-f-]{36})\/payments$/);
 if(r&&m==='POST')return json(res,201,addPayment(r[1],body));
 r=p.match(/^\/api\/payments\/(pay_[0-9a-f-]{36})$/);
 if(r&&m==='DELETE')return json(res,200,cancelPayment(r[1]));
 if(p==='/api/payments'&&m==='GET'){const cs=companies(),month=str(url.searchParams.get('month'),7);let list=S.all('payments').map(x=>({...x,companyName:cs.find(c=>c.id===x.companyId)?.name||'—'}));if(month)list=list.filter(x=>x.date.startsWith(month));
  if(url.searchParams.get('format')==='csv'){res.statusCode=200;res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="payments-${month||'all'}.csv"`);return res.end(csv([['Дата','Компания','Сумма','Месяцев','Оплачено до','Способ','Комментарий','Отменён'],...list.map(x=>[x.date,x.companyName,String(x.amount).replace('.',','),x.months,x.paidUntilAfter,x.method,x.comment,x.cancelled?'да':''])]))}
  return json(res,200,list)}
 if(p==='/api/installs'&&m==='GET'){const cs=companies();return json(res,200,S.all('installs').map(i=>installView(i,cs)))}
 r=p.match(/^\/api\/installs\/([0-9a-f-]{36})$/);
 if(r&&m==='GET'){const i=S.get('installs',r[1]);if(!i)fail('Установка не найдена',404);return json(res,200,{...installView(i,companies()),license:licensePayload(i)})}
 if(r&&m==='PATCH')return json(res,200,installView(updateInstall(r[1],body),companies()));
 if(r&&m==='DELETE'){const i=S.get('installs',r[1]);if(!i)fail('Установка не найдена',404);S.del('installs',i.id);event('install.delete',`Установка ${i.reported?.companyName||i.id.slice(0,8)} удалена из списка`,i.id);return json(res,200,{ok:true})}
 if(p==='/api/users'&&m==='GET'){const cs=companies();const list=S.all('installs').flatMap(i=>{const c=cs.find(c=>c.id===i.companyId);return (i.users||[]).map(u=>({...u,installId:i.id,companyName:c?.name||i.reported?.companyName||'',companyId:c?.id||'',seenAt:i.lastSeen}))});
  if(url.searchParams.get('format')==='csv'){res.statusCode=200;res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="users.csv"');return res.end(csv([['E-mail','Имя','Компания','Роль','Статус','Согласие на обработку ПДн','Последний вход'],...list.map(u=>[u.email,u.name,u.companyName,u.role,u.disabled?'отключён':'активен',u.consentAt,u.lastLoginAt])]))}
  return json(res,200,{users:list,withoutConsent:S.all('installs').reduce((s,i)=>s+(i.withoutConsent||0),0)})}
 if(p==='/api/policy'&&m==='GET')return json(res,200,S.setting('policy',{}));
 if(p==='/api/policy'&&m==='PATCH'){const v={name:str(body.name,200),inn:str(body.inn,12).replace(/\D/g,''),email:str(body.email,120),title:str(body.title,200),version:str(body.version,40),text:String(body.text||'').slice(0,30000).trim()};if(v.text&&!v.version)fail('Укажите редакцию (например, дату) своего текста политики');S.setSetting('policy',v);event('policy','Политика обработки ПДн обновлена'+(v.version?' (редакция '+v.version+')':''));return json(res,200,v)}
 if(p==='/api/events'&&m==='GET')return json(res,200,S.all('events').slice(0,500));
 if(p==='/api/settings'&&m==='GET'){const host=req.headers.host;return json(res,200,{rules:rules(),publicKey:PUBLIC_KEY,serverUrl:(secure(req)?'https://':'http://')+host,version:VERSION})}
 if(p==='/api/settings'&&m==='PATCH'){const cur=rules(),n={trialDays:Math.max(0,Math.min(365,Math.floor(num(body.trialDays??cur.trialDays)))),graceDays:Math.max(0,Math.min(90,Math.floor(num(body.graceDays??cur.graceDays)))),checkHours:Math.max(1,Math.min(48,Math.floor(num(body.checkHours??cur.checkHours)))),offlineWarnDays:Math.max(1,Math.min(60,Math.floor(num(body.offlineWarnDays??cur.offlineWarnDays))))};S.setSetting('rules',n);event('settings','Правила подписки изменены');return json(res,200,n)}
 fail('Не найдено',404);
}

const server=http.createServer(async(req,res)=>{
 headers(res);
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/v1/checkin'){if(req.method!=='POST')fail('Требуется POST',405);if(!checkinLimit(ipOf(req)))fail('Слишком много запросов',429);return json(res,200,checkin(await readBody(req,64*1024),ipOf(req)))}
  if(url.pathname==='/api/v1/public-key')return json(res,200,{publicKey:PUBLIC_KEY});
  if(url.pathname==='/api/v1/health')return json(res,200,{ok:true,version:VERSION});
  if(url.pathname.startsWith('/api/'))return await consoleApi(req,res,url);
  if(!['GET','HEAD'].includes(req.method))fail('Метод не поддерживается',405);
  const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
  if(!/^[a-z0-9-]+\.(html|js|css|svg)$/.test(name))fail('Не найдено',404);
  const file=path.join(PUBLIC,name);if(!fs.existsSync(file))fail('Не найдено',404);
  res.statusCode=200;res.setHeader('Content-Type',STATIC[path.extname(name)]);res.setHeader('Cache-Control','no-cache');return res.end(fs.readFileSync(file));
 }catch(e){if(!e.status)console.error(e);json(res,e.status||500,{error:e.status?e.message:'Внутренняя ошибка'})}
});
if(require.main===module)server.listen(PORT,HOST,()=>console.log(`ПРОМЕТЕЙ · Пульт продавца ${VERSION}: http://${HOST}:${PORT}  (данные: ${DATA_DIR})`));
module.exports={server,PUBLIC_KEY,db,licenseOf,addMonths};
