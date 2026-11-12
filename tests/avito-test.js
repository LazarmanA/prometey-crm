// Авито → Лиды: ключи, загрузка сообщений (опрос), повторные сообщения в тот же лид, звонки, вебхук, права, ошибки.
const assert=require('node:assert/strict'),http=require('node:http');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-avito-'));
let checks=0;const check=(ok,label)=>{assert.ok(ok,label);checks++;console.log('PASS',label)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// --- имитация API Авито ---
const ME=777,now=()=>Math.floor(Date.now()/1000);
let chats=[],messages={},calls=[],tokens=0,webhookUrl='',hits=[];
const avito=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;hits.push(req.method+' '+req.url);const send=(s,j)=>{res.writeHead(s,{'content-type':'application/json'});res.end(JSON.stringify(j))};
 if(req.url==='/token'){const f=new URLSearchParams(body);if(f.get('client_id')==='good-id'&&f.get('client_secret')==='good-secret'){tokens++;return send(200,{access_token:'tok-'+tokens,token_type:'Bearer',expires_in:86400})}return send(400,{error:'invalid_client'})}
 if(!/^Bearer tok-/.test(req.headers.authorization||''))return send(403,{error:{message:'forbidden'}});
 if(req.url==='/core/v1/accounts/self')return send(200,{id:ME,name:'СпецТехАренда',email:'x@y.ru'});
 if(req.url.startsWith(`/messenger/v2/accounts/${ME}/chats?`))return send(200,{chats});
 const m=req.url.match(new RegExp(`^/messenger/v3/accounts/${ME}/chats/([^/]+)/messages/`));if(m)return send(200,{messages:messages[decodeURIComponent(m[1])]||[]});
 if(req.url==='/calltracking/v1/getCalls/')return send(200,{calls});
 if(req.url==='/messenger/v3/webhook'){webhookUrl=JSON.parse(body).url;return send(200,{ok:true})}
 send(404,{error:'nf'})});
