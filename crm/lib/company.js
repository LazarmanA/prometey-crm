'use strict';
// Организация-владелец CRM: реквизиты по ИНН и БИК (сервис DaData), фирменный стиль (название, цвет, логотип),
// импорт справочников из Excel (компании-клиенты, техника, сотрудники).
const crypto=require('node:crypto');
const Access=require('./access');
const Security=require('./security');
const Sheet=require('./sheet');
const fail=(message,status=400,code)=>{throw Object.assign(new Error(message),{status,...(code?{code}:{})})};
const str=v=>String(v??'').trim();
const digits=v=>str(v).replace(/\D/g,'');
const now=()=>new Date().toISOString();
const COLOR=/^#[0-9a-f]{6}$/i;

// ---------- справочники для импорта: колонки шаблона ----------
const KINDS={
 clients:{title:'Компании-клиенты',sheet:'Клиенты',cols:[['name','Название компании*'],['inn','ИНН'],['kpp','КПП'],['legalAddress','Юридический адрес'],['phone','Телефон'],['email','E-mail'],['contact','Контактное лицо'],['note','Комментарий']],
  example:['ООО «СтройПроект»','7701234567','770101001','г. Москва, ул. Строителей, д. 1','+7 900 111-22-33','office@stroyproject.ru','Иванов Пётр, прораб','постоянный клиент']},
 equipment:{title:'Техника',sheet:'Техника',cols:[['type','Вид техники*'],['model','Модель*'],['plate','Госномер'],['ownership','Своя или наёмная'],['ownerName','Владелец (для наёмной)'],['driver','Водитель / машинист'],['saleRate','Ставка для клиента, ₽ за смену'],['purchaseRate','Закупка, ₽ за смену'],['year','Год выпуска'],['hours','Моточасы']],
  example:['Автокран','Liebherr LTM 1050','А123ВС 77','своя','','Петров А.А.','45000','','2019','6200']},
 employees:{title:'Сотрудники',sheet:'Сотрудники',cols:[['name','Имя и фамилия*'],['email','E-mail (логин)*'],['phone','Телефон'],['position','Должность'],['role','Роль']],
  example:['Ольга Петрова','olga@company.ru','+7 900 222-33-44','Менеджер по аренде','Менеджер']}
};
const norm=s=>str(s).toLowerCase().replace(/ё/g,'е').replace(/[*«»"().,:;/\\₽-]+/g,' ').replace(/\s+/g,' ').trim();
const SYNONYMS={name:['название','наименование','компания','организация','клиент','имя','фио','сотрудник','имя и фамилия'],inn:['инн'],kpp:['кпп'],legalAddress:['юридический адрес','адрес','юр адрес'],phone:['телефон','тел','phone'],email:['e mail','email','почта','электронная почта','логин'],contact:['контактное лицо','контакт'],note:['комментарий','примечание'],
 type:['вид техники','вид','тип','тип техники'],model:['модель','марка'],plate:['госномер','гос номер','номер'],ownership:['своя или наемная','принадлежность','своя наемная'],ownerName:['владелец'],driver:['водитель','машинист','водитель машинист'],saleRate:['ставка для клиента','ставка','цена','ставка продажи'],purchaseRate:['закупка','ставка закупки'],year:['год выпуска','год'],hours:['моточасы','наработка'],position:['должность'],role:['роль','права']};
function mapHeader(kind,header){
 const cols=KINDS[kind].cols,map={};
 header.forEach((h,i)=>{const n=norm(h);if(!n)return;for(const [key,label] of cols){if(map[key]!==undefined)continue;if(norm(label)===n||norm(label).startsWith(n+' ')||n.startsWith(norm(label))||(SYNONYMS[key]||[]).some(s=>n===s||n.startsWith(s+' '))){map[key]=i;return}}});
 const missing=cols.filter(([k,l])=>l.endsWith('*')&&map[k]===undefined).map(([,l])=>'«'+l.replace('*','')+'»');
 if(missing.length)fail(`В первой строке не нашли колонки ${missing.join(', ')}. Скачайте шаблон и перенесите данные в него`,400,'bad_header');
 return map;
}
const money=v=>{const s=str(v).replace(/[\s ₽руб.]/gi,'').replace(',','.');if(!s)return 0;const n=Number(s);if(!Number.isFinite(n)||n<0)throw new Error('ставка должна быть числом');return Math.round(n)};
const intOr=(v,lo,hi)=>{const s=digits(v);if(!s)return undefined;const n=Number(s);return n>=lo&&n<=hi?n:undefined};

function createCompany({env=process.env,license,files,recovery}={}){
 // ---------- DaData ----------
 const keyOf=d=>str(env.PROMETEY_DADATA_KEY)||str(d.settings?.dadataKey)||str(license?.current?.()?.policy?.dadataKey);
 const API=()=>String(env.PROMETEY_DADATA_URL||'https://suggestions.dadata.ru/suggestions/api/4_1/rs').replace(/\/+$/,'');
 async function dadata(d,kind,query){
  const key=keyOf(d);if(!key)fail('Автозаполнение не подключено: нужен бесплатный ключ сервиса DaData (dadata.ru → Личный кабинет → API-ключ). Его можно вписать в «Администрирование → Компания». Пока заполните поля вручную',409,'no_key');
  let r;try{r=await fetch(`${API()}/findById/${kind}`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json',authorization:'Token '+key},body:JSON.stringify({query,count:1}),signal:AbortSignal.timeout(8000)})}catch{fail('Сервис DaData не отвечает — проверьте интернет или заполните поля вручную',502,'lookup_down')}
  if(r.status===401||r.status===403)fail('Ключ DaData не подходит — проверьте его в «Администрирование → Компания»',409,'bad_key');
  if(!r.ok)fail('Сервис DaData вернул ошибку — заполните поля вручную',502,'lookup_down');
  const j=await r.json().catch(()=>({}));return (j.suggestions||[])[0]||null;
 }
 async function lookupInn(d,inn){
  inn=digits(inn);if(!/^\d{10}(\d{2})?$/.test(inn))fail('ИНН — 10 цифр у организации или 12 у ИП');
  const s=await dadata(d,'party',inn);if(!s)fail('Компания с таким ИНН не найдена',404,'not_found');
  const x=s.data||{},ip=x.type==='INDIVIDUAL'||inn.length===12;
  const fio=x.fio?[x.fio.surname,x.fio.name,x.fio.patronymic].filter(Boolean).join(' '):'';
  return {name:str(x.name?.full_with_opf||s.value),shortName:str(x.name?.short_with_opf||s.value),inn:str(x.inn||inn),kpp:str(x.kpp),ogrn:str(x.ogrn),address:str(x.address?.unrestricted_value||x.address?.value),
   signatoryName:str(x.management?.name||fio),signatoryPosition:str(x.management?.post)||(ip?'Индивидуальный предприниматель':'Генеральный директор'),
   status:x.state?.status==='ACTIVE'?'действующая':x.state?.status==='LIQUIDATED'?'ликвидирована':x.state?.status==='LIQUIDATING'?'ликвидируется':str(x.state?.status),okved:str(x.okved),phone:str(x.phones?.[0]?.value),email:str(x.emails?.[0]?.value)};
 }
 async function lookupBik(d,bik){
  bik=digits(bik);if(!/^\d{9}$/.test(bik))fail('БИК — 9 цифр');
  const s=await dadata(d,'bank',bik);if(!s)fail('Банк с таким БИК не найден',404,'not_found');
  const x=s.data||{};return {bankName:str(x.name?.payment||s.value),bik:str(x.bic||bik),correspondentAccount:str(x.correspondent_account),address:str(x.address?.value)};
 }

 // ---------- фирменный стиль ----------
 const entity=d=>(d.legalEntities||[])[0]||null;
 function brand(d){const b=d.settings?.brand||{},e=entity(d);return {appName:str(b.appName),color:COLOR.test(b.color||'')?b.color:'',company:str(d.settings?.companyName)||str(e?.shortName||e?.name),logoUrl:e?.logo?`/api/brand/logo?v=${encodeURIComponent(e.logo.updatedAt||e.logo.fileId)}`:''}}
 function saveBrand(d,u,b){
  if(!Access.at(Access.perms(d,u),'settings','yes'))fail('Оформление меняет руководитель',403);
  const appName=str(b.appName);if(appName.length>40||/[<>]/.test(appName))fail('Название CRM: до 40 символов, без < >');
  const color=str(b.color);if(color&&!COLOR.test(color))fail('Цвет — в формате #RRGGBB');
  d.settings||={};d.settings.brand={appName,color,updatedAt:now()};
  if(b.companyName!==undefined){const c=str(b.companyName);if(c.length>120)fail('Название компании: до 120 символов');d.settings.companyName=c}
  if(b.dadataKey!==undefined){const k=str(b.dadataKey);if(k&&!/^[0-9a-f]{40}$/i.test(k))fail('Ключ DaData — 40 символов из цифр и латинских букв a–f');d.settings.dadataKey=k}
  return {...brand(d),dadata:!!keyOf(d)};
 }
 function info(d){const k=keyOf(d);return {entity:entity(d),brand:brand(d),dadata:!!k,dadataSource:str(env.PROMETEY_DADATA_KEY)?'server':str(d.settings?.dadataKey)?'settings':k?'vendor':'',kinds:Object.fromEntries(Object.entries(KINDS).map(([k,v])=>[k,{title:v.title,columns:v.cols.map(c=>c[1])}]))}}

 // ---------- импорт из Excel ----------
 function template(kind){const k=KINDS[kind];if(!k)fail('Неизвестный справочник',404);return {buf:Sheet.writeXlsx([k.cols.map(c=>c[1]),k.example],{sheet:k.sheet}),name:`prometey-shablon-${kind}.xlsx`}}
 function importTable(d,u,kind,b,ctx={}){
  const k=KINDS[kind];if(!k)fail('Неизвестный справочник',404);
  const perm=Access.perms(d,u);
  if(kind==='employees'?!Access.at(perm,'users','yes'):!Access.at(perm,'settings','yes'))fail('Загружать справочники может руководитель',403);
  const rows=Sheet.readTable(b.data,str(b.name));if(rows.length<2)fail('В таблице нет строк с данными — заполните шаблон под заголовками');
  const map=mapHeader(kind,rows[0]);
  const get=(r,key)=>map[key]===undefined?'':str(r[map[key]]);
  const report={kind,title:k.title,total:rows.length-1,created:0,skipped:[],errors:[],links:[]};
  const stamp=now();
  for(let i=1;i<rows.length;i++){
   const r=rows[i],line=i+1;
   try{
    if(kind==='clients'){
     const name=get(r,'name');if(!name)throw new Error('нет названия компании');if(name.length>200)throw new Error('слишком длинное название');
     const inn=digits(get(r,'inn')),kpp=digits(get(r,'kpp')),email=get(r,'email');
     if(inn&&!/^\d{10}(\d{2})?$/.test(inn))throw new Error('ИНН — 10 или 12 цифр');if(kpp&&!/^\d{9}$/.test(kpp))throw new Error('КПП — 9 цифр');
     if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('неверный e-mail');
     const dup=d.clients.find(c=>!c.archivedAt&&((inn&&c.inn===inn)||norm(c.name)===norm(name)));if(dup){report.skipped.push({row:line,reason:`уже есть: ${dup.name}`});continue}
     const contact=get(r,'contact'),note=[get(r,'note'),contact&&'Контакт: '+contact].filter(Boolean).join(' · ')||'Загружено из Excel';
     const legalAddress=get(r,'legalAddress');
     d.clients.push({id:'cl_'+crypto.randomUUID(),name,inn,kpp,phone:get(r,'phone'),email,legalAddress,address:legalAddress||'—',equipmentType:'Не указан',note,ownership:'mixed',requestAt:stamp.slice(0,16),managerId:u.id,createdAt:stamp,createdBy:u.id,archivedAt:null,source:'import'});
    }
    if(kind==='equipment'){
     const type=get(r,'type'),model=get(r,'model');if(!type||!model)throw new Error('нужны вид техники и модель');
     const own=norm(get(r,'ownership'));const ownership=!own||/^(сво|собств|own|да)/.test(own)?'own':/(наем|аренд|партн|чуж|rent|нет)/.test(own)?'rented':null;if(!ownership)throw new Error('«Своя или наёмная»: напишите «своя» или «наёмная»');
     const plate=get(r,'plate').toUpperCase();
     if(plate&&d.equipment.some(e=>!e.archivedAt&&str(e.plate).toUpperCase().replace(/\s/g,'')===plate.replace(/\s/g,''))){report.skipped.push({row:line,reason:`госномер ${plate} уже есть`});continue}
     let saleRate,purchaseRate;try{saleRate=money(get(r,'saleRate'));purchaseRate=money(get(r,'purchaseRate'))}catch(e){throw new Error(e.message)}
     const x={id:'eq_'+crypto.randomUUID(),type,model,plate,ownerName:get(r,'ownerName')||(ownership==='own'?(d.settings?.companyName||''):''),partnerId:'',driver:get(r,'driver'),tracker:'',ownership,saleRate,purchaseRate,status:'available',lat:55.75,lng:37.61,createdAt:stamp,createdBy:u.id,archivedAt:null,source:'import'};
     const year=intOr(get(r,'year'),1950,2100),hours=intOr(get(r,'hours'),0,10000000);if(year)x.year=year;if(hours!==undefined)x.hours=hours;
     d.equipment.push(x);
    }
    if(kind==='employees'){
     const name=get(r,'name'),email=get(r,'email').toLowerCase();if(!name)throw new Error('нет имени');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('неверный e-mail');
     if(d.users.some(x=>String(x.email||'').toLowerCase()===email)){report.skipped.push({row:line,reason:`${email} уже есть`});continue}
     const roleText=norm(get(r,'role'));const roles=Access.roles(d).filter(x=>perm.admin||!x.admin);
     const role=roleText?roles.find(x=>norm(x.name)===roleText||norm(x.id)===roleText||norm(x.name).startsWith(roleText)):roles.find(x=>x.id==='manager')||roles[0];
     if(!role)throw new Error(`роль «${get(r,'role')}» не найдена${perm.admin?'':' или её назначает только администратор'}`);
     if(ctx.canAddUser&&!ctx.canAddUser(d.users.filter(x=>!x.disabled).length))throw new Error('по тарифу больше нет мест для сотрудников');
     const nu={id:'u_'+crypto.randomUUID(),name,email,phone:get(r,'phone'),position:get(r,'position'),departmentId:'',role:role.id,passwordHash:Security.hashPassword(crypto.randomBytes(24).toString('base64url')),mustChangePassword:false,createdAt:stamp,createdBy:u.id,source:'import'};
     d.users.push(nu);
     const link=recovery.adminLink(d,u,nu.id,ctx,{hours:7*24,quiet:true});
     report.links.push({name,email,role:role.name,url:link.url||'',link:link.link});
    }
    report.created++;
   }catch(e){report.errors.push({row:line,message:e.message})}
  }
  if(report.created)(d.audit||=[]).unshift({id:'log_'+crypto.randomUUID(),at:stamp,userId:u.id,action:'import.'+kind,entity:kind,entityId:'',details:`Загрузка из Excel «${str(b.name).slice(0,80)}»: ${report.created} добавлено, ${report.skipped.length} пропущено, ${report.errors.length} с ошибками`});
  return report;
 }
 function linksTable(report){return Sheet.writeXlsx([['Сотрудник','E-mail (логин)','Роль','Ссылка для входа (действует 7 дней)'],...report.links.map(x=>[x.name,x.email,x.role,x.url||x.link])],{sheet:'Ссылки'})}

 // ---------- организация при первой регистрации ----------
 function applyOrganization(d,owner,org,{saveLegalEntity}){
  if(!org||typeof org!=='object')return null;
  const c=org.company||{},bk=org.bank||{};
  if(!str(c.name)&&!str(c.inn))return null;
  const demo=(d.legalEntities||[]).find(e=>e.id==='le-demo');
  const values={...c,...bk,signatoryPosition:str(c.signatoryPosition)||'Генеральный директор',vatRate:c.vatRate??22};
  const e=saveLegalEntity(d,owner,values,demo?demo.id:((d.legalEntities||[])[0]?.id||undefined));
  if(demo){delete e.logo;delete e.signatureImage;delete e.stampImage}
  d.settings||={};d.settings.companyName=str(c.shortName)||str(c.name)||d.settings.companyName;
  if(org.brand)saveBrand(d,owner,{appName:org.brand.appName,color:org.brand.color});
  if(org.brand?.logo&&files)files.setLogo(d,owner,{target:'legalEntity',id:e.id,data:org.brand.logo});
  return e;
 }
 return {lookupInn,lookupBik,brand,saveBrand,info,template,importTable,linksTable,applyOrganization,keyOf,KINDS};
}
module.exports={createCompany,KINDS,mapHeader};
