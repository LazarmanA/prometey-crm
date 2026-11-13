'use strict';
// Бланк счёта-договора без полей {{…}}: номер и дата, стороны, таблица позиций, итоги, прописью, срок оплаты — заполняются автоматически.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Docx=require('../lib/docx'),{readZip}=require('../lib/zip');
let checks=0;const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
const buf=fs.readFileSync(path.join(__dirname,'fixtures/schet-dogovor-bez-poley.docx'));
const info=Docx.inspect(buf);
ok(info.auto&&['Документ.Номер','Документ.ДатаТекстом','Клиент.Реквизиты','Строка.Наименование','Строка.Сумма','Сумма','НДС.Итог','СуммаПрописью','СрокОплаты'].every(f=>info.fields.includes(f)),'blank without {{…}} is recognized: '+info.recognized.join(', '));
const out=Docx.fill(buf,{doc:{number:'СД-2026-000003',date:'2026-11-13'},entity:{name:'ООО «РУССТРОЙ»',address:'г. Москва, ул. Тверская, д. 1',phone:'+7 495 123-45-67',email:'info@russtroy.ru'},client:{name:'ООО «ТПАС»',inn:'7802390911',kpp:'780201001',legalAddress:'г. Санкт-Петербург, ул. Мира, 5'},order:{},object:{},
 items:[{description:'Услуги трала',quantity:2,unit:'trip',rate:45000,gross:90000},{description:'Экскаватор CAT 320',quantity:8,unit:'hour',rate:3500,gross:28000}],totals:{totalGross:118000,totalNet:96721.31,vatTotal:21278.69,vatRate:22},images:{}});
const xml=readZip(out).get('word/document.xml').toString('utf8'),text0=[...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m=>m[1]).join('').replace(/&quot;/g,'"'),text=text0.replace(/[\u00a0\u202f]/g,' ');
ok(/№ СД-2026-000003 от «13» ноября 2026 г\./.test(text),'number and date');
ok(text.includes('ООО «ТПАС», ИНН 7802390911 / КПП 780201001')&&text.includes('Адрес: г. Москва, ул. Тверская')&&text.includes('+7 495 123-45-67')&&text.includes('info@russtroy.ru'),'parties, address, phone, e-mail');
ok(text.includes('Услуги трала')&&text.includes('Экскаватор CAT 320')&&text.includes('рейс')&&text.includes('90 000,00')&&!/>км</.test(xml)&&!xml.includes('>услуга<'),'items table filled, empty template rows removed');
ok(text.includes('Итого: 118 000,00')&&text.includes('В том числе НДС 22%: 21 278,69')&&text.includes('Всего наименований 2, на сумму 118 000,00 руб.'),'totals, VAT, count');
ok(/Сто восемнадцать тысяч рублей 00 копеек/i.test(text)&&/Оплатить не позднее 20\.11\.2026/.test(text),'amount in words and due date (+5 working days)');
ok(!xml.includes('{{')&&!xml.includes('w:val="yellow"'),'no leftover fields or yellow marks');
// шаблон с полями не трогаем
const marked=Docx.inspect(Docx.sampleInvoice?Docx.sampleInvoice():Docx.sample());ok(!marked.auto,'template with {{…}} fields is not auto-marked');
console.log(`OK autotemplate: ${checks} checks`);
