'use strict';
// Минимальный ZIP (для .docx): чтение и запись без сторонних библиотек.
const zlib=require('node:zlib');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const MAX_ENTRIES=2000,MAX_TOTAL=200*1024*1024;

let crcTable=null;
function crc32(buf){
 if(zlib.crc32)return zlib.crc32(buf)>>>0;
 if(!crcTable){crcTable=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;crcTable[n]=c>>>0}}
 let c=0xFFFFFFFF;for(const b of buf)c=crcTable[(c^b)&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;
}

// → Map(name → Buffer), порядок сохраняется
function readZip(buf,{maxTotal=MAX_TOTAL,maxEntries=MAX_ENTRIES}={}){
 if(!Buffer.isBuffer(buf)||buf.length<22)fail('Файл повреждён или это не документ Word (.docx)');
 let eocd=-1;for(let i=buf.length-22;i>=Math.max(0,buf.length-22-65535);i--)if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break}
 if(eocd<0)fail('Файл повреждён или это не документ Word (.docx)');
 const count=buf.readUInt16LE(eocd+10),cdOffset=buf.readUInt32LE(eocd+16);
 if(count>maxEntries)fail('Слишком много частей в файле');
 const out=new Map();let p=cdOffset,total=0;
 for(let i=0;i<count;i++){
  if(p+46>buf.length||buf.readUInt32LE(p)!==0x02014b50)fail('Файл повреждён (оглавление архива)');
  const flags=buf.readUInt16LE(p+8),method=buf.readUInt16LE(p+10),csize=buf.readUInt32LE(p+20),usize=buf.readUInt32LE(p+24),nlen=buf.readUInt16LE(p+28),elen=buf.readUInt16LE(p+30),clen=buf.readUInt16LE(p+32),local=buf.readUInt32LE(p+42);
  const name=buf.subarray(p+46,p+46+nlen).toString(flags&0x800?'utf8':'latin1');p+=46+nlen+elen+clen;
  if(flags&1)fail('Документ защищён паролем — снимите защиту и загрузите снова');
  if(name.includes('..')||name.startsWith('/')||name.includes('\\'))fail('Недопустимое имя внутри файла');
  if(local+30>buf.length||buf.readUInt32LE(local)!==0x04034b50)fail('Файл повреждён (заголовок части)');
  const start=local+30+buf.readUInt16LE(local+26)+buf.readUInt16LE(local+28),raw=buf.subarray(start,start+csize);
  total+=usize;if(total>maxTotal)fail('Файл слишком большой после распаковки');
  let data;if(method===0)data=Buffer.from(raw);else if(method===8)data=zlib.inflateRawSync(raw,{maxOutputLength:Math.max(usize,1)+1024});else fail('Неподдерживаемое сжатие в файле');
  if(name.endsWith('/'))continue;out.set(name,data);
 }
 return out;
}

function writeZip(entries){
 const locals=[],central=[];let offset=0;
 const dt=(()=>{const d=new Date();return {time:(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1),date:((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate()}})();
 for(const [name,content] of entries){
  const data=Buffer.isBuffer(content)?content:Buffer.from(String(content),'utf8'),nameBuf=Buffer.from(name,'utf8');
  const store=name==='mimetype'||/\.(png|jpe?g|gif|zip)$/i.test(name),comp=store?data:zlib.deflateRawSync(data,{level:6}),crc=crc32(data);
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(store?0:8,8);h.writeUInt16LE(dt.time,10);h.writeUInt16LE(dt.date,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(comp.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(nameBuf.length,26);
  locals.push(h,nameBuf,comp);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(store?0:8,10);c.writeUInt16LE(dt.time,12);c.writeUInt16LE(dt.date,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(comp.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(nameBuf.length,28);c.writeUInt32LE(offset,42);
  central.push(c,nameBuf);offset+=30+nameBuf.length+comp.length;
 }
 const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.size??entries.length,8);end.writeUInt16LE(entries.size??entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,cd,end]);
}
module.exports={readZip,writeZip,crc32};
