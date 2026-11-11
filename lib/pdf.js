const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
// Windows: стандартные места установки LibreOffice, Microsoft Edge и Google Chrome.
const WIN=process.platform==='win32';
const pf=[process.env.ProgramFiles||'C:\\Program Files',process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)'];
const winPaths=rel=>WIN?pf.map(p=>path.join(p,rel)):[];
const fileUrl=p=>pathToFileURL(p).href;
function find(candidates){return candidates.filter(Boolean).find(p=>fs.existsSync(p))||''}
function libreOfficePath(){return find([process.env.PROMETEY_LIBREOFFICE,'/usr/bin/libreoffice','/usr/local/bin/libreoffice',...winPaths('LibreOffice\\program\\soffice.exe')])}
function chromiumPath(){return find([process.env.PROMETEY_CHROMIUM,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable',...winPaths('Microsoft\\Edge\\Application\\msedge.exe'),...winPaths('Google\\Chrome\\Application\\chrome.exe')])}
function run(command,args,timeout=30000){return new Promise((resolve,reject)=>{const detached=process.platform!=='win32',child=spawn(command,args,{stdio:['ignore','pipe','pipe'],detached,windowsHide:true});let out='',err='',killed=false,settled=false;const terminate=()=>{if(!child.pid)return;try{if(detached)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL')}catch{try{child.kill('SIGKILL')}catch{}}};const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);fn(value)};const timer=setTimeout(()=>{killed=true;terminate()},timeout);child.stdout.on('data',b=>{if(out.length<12000)out+=b});child.stderr.on('data',b=>{if(err.length<12000)err+=b});child.on('error',e=>finish(reject,e));child.on('exit',code=>{if(code===0&&!killed)finish(resolve,{out,err});else finish(reject,Object.assign(new Error(killed?'PDF generation timeout':`PDF engine exited with code ${code}: ${(err||out).trim().slice(-800)}`),{status:500}))})})}
async function renderWithLibreOffice(html,outFile,lo){
 const id='prometey-'+process.pid+'-'+Date.now()+'-'+Math.random().toString(16).slice(2),tmpdir=fs.mkdtempSync(path.join(os.tmpdir(),id+'-')),input=path.join(tmpdir,id+'.html'),profile=path.join(tmpdir,'profile');fs.writeFileSync(input,html,{mode:0o600});
 try{await run(lo,[`-env:UserInstallation=${fileUrl(profile)}`,'--headless','--convert-to','pdf','--outdir',tmpdir,input]);const generated=path.join(tmpdir,id+'.pdf');if(!fs.existsSync(generated)||fs.statSync(generated).size<1000)throw Object.assign(new Error('LibreOffice не создал PDF'),{status:500});fs.mkdirSync(path.dirname(outFile),{recursive:true,mode:0o700});fs.renameSync(generated,outFile);fs.chmodSync(outFile,0o600);return outFile}finally{fs.rmSync(tmpdir,{recursive:true,force:true})}
}
async function renderWithChromium(html,outFile,chrome){
 // Отдельный временный профиль: браузер не трогает профиль пользователя и работает под служебной учётной записью Windows.
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-'+process.pid+'-')),tmp=path.join(dir,'doc.html'),profile=path.join(dir,'profile');fs.writeFileSync(tmp,html,{mode:0o600});fs.mkdirSync(path.dirname(outFile),{recursive:true,mode:0o700});
 try{await run(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--disable-extensions','--no-first-run','--no-default-browser-check','--no-pdf-header-footer','--incognito',`--user-data-dir=${profile}`,`--print-to-pdf=${outFile}`,fileUrl(tmp)],60000);if(!fs.existsSync(outFile)||fs.statSync(outFile).size<1000)throw Object.assign(new Error('Браузер не создал PDF'),{status:500});fs.chmodSync(outFile,0o600);return outFile}finally{try{fs.rmSync(dir,{recursive:true,force:true})}catch{}}
}
// Документ OpenDocument (FODT) → PDF через LibreOffice: точная вёрстка таблиц для бухгалтерских форм.
async function renderOdtWithLibreOffice(fodt,outFile,lo=libreOfficePath()){
 if(!lo)throw Object.assign(new Error('LibreOffice не установлен'),{status:503});
 const id='prometey-'+process.pid+'-'+Date.now()+'-'+Math.random().toString(16).slice(2),tmpdir=fs.mkdtempSync(path.join(os.tmpdir(),id+'-')),input=path.join(tmpdir,id+'.fodt'),profile=path.join(tmpdir,'profile');fs.writeFileSync(input,fodt,{mode:0o600});
 try{await run(lo,[`-env:UserInstallation=${fileUrl(profile)}`,'--headless','--convert-to','pdf','--outdir',tmpdir,input]);const generated=path.join(tmpdir,id+'.pdf');if(!fs.existsSync(generated)||fs.statSync(generated).size<1000)throw Object.assign(new Error('LibreOffice не создал PDF'),{status:500});fs.mkdirSync(path.dirname(outFile),{recursive:true,mode:0o700});fs.copyFileSync(generated,outFile);fs.chmodSync(outFile,0o600);return outFile}finally{fs.rmSync(tmpdir,{recursive:true,force:true})}
}
// Бухгалтерская форма: FODT через LibreOffice, а если его нет — HTML через Chromium.
async function renderForm({fodt,html},outFile){const lo=libreOfficePath();if(lo&&fodt)return renderOdtWithLibreOffice(fodt,outFile,lo);const chrome=chromiumPath();if(chrome)return renderWithChromium(html,outFile,chrome);if(lo)return renderWithLibreOffice(html,outFile,lo);throw Object.assign(new Error('PDF engine is not configured. Install LibreOffice or set PROMETEY_LIBREOFFICE/PROMETEY_CHROMIUM.'),{status:503})}
// html — строка или функция(движок) → строка. Браузер (Chrome/Edge/Chromium) точнее LibreOffice: рамки, картинки, печать поверх подписи.
async function renderPdf(html,outFile){const page=engine=>typeof html==='function'?html(engine):html;const chrome=chromiumPath();if(chrome)return renderWithChromium(page('chromium'),outFile,chrome);const lo=libreOfficePath();if(lo)return renderWithLibreOffice(page('libreoffice'),outFile,lo);throw Object.assign(new Error('PDF engine is not configured. Install LibreOffice or set PROMETEY_LIBREOFFICE/PROMETEY_CHROMIUM.'),{status:503})}
function pdfEngine(){const chrome=chromiumPath();if(chrome)return {available:true,type:'chromium',path:chrome};const lo=libreOfficePath();if(lo)return {available:true,type:'libreoffice',path:lo};return {available:false,type:'none',path:''}}
// Любой офисный файл (например, договор .docx по своему шаблону) → PDF через LibreOffice.
async function convertWithLibreOffice(buffer,ext,outFile,lo=libreOfficePath()){
 if(!lo)throw Object.assign(new Error('LibreOffice не установлен'),{status:503});
 const id='prometey-'+process.pid+'-'+Date.now()+'-'+Math.random().toString(16).slice(2),tmpdir=fs.mkdtempSync(path.join(os.tmpdir(),id+'-')),input=path.join(tmpdir,id+ext),profile=path.join(tmpdir,'profile');fs.writeFileSync(input,buffer,{mode:0o600});
 try{await run(lo,[`-env:UserInstallation=${fileUrl(profile)}`,'--headless','--convert-to','pdf','--outdir',tmpdir,input],60000);const generated=path.join(tmpdir,id+'.pdf');if(!fs.existsSync(generated)||fs.statSync(generated).size<500)throw Object.assign(new Error('LibreOffice не создал PDF'),{status:500});fs.mkdirSync(path.dirname(outFile),{recursive:true,mode:0o700});fs.copyFileSync(generated,outFile)}finally{fs.rmSync(tmpdir,{recursive:true,force:true})}
}
// Microsoft Word на Windows: .docx → PDF через COM (если Word установлен). Нужен, когда нет LibreOffice.
let wordCache;
function msWordAvailable(){if(process.platform!=='win32'||process.env.PROMETEY_NO_WORD)return false;if(wordCache!==undefined)return wordCache;
 try{const r=require('node:child_process').spawnSync('reg',['query','HKCR\\Word.Application\\CurVer'],{windowsHide:true,timeout:5000});wordCache=r.status===0}catch{wordCache=false}return wordCache}
async function convertWithWord(buffer,outFile){
 const tmpdir=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-word-')),input=path.join(tmpdir,'doc.docx'),output=path.join(tmpdir,'doc.pdf');fs.writeFileSync(input,buffer,{mode:0o600});
 const q=s=>"'"+String(s).replace(/'/g,"''")+"'";
 const script=`$ErrorActionPreference='Stop';$w=New-Object -ComObject Word.Application;$w.Visible=$false;$w.DisplayAlerts=0;try{$d=$w.Documents.Open(${q(input)},$false,$true,$false);try{$d.ExportAsFixedFormat(${q(output)},17)}finally{$d.Close(0)}}finally{$w.Quit();[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($w)}`;
 try{await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],120000);if(!fs.existsSync(output)||fs.statSync(output).size<500)throw Object.assign(new Error('Word не создал PDF'),{status:500});fs.mkdirSync(path.dirname(outFile),{recursive:true,mode:0o700});fs.copyFileSync(output,outFile)}finally{fs.rmSync(tmpdir,{recursive:true,force:true})}
}
function docxPdfAvailable(){return !!libreOfficePath()||msWordAvailable()}
async function convertDocxToPdf(buffer,outFile){if(libreOfficePath())return convertWithLibreOffice(buffer,'.docx',outFile);if(msWordAvailable())return convertWithWord(buffer,outFile);throw Object.assign(new Error('Для PDF из своего шаблона нужен LibreOffice или Microsoft Word'),{status:503})}
module.exports={convertWithLibreOffice,convertDocxToPdf,docxPdfAvailable,msWordAvailable,renderPdf,renderForm,chromiumPath,libreOfficePath,pdfEngine};
