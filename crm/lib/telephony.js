const crypto=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {readAudio,audioType}=require('./recordings');
const profiles=[['mango','Mango Office'],['beeline','Билайн'],['mts','МТС'],['t2','T2 / Tele2'],['custom','Другая АТС']];
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
function phone(value){let s=String(value||'').replace(/\D/g,'');if(s.length===11&&s[0]==='8')s='7'+s.slice(1);return s}
function config(env){try{const c=JSON.parse(env.TELEPHONY_GATEWAYS||'{}');if(!c||Array.isArray(c)||typeof c!=='object')throw 0;for(const [id,key] of Object.entries(c))if(!/^[a-z][a-z0-9_-]{0,39}$/.test(id)||typeof key!=='string'||key.length<32)throw 0;return c}catch{throw new Error('TELEPHONY_GATEWAYS: требуется JSON с уникальными именами шлюзов и ключами от 32 символов')}}
function createTelephony(store,env=process.env,recordingsDirectory){
 const keys=Object.assign(Object.create(null),config(env));
 function authorize(req,id){const expected=keys[id],actual=(req.headers.authorization||'').replace(/^Bearer /,'');if(!expected||!actual||!crypto.timingSafeEqual(crypto.createHash('sha256').update(expected).digest(),crypto.createHash('sha256').update(actual).digest()))fail('Нет доступа к шлюзу',401)}
 function attach(d,event,kind,id){if(!['clients','orders'].includes(kind))fail('Неверный тип карточки');const parent=d[kind].find(x=>x.id===id&&!x.archivedAt);if(!parent)fail('Активная карточка не найдена',404);if(event.target)fail('Звонок уже привязан',409);if((parent.calls||[]).length>=1000)fail('Лимит звонков в карточке',409);const call={id:crypto.randomUUID(),phone:event.phone,at:event.at,direction:event.direction,status:event.status,duration:event.duration,note:event.note,source:'telephony:'+event.provider,externalId:event.externalId,createdBy:'telephony',updatedAt:new Date().toISOString()};(parent.calls ||= []).push(call);event.target={kind,id,callId:call.id};return event}
 function ingest(provider,b){
  if(!b||typeof b!=='object'||Array.isArray(b))fail('Ожидается объект JSON');
  if(typeof b.externalId!=='string'||!b.externalId.trim()||b.externalId.length>160)fail('externalId: строка до 160 символов');
  if(typeof b.phone!=='string'||phone(b.phone).length<7||phone(b.phone).length>15)fail('Неверный номер телефона');
  if(typeof b.at!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(b.at)||!Number.isFinite(Date.parse(b.at)))fail('at: дата ISO 8601 с часовым поясом');
  if(!['incoming','outgoing'].includes(b.direction)||!['completed','missed'].includes(b.status))fail('Передавайте только итог завершённого звонка');
  if(!Number.isInteger(b.duration)||b.duration<0||b.duration>86400)fail('duration: секунды, 0–86400');
  if(b.note!==undefined&&(typeof b.note!=='string'||b.note.length>8000))fail('Слишком длинный комментарий');
  const values={provider,externalId:b.externalId,phone:phone(b.phone),at:new Date(b.at).toISOString(),direction:b.direction,status:b.status,duration:b.duration,note:b.note||''};
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({...values,target:b.target||null})).digest('hex');
  return store.transaction(d=>{const events=d.telephonyEvents ||= [];const old=events.find(e=>e.provider===provider&&e.externalId===b.externalId);if(old){if(old.fingerprint!==fingerprint)fail('Этот externalId уже принят с другими данными',409);return {changed:false,body:{ok:true,duplicate:true,event:old}}}if(events.length>=50000)fail('Лимит журнала телефонии: требуется обслуживание',507);
   const event={id:crypto.randomUUID(),...values,fingerprint,receivedAt:new Date().toISOString(),target:null};
   if(b.target){attach(d,event,b.target.kind,b.target.id)}else{const found=d.clients.filter(c=>!c.archivedAt&&phone(c.phone)===values.phone);if(found.length===1)attach(d,event,'clients',found[0].id)}
   events.push(event);return {changed:true,body:{ok:true,duplicate:false,event}};
  }).body;
 }
 function admin(user,method,url,b){if(!require('./access').at(user.perms||require('./access').perms(null,user),'telephony','yes'))fail('Доступно руководителю',403);
  if(method==='GET'&&url.pathname==='/api/telephony'){const d=store.read();const ids=[...new Set([...profiles.map(p=>p[0]),...Object.keys(keys)])];return {providers:ids.map(id=>({id,name:profiles.find(p=>p[0]===id)?.[1]||id,configured:!!keys[id],endpoint:'/api/telephony/webhooks/'+id})),events:(d.telephonyEvents||[]).slice(-200).reverse().map(({fingerprint,...e})=>e),clients:d.clients.filter(x=>!x.archivedAt).map(x=>({id:x.id,name:x.name})),orders:d.orders.filter(x=>!x.archivedAt).map(x=>({id:x.id,name:x.name||x.number}))}}
  const match=url.pathname.match(/^\/api\/telephony\/events\/([a-f0-9-]+)\/link$/);if(method==='POST'&&match)return store.transaction(d=>{const e=(d.telephonyEvents||[]).find(x=>x.id===match[1]);if(!e)fail('Событие не найдено',404);attach(d,e,b.kind,b.id);d.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),userId:user.id,action:'call.link',entity:b.kind,entityId:b.id,details:'Привязан звонок телефонии'});return {changed:true,body:{ok:true}}}).body;
  fail('Операция не найдена',404);
 }
 async function recording(req,provider,eventId){
  function locate(d){const e=(d.telephonyEvents||[]).find(e=>e.provider===provider&&e.id===eventId);if(!e?.target)fail('Сначала привяжите звонок к карточке',409);const p=d[e.target.kind].find(p=>p.id===e.target.id&&!p.archivedAt),c=p?.calls?.find(c=>c.id===e.target.callId);if(!c)fail('Активный звонок не найден',404);return c}
  locate(store.read());const bytes=await readAudio(req),type=audioType(bytes),hash=crypto.createHash('sha256').update(bytes).digest('hex');
  if(!recordingsDirectory)fail('Хранилище записей не настроено',503);
  const fileId=crypto.randomUUID()+'.'+type.ext;fs.mkdirSync(recordingsDirectory,{recursive:true,mode:0o700});const file=path.join(recordingsDirectory,fileId);fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
  try{const result=store.transaction(d=>{const c=locate(d);if(c.recording){if(c.recording.sha256===hash)return {changed:false,body:{ok:true,duplicate:true}};fail('Другая запись уже сохранена',409)}c.recording={fileId,mime:type.mime,size:bytes.length,sha256:hash,uploadedAt:new Date().toISOString(),uploadedBy:'telephony:'+provider};return {changed:true,body:{ok:true,duplicate:false}}});if(result.body.duplicate)fs.unlinkSync(file);return result.body}catch(e){fs.unlinkSync(file);throw e}
 }
 return {authorize,ingest,admin,recording};
}
module.exports={createTelephony,phone};
