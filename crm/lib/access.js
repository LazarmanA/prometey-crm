/* Права доступа: роли с матрицей прав (как в Битрикс24). Общий код для сервера и автономной демо-версии. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PrometeyAccess=factory()})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
// Описание прав для экрана «Роли и права». Уровни перечислены от меньшего к большему.
const SCHEMA=[
 {key:'crm',label:'CRM: лиды, компании, объекты, сделки, смены',levels:[['none','Нет доступа'],['own','Только свои'],['read','Видит все, меняет свои'],['all','Все записи']]},
 {key:'equipment',label:'Собственный парк техники (добавление и изменение)',levels:[['no','Нет'],['yes','Да']]},
 {key:'finance',label:'Финансы и прибыль',levels:[['none','Нет доступа'],['own','По своим сделкам'],['all','По всей компании']]},
 {key:'documents',label:'Счета и договоры',levels:[['none','Нет доступа'],['own','Свои и по своим сделкам'],['all','Все документы']]},
 {key:'accounting',label:'Бухгалтерия: проверка работ, реализации, оплаты, ЭДО',levels:[['none','Нет доступа'],['read','Просмотр и отчёты'],['edit','Полный доступ']]},
 {key:'feed',label:'Лента',levels:[['read','Читать и комментировать'],['post','Публиковать'],['moderate','Модерировать (закреплять, удалять чужое)']]},
 {key:'telephony',label:'Телефония (настройка шлюзов)',levels:[['no','Нет'],['yes','Да']]},
 {key:'integrations',label:'Интеграции 1С и Битрикс24',levels:[['no','Нет'],['yes','Да']]},
 {key:'audit',label:'Журнал действий',levels:[['no','Нет'],['yes','Да']]},
 {key:'settings',label:'Настройки CRM, реквизиты, модули',levels:[['no','Нет'],['yes','Да']]},
 {key:'users',label:'Сотрудники, отделы и роли',levels:[['no','Нет'],['yes','Да']]}
];
const FULL=Object.fromEntries(SCHEMA.map(s=>[s.key,s.levels.at(-1)[0]]));
const NONE=Object.fromEntries(SCHEMA.map(s=>[s.key,s.levels[0][0]]));
const PRESETS={
 director:{id:'director',name:'Руководитель',system:true,admin:true,permissions:{...FULL}},
 manager:{id:'manager',name:'Менеджер',system:true,admin:false,permissions:{...NONE,crm:'own',finance:'own',documents:'own',feed:'post'}},
 head:{id:'head',name:'Руководитель отдела (РОП)',system:true,admin:false,permissions:{...NONE,crm:'all',equipment:'yes',finance:'all',documents:'all',accounting:'read',feed:'moderate',audit:'yes'}},
 accountant:{id:'accountant',name:'Бухгалтер',system:true,admin:false,permissions:{...NONE,crm:'read',finance:'all',documents:'all',accounting:'edit',feed:'post'}}
};
function normalize(p){const out={};for(const s of SCHEMA){const v=p&&p[s.key];out[s.key]=s.levels.some(l=>l[0]===v)?v:s.levels[0][0]}return out}
function roleOf(data,user){if(!user)return null;const custom=(data&&data.roles||[]).find(r=>r.id===user.role);return custom||PRESETS[user.role]||PRESETS.manager}
// Итоговые права пользователя. Администратор (системная роль «Руководитель») получает всё.
// Руководитель отдела (назначен в «Отделах») видит и ведёт все сделки, документы и финансы — как руководящий состав.
const LEAD_MIN={crm:'all',finance:'all',documents:'all'};
function perms(data,user){const role=roleOf(data,user);if(!role)return {...NONE,admin:false,roleName:''};if(role.admin)return {...FULL,admin:true,roleName:role.name};
 const p={...normalize(role.permissions),admin:false,roleName:role.name};
 if((data&&data.departments||[]).some(dep=>dep.headId===user.id&&!dep.archivedAt)){for(const [k,v] of Object.entries(LEAD_MIN))if(rank(k,p[k])<rank(k,v))p[k]=v;p.departmentHead=true}
 return p}
const rank=(key,level)=>{const s=SCHEMA.find(x=>x.key===key);return s?s.levels.findIndex(l=>l[0]===level):-1};
// at(p,'crm','read') — уровень не ниже указанного.
function at(p,key,level){return !!p&&(p.admin||rank(key,p[key])>=rank(key,level))}
function roles(data){const custom=(data&&data.roles)||[];return [...Object.values(PRESETS).filter(r=>!custom.some(c=>c.id===r.id)),...custom]}
return {SCHEMA,PRESETS,FULL,NONE,normalize,roleOf,perms,at,roles};
});
