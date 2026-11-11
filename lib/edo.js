// Форматы для ЭДО и обмена: УПД 5.03 (ON_NSCHFDOPPR, приказ ФНС ЕД-7-26/970@), кодировка windows-1251,
// ZIP-архив без сжатия, разбор выписки банка 1CClientBankExchange.
const crypto=require('node:crypto');

// ---------- windows-1251 ----------
const CP1251=(()=>{const map=new Map(),dec=new TextDecoder('windows-1251');for(let b=128;b<256;b++){const ch=dec.decode(Uint8Array.of(b));if(ch!=='�')map.set(ch,b)}return map})();
function encode1251(text){const s=String(text),out=Buffer.alloc(s.length);let n=0;for(const ch of s){const c=ch.codePointAt(0);if(c<128)out[n++]=c;else{const b=CP1251.get(ch);out[n++]=b===undefined?0x3f:b}}return out.subarray(0,n)}
function decodeText(buf){buf=Buffer.isBuffer(buf)?buf:Buffer.from(buf);const utf=buf.toString('utf8');return utf.includes('�')?new TextDecoder('windows-1251').decode(buf):utf.replace(/^﻿/,'')}

// ---------- ZIP (stored) ----------
const CRC=(()=>{const t=new Int32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[i]=c}return t})();
function crc32(buf){let c=-1;for(const b of buf)c=CRC[(c^b)&255]^(c>>>8);return (c^-1)>>>0}
function zip(files){const local=[],central=[];let offset=0;const d=new Date(),time=(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1),date=((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
 for(const f of files){const name=Buffer.from(f.name,'utf8'),data=Buffer.isBuffer(f.data)?f.data:Buffer.from(f.data),crc=crc32(data);
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x0800,6);h.writeUInt16LE(0,8);h.writeUInt16LE(time,10);h.writeUInt16LE(date,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(name.length,26);h.writeUInt16LE(0,28);
  local.push(h,name,data);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x0800,8);c.writeUInt16LE(0,10);c.writeUInt16LE(time,12);c.writeUInt16LE(date,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);
  central.push(c,name);offset+=30+name.length+data.length}
 const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,cd,end])}

