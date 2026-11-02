// Проверка защиты от типовых атак: подбор пароля, подмена IP, CSRF, обход путей, чужие данные,
// поддельные сессии, некорректные запросы, загрязнение прототипа, флуд запросами.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-attack-'));
process.env.DATA_FILE=path.join(temp,'data.json');
process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.RECORDINGS_DIR=path.join(temp,'recordings');
process.env.ANON_RATE_LIMIT_PER_MIN='120';
delete process.env.TRUST_PROXY;delete process.env.COOKIE_SECURE;
fs.copyFileSync(path.join(__dirname,'../storage/data.demo.json'),process.env.DATA_FILE);
const Security=require('../lib/security');
const server=require('../server');
let base,checks=0;
const check=(ok,label)=>{assert.ok(ok,label);checks++;console.log('PASS',label)};
async function req(p,{token,method='GET',body,headers={},raw}={}){const r=await fetch(base+p,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},...(raw!==undefined?{body:raw}:body?{body:JSON.stringify(body)}:{})});const text=await r.text();let json=null;try{json=JSON.parse(text)}catch{}return {status:r.status,body:json,text,headers:r.headers}}
// Raw HTTP request: fetch normalises "../" in URLs, an attacker does not.
function rawGet(p){return new Promise((resolve,reject)=>{const u=new URL(base);const r=http.request({host:u.hostname,port:u.port,path:p,method:'GET'},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode,body:b}))});r.on('error',reject);r.end()})}
const login=(email,password,headers={})=>req('/api/login',{method:'POST',body:{email,password},headers});

