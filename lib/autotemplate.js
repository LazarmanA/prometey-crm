'use strict';
// Авторазметка шаблона без полей {{…}}: бланк счёта / счёта-договора / договора с пропусками «_____», «№ ___ от «__» ____ 202_ г.»,
// пустыми строками таблицы и жёлтыми пометками превращается в шаблон с полями. Текст и оформление документа сохраняются.
const decode=s=>s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,(m,e)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[e.toLowerCase()]??String.fromCodePoint(e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10))));
const encode=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const B='[_\\s\\u00a0]*';           // пропуск: подчёркивания и пробелы
const BL='(?:_{2,}|[\\s\\u00a0]{3,})';  // явный пропуск

// ——— абзацы: правки по склеенному тексту, раскладка обратно по фрагментам (оформление фрагментов сохраняется)
function editParagraphs(xml,fn){
 const out=[];let last=0;const re=/<w:p[ >][\s\S]*?<\/w:p>/g;let m;
 while((m=re.exec(xml))){
  const p=m[0];if(/<w:tbl[ >]/.test(p)){continue}
  const nodes=[];const tr=/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;let t;while((t=tr.exec(p)))nodes.push({start:t.index,end:t.index+t[0].length,text:decode(t[1])});
  const joined=nodes.map(n=>n.text).join('');const edits=fn(joined)||[];if(!edits.length||!nodes.length)continue;
  const texts=nodes.map(n=>n.text),starts=[];let acc=0;for(const s of texts){starts.push(acc);acc+=s.length}
  const at=pos=>{let i=starts.length-1;while(i>0&&starts[i]>pos)i--;return [i,pos-starts[i]]};
  for(const e of edits.sort((a,b)=>b.start-a.start)){
   if(e.start===e.end&&e.start>=joined.length){const i=texts.length-1;texts[i]+=e.text;continue}
   const [a,offA]=at(e.start),[b,offB]=at(Math.max(e.start,e.end-1));
   if(a===b)texts[a]=texts[a].slice(0,offA)+e.text+texts[a].slice(e.end>e.start?offB+1:offA);
   else{texts[a]=texts[a].slice(0,offA)+e.text;for(let i=a+1;i<b;i++)texts[i]='';texts[b]=texts[b].slice(offB+1)}
  }
  let np='',l=0;nodes.forEach((n,i)=>{if(texts[i]===n.text)return;np+=p.slice(l,n.start)+'<w:t xml:space="preserve">'+encode(texts[i]).replace(/\n/g,'</w:t><w:br/><w:t xml:space="preserve">')+'</w:t>';l=n.end});np+=p.slice(l);
  out.push({start:m.index,end:m.index+p.length,text:np});
 }
 let res='';for(const o of out){res+=xml.slice(last,o.start)+o.text;last=o.end}return res+xml.slice(last);
}
const cellText=tc=>[...tc.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m=>decode(m[1])).join('').trim();
function cellSet(tc,text){
 const run=tc.match(/<w:r[ >][\s\S]*?<\/w:r>/);const rPr=run?.[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0]||'';
 let x=tc.replace(/<w:r[ >][\s\S]*?<\/w:r>/g,'');const r=`<w:r>${rPr}<w:t xml:space="preserve">${encode(text)}</w:t></w:r>`;
 if(/<w:p[^>]*\/>/.test(x)&&!/<w:p[ >][\s\S]*?<\/w:p>/.test(x))return x.replace(/<w:p([^>]*)\/>/,`<w:p$1>${r}</w:p>`);
 return x.replace(/(<w:p[ >][\s\S]*?)(<\/w:p>)/,`$1${r}$2`);
}
// ——— таблица позиций: шапка «Товары (работы, услуги) … Сумма», первая строка — поля, пустые строки-заготовки убираются
const COLS=[['n',/^(№|n|#|№\s*п\/п)$/i],['name',/товар|наимен|работ|услуг|техник/i],['qty',/кол/i],['unit',/^ед|единиц/i],['price',/цена|тариф|ставк/i],['sum',/сумм|стоимост/i]];
const COL_FIELD={n:'{{Строка.№}}',name:'{{Строка.Наименование}}',qty:'{{Строка.Количество}}',unit:'{{Строка.Ед}}',price:'{{Строка.Цена}}',sum:'{{Строка.Сумма}}'};
const FILLER=/^(\d{1,3}|ч|час|км|смен[аы]?|рейс|услуга|шт|ед\.?|м3|м³|т|маш\.?-?ч|сутки|руб\.?|[-–—\s_.,]*)$/i;
function markTables(xml,found){
 return xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g,tbl=>{
  if(tbl.includes('{{'))return tbl;
  const rows=tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g)||[];let h=-1,map=null;
  for(let i=0;i<rows.length&&h<0;i++){const cells=(rows[i].match(/<w:tc>[\s\S]*?<\/w:tc>/g)||[]).map(cellText);const mp={};cells.forEach((c,k)=>{for(const [key,re] of COLS)if(mp[key]==null&&re.test(c)){mp[key]=k;break}});if(mp.name!=null&&mp.sum!=null){h=i;map=mp}}
  if(h<0)return tbl;
  const data=rows.slice(h+1),blank=data.filter(r=>(r.match(/<w:tc>[\s\S]*?<\/w:tc>/g)||[]).map(cellText).every(c=>FILLER.test(c)));
  if(!blank.length)return tbl;
  const first=blank[0];let k=0;const filled=first.replace(/<w:tc>[\s\S]*?<\/w:tc>/g,tc=>{const col=Object.keys(map).find(c=>map[c]===k);k++;return col?cellSet(tc,COL_FIELD[col]):cellSet(tc,'')});
  found.push('Таблица позиций');
  let out=tbl.replace(first,filled);for(const r of blank.slice(1))out=out.replace(r,'');return out;
 });
}
// ——— правила для абзацев
function markParagraphs(xml,found){
 let zone='our';
 return editParagraphs(xml,text=>{
  const edits=[],seen=(s,e,t,label)=>{if(edits.some(x=>s<x.end&&e>x.start))return;edits.push({start:s,end:e,text:t});if(label)found.push(label)};
  const each=(re,fn)=>{for(const m of text.matchAll(re))fn(m)};
  if(/^\s*(Поставщик|Исполнитель|Арендодатель|Продавец)/i.test(text))zone='our';
  if(/^\s*(Покупатель|Заказчик|Плательщик|Арендатор)/i.test(text))zone='client';
  if(text.includes('{{'))return [];
  // № ___ от «__» _______ 202_ г.
  each(new RegExp('№'+B+'_{2,}'+B+'от'+B+'[«"]'+B+'[»"]'+B+'_*'+B+'(?:2\\d{0,3})?'+B+'г\\.?','g'),m=>seen(m.index,m.index+m[0].length,'№ {{Документ.Номер}} от {{Документ.ДатаТекстом}}','Номер и дата'));
  each(new RegExp('№'+B+'_{2,}','g'),m=>seen(m.index,m.index+m[0].length,'№ {{Документ.Номер}}','Номер'));
  each(new RegExp('от'+B+'[«"]'+B+'[»"]'+B+'_+'+B+'(?:2\\d{0,3})?'+B+'г\\.?','g'),m=>seen(m.index,m.index+m[0].length,'от {{Документ.ДатаТекстом}}','Дата'));
  each(/от\s*_{1,3}\.\s*_{1,3}\.\s*_{2,4}(\s*г\.?)?/g,m=>seen(m.index,m.index+m[0].length,'от {{Документ.Дата}}','Дата'));
  // стороны
  const party=text.match(new RegExp('^(\\s*(?:Покупатель|Заказчик|Плательщик|Арендатор)[^:]{0,30}:)'+B+'$','i'));if(party)seen(party[1].length,text.length,' {{Клиент.Реквизиты}}','Реквизиты заказчика');
  const addr=text.match(new RegExp('^(\\s*(?:Юридический\\s+)?Адрес\\s*:)'+B+'$','i'));if(addr)seen(addr[1].length,text.length,' {{'+(zone==='client'?'Клиент':'Наша')+'.Адрес}}','Адрес');
  each(new RegExp('(Телефон|Тел\\.)\\s*:'+B+'(?=,|;|$)','gi'),m=>{const lab=m[0].match(/^[^:]*:/)[0];seen(m.index,m.index+m[0].length,lab+' {{'+(zone==='client'?'Клиент':'Наша')+'.Телефон}}','Телефон')});
  each(new RegExp('(e-?mail|эл\\.\\s*почта)\\s*:'+B+'(?=,|;|$)','gi'),m=>{const lab=m[0].match(/^[^:]*:/)[0];seen(m.index,m.index+m[0].length,lab+' {{'+(zone==='client'?'Клиент':'Наша')+'.Email}}','E-mail')});
  // итоги
  each(new RegExp('В\\s+том\\s+числе\\s+НДС[^:]{0,12}:'+B+'(?=$|Всего|Итого)','gi'),m=>seen(m.index,m.index+m[0].length,'{{НДС.Итог}} ','НДС'));
  each(new RegExp('Итого\\s*:'+B+'(?=$|В\\s+том|Всего)','gi'),m=>seen(m.index,m.index+m[0].length,'Итого: {{Сумма}} ','Итого'));
  each(new RegExp('Всего\\s+к\\s+оплате\\s*:'+B+'(?=$|Всего\\s+наимен)','gi'),m=>{const tail=/Всего\s+наимен/i.test(text.slice(m.index+m[0].length));seen(m.index,m.index+m[0].length,'Всего к оплате: {{Сумма}}'+(tail?'\n':''),'Всего к оплате')});
  each(new RegExp('наименований'+B+'_+','gi'),m=>seen(m.index,m.index+m[0].length,'наименований {{Позиций}}','Количество позиций'));
  each(new RegExp('на\\s+сумму'+B+'_+','gi'),m=>seen(m.index,m.index+m[0].length,'на сумму {{Сумма}}','Сумма'));
  if(/^\s*Сумма\s+прописью\s*(:?\s*_*|рублей\s*0{2}\s*копеек)?\s*$/i.test(text))seen(0,text.length,'{{СуммаПрописью}}','Сумма прописью');
  else each(new RegExp('Сумма\\s+прописью\\s*:'+B,'gi'),m=>seen(m.index,m.index+m[0].length,'Сумма прописью: {{СуммаПрописью}}','Сумма прописью'));
  each(new RegExp('(Оплатить\\s+не\\s+позднее|Срок\\s+оплаты\\s*:?)'+B+'$','gi'),m=>seen(m.index,m.index+m[0].length,m[1]+' {{СрокОплаты}}','Срок оплаты'));
  // подпись и печать
  each(/((?:Генеральный\s+)?(?:директор|Руководитель|Исполнитель|Поставщик|ИП)[^_]{0,40}?)(_{5,})/gi,m=>seen(m.index+m[1].length,m.index+m[0].length,'{{Подпись}}','Подпись'));
  if(/^\s*М\.?\s*П\.?\s*$/.test(text))seen(text.length,text.length,' {{Печать}}','Печать');
  return edits;
 });
}
function markup(xml){
 const found=[];
 let out=markTables(xml,found);out=markParagraphs(out,found);
 // жёлтые пометки «заполнить здесь» больше не нужны
 out=out.replace(/<w:highlight w:val="yellow"\/>/g,'');
 const left=[];for(const g of out.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)){const t=[...g[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m=>decode(m[1])).join('');if(/_{3,}/.test(t)&&!t.includes('{{'))left.push(t.replace(/\s+/g,' ').trim().slice(0,90))}
 return {xml:out,found:[...new Set(found)],left};
}
module.exports={markup};