// ---------- УПД 5.03 ----------
const xa=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
const ruDate=iso=>{const [y,m,d]=String(iso).slice(0,10).split('-');return `${d}.${m}.${y}`};
const MONTHS=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
// Как в 1С: «30 сентября 2026 г.» с неразрывным пробелом перед «г.»
const longDate=iso=>{const [y,m,d]=String(iso).slice(0,10).split('-');return `${Number(d)} ${MONTHS[Number(m)-1]} ${y}\u00a0г.`};
const money2=n=>(Math.round((Number(n)+Number.EPSILON)*100)/100).toFixed(2);
const qty=n=>{const v=Number(n);return Math.abs(v*100-Math.round(v*100))<1e-9?v.toFixed(2):String(Math.round(v*1000)/1000)};
function splitName(full){const parts=String(full||'').replace(/^ИП\s+/i,'').trim().split(/\s+/).filter(Boolean);return {Фамилия:parts[0]||'',Имя:parts[1]||'',Отчество:parts.slice(2).join(' ')}}
const participantId=x=>String(x.edoId||'').trim()||(x.kpp?`${x.inn}-${x.kpp}`:String(x.inn||''));
function party(tag,x,{bank=false}={}){
 const inn=String(x.inn||'').replace(/\D/g,''),T='\r\n\t\t\t';
 const n=splitName(x.name);
 const id=inn.length===12
  ?`${T}\t<ИдСв>${T}\t\t<СвИП ИННФЛ="${xa(inn)}">${T}\t\t\t<ФИО Фамилия="${xa(n.Фамилия)}" Имя="${xa(n.Имя)}" Отчество="${xa(n.Отчество)}"/>${T}\t\t</СвИП>${T}\t</ИдСв>`
  :`${T}\t<ИдСв>${T}\t\t<СвЮЛУч НаимОрг="${xa(x.name)}" ИННЮЛ="${xa(inn)}"${x.kpp?` КПП="${xa(x.kpp)}"`:''}/>${T}\t</ИдСв>`;
 const adr=`${T}\t<Адрес>${T}\t\t<АдрИнф КодСтр="643" НаимСтран="Россия" АдрТекст="${xa(x.address||'')}"/>${T}\t</Адрес>`;
 const bankXml=bank&&x.bankAccount?`${T}\t<БанкРекв НомерСчета="${xa(x.bankAccount)}">${T}\t\t<СвБанк НаимБанк="${xa(x.bankName||'')}" БИК="${xa(x.bik||'')}"${x.correspondentAccount?` КорСчет="${xa(x.correspondentAccount)}"`:''}/>${T}\t</БанкРекв>`:'';
 return `<${tag}>${id}${adr}${bankXml}${T}</${tag}>`;
}
// r — реализация с рассчитанными строками; seller/buyer — {name,inn,kpp,address,bank...}; signer — {name,position}
function updXml(r,seller,buyer,signer,{now=new Date(),program='ПРОМЕТЕЙ CRM'}={}){
 const vatFree=r.vatRate==='none';
 const msk=new Date(now.getTime()+3*3600000).toISOString();
 const stamp=msk.slice(0,10).replace(/-/g,'');
 const fileId=`ON_NSCHFDOPPR_${participantId(buyer)}_${participantId(seller)}_${stamp}_${r.fileGuid||crypto.randomUUID()}`;
 const rate=vatFree?'без НДС':r.vatRate+'%';
 const tax=v=>vatFree?'<СумНал><БезНДС>без НДС</БезНДС></СумНал>':`<СумНал><СумНал>${money2(v)}</СумНал></СумНал>`;
 const lines=r.lines.map((l,i)=>`
			<СведТов НомСтр="${i+1}" НаимТов="${xa(l.name)}"${l.okei?` ОКЕИ_Тов="${xa(l.okei)}"`:''} НаимЕдИзм="${xa(l.unitName)}" КолТов="${qty(l.quantity)}" ЦенаТов="${money2(l.price)}" НалСт="${rate}" СтТовБезНДС="${money2(l.net)}" СтТовУчНал="${money2(l.gross)}">
				<Акциз>
					<БезАкциз>без акциза</БезАкциз>
				</Акциз>
				${tax(l.vat)}
			</СведТов>`).join('');
 const basis=r.basis&&r.basis.number?{name:`${r.basis.name||'Договор'} №${r.basis.number}${r.basis.date?' от '+longDate(r.basis.date):''}`,number:r.basis.number,date:r.basis.date}:{name:'Без документа-основания',number:'',date:''};
 const fio=splitName(signer.name);
 const xml=`<?xml version="1.0" encoding="windows-1251"?>
<Файл xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ИдФайл="${xa(fileId)}" ВерсФорм="5.03" ВерсПрог="${xa(program)}">
	<Документ КНД="1115131" ДатаИнфПр="${ruDate(msk)}" ВремИнфПр="${msk.slice(11,19).replace(/:/g,'.')}" НаимЭконСубСост="${xa(seller.name)}" Функция="${vatFree?'ДОП':'СЧФДОП'}" ПоФактХЖ="Документ об отгрузке товаров (выполнении работ), передаче имущественных прав (документ об оказании услуг)" НаимДокОпр="${vatFree?'Документ об отгрузке товаров (выполнении работ), передаче имущественных прав (документ об оказании услуг)':'Универсальный передаточный документ'}">
		<СвСчФакт НомерДок="${xa(r.number)}" ДатаДок="${ruDate(r.date)}">
			${party('СвПрод',seller,{bank:true})}
			<ДокПодтвОтгрНом РеквНаимДок="Универсальный передаточный документ" РеквНомерДок="${xa(r.number)}" РеквДатаДок="${ruDate(r.date)}"/>
			${party('СвПокуп',buyer)}
			<ДенИзм КодОКВ="643" НаимОКВ="Российский рубль"/>
			<ДопСвФХЖ1/>
			<ИнфПолФХЖ1/>
		</СвСчФакт>
		<ТаблСчФакт>${lines}
			<ВсегоОпл СтТовБезНДСВсего="${money2(r.totals.net)}" СтТовУчНалВсего="${money2(r.totals.gross)}">
				${vatFree?'<СумНалВсего><БезНДС>без НДС</БезНДС></СумНалВсего>':`<СумНалВсего><СумНал>${money2(r.totals.vat)}</СумНал></СумНалВсего>`}
			</ВсегоОпл>
		</ТаблСчФакт>
		<СвПродПер>
			<СвПер СодОпер="${xa(r.operation||'Услуги оказаны в полном объеме')}" ДатаПер="${ruDate(r.date)}">
				<ОснПер РеквНаимДок="${xa(basis.name)}"${basis.number?` РеквНомерДок="${xa(basis.number)}"`:''}${basis.date?` РеквДатаДок="${ruDate(basis.date)}"`:` РеквДатаДок="${ruDate(r.date)}"`}/>
			</СвПер>
		</СвПродПер>
		<Подписант СпосПодтПолном="1" Должн="${xa(signer.position||'Генеральный директор')}">
			<ФИО Фамилия="${xa(fio.Фамилия)}" Имя="${xa(fio.Имя)}" Отчество="${xa(fio.Отчество)}"/>
		</Подписант>
	</Документ>
</Файл>
`;
 const crlf=xml.replace(/\r?\n/g,'\r\n');
 return {fileName:fileId+'.xml',fileId,xml:crlf,bytes:encode1251(crlf)};
}

// ---------- выписка 1CClientBankExchange ----------
function parseBankStatement(text){
 text=String(text||'');if(!/^\s*1CClientBankExchange/.test(text))throw Object.assign(new Error('Это не выписка в формате 1С (1CClientBankExchange). Выгрузите выписку из банк-клиента «для 1С».'),{status:400});
 const docs=[];let cur=null;
 for(const raw of text.split(/\r?\n/)){const line=raw.trim();if(!line)continue;const i=line.indexOf('=');const key=i<0?line:line.slice(0,i),value=i<0?'':line.slice(i+1).trim();
  if(key==='СекцияДокумент'){cur={Вид:value};continue}
  if(key==='КонецДокумента'){if(cur)docs.push(cur);cur=null;continue}
  if(cur)cur[key]=value;
 }
 const date=v=>{const m=String(v||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:''};
 return docs.map(x=>({kind:x.Вид,number:x.Номер||'',date:date(x.ДатаПоступило||x.Дата),amount:Number(String(x.Сумма||'').replace(',','.')),payerInn:String(x.ПлательщикИНН||'').replace(/\D/g,''),payerName:x.Плательщик1||x.Плательщик||'',payerAccount:x.ПлательщикСчет||'',receiverInn:String(x.ПолучательИНН||'').replace(/\D/g,''),receiverAccount:x.ПолучательСчет||'',purpose:x.НазначениеПлатежа||''})).filter(x=>x.date&&Number.isFinite(x.amount)&&x.amount>0);
}
module.exports={encode1251,decodeText,zip,crc32,updXml,parseBankStatement,ruDate,longDate,money2,participantId};
