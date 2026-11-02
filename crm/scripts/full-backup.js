const fs=require('node:fs');
const path=require('node:path');
const {Store}=require('../lib/database');
const root=path.resolve(__dirname,'..');
const seed=process.env.DATA_FILE||path.join(root,'storage/data.demo.json');
const database=path.resolve(process.env.DB_FILE||path.join(root,'storage/prometey.sqlite'));
const sourceRoot=path.dirname(database);
const recordings=path.resolve(process.env.RECORDINGS_DIR||path.join(sourceRoot,'recordings'));
const documents=path.resolve(process.env.DOCUMENTS_DIR||path.join(sourceRoot,'documents'));
const uploads=path.resolve(process.env.UPLOADS_DIR||path.join(sourceRoot,'uploads'));
const backups=path.resolve(process.env.BACKUP_DIR||path.join(root,'backups'));
function stamp(){return new Date().toISOString().replace(/[:.]/g,'-')}
function copyDir(src,dst){if(!fs.existsSync(src))return 0;fs.cpSync(src,dst,{recursive:true,force:false,errorOnExist:true});let n=0;const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else n++}};walk(dst);return n}
(async()=>{
 if(!fs.existsSync(database))throw new Error('Database not found: '+database);
 const dir=path.join(backups,'prometey-'+stamp());fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const store=new Store(database,seed);let dbCopy;
 try{dbCopy=await store.backup(path.join(dir,'prometey.sqlite'))}finally{store.close()}
 const documentFiles=copyDir(documents,path.join(dir,'documents'));
 const recordingFiles=copyDir(recordings,path.join(dir,'recordings'));
 const uploadFiles=copyDir(uploads,path.join(dir,'uploads'));
 const manifest={createdAt:new Date().toISOString(),version:require('../package.json').version,database:path.basename(dbCopy),databaseBytes:fs.statSync(dbCopy).size,documentFiles,recordingFiles,uploadFiles};
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({ok:true,backup:dir,...manifest},null,2));
})().catch(e=>{console.error('Backup failed: '+e.message);process.exitCode=1});
