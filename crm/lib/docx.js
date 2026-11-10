'use strict';
// Свои шаблоны договоров в Word (.docx): поля вида {{Клиент.Наименование}} заменяются данными сделки.
// Строка таблицы, в которой есть поля {{Строка.…}}, повторяется для каждой позиции (техника, услуги).
const {readZip,writeZip}=require('./zip');
const W=require('./words');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const money=n=>new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0);
const UNITS={shift:'смена',hour:'час',trip:'рейс',unit:'ед.',day:'сутки',machine_hour:'маш.-ч',km:'км',ton:'тонна',m3:'м³'};
const unitName=u=>UNITS[u]||String(u||'').replace(/^custom:/,'');

// Поля, доступные в шаблоне (порядок = порядок в подсказке).
const FIELDS=[
 ['Документ',[
  ['Договор.Номер','Номер договора',c=>c.doc.number],
  ['Договор.Дата','Дата договора: 30.10.2026',c=>W.dateRu(c.doc.date)],
  ['Договор.ДатаТекстом','Дата: «30» октября 2026 г.',c=>W.dateText(c.doc.date)],
  ['Документ.Номер','Номер документа — счёта, договора, договора-счёта',c=>c.doc.number],
  ['Документ.Дата','Дата документа: 30.10.2026',c=>W.dateRu(c.doc.date)],
  ['Документ.ДатаТекстом','Дата документа: «30» октября 2026 г.',c=>W.dateText(c.doc.date)],
 ]],
 ['Наша организация (исполнитель)',[
  ['Наша.Наименование','Полное наименование',c=>c.entity.name],
  ['Наша.КраткоеНаименование','Короткое название',c=>c.entity.shortName||c.entity.name],
  ['Наша.ИНН','ИНН',c=>c.entity.inn],
  ['Наша.КПП','КПП',c=>c.entity.kpp],
  ['Наша.Адрес','Юридический адрес',c=>c.entity.address],
  ['Наша.РасчетныйСчет','Расчётный счёт',c=>c.entity.bankAccount],
  ['Наша.Банк','Банк',c=>c.entity.bankName],
  ['Наша.БИК','БИК',c=>c.entity.bik],
  ['Наша.КоррСчет','Корр. счёт',c=>c.entity.correspondentAccount],
  ['Наша.Подписант','Подписант: Иванов Иван Иванович',c=>c.entity.signatoryName],
  ['Наша.ПодписантКратко','Подписант: Иванов И.И.',c=>W.initials(c.entity.signatoryName)],
  ['Наша.Должность','Должность подписанта',c=>c.entity.signatoryPosition],
 ]],
 ['Клиент (заказчик)',[
  ['Клиент.Наименование','Название компании',c=>c.client.name],
  ['Клиент.ИНН','ИНН',c=>c.client.inn],
  ['Клиент.КПП','КПП',c=>c.client.kpp],
  ['Клиент.Адрес','Юридический адрес',c=>c.client.legalAddress||c.client.address],
  ['Клиент.Телефон','Телефон',c=>c.client.phone],
  ['Клиент.Email','E-mail',c=>c.client.email],
 ]],
 ['Сделка',[
  ['Сделка.Номер','Номер сделки',c=>c.order.number],
  ['Сделка.Название','Название сделки',c=>c.order.name],
  ['Объект.Название','Объект',c=>c.object.name||c.order.address],
  ['Объект.Адрес','Адрес объекта',c=>c.object.address||c.order.address],
  ['Период.Начало','Начало работ',c=>W.dateRu(c.order.start)],
  ['Период.Окончание','Окончание работ',c=>W.dateRu(c.order.end)],
  ['Техника','Перечень техники через запятую',c=>[...new Set(c.items.map(i=>i.description))].join(', ')],
 ]],
 ['Суммы',[
  ['Сумма','Итого: 125 400,00',c=>money(c.totals.totalGross)],
  ['СуммаПрописью','Итого прописью',c=>W.rublesInWords(c.totals.totalGross)],
  ['СуммаБезНДС','Сумма без НДС',c=>money(c.totals.totalNet)],
  ['НДС','Сумма НДС',c=>money(c.totals.vatTotal)],
  ['СтавкаНДС','Ставка НДС: 22%',c=>c.totals.vatRate?c.totals.vatRate+'%':'Без НДС'],
 ]],
 ['Подпись и печать (картинки из «Администрирование → Компания»)',[
  ['Подпись','Факсимиле подписи руководителя',()=>IMG('signature')],
  ['Печать','Печать организации (ставится поверх текста рядом)',()=>IMG('stamp')],
  ['Логотип','Логотип организации',()=>IMG('logo')],
 ]],
 ['Строка таблицы (повторяется для каждой позиции)',[
  ['Строка.№','Номер строки',(c,i,n)=>String(n+1)],
  ['Строка.Наименование','Наименование',(c,i)=>i.description],
  ['Строка.Количество','Количество',(c,i)=>String(i.quantity).replace('.',',')],
  ['Строка.Ед','Единица',(c,i)=>unitName(i.unit)],
  ['Строка.Цена','Цена',(c,i)=>money(i.rate)],
  ['Строка.Сумма','Сумма',(c,i)=>money(i.gross)],
 ]],
];
// Картинки: в тексте ставится метка, потом она заменяется рисунком Word.
const IMG=k=>'\u27e6IMG:'+k+'\u27e7';
const IMG_RE=/\u27e6IMG:(signature|stamp|logo)\u27e7/g;
const EMU=9525; // 1 px (96 dpi) в EMU
function imageSize(buf){
 if(buf.length>24&&buf.readUInt32BE(0)===0x89504e47)return {w:buf.readUInt32BE(16),h:buf.readUInt32BE(20),ext:'png',mime:'image/png'};
 if(buf[0]===0xff&&buf[1]===0xd8){let i=2;while(i+9<buf.length){if(buf[i]!==0xff){i++;continue}const m=buf[i+1],len=buf.readUInt16BE(i+2);if(m>=0xc0&&m<=0xcf&&![0xc4,0xc8,0xcc].includes(m))return {h:buf.readUInt16BE(i+5),w:buf.readUInt16BE(i+7),ext:'jpeg',mime:'image/jpeg'};i+=2+len}}
 return null;
}
// высота на листе: подпись 1,4 см, печать 4 см, логотип 1,6 см
const IMG_H={signature:1.4,stamp:4,logo:1.6};
function drawingXml(kind,img,rid,n){
 const cy=Math.round(IMG_H[kind]*360000),cx=Math.round(cy*img.w/Math.max(1,img.h));
 const graphic=`<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="${kind}.${img.ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
 const WP='xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
 if(kind!=='stamp')return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" ${WP}><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="${kind}"/><wp:cNvGraphicFramePr/>${graphic}</wp:inline></w:drawing>`;
 // печать — поверх текста, сдвинута влево-вверх от места метки, как ставят рукой
 return `<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1" ${WP}><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="character"><wp:posOffset>${-Math.round(cx*0.2)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="line"><wp:posOffset>${-Math.round(cy*0.4)}</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${n}" name="${kind}"/><wp:cNvGraphicFramePr/>${graphic}</wp:anchor></w:drawing>`;
}
// Метки картинок → рисунки (только в теле документа; в колонтитулах — пусто)
function placeImages(files,out,images){
 const used=new Map();let n=7100;
 for(const [name,data] of out){
  if(!PARTS.test(name))continue;let xml=data.toString('utf8');if(!xml.includes('\u27e6IMG:'))continue;
  const body=name==='word/document.xml';
  xml=xml.replace(/<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g,(m,attr,text)=>{if(!text.includes('\u27e6IMG:'))return m;
   return '<w:t xml:space="preserve">'+text.replace(IMG_RE,(x,kind)=>{const img=images?.[kind];
    if(!img||!body)return kind==='signature'?'____________':'';
    if(!used.has(kind))used.set(kind,{rid:'rIdPrm'+kind,file:'media/prometey-'+kind+'.'+img.ext,img});
    return '</w:t>'+drawingXml(kind,img,used.get(kind).rid,n++)+'<w:t xml:space="preserve">'})+'</w:t>'});
  out.set(name,Buffer.from(xml,'utf8'));
 }
 if(!used.size)return;
 const relsName='word/_rels/document.xml.rels';
 let rels=(out.get(relsName)||Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>')).toString('utf8');
 let types=(out.get('[Content_Types].xml')||Buffer.from('')).toString('utf8');
 for(const {rid,file,img} of used.values()){
  out.set('word/'+file,img.buf);
  rels=rels.replace(new RegExp('<Relationship[^>]*Id="'+rid+'"[^>]*/>','g'),'').replace('</Relationships>',`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${file}"/></Relationships>`);
  if(types&&!new RegExp('Extension="'+img.ext+'"','i').test(types))types=types.replace('</Types>',`<Default Extension="${img.ext}" ContentType="${img.mime}"/></Types>`);
 }
 out.set(relsName,Buffer.from(rels,'utf8'));if(types)out.set('[Content_Types].xml',Buffer.from(types,'utf8'));
}
const norm=s=>String(s).toLowerCase().replace(/ё/g,'е').replace(/[\s_]/g,'');
const INDEX=new Map();for(const [,list] of FIELDS)for(const [key,,get] of list)INDEX.set(norm(key),{key,get,row:key.startsWith('Строка.')});
for(const [alias,key] of [['Факсимиле','Подпись'],['МП','Печать'],['М.П.','Печать'],['Счёт.Номер','Документ.Номер'],['Счет.Номер','Документ.Номер'],['Счёт.Дата','Документ.Дата'],['Счет.Дата','Документ.Дата'],['Счёт.ДатаТекстом','Документ.ДатаТекстом'],['Счет.ДатаТекстом','Документ.ДатаТекстом']])INDEX.set(norm(alias),INDEX.get(norm(key)));
const fieldList=()=>FIELDS.map(([group,list])=>({group,fields:list.map(([key,label])=>({key,label,code:'{{'+key+'}}'}))}));

const decode=s=>s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,(m,e)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[e.toLowerCase()]??String.fromCodePoint(e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10))));
const encode=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
const PLACEHOLDER=/\{\{\s*([^{}]{1,80}?)\s*\}\}/g;

