(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PrometeyContacts=factory()})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
const MAX=5000;
const fields=['inn','name','phone','note'],headers=['ИНН','Название','Телефон','Комментарий'];
const extra=['email','kpp','legalAddress','contact'];
const aliases={inn:['инн','inn'],name:['название','наименование','компания','name','company','title'],phone:['телефон','phone','телефоны'],note:['комментарий','комментарии','note','comment','comments']};
const clean=s=>String(s??'').replace(/^'(?='|\s*[=+@-])/,'').trim();
function table(text){text=String(text).replace(/^\uFEFF/,'');if(text.length>15728640)throw Error('Файл больше 15 МБ');const first=text.split(/\r?\n/)[0],delim=first.includes(';')?';':first.includes('\t')?'\t':',';let rows=[],row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=c;continue}if(c==='"'){if(cell||closed)throw Error('Некорректные кавычки в CSV');quoted=true}else if(c===delim){row.push(cell);cell='';closed=false}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';closed=false}else{if(closed)throw Error('Лишние символы после кавычек CSV');cell+=c}}
 if(quoted)throw Error('Незакрытые кавычки CSV');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);if(rows.length<1)throw Error('Файл пуст');return rows}
function parse(text){const rows=table(text);const cols=rows.shift().map(s=>s.trim().toLowerCase());const mapping=fields.map(f=>{const matches=cols.map((s,i)=>aliases[f].includes(s)?i:-1).filter(i=>i>=0);if(matches.length>1)throw Error('Повторяется столбец '+headers[fields.indexOf(f)]);return matches[0]??-1});if(mapping[1]<0)throw Error('Нужен столбец «Название». Скачайте шаблон CSV.');if(rows.length>MAX)throw Error('Не более '+MAX+' контактов за одну загрузку — разделите файл');if(!rows.length)throw Error('Нет строк с контактами');return rows.map((r,i)=>{if(r.length!==cols.length)throw Error('Неверное число столбцов в записи '+(i+2));return Object.fromEntries(fields.map((f,j)=>[f,mapping[j]<0?'':clean(r[mapping[j]])]))})}
function csv(rows){const quote=v=>{let s=String(v??'');if(/^(?:'|[\s]*[=+@-])/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};return '\uFEFF'+[headers,...rows.map(r=>fields.map(f=>r[f]||''))].map(r=>r.map(quote).join(';')).join('\r\n')+'\r\n'}
function plan(rows,existing){if(!Array.isArray(rows)||!rows.length||rows.length>MAX)throw Error('Загрузите от 1 до '+MAX+' контактов');const candidates=existing.map(x=>({...x}));return rows.map((row,index)=>{const c=Object.fromEntries([...fields,...extra].map(f=>[f,String(row?.[f]??'').trim().slice(0,f==='note'?8000:300)]));if(c.kpp&&!/^\d{9}$/.test(c.kpp))c.kpp='';for(const f of extra)if(!c[f])delete c[f];const error=!c.name?'Не указано название':c.name.length>200?'Название длиннее 200 символов':c.inn&&!/^\d{10}(\d{2})?$/.test(c.inn)?'ИНН должен содержать 10 или 12 цифр':c.phone.length>200?'Телефон длиннее 200 символов':c.note.length>8000?'Комментарий длиннее 8000 символов':'';if(error)return {row:index+2,status:'error',reason:error,contact:c};const digits=s=>String(s||'').replace(/\D/g,''),norm=s=>String(s||'').toLocaleLowerCase('ru').replace(/ё/g,'е').trim();const phones=v=>String(v||'').split(/[,;\n]|\s{2,}/).map(p=>digits(p)).filter(p=>p.length>=10).map(p=>p.slice(-10));const mine=phones(c.phone);const duplicate=candidates.some(x=>(c.inn&&x.inn===c.inn)||(norm(c.name)===norm(x.name)&&(!c.inn||!x.inn)&&(!mine.length||!phones(x.phone).length||phones(x.phone).some(p=>mine.includes(p)))));if(!duplicate)candidates.push(c);return {row:index+2,status:duplicate?'skip':'create',reason:duplicate?'Уже есть: тот же ИНН или то же название с тем же телефоном — пропуск':'Новый контакт',contact:c}})}

// Таблица из любой CRM (Битрикс24, amoCRM, 1С, своя): первая строка — заголовки. Колонки узнаём по смыслу,
// все телефоны и e-mail собираем в одно поле, ИНН или телефон в комментарии переносим на место.
function mapTable(table){if(!Array.isArray(table)||table.length<2)throw Error('В файле нет строк с данными');if(table.length>MAX+1)throw Error('Не более '+MAX+' контактов за одну загрузку — разделите файл');
 const h=table[0].map(x=>String(x??'').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[*«»"]/g,'').replace(/\s+/g,' ').trim());
 const find=(...tests)=>{for(const t of tests){const i=h.findIndex(x=>typeof t==='string'?x===t:t.test(x));if(i>=0)return i}return -1};
 const all=re=>h.map((x,i)=>re.test(x)?i:-1).filter(i=>i>=0);
 const col={name:find('название компании','название','наименование','наименование организации','компания','организация','контрагент','клиент','полное наименование','фио','имя',/^назв/,/наименован/),inn:find('инн',/(^|\s)инн(\s|$)/,'inn'),kpp:find('кпп',/(^|\s)кпп(\s|$)/),
  address:find('юридический адрес','адрес','фактический адрес','адрес компании',/адрес/),contact:find('контактное лицо','контакт','основной контакт',/контактн/),note:find('комментарий','комментарии','примечание','описание','note','comment')};
 const phoneCols=all(/телефон|phone|^тел\.?$|мобильн/).filter(i=>!/рассыл/.test(h[i])||true),mailCols=all(/e-?mail|почта|email/);
 if(col.name<0)throw Error('Не нашли колонку с названием компании. Назовите её «Название»');
 const cell=(r,i)=>i<0?'':clean(r[i]);const uniq=a=>[...new Set(a.filter(Boolean))];
 const normPhone=v=>{let s=String(v).trim();const d=s.replace(/\D/g,'');if(/^\d+(\.0+)?(e\+?\d+)?$/i.test(s)&&d.length>=10){const n=Number(s);if(Number.isFinite(n))s=String(Math.round(n))}return s};
 const rows=[];for(const r of table.slice(1)){const name=cell(r,col.name);if(!name&&!phoneCols.some(i=>cell(r,i)))continue;
  let inn=cell(r,col.inn).replace(/\D/g,''),note=cell(r,col.note),title=name;
  const inName=/,?\s*ИНН[:\s]*(\d{10}|\d{12})\b/i.exec(title);if(inName){if(!inn)inn=inName[1];title=title.replace(inName[0],'').trim()}const phones=phoneCols.map(i=>normPhone(cell(r,i)));
  const nd=note.replace(/[\s()+-]/g,'');
  if(/^\d+$/.test(nd)){if(!inn&&(nd.length===10||nd.length===12)&&!/^[78]9\d{8}$/.test(nd)){inn=nd;note=''}else if(nd.length===11&&/^[78]/.test(nd)||nd.length===10&&/^9/.test(nd)){phones.push(note);note=''}}
  const contact=cell(r,col.contact);
  rows.push({name:title||phones.find(Boolean)||'',inn,kpp:cell(r,col.kpp).replace(/\D/g,''),phone:uniq(phones).join(', '),email:uniq(mailCols.map(i=>cell(r,i))).join(', '),legalAddress:cell(r,col.address),contact,note:[note,contact&&'Контакт: '+contact].filter(Boolean).join(' · ')})}
 if(!rows.length)throw Error('В файле нет строк с данными');if(rows.length>MAX)throw Error('Не более '+MAX+' контактов за одну загрузку — разделите файл');
 const label=i=>i<0?'':table[0][i];
 return {rows,columns:{name:label(col.name),inn:label(col.inn),kpp:label(col.kpp),phone:phoneCols.map(label),email:mailCols.map(label),address:label(col.address),note:label(col.note),contact:label(col.contact)},total:rows.length}}
return {parse,table,csv,plan,mapTable,MAX};
});
