'use strict';
// Сверка генератора УПД 5.03 с образцом из 1С (tests/fixtures/upd-5.03-sample.xml).
// В образце русские буквы при пересылке заменились на «�», поэтому сравниваем документы в «маске»:
// каждая не-ASCII буква → «#». Совпадают все теги, атрибуты, их порядок вложенности и значения;
// различаться могут только дата/время формирования, GUID файла и версия программы.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {updXml,encode1251}=require('../lib/edo');
const sample=fs.readFileSync(path.join(__dirname,'fixtures/upd-5.03-sample.xml'));
const mask=buf=>buf.toString('latin1').replace(/\xef\xbf\xbd/g,'#').replace(/[\x80-\xff]/g,'#');
// Разбор в список элементов: путь + набор атрибутов (порядок атрибутов в XML не важен) + текст.
function shape(text){const out=[],stack=[];const re=/<(\/?)([^\s>\/?!]+)([^>]*?)(\/?)>|([^<]+)/g;let m;while((m=re.exec(text))){if(m[5]!==undefined){const t=m[5].trim();if(t)out.push(stack.join('/')+' #text='+t);continue}if(m[1]){stack.pop();continue}const attrs=[...m[3].matchAll(/([^\s=]+)="([^"]*)"/g)].map(a=>a[1]+'='+a[2]).sort();out.push(stack.concat(m[2]).join('/')+' '+attrs.join(' '));if(!m[4])stack.push(m[2])}return out}
const r={number:'2131',date:'2026-10-10',vatRate:22,basis:{name:'Договор',number:'2963',date:'2026-09-30'},operation:'Услуги оказаны в полном объеме',fileGuid:'c9915058-6cdf-4d1e-a1ba-37478e048360',
 lines:[{name:'Услуги аренды Самосва  (Грузовой 32т ) за период 10.10.26-10.10.26 (Москва, ул.Тимирязев 33к4)',okei:'356',unitName:'час',quantity:8,price:3483.61,net:27868.85,vat:6131.15,gross:34000}],
 totals:{net:27868.85,vat:6131.15,gross:34000}};
const seller={name:'ООО Спецтехника',inn:'9715479130',kpp:'771501001',address:'127018, г. Москва, Проезд Марьиной Рощи 3-й, д. 40 стр 1, помещ. 1/27',bankAccount:'40702810920000097969',bankName:'ПАО Новый Мирок',bik:'044525104',correspondentAccount:'30101810745374525104'};
const buyer={name:'ООО "Альфа"',inn:'5009142383',kpp:'500901001',address:'142005, Московская обл., г. Домодедово, мкр Центральный, ул. Лесная, д. 13 к. 1, место 57, ком. 2'};
const out=updXml(r,seller,buyer,{name:'',position:'Генеральный директор'},{now:new Date('2026-10-28T09:00:04Z'),program:'1.0.12'});
const ours=mask(out.bytes),theirs=mask(sample);
const a=shape(ours),b=shape(theirs);
// ИдФайл, ДатаИнфПр и ВремИнфПр зависят от момента выгрузки — приводим к образцу.
const norm=list=>list.map((l,i)=>i===2?l.split(' ').map(t=>t.replace(/=\d{2}\.\d{2}\.\d{2,4}$/,'=*')).sort().join(' '):l);
const A=norm(a),B=norm(b);
for(let i=0;i<Math.max(A.length,B.length);i++)if(A[i]!==B[i]){console.log('first difference at element',i,'\n ours:  ',A[i],'\n sample:',B[i]);break}
assert.equal(A.length,B.length,'same number of elements');
assert.deepEqual(A,B,'same structure, attributes and values');
assert.ok(out.fileName.startsWith('ON_NSCHFDOPPR_5009142383-500901001_9715479130-771501001_20261028_c9915058'),'file name like the sample');
assert.ok(out.bytes.includes(Buffer.from('\r\n')),'CRLF line endings like 1C');
assert.equal(encode1251('Ёё№—').toString('hex'),'a8b8b997','windows-1251 encoding');
console.log(`PASS UPD 5.03 matches the 1C sample: ${A.length} elements, attributes and values (masked), file name, windows-1251, CRLF`);
