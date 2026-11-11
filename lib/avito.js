'use strict';
// Авито → Лиды. Новые сообщения покупателей в мессенджере Авито (и, если включено, звонки через коллтрекинг Авито)
// попадают в «Лиды» с источником «Авито». Работает без «белого» адреса: CRM сама опрашивает Авито раз в 2 минуты.
// Если CRM доступна из интернета по HTTPS, можно дополнительно подписать вебхук — тогда заявки приходят сразу.
// Ключи (client_id / client_secret) — в личном кабинете Авито: «Профиль → Для профессионалов → API» (нужен тариф с доступом к API).
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Access=require('./access');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const str=(v,max=500)=>String(v??'').trim().slice(0,max);
const nowIso=()=>new Date().toISOString();
const uid=p=>p+'_'+crypto.randomUUID();
const POLL_MS=2*60000,FIRST_IMPORT_DAYS=3;

function createAvito({dataDir,store,env=process.env,transport=fetch}){
 const API=String(env.AVITO_API_URL||'https://api.avito.ru').replace(/\/+$/,'');
 const file=path.join(dataDir,'avito.json');
 let cfg=load(),token=null,timer=null,running=null,webhookKick=null;
 function load(){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return {enabled:false,clientId:'',clientSecret:'',ownerId:'',calls:false,publicUrl:'',webhookSecret:crypto.randomBytes(24).toString('base64url'),state:{},log:[]}}}
 function save(){fs.mkdirSync(dataDir,{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(cfg,null,1),{mode:0o600});fs.renameSync(file+'.tmp',file)}
 function note(kind,text){cfg.log=[{at:nowIso(),kind,text:String(text).slice(0,300)},...(cfg.log||[])].slice(0,50)}

 // ---------- API Авито ----------
 async function request(method,p,{body,form,auth=true}={}){
  const headers={};if(auth)headers.Authorization='Bearer '+await accessToken();
  let payload;if(form){headers['Content-Type']='application/x-www-form-urlencoded';payload=new URLSearchParams(form).toString()}else if(body!==undefined){headers['Content-Type']='application/json';payload=JSON.stringify(body)}
  let r;try{r=await transport(API+p,{method,headers,body:payload,redirect:'error',signal:AbortSignal.timeout(20000)})}catch(e){fail('Нет связи с Авито: '+(e.cause?.code||e.message),502)}
  const text=await r.text();let j=null;try{j=text?JSON.parse(text):{}}catch{j={raw:text.slice(0,200)}}
  if(p==='/token'&&!r.ok)fail('Авито не принял client_id / client_secret — проверьте ключи',502);
  if(r.status===401||r.status===403){token=null;if(auth)fail(p==='/token'?'Авито не принял client_id / client_secret':'Авито отказал в доступе (проверьте права ключа и тариф с API)',502)}
  if(r.status===402)fail('В Авито не подключён доступ к API мессенджера (нужен подходящий тариф)',502);
  if(r.status===429)fail('Авито просит подождать (слишком много запросов)',502);
  if(!r.ok)fail(`Авито ответил ${r.status}${j?.error?.message?': '+j.error.message:j?.message?': '+j.message:''}`,502);
  return j;
 }
 async function accessToken(){
  if(token&&token.until>Date.now())return token.value;
  if(!cfg.clientId||!cfg.clientSecret)fail('Укажите client_id и client_secret Авито');
  const j=await request('POST','/token',{form:{grant_type:'client_credentials',client_id:cfg.clientId,client_secret:cfg.clientSecret},auth:false});
  if(!j.access_token)fail('Авито не выдал ключ доступа: проверьте client_id и client_secret',502);
  token={value:j.access_token,until:Date.now()+Math.max(60,(Number(j.expires_in)||3600)-120)*1000};return token.value;
 }
 async function account(){const j=await request('GET','/core/v1/accounts/self');const id=Number(j.id||j.user_id);if(!id)fail('Авито не сообщил номер профиля',502);cfg.state.userId=id;cfg.state.accountName=str(j.name||j.profile_name||j.email,120);return {id,name:cfg.state.accountName}}

 // ---------- лиды ----------
 function defaultOwner(d){const u=d.users.find(x=>x.id===cfg.ownerId&&!x.disabled);if(u)return u.id;const admin=d.users.find(x=>!x.disabled&&Access.at(Access.perms(d,x),'settings','yes'));return (admin||d.users.find(x=>!x.disabled)||{}).id}
 function event(lead,type,text,at){lead.events=lead.events||[];lead.events.push({id:uid('evt'),at:at||nowIso(),type,text:String(text).slice(0,3000),by:'avito'});lead.lastActivityAt=nowIso()}
 function audit(d,action,lead){(d.audit||=[]).unshift({id:uid('log'),at:nowIso(),userId:'integration:avito',action,entity:'leads',entityId:lead.id,details:lead.name});d.audit=d.audit.slice(0,1000)}
 const safeIso=v=>{const t=Date.parse(v);return Number.isFinite(t)?new Date(t).toISOString():nowIso()};
 const open=l=>!['won','lost'].includes(l.status);
 const digits=v=>String(v||'').replace(/\D/g,'');
 const phoneKey=p=>{const x=digits(p);return x.length>=10?x.slice(-10):''};
 function newLead(d,{name,phone='',note='',externalId='',avito={},nextAction}){
  const lead={id:uid('lead'),source:'avito',externalId,name:str(name,200)||'Покупатель Авито',company:'',inn:'',phone:str(phone,40),email:'',note:str(note,3000),status:'new',ownerId:defaultOwner(d),clientId:'',nextAt:nowIso().slice(0,16),nextAction:nextAction||'Ответить в Авито',createdAt:nowIso(),lastActivityAt:nowIso(),events:[],avito};
  (d.leads||=[]).push(lead);event(lead,'status','Лид создан: Авито');audit(d,'lead.create',lead);return lead;
 }
 // Сообщения одного чата → один открытый лид; новый вопрос после закрытого лида → новый лид.
 function applyChat(d,chat,messages){
  const uidAvito=cfg.state.userId,buyer=(chat.users||[]).find(x=>Number(x.id)!==uidAvito)||{},item=chat.context?.value||{};
  const ext='avito:chat:'+chat.id;let lead=(d.leads||[]).filter(l=>l.externalId===ext).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
  let created=false;
  if(!lead||!open(lead)){
   const url=item.url?(String(item.url).startsWith('http')?item.url:'https://www.avito.ru'+item.url):'';
   lead=newLead(d,{name:buyer.name||'Покупатель Авито',externalId:ext,note:[item.title?`Объявление: ${item.title}${item.price_string?' · '+item.price_string:''}`:'',url,`Чат в Авито: https://www.avito.ru/profile/messenger/channel/${chat.id}`].filter(Boolean).join('\n'),avito:{chatId:String(chat.id),itemId:String(item.id||''),itemTitle:str(item.title,200),itemUrl:url,buyerId:String(buyer.id||'')}});created=true;
  }
  for(const m of messages){const t=m.content?.text||({image:'[фото]',voice:'[голосовое сообщение]',location:'[геолокация]',link:m.content?.link?.text||'[ссылка]',item:'[объявление]',call:'[звонок через Авито]',file:'[файл]'}[m.type])||'['+(m.type||'сообщение')+']';event(lead,'message','Авито: '+t,new Date((Number(m.created)||Date.now()/1000)*1000).toISOString())}
  if(!created&&lead.status==='waiting'){lead.status='in_progress';event(lead,'status','Клиент ответил в Авито')}
  if(!created){lead.nextAt=lead.nextAt&&lead.nextAt<nowIso().slice(0,16)?lead.nextAt:nowIso().slice(0,16);lead.nextAction=lead.nextAction||'Ответить в Авито';audit(d,'lead.activity',lead)}
  return created;
 }
 function applyCall(d,c){
  const phone=str(c.buyerPhone||c.callerPhone||c.clientPhone||c.from,40),key=phoneKey(phone),id=String(c.callId||c.id||'');
  const at=c.callTime||c.startTime||c.created||nowIso(),dur=Number(c.talkDuration??c.duration??0);
  const ext='avito:call:'+id;if((d.leads||[]).some(l=>l.externalId===ext||(l.events||[]).some(e=>e.ref===ext)))return false;
  const text=`Звонок с Авито${c.itemTitle?' по объявлению «'+c.itemTitle+'»':c.itemId?' по объявлению '+c.itemId:''}: ${dur>0?'разговор '+Math.round(dur)+' сек.':'пропущенный'}`;
  const existing=key&&(d.leads||[]).find(l=>open(l)&&phoneKey(l.phone)===key);
  if(existing){event(existing,'call',text,safeIso(at));existing.events.at(-1).ref=ext;audit(d,'lead.activity',existing);return false}
  const lead=newLead(d,{name:phone||'Звонок с Авито',phone,externalId:ext,note:text,avito:{itemId:String(c.itemId||''),callId:id},nextAction:dur>0?'Перезвонить и уточнить заявку':'Перезвонить — пропущенный звонок'});event(lead,'call',text);return true;
 }

 // ---------- загрузка ----------
 async function syncMessages(){
  const uidA=cfg.state.userId||(await account()).id;
  const since=Number(cfg.state.lastMessageAt)||Math.floor(Date.now()/1000)-FIRST_IMPORT_DAYS*86400;
  const chats=[];for(let offset=0;offset<500;offset+=100){const j=await request('GET',`/messenger/v2/accounts/${uidA}/chats?chat_types=u2i&limit=100&offset=${offset}`);const list=Array.isArray(j.chats)?j.chats:[];chats.push(...list);if(list.length<100||list.every(c=>Number(c.last_message?.created||c.updated||0)<=since))break}
  const fresh=chats.filter(c=>{const m=c.last_message||{};return Number(m.created||0)>since&&(m.direction==='in'||(m.author_id&&Number(m.author_id)!==uidA))}).sort((a,b)=>Number(a.last_message.created)-Number(b.last_message.created));
  let created=0,updated=0,max=since;
  for(const chat of fresh){
   let msgs=[];try{const j=await request('GET',`/messenger/v3/accounts/${uidA}/chats/${encodeURIComponent(chat.id)}/messages/?limit=30`);msgs=(Array.isArray(j)?j:j.messages||[])}catch{msgs=[]}
   msgs=msgs.filter(m=>Number(m.created)>since&&(m.direction==='in'||(m.author_id&&Number(m.author_id)!==uidA))).sort((a,b)=>Number(a.created)-Number(b.created));
   if(!msgs.length)msgs=[chat.last_message];
   const isNew=store.transaction(d=>({changed:true,body:applyChat(d,chat,msgs)})).body;isNew?created++:updated++;
   max=Math.max(max,Number(chat.last_message.created)||0);
  }
  cfg.state.lastMessageAt=max;return {created,updated};
 }
 async function syncCalls(){
  if(!cfg.calls)return {created:0};
  const from=cfg.state.lastCallAt||new Date(Date.now()-FIRST_IMPORT_DAYS*86400000).toISOString(),to=nowIso();
  const j=await request('POST','/calltracking/v1/getCalls/',{body:{dateTimeFrom:from,dateTimeTo:to,limit:100,offset:0}});
  const calls=Array.isArray(j.calls)?j.calls:Array.isArray(j.result?.calls)?j.result.calls:Array.isArray(j)?j:[];
  let created=0;for(const c of calls){if(store.transaction(d=>({changed:true,body:applyCall(d,c)})).body)created++}
  cfg.state.lastCallAt=to;return {created};
 }
 async function sync(reason='poll'){
  if(running)return running;
  running=(async()=>{
   try{const m=await syncMessages();let c={created:0};try{c=await syncCalls()}catch(e){note('error','Звонки: '+e.message)}
    cfg.state.lastPollAt=nowIso();cfg.state.lastError='';const total=m.created+c.created;
    if(total||m.updated){cfg.state.imported=(cfg.state.imported||0)+total;note('ok',`Новых лидов: ${total}${m.updated?`, новых сообщений в открытых лидах: ${m.updated}`:''}`)}
    save();return {ok:true,created:total,updated:m.updated,reason};
   }catch(e){cfg.state.lastPollAt=nowIso();cfg.state.lastError=e.message;note('error',e.message);save();throw e}
   finally{running=null}
  })();
  return running;
 }
 function schedule(){if(timer)clearInterval(timer);timer=null;if(cfg.enabled&&cfg.clientId&&cfg.clientSecret){timer=setInterval(()=>sync().catch(()=>{}),Number(env.AVITO_POLL_MS)||POLL_MS);timer.unref?.()}}
 function start(){schedule();if(cfg.enabled){const t=setTimeout(()=>sync('start').catch(()=>{}),env.NODE_ENV==='test'?50:15000);t.unref?.()}}
 function stop(){if(timer)clearInterval(timer);timer=null}

 // ---------- вебхук (если CRM доступна из интернета) ----------
 function webhook(secret,body){
  const a=Buffer.from(String(secret||'')),b=Buffer.from(cfg.webhookSecret||'');
  if(!cfg.enabled||a.length!==b.length||!crypto.timingSafeEqual(a,b))fail('Not found',404);
  const type=body?.payload?.type;if(type&&type!=='message')return {ok:true};
  clearTimeout(webhookKick);webhookKick=setTimeout(()=>sync('webhook').catch(()=>{}),1500);webhookKick.unref?.();return {ok:true};
 }

 // ---------- экран настройки ----------
 function view(d){
  return {enabled:!!cfg.enabled,clientId:cfg.clientId||'',hasSecret:!!cfg.clientSecret,ownerId:cfg.ownerId||'',calls:!!cfg.calls,publicUrl:cfg.publicUrl||'',
   webhookPath:'/api/integrations/avito/webhook/'+cfg.webhookSecret,account:cfg.state.accountName||'',userId:cfg.state.userId||'',lastPollAt:cfg.state.lastPollAt||'',lastError:cfg.state.lastError||'',imported:cfg.state.imported||0,
   log:cfg.log||[],owners:d.users.filter(u=>!u.disabled).map(u=>({id:u.id,name:u.name})),
   leadsToday:(d.leads||[]).filter(l=>l.source==='avito'&&l.createdAt>=nowIso().slice(0,10)).length,leadsTotal:(d.leads||[]).filter(l=>l.source==='avito').length};
 }
 async function admin(user,method,url,body,data){
  if(!Access.at(Access.perms(data,user),'settings','yes'))fail('Настройку Авито меняет руководитель',403);
  const p=url.pathname;
  if(p==='/api/integrations/avito'&&method==='GET')return view(data);
  if(p==='/api/integrations/avito'&&method==='PATCH'){
   const clientId=body.clientId!==undefined?str(body.clientId,200):cfg.clientId;
   if(clientId!==cfg.clientId){cfg.state={};token=null}
   cfg.clientId=clientId;if(str(body.clientSecret)){cfg.clientSecret=str(body.clientSecret,300);token=null}
   if(body.ownerId!==undefined){if(body.ownerId&&!data.users.some(u=>u.id===body.ownerId&&!u.disabled))fail('Сотрудник не найден');cfg.ownerId=str(body.ownerId,80)}
   if(body.calls!==undefined)cfg.calls=!!body.calls;
   if(body.publicUrl!==undefined){const u=str(body.publicUrl,300).replace(/\/+$/,'');if(u&&!/^https:\/\/[^\s/]+/.test(u))fail('Адрес CRM в интернете должен начинаться с https://');cfg.publicUrl=u}
   if(body.enabled!==undefined){if(body.enabled&&(!cfg.clientId||!cfg.clientSecret))fail('Сначала укажите client_id и client_secret');cfg.enabled=!!body.enabled;note('info',cfg.enabled?'Загрузка заявок включена':'Загрузка заявок выключена')}
   save();schedule();if(cfg.enabled&&body.enabled)sync('enable').catch(()=>{});
   return view(data);
  }
  if(p==='/api/integrations/avito/test'&&method==='POST'){token=null;const a=await account();save();return {ok:true,account:a.name||String(a.id),userId:a.id}}
  if(p==='/api/integrations/avito/sync'&&method==='POST'){if(!cfg.clientId||!cfg.clientSecret)fail('Сначала укажите client_id и client_secret');return await sync('manual')}
  if(p==='/api/integrations/avito/webhook'&&method==='POST'){
   if(!cfg.publicUrl)fail('Укажите адрес CRM в интернете (https://…)');
   await request('POST','/messenger/v3/webhook',{body:{url:cfg.publicUrl+'/api/integrations/avito/webhook/'+cfg.webhookSecret}});note('ok','Вебхук Авито подписан');save();return {ok:true}
  }
  fail('Операция не найдена',404);
 }
 const status=()=>({enabled:!!cfg.enabled,lastPollAt:cfg.state.lastPollAt||'',lastError:cfg.state.lastError||''});
 return {start,stop,sync,webhook,admin,status};
}
module.exports={createAvito};
