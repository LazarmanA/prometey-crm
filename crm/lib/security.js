const crypto=require('node:crypto');

const SCRYPT_OPTS={N:16384,r:8,p:1,maxmem:64*1024*1024};
function hashPassword(password){
 password=String(password||'');
 const salt=crypto.randomBytes(16);
 const key=crypto.scryptSync(password,salt,32,SCRYPT_OPTS);
 return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function isHash(value){return /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/i.test(String(value||''))}
const DUMMY_HASH=hashPassword(crypto.randomBytes(16).toString('hex'));
const MAX_PASSWORD_LENGTH=1024;
function verifyPassword(stored,password){
 stored=String(stored||'');password=String(password||'');
 if(password.length>MAX_PASSWORD_LENGTH)return false;
 if(isHash(stored)){
  const [,saltHex,keyHex]=stored.split('$');
  const actual=crypto.scryptSync(password,Buffer.from(saltHex,'hex'),32,SCRYPT_OPTS);
  return crypto.timingSafeEqual(actual,Buffer.from(keyHex,'hex'));
 }
 // Legacy compatibility (plain text from old seeds): compare digests so timing does not leak the length.
 if(!stored)return false;
 return crypto.timingSafeEqual(crypto.createHash('sha256').update(stored).digest(),crypto.createHash('sha256').update(password).digest());
}
// Spends the same scrypt time as a real check, so a missing account cannot be told apart by response time.
function burnPasswordCheck(password){verifyPassword(DUMMY_HASH,password);return false}
function tokenHash(token){return crypto.createHash('sha256').update(String(token||'')).digest('hex')}
function publicUser(user){const {password,passwordHash,envCredential,...safe}=user;return safe}
function bootstrapPasswords(store,env=process.env){
 const production=env.NODE_ENV==='production';
 const roleOverrides={
  director:{email:String(env.PROMETEY_ADMIN_EMAIL||'').trim(),password:String(env.PROMETEY_ADMIN_PASSWORD||'')},
  manager:{email:String(env.PROMETEY_MANAGER_EMAIL||'').trim(),password:String(env.PROMETEY_MANAGER_PASSWORD||'')}
 };
 return store.transaction(data=>{
  let changed=false;
  // Учётные данные из настроек сервера относятся только к первому руководителю и первому менеджеру.
  // Остальных сотрудников создают в разделе «Администрирование».
  const first={director:data.users.find(u=>u.role==='director'),manager:data.users.find(u=>u.role==='manager')};
  for(const user of data.users){
   const role=user===first.director?'director':user===first.manager?'manager':'';
   const override=role&&roleOverrides[role];
   const current=String(user.passwordHash||user.password||'');
   const defaultPassword=role==='director'?'director':role==='manager'?'manager':'';
   const stillDefault=!!defaultPassword&&verifyPassword(current,defaultPassword);
   // Режим первой регистрации (установщик для Windows): руководитель сам создаёт учётную запись в CRM, демо-входы закрыты (lib/onboarding.js).
   if(env.PROMETEY_SETUP==='1'&&role&&(!override.email||!override.password)){if(!isHash(current)&&current){user.passwordHash=hashPassword(current);delete user.password;changed=true}continue}
   // Менеджер из настроек сервера необязателен: если его не задали, демо-менеджер отключается (вход manager/manager невозможен),
   // а сотрудников руководитель добавляет в «Администрировании».
   if(production&&role==='manager'&&(!override.email||!override.password)){
    if(!user.disabled&&stillDefault){user.disabled=true;user.disabledAt=new Date().toISOString();data.sessions=(data.sessions||[]).filter(x=>x.userId!==user.id);changed=true}
    continue;
   }
   if(production&&role&&(!override.email||!override.password)){
    throw new Error('Production launch blocked: set PROMETEY_ADMIN_EMAIL/PROMETEY_ADMIN_PASSWORD and PROMETEY_MANAGER_EMAIL/PROMETEY_MANAGER_PASSWORD.');
   }
   if(production&&override){
    if(!/^\S+@\S+\.\S+$/.test(override.email))throw new Error('Production email is invalid for role '+role);
    if(override.password.length<12)throw new Error('Production password must contain at least 12 characters');
    // Отпечаток применённых значений: пароль, сменённый потом в интерфейсе, не сбрасывается при каждом перезапуске,
    // а новый пароль из настроек сервера (prometey passwords) применяется один раз.
    const fingerprint=crypto.createHash('sha256').update(override.email.toLowerCase()+'\n'+override.password).digest('hex');
    if(user.envCredential===fingerprint&&!stillDefault){if('password' in user){delete user.password;changed=true}continue}
    const clash=data.users.find(u=>u!==user&&String(u.email||'').toLowerCase()===override.email.toLowerCase());
    if(clash)throw new Error('Production email for role '+role+' is already used by another employee');
    if(String(user.email||'').toLowerCase()!==override.email.toLowerCase())delete user.privacyConsent;user.email=override.email;user.passwordHash=hashPassword(override.password);user.envCredential=fingerprint;if(role==='director'&&env.PROMETEY_ADMIN_MUST_CHANGE==='1')user.mustChangePassword=true;
    data.sessions=(data.sessions||[]).filter(x=>x.userId!==user.id);delete user.password;changed=true;
    continue;
   }
   if(production&&stillDefault)throw new Error('Production launch blocked: demo credentials are not allowed.');
   if(!isHash(current)&&current){user.passwordHash=hashPassword(current);delete user.password;changed=true}
  }
  return {changed};
 });
}
function cookieToken(req){
 const raw=String(req.headers.cookie||'');
 for(const part of raw.split(';')){const [k,...v]=part.trim().split('=');if(k==='prometey_session')return decodeURIComponent(v.join('='))}
 return '';
}
function setSessionCookie(res,token,{secure=false,maxAge=86400}={}){
 const attrs=[`prometey_session=${encodeURIComponent(token)}`,'Path=/','HttpOnly','SameSite=Strict',`Max-Age=${maxAge}`];if(secure)attrs.push('Secure');res.setHeader('Set-Cookie',attrs.join('; '));
}
function clearSessionCookie(res,{secure=false}={}){const attrs=['prometey_session=','Path=/','HttpOnly','SameSite=Strict','Max-Age=0'];if(secure)attrs.push('Secure');res.setHeader('Set-Cookie',attrs.join('; '))}
// Content-Security-Policy: scripts only from this server; Yandex Maps domains are added only when a maps key is configured.
function contentSecurityPolicy({maps=false}={}){
 const y=maps?' https://api-maps.yandex.ru https://*.api-maps.yandex.ru https://yastatic.net https://*.yandex.ru https://*.yandex.net https://*.maps.yandex.net':'';
 return [
  "default-src 'self'",
  "script-src 'self'"+(maps?" 'unsafe-eval'"+y:''),
  "style-src 'self' 'unsafe-inline'"+(maps?' blob:'+y:''),
  "img-src 'self' data: blob:"+y,
  "font-src 'self' data:",
  "connect-src 'self'"+y,
  "frame-src "+(maps?y.trim():"'none'"),
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
 ].join('; ');
}
function securityHeaders(res,{secure=false,maps=false}={}){
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), usb=()');
 res.setHeader('Cross-Origin-Opener-Policy','same-origin');
 res.setHeader('Cross-Origin-Resource-Policy','same-origin');
 res.setHeader('X-Permitted-Cross-Domain-Policies','none');
 res.setHeader('Content-Security-Policy',contentSecurityPolicy({maps}));
 if(secure)res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
}
// Sliding-window counters kept in memory. Each limiter is bounded so a flood of random keys cannot exhaust memory.
function createLimiter({limit,windowMs,maxKeys=50000}){
 const hits=new Map();let sweep=0;
 function prune(now){if(now-sweep<windowMs&&hits.size<maxKeys)return;sweep=now;for(const [k,v] of hits)if(v.reset<=now)hits.delete(k);while(hits.size>=maxKeys)hits.delete(hits.keys().next().value)}
 return {
  check(key,now=Date.now()){const v=hits.get(key);return !v||v.reset<=now||v.count<limit},
  retryAfter(key,now=Date.now()){const v=hits.get(key);return v&&v.reset>now?Math.ceil((v.reset-now)/1000):0},
  hit(key,now=Date.now()){prune(now);let v=hits.get(key);if(!v||v.reset<=now){v={count:0,reset:now+windowMs};hits.set(key,v)}v.count++;return v.count<=limit},
  reset(key){hits.delete(key)},
  size(){return hits.size}
 };
}
function trustProxy(env=process.env){return /^(1|true|yes)$/i.test(String(env.TRUST_PROXY||''))}
// Client address. X-Forwarded-For is honoured only behind our own reverse proxy (TRUST_PROXY=1);
// the right-most entry is the one appended by that proxy, so a forged header from the client is ignored.
function clientIp(req,env=process.env){
 const socket=String(req.socket?.remoteAddress||'').replace(/^::ffff:/,'');
 if(!trustProxy(env))return socket.slice(0,100);
 const real=String(req.headers['x-real-ip']||'').trim();if(real)return real.slice(0,100);
 const list=String(req.headers['x-forwarded-for']||'').split(',').map(s=>s.trim()).filter(Boolean);
 return (list.at(-1)||socket).slice(0,100);
}
function secureRequest(req,env=process.env){
 const forced=String(env.COOKIE_SECURE||'').toLowerCase();if(forced==='true')return true;if(forced==='false')return false;
 if(req.socket?.encrypted)return true;
 return trustProxy(env)&&String(req.headers['x-forwarded-proto']||'').split(',')[0].trim()==='https';
}
// CSRF defence in depth (cookies are already SameSite=Strict): a browser request that changes data
// must come from a page of this same site. Requests without Origin/Referer (API clients, curl) are allowed.
function sameOrigin(req){
 const host=String(req.headers['x-forwarded-host']&&trustProxy()?req.headers['x-forwarded-host']:req.headers.host||'').split(',')[0].trim().toLowerCase();
 const source=req.headers.origin||req.headers.referer;
 if(!source)return String(req.headers['sec-fetch-site']||'')!=='cross-site';
 if(source==='null')return false;
 try{return new URL(source).host.toLowerCase()===host}catch{return false}
}
module.exports={hashPassword,isHash,verifyPassword,burnPasswordCheck,contentSecurityPolicy,createLimiter,trustProxy,clientIp,secureRequest,sameOrigin,MAX_PASSWORD_LENGTH,tokenHash,publicUser,bootstrapPasswords,cookieToken,setSessionCookie,clearSessionCookie,securityHeaders};
