// Server-only connectors. Secrets are supplied through the deployment environment.
const crypto=require('node:crypto');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
function snapshot(data){
 const companies=data.clients.filter(x=>!x.archivedAt).map(x=>({id:x.id,name:x.name,inn:x.inn||'',phone:x.phone||'',email:x.email||'',address:x.address||''}));
 const deals=data.orders.filter(x=>!x.archivedAt&&companies.some(c=>c.id===x.clientId)).map(x=>({id:x.id,number:x.number,name:x.name,companyId:x.clientId,address:x.address||'',start:x.start,end:x.end,comment:x.comment||x.note||'',equipmentType:x.equipmentType||'',ownership:x.ownership||'',items:data.orderItems.filter(i=>i.orderId===x.id&&!i.archivedAt).map(i=>({equipmentId:i.equipmentId,equipment:data.equipment.find(e=>e.id===i.equipmentId)?.model||'',start:i.start||x.start,end:i.end||x.end,quantity:i.quantity,saleRate:i.saleRate,purchaseRate:i.purchaseRate,extras:i.extras,unit:i.unit}))}));
 return {schema:'prometey.exchange.v1',companies,deals};
}
function createIntegrations({env=process.env,transport=fetch}={}){
 const previews=new Map();const logs=[];let busy=false;
 function config(provider){const raw=provider==='bitrix24'?env.BITRIX24_WEBHOOK:env.ONEC_EXCHANGE_URL;if(!raw)fail('Подключение не настроено на сервере');let u;try{u=new URL(raw)}catch{fail('Некорректный адрес подключения')};if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)fail('Укажите HTTPS-адрес без параметров и встроенного пароля');if(provider==='bitrix24'&&!/^\/rest\/\d+\/[^/]+\/$/.test(u.pathname))fail('Нужен адрес входящего вебхука Битрикс24 /rest/ID/ключ/');if(!env.PROMETEY_SOURCE_ID)fail('На сервере не указан постоянный PROMETEY_SOURCE_ID');return u.toString().replace(/\/$/,'')+'/'}
 async function request(url,body,headers={}){try{const r=await transport(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)fail('Внешняя система ответила HTTP '+r.status,502);const v=await r.json();if(v.error)fail('Внешняя система отклонила запрос. Проверьте права и настройки.',502);return v}catch(e){if(e.status)throw e;fail('Нет ответа внешней системы. Проверьте адрес и соединение.',502)}}
 async function b24(method,body){return request(config('bitrix24')+method+'.json',body)}
 async function upsert(kind,id,fields){const origin={ORIGINATOR_ID:env.PROMETEY_SOURCE_ID,ORIGIN_ID:id};const found=await b24('crm.'+kind+'.list',{filter:{'=ORIGINATOR_ID':origin.ORIGINATOR_ID,'=ORIGIN_ID':id},select:['ID']});if(!Array.isArray(found.result)||found.result.length>1)fail('Неоднозначное сопоставление записей Битрикс24',409);if(found.result.length){await b24('crm.'+kind+'.update',{id:found.result[0].ID,fields});return found.result[0].ID}const added=await b24('crm.'+kind+'.add',{fields:{...fields,...origin}});if(!added.result)fail('Битрикс24 не вернул ID записи',502);return added.result}
 return async function handle(user,method,url,body,data){
  if(!require('./access').at(user.perms||require('./access').perms(null,user),'integrations','yes'))fail('Интеграции доступны руководителю',403);
  const parts=url.pathname.split('/').filter(Boolean),provider=parts[2],action=parts[3];
  if(parts.length===2&&method==='GET')return {offline:false,providers:['bitrix24','onec'].map(id=>({id,configured:!!(id==='bitrix24'?env.BITRIX24_WEBHOOK:env.ONEC_EXCHANGE_URL)&&!!env.PROMETEY_SOURCE_ID})),logs:logs.slice(-20).reverse()};
  if(!['bitrix24','onec'].includes(provider))fail('Неизвестная интеграция',404);
  if(action==='preview'&&method==='POST'){for(const [k,v]of previews)if(v.expires<Date.now())previews.delete(k);if(previews.size>=100)previews.delete(previews.keys().next().value);const payload=snapshot(data),id=crypto.randomUUID();previews.set(id,{provider,userId:user.id,payload,expires:Date.now()+600000});return {id,payload}}
  if(action==='test'&&method==='POST'){if(provider==='bitrix24')await b24('crm.company.list',{select:['ID'],start:0});else{const r=await request(config(provider)+'health',{schema:'prometey.exchange.v1'},env.ONEC_TOKEN?{Authorization:'Bearer '+env.ONEC_TOKEN}:{});if(r.schema!=='prometey.exchange.v1'||r.ok!==true)fail('HTTP-сервис 1С не поддерживает контракт prometey.exchange.v1',502)}return {ok:true}}
  if(action==='send'&&method==='POST'){
   const plan=previews.get(body.previewId);if(!plan||plan.userId!==user.id||plan.provider!==provider||plan.expires<Date.now())fail('Сформируйте новый предварительный просмотр',409);
   if(JSON.stringify(snapshot(data))!==JSON.stringify(plan.payload))fail('Данные изменились. Обновите предварительный просмотр.',409);
   if(busy)fail('Уже выполняется обмен. Дождитесь завершения.',409);config(provider);busy=true;let completed=0;
   try{const p=plan.payload;
    if(provider==='onec'){const r=await request(config(provider)+'exchange',{...p,source:env.PROMETEY_SOURCE_ID,requestId:body.previewId},env.ONEC_TOKEN?{Authorization:'Bearer '+env.ONEC_TOKEN}:{});if(r.ok!==true||r.requestId!==body.previewId)fail('1С не подтвердила пакет. Повторите с тем же идентификатором.',502);completed=p.companies.length+p.deals.length}
    else{const ids={};for(const c of p.companies){ids[c.id]=await upsert('company',c.id,{TITLE:c.name,COMMENTS:`Прометей\nИНН: ${c.inn}\nТелефон: ${c.phone}\nEmail: ${c.email}\nАдрес: ${c.address}`});completed++}for(const d of p.deals){await upsert('deal',d.id,{TITLE:(d.number||'')+' '+d.name,COMPANY_ID:ids[d.companyId],CURRENCY_ID:'RUB',IS_MANUAL_OPPORTUNITY:'Y',OPPORTUNITY:d.items.reduce((s,i)=>s+Number(i.quantity||0)*Number(i.saleRate||0),0),COMMENTS:JSON.stringify(d,null,2)});completed++}}
    previews.delete(body.previewId);logs.push({at:new Date().toISOString(),provider,ok:true,completed});return {ok:true,completed};
   }catch(e){logs.push({at:new Date().toISOString(),provider,ok:false,completed});throw e}finally{busy=false;if(logs.length>100)logs.shift()}
  }
  fail('Неизвестная операция интеграции',404);
 }
}
module.exports={createIntegrations,snapshot};
