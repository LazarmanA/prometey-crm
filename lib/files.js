'use strict';
// Загружаемые файлы: логотипы (наши организации и компании-клиенты) и свои шаблоны договоров (.docx).
// Файлы лежат в папке данных (UPLOADS_DIR), в базе — только ссылки. Старые версии не удаляются:
// выпущенные документы продолжают ссылаться на логотип и шаблон, с которыми были созданы.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Access=require('./access');
const Docx=require('./docx');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const str=v=>String(v??'').trim();
const now=()=>new Date().toISOString();
const MAX_LOGO=2*1024*1024,MAX_TEMPLATE=10*1024*1024;
const ID=/^f_[0-9a-f-]{36}$/;
const TEMPLATE_TYPES={contract:'Договор',contract_invoice:'Договор-счёт',invoice:'Счёт на оплату',upd:'УПД',other:'Другое'};

function imageType(buf){
 if(buf.length>8&&buf.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return {mime:'image/png',ext:'.png'};
 if(buf.length>3&&buf[0]===0xff&&buf[1]===0xd8&&buf[2]===0xff)return {mime:'image/jpeg',ext:'.jpg'};
 if(buf.length>12&&buf.toString('latin1',0,4)==='RIFF'&&buf.toString('latin1',8,12)==='WEBP')return {mime:'image/webp',ext:'.webp'};
 return null;
}
function decodeData(value,max){
 const s=str(value),m=/^data:([\w.+/-]+)?;base64,(.*)$/s.exec(s),b64=(m?m[2]:s).replace(/\s+/g,'');
 if(!b64||!/^[A-Za-z0-9+/]+=*$/.test(b64))fail('Файл не получен');
 if(b64.length*3/4>max)fail(`Файл больше ${Math.round(max/1024/1024)} МБ`,413);
 return Buffer.from(b64,'base64');
}

function createFiles({dir}){
 const root=path.resolve(dir);
 const pathOf=(kind,id,ext)=>{if(!ID.test(id))fail('Файл не найден',404);return path.join(root,kind,id+ext)};
 function write(kind,ext,buf){const id='f_'+crypto.randomUUID(),file=pathOf(kind,id,ext);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file+'.tmp',buf,{mode:0o600});fs.renameSync(file+'.tmp',file);return id}
 const EXT={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'};
 function logoFile(ref){if(!ref?.fileId||!EXT[ref.mime])return null;const f=pathOf('logos',ref.fileId,EXT[ref.mime]);return fs.existsSync(f)?f:null}
 function logoDataUri(ref){try{const f=logoFile(ref);return f?`data:${ref.mime};base64,${fs.readFileSync(f).toString('base64')}`:''}catch{return ''}}
 function templateFile(t){const f=pathOf('templates',t.fileId,'.docx');if(!fs.existsSync(f))fail('Файл шаблона не найден на сервере',410);return f}

 // ---- права ----
 const perms=(d,u)=>u.perms||Access.perms(d,u);
 const canSettings=(d,u)=>Access.at(perms(d,u),'settings','yes');
 const canTemplates=(d,u,type)=>canSettings(d,u)||Access.at(perms(d,u),'documents','all')||type==='upd'&&Access.at(perms(d,u),'accounting','edit');
 function canEditClient(d,u,c,CRM){if(!c)return false;if(CRM?.canEdit)return CRM.canEdit(d,u,'clients',c);return Access.at(perms(d,u),'crm','all')||c.managerId===u.id}

 function audit(d,u,action,entity,id,details){(d.audit||=[]).unshift({id:'log_'+crypto.randomUUID(),at:now(),userId:u.id,action,entity,entityId:id,details:String(details||'').slice(0,200)});d.audit=d.audit.slice(0,1000)}
 // бланк без полей {{…}}: смотрим, что размечается автоматически (кэш по файлу)
 const autoCache=new Map();
 const autoInfo=t=>{if((t.fields||[]).length&&!t.auto)return null;if(autoCache.has(t.fileId))return autoCache.get(t.fileId);let r=null;try{const f=pathOf('templates',t.fileId,'.docx');if(fs.existsSync(f)){const i=Docx.inspect(fs.readFileSync(f));if(i.auto)r={fields:i.fields,recognized:i.recognized,left:i.left}}}catch{}autoCache.set(t.fileId,r);return r};
 const publicTemplate=(d,t)=>({...(()=>{const a=autoInfo(t);return a?{auto:true,recognized:a.recognized,left:a.left,autoFields:a.fields}:{}})(),id:t.id,name:t.name,type:t.type,typeName:TEMPLATE_TYPES[t.type]||t.type,fileName:t.fileName,size:t.size,fields:t.fields||[],unknown:t.unknown||[],isDefault:!!t.isDefault,legalEntityId:t.legalEntityId||'',createdAt:t.createdAt,updatedAt:t.updatedAt,author:d.users.find(u=>u.id===t.createdBy)?.name||''});

 // Логотип: target = legalEntity | client
 function setLogo(d,u,b,CRM){
  const target=str(b.target),id=str(b.id);
  let x;
  // для организации: logo — логотип, signature — подпись, stamp — печать
  const field=target==='legalEntity'?({logo:'logo',signature:'signatureImage',stamp:'stampImage',accountant:'accountantSignatureImage'}[str(b.kind)||'logo']):'logo';if(!field)fail('Неизвестный вид картинки');
  // подпись главного бухгалтера может загрузить и бухгалтерия
  if(target==='legalEntity'){x=(d.legalEntities||[]).find(e=>e.id===id);if(!x)fail('Организация не найдена',404);if(!canSettings(d,u)&&!(field==='accountantSignatureImage'&&Access.at(Access.perms(d,u),'accounting','edit')))fail(field==='accountantSignatureImage'?'Подпись главного бухгалтера загружает бухгалтерия или руководитель':'Логотип организации меняет руководитель',403)}
  else if(target==='client'){x=d.clients.find(c=>c.id===id);if(!x)fail('Компания не найдена',404);if(!canEditClient(d,u,x,CRM))fail('Нет права изменять эту компанию',403)}
  else fail('Неизвестный объект для логотипа');
  if(b.remove){delete x[field];x.updatedAt=now();audit(d,u,'logo.remove',target==='client'?'clients':'legalEntities',id,x.name+(field!=='logo'?' · '+field:''));return {[field]:null}}
  const buf=decodeData(b.data,MAX_LOGO),type=imageType(buf);
  if(!type)fail('Логотип должен быть картинкой PNG, JPG или WebP');
  const fileId=write('logos',type.ext,buf);
  x[field]={fileId,mime:type.mime,size:buf.length,updatedAt:now()};x.updatedAt=now();
  audit(d,u,'logo.upload',target==='client'?'clients':'legalEntities',id,x.name+(field!=='logo'?' · '+field:''));
  return {[field]:x[field],logo:x.logo||null};
 }

 function uploadTemplate(d,u,b){
  if(!canTemplates(d,u,str(b.type)))fail('Шаблоны загружает руководитель или сотрудник с правом «Счета и договоры: все»',403);
  const fileName=str(b.fileName).slice(0,200)||'Договор.docx';
  if(/\.doc$/i.test(fileName))fail('Старый формат .doc не поддерживается. Откройте файл в Word и сохраните как «Документ Word (*.docx)».');
  if(!/\.docx$/i.test(fileName))fail('Загрузите договор в формате Word (.docx)');
  const buf=decodeData(b.data,MAX_TEMPLATE),info=Docx.inspect(buf);
  const type=TEMPLATE_TYPES[b.type]?b.type:'contract';
  const name=str(b.name).slice(0,120)||fileName.replace(/\.docx$/i,'');
  const fileId=write('templates','.docx',buf),list=d.templates||=[];
  const t={id:'tpl_'+crypto.randomUUID(),name,type,fileName,fileId,size:buf.length,fields:info.fields,unknown:info.unknown,isDefault:!list.some(x=>!x.archivedAt&&x.type===type),legalEntityId:'',createdBy:u.id,createdAt:now(),updatedAt:now()};
  list.push(t);audit(d,u,'template.upload','templates',t.id,name);
  return publicTemplate(d,t);
 }
 function updateTemplate(d,u,id,b){
  if(!canTemplates(d,u,(d.templates||[]).find(t=>t.id===id)?.type))fail('Нет права изменять шаблоны',403);
  const t=(d.templates||[]).find(x=>x.id===id&&!x.archivedAt);if(!t)fail('Шаблон не найден',404);
  if(b.name!==undefined){const n=str(b.name).slice(0,120);if(!n)fail('Укажите название');t.name=n}
  if(b.type!==undefined){if(!TEMPLATE_TYPES[b.type])fail('Неизвестный вид документа');t.type=b.type}
  if(b.data!==undefined){const fileName=str(b.fileName)||t.fileName;if(!/\.docx$/i.test(fileName))fail('Загрузите договор в формате Word (.docx)');const buf=decodeData(b.data,MAX_TEMPLATE),info=Docx.inspect(buf);t.fileId=write('templates','.docx',buf);t.fileName=fileName;t.size=buf.length;t.fields=info.fields;t.unknown=info.unknown}
  if(b.isDefault){for(const x of d.templates)if(x.type===t.type)x.isDefault=false;t.isDefault=true}
  else if(b.isDefault===false)t.isDefault=false;
  t.updatedAt=now();audit(d,u,'template.update','templates',t.id,t.name);
  return publicTemplate(d,t);
 }
 function removeTemplate(d,u,id){
  if(!canTemplates(d,u,(d.templates||[]).find(t=>t.id===id)?.type))fail('Нет права удалять шаблоны',403);
  const t=(d.templates||[]).find(x=>x.id===id&&!x.archivedAt);if(!t)fail('Шаблон не найден',404);
  t.archivedAt=now();t.isDefault=false;audit(d,u,'template.remove','templates',t.id,t.name);
  return {ok:true};
 }
 const listTemplates=(d,type)=>(d.templates||[]).filter(t=>!t.archivedAt&&(!type||t.type===type)).map(t=>publicTemplate(d,t));
 return {setLogo,logoFile,logoDataUri,uploadTemplate,updateTemplate,removeTemplate,listTemplates,templateFile,canTemplates,TEMPLATE_TYPES,dir:root};
}
module.exports={createFiles,imageType,TEMPLATE_TYPES};
