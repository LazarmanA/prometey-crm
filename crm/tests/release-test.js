const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function run(label,file){
 const r=spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',env:{...process.env,NODE_ENV:'test'}});
 if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);
 assert.equal(r.status,0,label+' failed');
}
function syntax(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['.git','node_modules'].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())syntax(p);else if(e.isFile()&&p.endsWith('.js')){const r=spawnSync(process.execPath,['--check',p],{encoding:'utf8'});assert.equal(r.status,0,'syntax: '+path.relative(root,p)+'\n'+r.stderr)}}}
(async()=>{
 syntax(root);console.log('PASS syntax: all JavaScript files');
 for(const [label,file] of [
  ['core','tests/smoke-test.js'],['database','tests/database-test.js'],['workspaces','tests/workspaces-test.js'],
  ['chat-contacts','tests/chat-contacts-test.js'],['calls','tests/calls-test.js'],['telephony','tests/telephony-test.js'],
  ['integrations','tests/integrations-test.js'],['security','tests/security-test.js'],['attacks','tests/attack-test.js'],['upd-5.03','tests/upd-sample-test.js'],['admin-feed','tests/admin-feed-test.js'],['accounting','tests/accounting-test.js'],['documents','tests/documents-test.js']
 ])run(label,file);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-release-'));
 process.env.NODE_ENV='production';process.env.HOST='127.0.0.1';process.env.PORT='0';
 process.env.DATA_FILE=path.join(root,'storage/data.demo.json');process.env.DB_FILE=path.join(temp,'prometey.sqlite');
 process.env.DOCUMENTS_DIR=path.join(temp,'documents');process.env.RECORDINGS_DIR=path.join(temp,'recordings');
 process.env.PROMETEY_ADMIN_EMAIL='release-admin@example.test';process.env.PROMETEY_ADMIN_PASSWORD='ReleaseAdmin!2026';
 process.env.PROMETEY_MANAGER_EMAIL='release-manager@example.test';process.env.PROMETEY_MANAGER_PASSWORD='ReleaseManager!2026';
 process.env.COOKIE_SECURE='false';
 const server=require('../server');
 try{
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',e=>e?reject(e):resolve()));const base='http://127.0.0.1:'+server.address().port;
  let r=await fetch(base+'/api/health');assert.equal(r.status,200);const health=await r.json();assert.equal(health.ok,true);assert.equal(health.version,require('../package.json').version);assert.equal(health.database,'ok');assert.equal(health.storage,'ok');assert.equal(health.pdfReady,true);assert.notEqual(health.pdfEngine,'none');assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  r=await fetch(base+'/');assert.equal(r.status,200);const html=await r.text();assert.match(html,/<title>ПРОМЕТЕЙ CRM<\/title>/);assert.match(html,/documents\.js/);
  r=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:process.env.PROMETEY_ADMIN_EMAIL,password:process.env.PROMETEY_ADMIN_PASSWORD})});assert.equal(r.status,200);const auth=await r.json();assert(auth.token);assert.equal(auth.user.role,'director');assert.equal(auth.user.passwordHash,undefined);assert.equal(auth.user.password,undefined);
  const headers={authorization:'Bearer '+auth.token,'content-type':'application/json'};
  r=await fetch(base+'/api/documents',{headers});assert.equal(r.status,403);assert.equal((await r.json()).code,'privacy_consent_required','production admin accepts the privacy policy first');
  const pol=await (await fetch(base+'/api/privacy',{headers})).json();r=await fetch(base+'/api/privacy/accept',{method:'POST',headers,body:JSON.stringify({agree:true,version:pol.version})});assert.equal(r.status,200);
  r=await fetch(base+'/api/documents',{headers});assert.equal(r.status,200);assert(Array.isArray(await r.json()));
  r=await fetch(base+'/api/logout',{method:'POST',headers});assert.equal(r.status,200);
  r=await fetch(base+'/api/documents',{headers});assert.equal(r.status,401);
  console.log('PASS release runtime: production credentials, health, security headers, UI shell, auth/session revocation, documents API, PDF engine');
 }finally{server.closeIdleConnections?.();await new Promise(resolve=>server.close(resolve))}
 fs.mkdirSync(process.env.DOCUMENTS_DIR,{recursive:true});fs.mkdirSync(process.env.RECORDINGS_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.DOCUMENTS_DIR,'probe.pdf'),'probe');fs.writeFileSync(path.join(process.env.RECORDINGS_DIR,'probe.wav'),'probe');
 const backupDir=path.join(temp,'backups');const backup=spawnSync(process.execPath,[path.join(root,'scripts/full-backup.js')],{cwd:root,encoding:'utf8',env:{...process.env,BACKUP_DIR:backupDir}});if(backup.stdout)process.stdout.write(backup.stdout);if(backup.stderr)process.stderr.write(backup.stderr);assert.equal(backup.status,0,'full backup failed');const backupName=fs.readdirSync(backupDir)[0],manifest=JSON.parse(fs.readFileSync(path.join(backupDir,backupName,'manifest.json'),'utf8'));assert.equal(manifest.documentFiles,1);assert.equal(manifest.recordingFiles,1);assert(manifest.databaseBytes>1000);console.log('PASS full backup: database, documents, recordings, manifest');
 fs.rmSync(temp,{recursive:true,force:true});
 console.log('PASS PROMETEY CRM 1.0 release gate');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
