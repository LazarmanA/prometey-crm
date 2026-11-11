'use strict';
// Подписка ПРОМЕТЕЙ: CRM раз в несколько часов сообщает пульту продавца версию, число пользователей и состояние
// подключённых сервисов, а в ответ получает подписанное (Ed25519) состояние подписки.
// Не оплачено и льготный период прошёл → режим «только просмотр»: всё видно и выгружается, изменять нельзя.
// Включается, только если заданы PROMETEY_LICENSE_SERVER и PROMETEY_LICENSE_KEY (их вшивает установщик).
// Данные клиентов CRM на пульт не передаются — только счётчики и названия сервисов.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const Access=require('./access');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const DAY=86400000,OFFLINE_TRIAL_DAYS=14;
const STATUS_TEXT={off:'Без подписки',trial:'Пробный период',active:'Подписка оплачена',grace:'Подписка не оплачена — льготный период',expired:'Подписка не оплачена',blocked:'Доступ приостановлен'};

function createLicense({dataDir,env=process.env,store,collect,transport=fetch,version}){
 const server=String(env.PROMETEY_LICENSE_SERVER||'').replace(/\/+$/,''),keyB64=String(env.PROMETEY_LICENSE_KEY||'').trim();
 let publicKey=null;
 if(server&&keyB64){try{publicKey=crypto.createPublicKey({key:Buffer.from(keyB64,'base64'),format:'der',type:'spki'})}catch{console.warn('[подписка] неверный PROMETEY_LICENSE_KEY — проверка подписки отключена')}}
 const enabled=!!(server&&publicKey&&/^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(server));
 if(server&&publicKey&&!enabled)console.warn('[подписка] адрес пульта должен начинаться с https:// — проверка отключена');
 const idFile=path.join(dataDir,'installation.json'),stateFile=path.join(dataDir,'license-state.json');
 function identity(){
  try{const x=JSON.parse(fs.readFileSync(idFile,'utf8'));if(/^[0-9a-f-]{36}$/.test(x.installId)&&x.secret)return x}catch{}
  const x={installId:crypto.randomUUID(),secret:crypto.randomBytes(32).toString('base64url'),createdAt:new Date().toISOString()};
  fs.mkdirSync(dataDir,{recursive:true});fs.writeFileSync(idFile,JSON.stringify(x,null,1),{mode:0o600});return x;
 }
 const id=enabled?identity():null;
 let state=null,lastCheckAt='',lastError='',timer=null,checking=null;
 function verify(signed){
  if(!signed||typeof signed.payload!=='string'||typeof signed.signature!=='string')throw new Error('Пульт прислал неполный ответ');
  if(!crypto.verify(null,Buffer.from(signed.payload),publicKey,Buffer.from(signed.signature,'base64url')))throw new Error('Подпись ответа пульта неверна');
  const p=JSON.parse(Buffer.from(signed.payload,'base64url').toString('utf8'));
  if(p.installId!==id.installId)throw new Error('Ответ пульта относится к другой установке');
  return p;
 }
 // сохранённое состояние (работает без интернета до конца оплаченного срока)
 if(enabled){try{const s=JSON.parse(fs.readFileSync(stateFile,'utf8'));state={...verify(s.signed),signed:s.signed,receivedAt:s.receivedAt};lastCheckAt=s.receivedAt||''}catch{state=null}}

 function current(at=Date.now()){
  if(!enabled)return {enabled:false,status:'off',readOnly:false};
  let status,until='',graceUntil='',message='',companyName='',maxUsers=0,plan='',reason='';
  if(state){
   ({until='',graceUntil='',message='',companyName='',maxUsers=0,plan='',reason=''}=state);
   if(state.blocked||state.status==='blocked')status='blocked';
   else{const u=Date.parse(until)||0,g=Date.parse(graceUntil)||u;status=at<=u?(state.kind==='paid'?'active':'trial'):at<=g?'grace':'expired';
    // Пульт уже сообщил о неоплате — не «откатываемся» назад по часам компьютера.
    if(state.status==='expired')status='expired'}
   // Часы компьютера переведены назад больше чем на сутки — подозрительно, доверяем ответу пульта.
   if(state.issuedAt&&at<Date.parse(state.issuedAt)-DAY)status=state.status;
  }else{
   // Ни разу не удалось связаться с пультом: пробный период от первого запуска.
   const created=Date.parse(id.createdAt)||at;until=new Date(created+OFFLINE_TRIAL_DAYS*DAY).toISOString();graceUntil=until;
   status=at<=Date.parse(until)?'trial':'expired';reason='CRM не может связаться с сервером подписки';
  }
  const readOnly=status==='expired'||status==='blocked';
  const daysLeft=until?Math.ceil((Date.parse(until)-at)/DAY):0;
  let banner='';
  if(status==='trial'&&daysLeft<=7)banner=`Пробный период заканчивается ${fmt(until)}. Чтобы продолжить работу, оформите подписку.`;
  if(status==='active'&&daysLeft<=5)banner=`Подписка оплачена до ${fmt(until)}. Не забудьте продлить.`;
  if(status==='grace')banner=`Подписка не оплачена. CRM перейдёт в режим «только просмотр» ${fmt(graceUntil)}.`;
  if(status==='expired')banner='Подписка не оплачена — CRM работает только для просмотра. Данные сохранены, их можно смотреть и выгружать. После оплаты всё включится автоматически.';
  if(status==='blocked')banner='Доступ к CRM приостановлен — работает только просмотр. Свяжитесь с поставщиком ПРОМЕТЕЙ.';
  return {policy:state?.policy||null,enabled:true,status,statusText:STATUS_TEXT[status],readOnly,until,graceUntil,daysLeft,companyName,plan,maxUsers,message,reason,banner,lastCheckAt,lastError};
 }
 const fmt=iso=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||''));return m?`${m[3]}.${m[2]}.${m[1]}`:''};

 async function check(){
  if(!enabled)return current();
  if(checking)return checking;
  checking=(async()=>{
   try{
    const body={installId:id.installId,secret:id.secret,version,...(await collect())};
    const r=await transport(server+'/api/v1/checkin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||('сервер подписки ответил '+r.status));
    const p=verify(j);state={...p,signed:j,receivedAt:new Date().toISOString()};lastCheckAt=state.receivedAt;lastError='';
    fs.writeFileSync(stateFile+'.tmp',JSON.stringify({signed:j,receivedAt:state.receivedAt}),{mode:0o600});fs.renameSync(stateFile+'.tmp',stateFile);
    schedule((Number(p.nextCheckSec)||6*3600)*1000);
   }catch(e){lastError=String(e.message||e).slice(0,300);schedule(30*60000)}
   finally{checking=null}
   return current();
  })();
  return checking;
 }
 function schedule(ms){if(timer)clearTimeout(timer);timer=setTimeout(check,Math.max(60000,Math.min(ms,48*3600000)));timer.unref?.()}
 function start(){if(!enabled)return;const t=setTimeout(check,env.NODE_ENV==='test'?10:5000);t.unref?.()}
 function stop(){if(timer)clearTimeout(timer)}

 // Что можно делать в режиме «только просмотр»: читать, выйти, сменить свой пароль, проверить подписку.
 const ALLOWED=new Set(['/api/logout','/api/profile/password','/api/admin/license/check','/api/login']);
 function guard(method,pathname){
  if(['GET','HEAD','OPTIONS'].includes(method)||ALLOWED.has(pathname))return;
  const c=current();if(!c.readOnly)return;
  throw Object.assign(new Error(c.status==='blocked'?'Доступ к CRM приостановлен: доступен только просмотр. Свяжитесь с поставщиком ПРОМЕТЕЙ.':'Подписка не оплачена: CRM работает только для просмотра. После оплаты всё включится автоматически.'),{status:402,code:'license_read_only'});
 }
 function canAddUser(activeUsers){const c=current();return !c.enabled||!c.maxUsers||activeUsers<c.maxUsers}

 async function admin(user,method,url,data){
  if(!Access.at(Access.perms(data,user),'settings','yes'))fail('Раздел доступен администратору',403);
  if(url.pathname==='/api/admin/license'&&method==='GET'){
   return {...current(),installId:id?.installId||'',server,sent:'Версия CRM; число пользователей, компаний-клиентов, сделок и документов; размер базы; название и ИНН вашей организации; какие сервисы подключены (PDF, Битрикс24, 1С, телефония, карты, доступ из сети, резервные копии); имя компьютера и версия Windows; имя, e-mail, роль и дата последнего входа сотрудников, принявших политику обработки персональных данных. Данные клиентов, сделок и документов не передаются.'};
  }
  if(url.pathname==='/api/admin/license/check'&&method==='POST'){if(!enabled)fail('Проверка подписки не настроена в этой сборке',409);const c=await check();if(c.lastError)fail('Не удалось связаться с сервером подписки: '+c.lastError,502);return c}
  fail('Операция не найдена',404);
 }
 return {enabled,current,check,start,stop,guard,admin,canAddUser,installId:id?.installId||''};
}