const chat=(id,buyer,text,created,title='Аренда автокрана 25 т')=>({id,context:{type:'item',value:{id:5001,title,url:'/moskva/uslugi/arenda_avtokrana_5001',price_string:'3 500 ₽ за час'}},users:[{id:ME,name:'СпецТехАренда'},{id:9000+chats.length,name:buyer}],last_message:{id:'m'+created,author_id:9000,content:{text},created,direction:'in',type:'text'},created,updated:created});
(async()=>{let crm;try{
 await new Promise(r=>avito.listen(0,'127.0.0.1',r));
 process.env.AVITO_API_URL='http://127.0.0.1:'+avito.address().port;
 process.env.DB_FILE=path.join(temp,'db.sqlite');process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.RECORDINGS_DIR=path.join(temp,'recordings');process.env.NODE_ENV='test';
 crm=require('../server');await new Promise(r=>crm.listen(0,'127.0.0.1',r));const C='http://127.0.0.1:'+crm.address().port;
 const req=async(p,token,method='GET',body)=>{const r=await fetch(C+p,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});let j=null;try{j=await r.json()}catch{}return {status:r.status,body:j}};
 const D=(await req('/api/login',null,'POST',{email:'director@prometey.local',password:'director'})).body.token,M=(await req('/api/login',null,'POST',{email:'manager@prometey.local',password:'manager'})).body.token;
 check((await req('/api/integrations/avito',M)).status===403,'only the administrator configures Avito');
 let r=await req('/api/integrations/avito',D);check(r.status===200&&!r.body.enabled&&!r.body.hasSecret,'settings screen: off by default');
 check((await req('/api/integrations/avito',D,'PATCH',{enabled:true})).status===400,'cannot enable without keys');
 await req('/api/integrations/avito',D,'PATCH',{clientId:'good-id',clientSecret:'wrong'});
 r=await req('/api/integrations/avito/test',D,'POST',{});check(r.status===502&&/client_id|client_secret|ключ/.test(r.body.error),'wrong secret: clear error');
 await req('/api/integrations/avito',D,'PATCH',{clientSecret:'good-secret'});
 r=await req('/api/integrations/avito/test',D,'POST',{});check(r.status===200&&r.body.account==='СпецТехАренда','connection check shows Avito account');
 check(!JSON.stringify((await req('/api/integrations/avito',D)).body).includes('good-secret'),'secret never returned to the browser');
 check((fs.statSync(path.join(temp,'avito.json')).mode&0o077)===0,'keys file is private');
 // заявки
 chats=[chat('u2i-aaa','Иван','Здравствуйте, нужен кран на завтра',now()-60),chat('u2i-bbb','Ольга','Сколько стоит смена?',now()-30,'Экскаватор-погрузчик JCB'),chat('u2i-old','Старый','было давно',now()-10*86400)];
 chats.push({...chat('u2i-mine','Пётр','мы ответили',now()-20),last_message:{author_id:ME,direction:'out',content:{text:'наш ответ'},created:now()-20,type:'text'}});
 messages['u2i-aaa']=[{id:'1',author_id:9000,direction:'in',type:'text',content:{text:'Здравствуйте, нужен кран на завтра'},created:now()-90},{id:'2',author_id:9000,direction:'in',type:'image',content:{},created:now()-60}];
 r=await req('/api/integrations/avito',D,'PATCH',{enabled:true});check(r.status===200&&r.body.enabled,'enabled');
 let leads=[];for(let i=0;i<50;i++){await sleep(100);leads=(await req('/api/leads?source=avito',D)).body;if(leads.length>=2)break}
 leads=(await req('/api/leads',D)).body.filter(l=>l.source==='avito');
 check(leads.length===2,'new Avito chats became leads (old chats and our own replies skipped)');
 const ivan=leads.find(l=>l.name==='Иван');
 check(ivan&&ivan.status==='new'&&/Аренда автокрана 25 т/.test(ivan.note)&&/avito\.ru\/profile\/messenger\/channel\/u2i-aaa/.test(ivan.note)&&ivan.nextAction==='Ответить в Авито','lead: buyer name, ad title, chat link, next action');
 check(ivan.events.filter(e=>e.type==='message').length===2&&ivan.events.some(e=>/\[фото\]/.test(e.text)),'all new messages of the chat in lead history');
 check(ivan.ownerId==='u-director','default responsible: administrator');
 // повторное сообщение в тот же чат → тот же лид
 chats[0].last_message={...chats[0].last_message,content:{text:'А в субботу можно?'},created:now()+1};messages['u2i-aaa']=[{id:'3',author_id:9000,direction:'in',type:'text',content:{text:'А в субботу можно?'},created:now()+1}];
 r=await req('/api/integrations/avito/sync',D,'POST',{});check(r.status===200&&r.body.created===0&&r.body.updated===1,'next message added to the same lead, no duplicate');
 leads=(await req('/api/leads',D)).body.filter(l=>l.source==='avito');check(leads.length===2&&leads.find(l=>l.name==='Иван').events.some(e=>e.text==='Авито: А в субботу можно?'),'message visible in lead history');
 r=await req('/api/integrations/avito/sync',D,'POST',{});check(r.body.created===0&&r.body.updated===0,'repeated sync imports nothing twice');
 // закрытый лид + новое сообщение → новый лид
 await req('/api/leads/'+leads.find(l=>l.name==='Ольга').id,D,'PATCH',{status:'junk',junkReason:'Дорого'});
 chats[1].last_message={...chats[1].last_message,content:{text:'Передумали, давайте'},created:now()+2};messages['u2i-bbb']=[];
 r=await req('/api/integrations/avito/sync',D,'POST',{});leads=(await req('/api/leads',D)).body.filter(l=>l.source==='avito');
 check(r.body.created===1&&leads.filter(l=>l.name==='Ольга').length===2,'customer returning after a closed lead → new lead');
 // ответственный и звонки
 await req('/api/integrations/avito',D,'PATCH',{ownerId:'u-manager',calls:true});
 calls=[{callId:'c1',itemId:5001,buyerPhone:'+7 916 111-22-33',callTime:new Date().toISOString(),talkDuration:95},{callId:'c2',buyerPhone:'89161112233',callTime:new Date().toISOString(),talkDuration:0}];
 r=await req('/api/integrations/avito/sync',D,'POST',{});leads=(await req('/api/leads',D)).body.filter(l=>l.source==='avito');
 const callLead=leads.find(l=>l.phone==='+7 916 111-22-33');
 check(r.body.created===1&&callLead&&callLead.ownerId==='u-manager'&&callLead.events.filter(e=>e.type==='call').length===2,'calls: one lead per phone, second call in its history, chosen responsible');
 check((await req('/api/leads',M)).body.some(l=>l.id===callLead.id),'responsible manager sees the lead');
 await req('/api/integrations/avito/sync',D,'POST',{});check((await req('/api/leads',D)).body.filter(l=>l.source==='avito').length===leads.length,'calls not duplicated');
 // вебхук
 await req('/api/integrations/avito',D,'PATCH',{publicUrl:'http://crm.example.ru'}).then(x=>check(x.status===400,'webhook needs https'));
 await req('/api/integrations/avito',D,'PATCH',{publicUrl:'https://crm.example.ru'});
 r=await req('/api/integrations/avito/webhook',D,'POST',{});check(r.status===200&&webhookUrl.startsWith('https://crm.example.ru/api/integrations/avito/webhook/'),'webhook subscribed at Avito');
 const hookPath=new URL(webhookUrl).pathname;
 check((await fetch(C+'/api/integrations/avito/webhook/'+'x'.repeat(32),{method:'POST',body:'{}'})).status===404,'webhook with wrong secret ignored');
 chats.push(chat('u2i-ccc','Сергей','Нужен самосвал',now()+3));const before=hits.length;
 r=await fetch(C+hookPath,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'e1',version:'v3.0.0',payload:{type:'message',value:{chat_id:'u2i-ccc'}}})});
 check(r.status===200,'webhook accepted without login or CSRF token');
 for(let i=0;i<40&&!(await req('/api/leads',D)).body.some(l=>l.name==='Сергей');i++)await sleep(100);
 check((await req('/api/leads',D)).body.some(l=>l.name==='Сергей'&&l.source==='avito')&&hits.length>before,'webhook triggers immediate import');
 // ошибка Авито не ломает CRM
 const id0=process.env.AVITO_API_URL;await req('/api/integrations/avito',D,'PATCH',{clientId:'other-id',clientSecret:'bad'});
 r=await req('/api/integrations/avito/sync',D,'POST',{});check(r.status===502,'Avito error reported');
 r=await req('/api/integrations/avito',D);check(r.body.lastError&&r.body.log.some(l=>l.kind==='error'),'error shown on the settings screen and in the log');
 check((await req('/api/leads',D)).status===200,'CRM keeps working');
 r=await req('/api/integrations/avito',D,'PATCH',{enabled:false});check(!r.body.enabled,'can be switched off');
 console.log(`OK avito: ${checks} checks`);void id0;
}catch(e){console.error(e);process.exitCode=1}finally{crm?.close();avito.close();setTimeout(()=>{fs.rmSync(temp,{recursive:true,force:true});process.exit()},200)}})();