// Обход текста абзацев: Word режет «{{Клиент.ИНН}}» на несколько фрагментов — склеиваем по абзацу.
function paragraphs(xml){
 const re=/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<\/w:p>/g,nodes=[];let m,para=0;
 while((m=re.exec(xml))){if(m[0]==='</w:p>'){para++;continue}nodes.push({start:m.index,end:m.index+m[0].length,text:decode(m[1]),para})}
 const groups=new Map();for(const n of nodes){if(!groups.has(n.para))groups.set(n.para,[]);groups.get(n.para).push(n)}
 return {nodes,groups:[...groups.values()]};
}
function scanXml(xml){const out=[];for(const g of paragraphs(xml).groups){const text=g.map(n=>n.text).join('');for(const m of text.matchAll(PLACEHOLDER))out.push(m[1])}return out}
function fillXml(xml,resolve){
 const {nodes,groups}=paragraphs(xml);let touched=false;
 for(const g of groups){
  const texts=g.map(n=>n.text),joined=texts.join('');if(!joined.includes('{{'))continue;
  const starts=[];let acc=0;for(const t of texts){starts.push(acc);acc+=t.length}
  const at=pos=>{let i=starts.length-1;while(i>0&&starts[i]>pos)i--;return [i,pos-starts[i]]};
  const matches=[...joined.matchAll(PLACEHOLDER)].reverse();
  for(const m of matches){const value=resolve(m[1]);if(value===undefined)continue;touched=true;
   const [a,offA]=at(m.index),[b,offB]=at(m.index+m[0].length-1);
   const rep=String(value??'');
   if(a===b)texts[a]=texts[a].slice(0,offA)+rep+texts[a].slice(offB+1);
   else{texts[a]=texts[a].slice(0,offA)+rep;for(let i=a+1;i<b;i++)texts[i]='';texts[b]=texts[b].slice(offB+1)}
  }
  g.forEach((n,i)=>{n.next=texts[i]});
 }
 if(!touched)return xml;
 let out='',last=0;
 for(const n of nodes){if(n.next===undefined||n.next===n.text)continue;out+=xml.slice(last,n.start)+'<w:t xml:space="preserve">'+encode(n.next).replace(/\r?\n/g,'</w:t><w:br/><w:t xml:space="preserve">')+'</w:t>';last=n.end}
 return out+xml.slice(last);
}
function repeatRows(xml,items,rowValue){
 return xml.replace(/<w:tr[ >](?:(?!<w:tr[ >])[\s\S])*?<\/w:tr>/g,row=>{
  const names=scanXml(row);if(!names.some(n=>INDEX.get(norm(n))?.row))return row;
  return items.map((item,i)=>fillXml(row,name=>{const f=INDEX.get(norm(name));return f?.row?rowValue(f,item,i):undefined})).join('');
 });
}
const PARTS=/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