// Сведения для пульта: только счётчики и состояние сервисов.
function collector({store,dbFile,env=process.env,pdfEngine,backupsDir,logFile,extra}){
 return async()=>{
  const d=store.read(),now=Date.now(),month=30*DAY;
  const users=(d.users||[]).filter(u=>!u.disabled);
  const entity=(d.legalEntities||[])[0]||{};
  let dbBytes=0;for(const f of [dbFile,dbFile+'-wal'])try{dbBytes+=fs.statSync(f).size}catch{}
  let lastBackupAt='';try{lastBackupAt=fs.readdirSync(backupsDir()).filter(n=>n.startsWith('prometey-')).map(n=>fs.statSync(path.join(backupsDir(),n)).mtime.toISOString()).sort().at(-1)||''}catch{}
  let errors24h=0;try{const st=fs.statSync(logFile);const len=Math.min(st.size,512*1024),buf=Buffer.alloc(len),fd=fs.openSync(logFile,'r');fs.readSync(fd,buf,0,len,st.size-len);fs.closeSync(fd);const since=new Date(now-DAY).toISOString().slice(0,10);errors24h=buf.toString('utf8').split('\n').filter(l=>l>=since&&/error|ошибк|failed/i.test(l)).length}catch{}
  const engine=pdfEngine();const host=env.HOST||'127.0.0.1';
  const backupAge=lastBackupAt?(now-Date.parse(lastBackupAt))/DAY:Infinity;
  let gateways=[];try{gateways=JSON.parse(env.TELEPHONY_GATEWAYS||'[]')}catch{}
  const services=[
   {key:'pdf',name:'PDF-документы',status:engine.available?'on':'error',detail:engine.available?(engine.type==='libreoffice'?'LibreOffice':'Браузер Edge/Chrome'):'нет LibreOffice и Edge'},
   {key:'templates',name:'Свои шаблоны договоров',status:(d.templates||[]).some(t=>!t.archivedAt)?'on':'off',detail:String((d.templates||[]).filter(t=>!t.archivedAt).length)},
   {key:'bitrix24',name:'Битрикс24',status:env.BITRIX24_WEBHOOK?'on':'off',detail:''},
   {key:'onec',name:'1С (обмен)',status:env.ONEC_EXCHANGE_URL?'on':'off',detail:''},
   {key:'telephony',name:'Телефония',status:Array.isArray(gateways)&&gateways.length?'on':'off',detail:Array.isArray(gateways)?gateways.map(g=>g.provider||g.name||'').filter(Boolean).join(', ').slice(0,100):''},
   {key:'maps',name:'Яндекс Карты',status:env.YANDEX_MAPS_API_KEY?'on':'off',detail:''},
   {key:'lan',name:'Доступ из офисной сети',status:['127.0.0.1','localhost','::1'].includes(host)?'off':'on',detail:host},
   {key:'backup',name:'Резервные копии',status:backupAge<2?'on':backupAge<8?'warn':'error',detail:lastBackupAt?'последняя '+lastBackupAt.slice(0,10):'ни одной'},
   {key:'edo',name:'УПД для ЭДО (XML)',status:(d.realizations||[]).length?'on':'off',detail:String((d.realizations||[]).length)},
  ];
  return {
   company:{name:entity.name||entity.shortName||'',inn:entity.inn||''},
   stats:{users:users.length,activeUsers:users.filter(u=>u.lastLoginAt&&now-Date.parse(u.lastLoginAt)<month).length,clients:(d.clients||[]).filter(c=>!c.archivedAt).length,orders:(d.orders||[]).filter(o=>!o.archivedAt).length,documents:(d.documents||[]).length,templates:(d.templates||[]).filter(t=>!t.archivedAt).length,dbBytes,lastLoginAt:users.map(u=>u.lastLoginAt||'').sort().at(-1)||''},
   ...(extra?(()=>{try{return extra(d)}catch{return {}}})():{}),
   services,host:{os:`${os.type()} ${os.release()}`,node:process.versions.node,hostname:os.hostname(),lan:!['127.0.0.1','localhost','::1'].includes(host)},lastBackupAt,errors24h,
  };
 };
}
module.exports={createLicense,collector,STATUS_TEXT};