(async()=>{try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});base='http://127.0.0.1:'+server.address().port;

 // --- заголовки безопасности ---
 let r=await req('/');
 const csp=r.headers.get('content-security-policy')||'';
 check(/script-src 'self'(;|$)/.test(csp)&&csp.includes("frame-ancestors 'none'")&&csp.includes("object-src 'none'"),'CSP: scripts only from own server, no framing, no plugins');
 check(r.headers.get('x-frame-options')==='DENY'&&r.headers.get('x-content-type-options')==='nosniff','clickjacking and MIME-sniffing headers');
 check(!r.headers.get('strict-transport-security'),'no HSTS over plain HTTP');
 r=await req('/',{headers:{'x-forwarded-proto':'https'}});
 check(!r.headers.get('strict-transport-security'),'forged X-Forwarded-Proto is ignored without TRUST_PROXY');

 // --- обход путей и служебные файлы ---
 for(const p of ['/../server.js','/..%2fserver.js','/%2e%2e/%2e%2e/etc/passwd','/..%5cserver.js','/%2e%2e%2fstorage%2fdata.demo.json','/.env','/.git/config','/index.html%00.js'])
  {const x=await rawGet(p);check([400,403,404].includes(x.status)&&!/require\(|root:|"users"/.test(x.body),'path attack blocked: '+p+' → '+x.status)}
 check((await rawGet('/%E0%A4%A')).status===400,'broken URL encoding → 400, not a crash');
 check((await req('/app.js')).status===200,'normal static file still served');

 // --- некорректные запросы ---
 check((await req('/api/login',{method:'POST',raw:'null'})).status===400,'JSON null body rejected');
 check((await req('/api/login',{method:'POST',raw:'[1,2]'})).status===400,'JSON array body rejected');
 check((await req('/api/login',{method:'POST',raw:'{bad'})).status===400,'broken JSON rejected');
 check((await req('/api/login',{method:'POST',body:{email:{$ne:''},password:{$ne:''}}})).status===400,'object-injection in login fields rejected');
 check((await req('/api/login',{method:'POST',raw:JSON.stringify({email:'x@y.z',password:'a'.repeat(5*1024*1024)})})).status===413,'oversized body → 413');
 check((await login('director@prometey.local','d'.repeat(5000))).status===400,'over-long password rejected before hashing (scrypt DoS)');
 check((await req('/api/session',{method:'PROPFIND'})).status===405,'unusual HTTP methods rejected');

 // --- подбор пароля ---
 const victim='manager@prometey.local';let codes=[];
 for(let i=0;i<9;i++)codes.push((await login(victim,'wrong-'+i)).status);
 check(codes.slice(0,8).every(c=>c===401)&&codes[8]===429,'brute force: 9th wrong password → 429');
 r=await login(victim,'manager');check(r.status===429,'even the right password is blocked during lockout');
 check(Number(r.headers.get('retry-after'))>0,'Retry-After header returned');
 r=await login(victim,'manager',{'x-forwarded-for':'203.0.113.'+Math.floor(Math.random()*200)});
 check(r.status===429,'spoofed X-Forwarded-For does not bypass the lockout');
 check(Security.clientIp({headers:{'x-forwarded-for':'1.2.3.4'},socket:{remoteAddress:'127.0.0.1'}},{})==='127.0.0.1','X-Forwarded-For ignored by default');
 check(Security.clientIp({headers:{'x-forwarded-for':'6.6.6.6, 198.51.100.7'},socket:{remoteAddress:'127.0.0.1'}},{TRUST_PROXY:'1'})==='198.51.100.7','behind proxy the proxy-appended address wins over a forged one');
 // password spraying from one address over many accounts
 const limiter=Security.createLimiter({limit:3,windowMs:1000});check(limiter.hit('k')&&limiter.hit('k')&&limiter.hit('k')&&!limiter.hit('k')&&limiter.retryAfter('k')>0,'limiter blocks after its limit');
 check(limiter.hit('k',Date.now()+1500),'limiter window expires');

 // --- перебор аккаунтов ---
 check(Security.verifyPassword('','')===false,'empty stored password never matches empty input');
 const t0=process.hrtime.bigint();await login('nobody-'+Date.now()+'@x.ru','whatever-123');const tUnknown=Number(process.hrtime.bigint()-t0)/1e6;
 check(tUnknown>5,'unknown account still spends scrypt time ('+tUnknown.toFixed(1)+' мс) — no user enumeration by timing');

 // --- сессии ---
 const d=(await login('director@prometey.local','director')).body.token;check(!!d,'director login');
 check((await req('/api/me')).status===401,'API without session → 401');
 check((await req('/api/me',{token:'forged-token-'+'x'.repeat(40)})).status===401,'forged token → 401');
 check((await req('/api/me',{headers:{cookie:'prometey_session=abc'}})).status===401,'forged cookie → 401');

 // --- CSRF ---
 const cookie={cookie:'prometey_session='+encodeURIComponent(d)};
 check((await req('/api/me',{headers:cookie})).status===200,'cookie session works');
 r=await req('/api/clients',{method:'POST',headers:{...cookie,origin:'https://evil.example'},body:{name:'CSRF'}});
 check(r.status===403,'CSRF: cross-site POST with cookie → 403');
 r=await req('/api/logout',{method:'POST',headers:{...cookie,referer:'https://evil.example/page'}});
 check(r.status===403,'CSRF: foreign Referer → 403');
 r=await req('/api/modules',{method:'POST',headers:{...cookie,origin:'null'},body:{id:'x',enabled:true}});
 check(r.status===403,'CSRF: sandboxed "null" origin → 403');
 r=await req('/api/modules',{method:'POST',headers:{...cookie,origin:base},body:{id:'nope',enabled:true}});
 check(r.status===404,'same-origin request passes the CSRF check');

 // --- чужие данные (IDOR) ---
 // the manager account is locked for 127.0.0.1 — log in from a second local address (127.0.0.2)
 const mgr=await (async()=>{const s=server.address();return new Promise((resolve,reject)=>{const body=JSON.stringify({email:'manager@prometey.local',password:'manager'});const rq=http.request({host:'127.0.0.1',port:s.port,path:'/api/login',method:'POST',localAddress:'127.0.0.2',headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{try{resolve(JSON.parse(b).token)}catch(e){reject(e)}})});rq.on('error',reject);rq.end(body)})})().catch(()=>null);
 check(!!mgr,'manager logs in from another address while the first is locked');
 check((await req('/api/orders/o2',{token:mgr})).status===404,'manager cannot read director deal');
 check((await req('/api/orders/o2',{token:mgr,method:'PATCH',body:{name:'hack'}})).status===404,'manager cannot edit director deal');
 check((await req('/api/audit',{token:mgr})).status===403,'manager cannot read audit log');
 check((await req('/api/modules',{token:mgr,method:'POST',body:{id:'telephony',enabled:false}})).status===403,'manager cannot toggle modules');
 check((await req('/api/integrations',{token:mgr})).status===403,'manager cannot reach integrations');
 check((await req('/api/telephony',{token:mgr})).status===403,'manager cannot reach telephony admin');
 check((await req('/api/documents/legal-entities',{token:mgr,method:'POST',body:{name:'X'}})).status===403,'manager cannot change company requisites');
 const secret=(await req('/api/clients',{token:d,method:'POST',body:{name:'Секретный клиент',address:'Москва',equipmentType:'Кран',note:'x',ownership:'own',requestAt:'2026-11-01T08:30'}})).body;
 check((await req('/api/clients/'+secret.id,{token:mgr})).status===404,'manager cannot read director client');
 r=await req('/api/leads',{token:mgr,method:'POST',body:{name:'Лид',phone:'+79990000001',nextAt:new Date(Date.now()+864e5).toISOString(),nextAction:'Позвонить',clientId:secret.id}});
 check(r.status===404,'lead cannot be linked to an inaccessible company');
 r=await req('/api/leads',{token:mgr,method:'POST',body:{name:'Лид 2',phone:'+79990000002',nextAt:new Date(Date.now()+864e5).toISOString(),nextAction:'Позвонить'}});
 check(r.status===201,'manager creates own lead');
 check((await req('/api/leads/'+r.body.id,{token:mgr,method:'PATCH',body:{clientId:secret.id}})).status===404,'lead PATCH cannot attach a foreign company');
 check((await req('/api/workspaces/orders/o2/owner',{token:mgr,method:'PATCH',body:{managerId:'u-manager'}})).status===404,'manager cannot take over a deal');

 // --- загрязнение прототипа и странные параметры ---
 r=await req('/api/clients/'+secret.id,{token:d,method:'PATCH',raw:'{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"name":"Секретный клиент"}'});
 check(r.status===200&&({}).polluted===undefined,'prototype pollution has no effect');
 check((await req('/api/clients?sort=__proto__',{token:d})).status===200,'sort by __proto__ does not crash');
 check((await req('/api/clients?archive=<script>',{token:d})).status===400,'invalid filter rejected');

 // --- телефония ---
 check((await req('/api/telephony/webhooks/mango',{method:'POST',body:{}})).status===401,'telephony webhook without key → 401');
 check((await req('/api/telephony/webhooks/mango',{method:'POST',body:{},headers:{authorization:'Bearer guess'}})).status===401,'telephony webhook with wrong key → 401');

 // --- PDF-шаблон не может загрузить внешние или локальные файлы ---
 const Documents=require('../lib/documents');const html=Documents.docHtml({legalEntities:[],clients:[],orders:[],objects:[]},{type:'invoice',items:[],renderContext:{client:{name:'<img src=file:///etc/passwd>'}}});
 check(/Content-Security-Policy" content="default-src 'none'/.test(html)&&!html.includes('<img src=file'),'PDF HTML escapes data and forbids loading any resource');

 // --- лимит сессий ---
 let tokens=[];for(let i=0;i<22;i++){const t=(await login('director@prometey.local','director')).body?.token;if(t)tokens.push(t)}
 check(tokens.length===22&&(await req('/api/me',{token:tokens[0]})).status===401&&(await req('/api/me',{token:tokens.at(-1)})).status===200,'oldest sessions closed above 20 per user');
 await req('/api/logout',{token:tokens.at(-1),method:'POST'});check((await req('/api/me',{token:tokens.at(-1)})).status===401,'logout revokes the token');

 // --- флуд анонимными запросами ---
 let blocked=0;for(let i=0;i<130;i++)if((await req('/api/session')).status===429)blocked++;
 check(blocked>0,'anonymous flood is throttled ('+blocked+' of 130 → 429)');

 console.log(`OK attack test: ${checks} checks`);
}finally{server.closeIdleConnections?.();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exit(1)});
