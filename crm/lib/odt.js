// Небольшой построитель документов OpenDocument (FODT — один XML-файл). LibreOffice переводит его в PDF
// точно: рамки таблиц, ширины столбцов, альбомная страница, без лишних отступов, как в HTML-импорте.
const x=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
const text=v=>x(v).replace(/\n/g,'<text:line-break/>').replace(/ {2,}/g,m=>' <text:s text:c="'+(m.length-1)+'"/>');
// Стиль абзаца: P_<align><b|n><size>
const styles=new Map();
function pstyle({align='start',bold=false,size=8}={}){const name=`P_${align}_${bold?'b':'n'}_${String(size).replace('.','_')}`;styles.set(name,`<style:style style:name="${name}" style:family="paragraph"><style:paragraph-properties fo:text-align="${align}" fo:margin-top="0cm" fo:margin-bottom="0cm"/><style:text-properties fo:font-size="${size}pt"${bold?' fo:font-weight="bold"':''}/></style:style>`);return name}
function para(content,opt={}){return `<text:p text:style-name="${pstyle(opt)}">${text(content)}</text:p>`}
let tableNo=0;
// table({widths:[см...], rows:[[cell|string]], border:true, size:7}); cell = {text, colspan, align, bold, border:false, bottom:true}
function table({widths,rows,border=true,size=8}){
 const n=++tableNo,auto=[];const total=widths.reduce((a,b)=>a+b,0);
 auto.push(`<style:style style:name="T${n}" style:family="table"><style:table-properties style:width="${total}cm" table:align="left" fo:margin-top="0.1cm" fo:margin-bottom="0.1cm"/></style:style>`);
 widths.forEach((w,i)=>auto.push(`<style:style style:name="T${n}C${i}" style:family="table-column"><style:table-column-properties style:column-width="${w}cm"/></style:style>`));
 const cellStyle={b:`T${n}_b`,n:`T${n}_n`,u:`T${n}_u`};
 auto.push(`<style:style style:name="${cellStyle.b}" style:family="table-cell"><style:table-cell-properties fo:padding="0.05cm" fo:border="0.5pt solid #000000" style:vertical-align="top"/></style:style>`);
 auto.push(`<style:style style:name="${cellStyle.n}" style:family="table-cell"><style:table-cell-properties fo:padding="0.04cm" fo:border="none" style:vertical-align="top"/></style:style>`);
 auto.push(`<style:style style:name="${cellStyle.u}" style:family="table-cell"><style:table-cell-properties fo:padding="0.04cm" fo:border="none" fo:border-bottom="0.5pt solid #000000" style:vertical-align="bottom"/></style:style>`);
 const body=rows.map(r=>{let cells='',span=0;for(const c0 of r){const c=typeof c0==='object'&&c0!==null?c0:{text:c0};const cs=c.colspan||1;const st=c.underline?cellStyle.u:(c.border??border)?cellStyle.b:cellStyle.n;const content=(Array.isArray(c.text)?c.text:[c.text]).map(t=>para(t??'',{align:c.align||'start',bold:!!c.bold,size:c.size||size})).join('');cells+=`<table:table-cell table:style-name="${st}" office:value-type="string"${cs>1?` table:number-columns-spanned="${cs}"`:''}>${content}</table:table-cell>`+'<table:covered-table-cell/>'.repeat(cs-1);span+=cs}return `<table:table-row>${cells}</table:table-row>`}).join('');
 return {auto,xml:`<table:table table:name="T${n}" table:style-name="T${n}">${widths.map((w,i)=>`<table:table-column table:style-name="T${n}C${i}"/>`).join('')}${body}</table:table>`};
}
// document([...blocks]) — блоки: строка XML абзаца или результат table()
function document(blocks,{landscape=false}={}){
 const auto=[];const body=blocks.map(b=>{if(b&&b.auto){auto.push(...b.auto);return b.xml}return b}).join('');
 const [w,h]=landscape?['29.7cm','21cm']:['21cm','29.7cm'];
 return `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
<office:font-face-decls><style:font-face style:name="Arial" svg:font-family="Arial, 'Liberation Sans', 'DejaVu Sans'" style:font-family-generic="swiss"/></office:font-face-decls>
<office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0cm"/><style:text-properties style:font-name="Arial" fo:font-size="8pt" fo:language="ru" fo:country="RU"/></style:default-style></office:styles>
<office:automatic-styles><style:page-layout style:name="PL"><style:page-layout-properties fo:page-width="${w}" fo:page-height="${h}" style:print-orientation="${landscape?'landscape':'portrait'}" fo:margin-top="1cm" fo:margin-bottom="1cm" fo:margin-left="1cm" fo:margin-right="1cm"/></style:page-layout>${[...styles.values()].join('')}${auto.join('')}</office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="PL"/></office:master-styles>
<office:body><office:text>${body}</office:text></office:body></office:document>`;
}
module.exports={para,table,document};