function inspect(buffer){
 const files=readZip(buffer);if(!files.has('word/document.xml'))fail('Это не документ Word (.docx). Сохраните договор в Word как «Документ Word (*.docx)» и загрузите снова.');
 const found=new Set(),unknown=new Set();
 for(const [name,data] of files)if(PARTS.test(name))for(const f of scanXml(data.toString('utf8'))){const x=INDEX.get(norm(f));if(x)found.add(x.key);else unknown.add(f)}
 return {fields:[...found],unknown:[...unknown]};
}

// ctx: {doc, entity, client, order, object, items, totals}
function fill(buffer,ctx){
 const files=readZip(buffer),out=new Map();
 const value=(f,item,i)=>{try{return String(f.get(ctx,item,i)??'')}catch{return ''}};
 for(const [name,data] of files){
  if(!PARTS.test(name)){out.set(name,data);continue}
  let xml=data.toString('utf8');
  xml=repeatRows(xml,ctx.items,(f,item,i)=>value(f,item,i));
  xml=fillXml(xml,n=>{const f=INDEX.get(norm(n));if(!f)return undefined;return f.row?'':value(f)});
  out.set(name,Buffer.from(xml,'utf8'));
 }
 placeImages(files,out,ctx.images);
 return writeZip(out);
}

// Образец шаблона со всеми полями — его можно открыть в Word, поправить текст и загрузить обратно.
function sample(){
 const p=(text,{bold=false,size=0,center=false}={})=>`<w:p>${center?'<w:pPr><w:jc w:val="center"/></w:pPr>':''}<w:r>${bold||size?`<w:rPr>${bold?'<w:b/>':''}${size?`<w:sz w:val="${size}"/>`:''}</w:rPr>`:''}<w:t xml:space="preserve">${encode(text)}</w:t></w:r></w:p>`;
 const WIDTHS=[500,4300,1000,900,1450,1500];const cell=(text,bold=false,i=0)=>`<w:tc><w:tcPr><w:tcW w:w="${WIDTHS[i]}" w:type="dxa"/></w:tcPr>${p(text,{bold})}</w:tc>`;
 const border='<w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(s=>`<w:${s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('')+'</w:tblBorders>';
 const table=`<w:tbl><w:tblPr><w:tblW w:w="9650" w:type="dxa"/><w:tblLayout w:type="fixed"/>${border}</w:tblPr><w:tblGrid>${WIDTHS.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid><w:tr>${['№','Наименование','Кол-во','Ед.','Цена','Сумма'].map((t,i)=>cell(t,true,i)).join('')}</w:tr><w:tr>${['{{Строка.№}}','{{Строка.Наименование}}','{{Строка.Количество}}','{{Строка.Ед}}','{{Строка.Цена}}','{{Строка.Сумма}}'].map((t,i)=>cell(t,false,i)).join('')}</w:tr></w:tbl>`;
 const body=[
  p('ДОГОВОР № {{Договор.Номер}}',{bold:true,size:32,center:true}),
  p('оказания услуг строительной техники',{center:true}),
  p('{{Договор.ДатаТекстом}}'),
  p('{{Наша.Наименование}}, ИНН {{Наша.ИНН}}, в лице {{Наша.Должность}} {{Наша.Подписант}} (Исполнитель), и {{Клиент.Наименование}}, ИНН {{Клиент.ИНН}} (Заказчик), заключили настоящий договор о нижеследующем.'),
  p('1. Предмет договора',{bold:true}),
  p('Исполнитель предоставляет технику ({{Техника}}) на объекте «{{Объект.Название}}» по адресу: {{Объект.Адрес}} в период с {{Период.Начало}} по {{Период.Окончание}}.'),
  p('2. Стоимость',{bold:true}),
  table,
  p('Итого: {{Сумма}} руб. ({{СуммаПрописью}}), в том числе НДС {{СтавкаНДС}} — {{НДС}} руб.'),
  p('3. Реквизиты сторон',{bold:true}),
  p('Исполнитель: {{Наша.Наименование}}, ИНН {{Наша.ИНН}}, КПП {{Наша.КПП}}, {{Наша.Адрес}}, р/с {{Наша.РасчетныйСчет}} в {{Наша.Банк}}, БИК {{Наша.БИК}}, к/с {{Наша.КоррСчет}}'),
  p('Заказчик: {{Клиент.Наименование}}, ИНН {{Клиент.ИНН}}, КПП {{Клиент.КПП}}, {{Клиент.Адрес}}, тел. {{Клиент.Телефон}}'),
  p(''),
  p('Исполнитель {{Подпись}}{{Печать}} / {{Наша.ПодписантКратко}} /          Заказчик ____________'),
 ].join('');
 const doc=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1418" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
 const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;
 return writeZip(new Map([
  ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'],
  ['_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
  ['word/_rels/document.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
  ['word/document.xml',doc],['word/styles.xml',styles],
 ]));
}
// Образец счёта на оплату: банковский блок, поставщик/покупатель, таблица, итоги, подписи
function sampleInvoice(){
 const enc=t=>encode(t);
 const run=(t,{b,sz}={})=>`<w:r>${b||sz?`<w:rPr>${b?'<w:b/>':''}${sz?`<w:sz w:val="${sz}"/>`:''}</w:rPr>`:''}<w:t xml:space="preserve">${enc(t)}</w:t></w:r>`;
 const p=(t,o={},jc)=>`<w:p>${jc?`<w:pPr><w:jc w:val="${jc}"/></w:pPr>`:''}${run(t,o)}</w:p>`;
 const all='<w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(x=>`<w:${x} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('')+'</w:tblBorders>';
 const tbl=(widths,rows)=>`<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a,b)=>a+b,0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${all}</w:tblPr><w:tblGrid>${widths.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.map(r=>`<w:tr>${r.map((c,i)=>`<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/></w:tcPr>${p(c[0],{b:c[1],sz:19},c[2])}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
 const bank=tbl([5600,1100,2950],[[['{{Наша.Банк}}'],['БИК'],['{{Наша.БИК}}']],[['Банк получателя',false],['Сч. №'],['{{Наша.КоррСчет}}']],[['ИНН {{Наша.ИНН}}   КПП {{Наша.КПП}}'],['Сч. №'],['{{Наша.РасчетныйСчет}}']],[['{{Наша.Наименование}}'],[''],['']],[['Получатель'],[''],['']]]);
 const W=[500,4300,1000,900,1450,1500];
 const items=tbl(W,[[['№',true,'center'],['Товары (работы, услуги)',true],['Кол-во',true],['Ед.',true],['Цена',true],['Сумма',true]],[['{{Строка.№}}',false,'center'],['{{Строка.Наименование}}'],['{{Строка.Количество}}'],['{{Строка.Ед}}'],['{{Строка.Цена}}',false,'right'],['{{Строка.Сумма}}',false,'right']]]);
 const body=[
  p('{{Логотип}}'),bank,p(''),
  p('Счёт на оплату № {{Документ.Номер}} от {{Документ.ДатаТекстом}}',{b:true,sz:30}),
  `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="1" w:color="000000"/></w:pBdr></w:pPr></w:p>`,
  p('Поставщик (исполнитель): {{Наша.Наименование}}, ИНН {{Наша.ИНН}}, КПП {{Наша.КПП}}, {{Наша.Адрес}}'),
  p('Покупатель (заказчик): {{Клиент.Наименование}}, ИНН {{Клиент.ИНН}}, КПП {{Клиент.КПП}}, {{Клиент.Адрес}}'),
  p('Основание: сделка {{Сделка.Номер}}, объект {{Объект.Адрес}}'),
  items,
  p('Итого: {{Сумма}}',{b:true},'right'),p('В том числе НДС ({{СтавкаНДС}}): {{НДС}}',{b:true},'right'),
  p('Всего к оплате: {{Сумма}} ({{СуммаПрописью}})'),
  p('Оплата этого счёта означает согласие с условиями оказания услуг. Счёт действителен 5 банковских дней.',{sz:18}),
  p(''),p(''),
  p('Руководитель {{Подпись}}{{Печать}} / {{Наша.ПодписантКратко}} /          Бухгалтер ____________'),
 ].join('');
 const zip=readZip(sample());
 const docXml=zip.get('word/document.xml').toString('utf8');
 zip.set('word/document.xml',Buffer.from(docXml.replace(/<w:body>[\s\S]*<w:sectPr>/,'<w:body>'+body+'<w:sectPr>'),'utf8'));
 return writeZip(zip);
}
module.exports={imageSize,FIELDS,fieldList,inspect,fill,sample,sampleInvoice,fillXml,scanXml};
