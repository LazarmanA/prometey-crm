'use strict';
// Таблицы для импорта: чтение Excel (.xlsx) и CSV (UTF-8 или Windows-1251), запись простого .xlsx (шаблоны).
const {readZip,writeZip}=require('./zip');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const MAX_ROWS=5000;

const unxml=s=>String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&amp;/g,'&');
const xml=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
const colIndex=ref=>{const m=/^([A-Z]+)/.exec(ref||'');if(!m)return -1;let n=0;for(const ch of m[1])n=n*26+ch.charCodeAt(0)-64;return n-1};
const textOf=frag=>{let out='';for(const m of frag.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g))out+=unxml(m[1]);return out};

function readXlsx(buf){
 let entries;try{entries=readZip(buf)}catch(e){fail('Файл Excel повреждён: '+e.message)}
 const get=n=>{const b=entries.get(n);return b?b.toString('utf8'):''};
 const shared=[];for(const m of get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g))shared.push(textOf(m[1]));
 // первый лист книги
 let sheetPath='xl/worksheets/sheet1.xml';
 const wb=get('xl/workbook.xml'),rels=get('xl/_rels/workbook.xml.rels');
 const first=/<sheet\b[^>]*r:id="([^"]+)"/.exec(wb);
 if(first){const rel=new RegExp(`<Relationship\\b[^>]*Id="${first[1]}"[^>]*Target="([^"]+)"`).exec(rels)||new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${first[1]}"`).exec(rels);if(rel){const t=rel[1].replace(/^\//,'');sheetPath=t.startsWith('xl/')?t:'xl/'+t}}
 const sheet=get(sheetPath);if(!sheet)fail('В файле Excel нет листа с данными');
 const rows=[];
 for(const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){
  const row=[];let next=0;
  for(const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
   const attrs=c[1],body=c[2]||'';const ref=/\br="([A-Z]+\d+)"/.exec(attrs)?.[1];const idx=ref?colIndex(ref):next;next=idx+1;
   const t=/\bt="([^"]+)"/.exec(attrs)?.[1]||'n';const v=/<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
   let val='';
   if(t==='s')val=shared[Number(v)]??'';else if(t==='inlineStr')val=textOf(body);else if(t==='b')val=v==='1'?'да':'нет';else val=v!==undefined?unxml(v):'';
   row[idx]=String(val);
  }
  rows.push(Array.from(row,x=>x??''));
  if(rows.length>MAX_ROWS+1)fail(`В файле больше ${MAX_ROWS} строк — разделите его на части`);
 }
 return rows;
}

function readCsv(buf){
 let text=buf.toString('utf8');
 if(text.includes('�')){try{text=new TextDecoder('windows-1251').decode(buf)}catch{}}
 text=text.replace(/^﻿/,'');
 const firstLine=text.split(/\r?\n/,1)[0]||'';const delim=(firstLine.match(/;/g)||[]).length>=(firstLine.match(/,/g)||[]).length?';':(firstLine.includes('\t')?'\t':',');
 const rows=[];let row=[],cell='',q=false;
 for(let i=0;i<text.length;i++){const ch=text[i];
  if(q){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++}else q=false}else cell+=ch;continue}
  if(ch==='"'){q=true;continue}
  if(ch===delim){row.push(cell);cell='';continue}
  if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';if(rows.length>MAX_ROWS+1)fail(`В файле больше ${MAX_ROWS} строк — разделите его на части`);continue}
  cell+=ch;
 }
 if(cell!==''||row.length){row.push(cell);rows.push(row)}
 return rows;
}

// Файл из браузера (data:...;base64,...) → строки таблицы без пустых
function readTable(data,name=''){
 const m=/^data:[^;,]*;base64,(.*)$/s.exec(String(data||''));const b64=(m?m[1]:String(data||'')).replace(/\s+/g,'');
 if(!b64)fail('Файл не получен');const buf=Buffer.from(b64,'base64');if(!buf.length)fail('Файл пустой');if(buf.length>15*1024*1024)fail('Файл больше 15 МБ');
 const isZip=buf[0]===0x50&&buf[1]===0x4b;
 if(/\.xls$/i.test(name)&&!isZip)fail('Старый формат .xls не поддерживается — в Excel выберите «Сохранить как» → «Книга Excel (.xlsx)»');
 const rows=(isZip?readXlsx(buf):readCsv(buf)).map(r=>r.map(c=>String(c??'').trim()));
 return rows.filter(r=>r.some(c=>c!==''));
}

// Простой .xlsx: первая строка — заголовки (жирные), ширина колонок по содержимому
function writeXlsx(rows,{sheet='Лист1',widths}={}){
 const col=i=>{let s='';i++;while(i>0){const m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=Math.floor((i-1)/26)}return s};
 const w=widths||rows[0].map((_,i)=>Math.min(60,Math.max(10,...rows.map(r=>String(r[i]??'').length+2))));
 const sheetXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${w.map((x,i)=>`<col min="${i+1}" max="${i+1}" width="${x}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((r,ri)=>`<row r="${ri+1}">${r.map((v,ci)=>`<c r="${col(ci)}${ri+1}" t="inlineStr"${ri===0?' s="1"':''}><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
 return writeZip(new Map([
  ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
  ['_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheet).slice(0,31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
  ['xl/styles.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF1E8"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
  ['xl/worksheets/sheet1.xml',sheetXml]
 ]));
}
module.exports={readTable,readXlsx,readCsv,writeXlsx,MAX_ROWS};
