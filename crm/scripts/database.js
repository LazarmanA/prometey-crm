const path=require('node:path');
const {Store}=require('../lib/database');
const root=path.resolve(__dirname,'..');
const seed=process.env.DATA_FILE||path.join(root,'storage/data.demo.json');
const filename=process.env.DB_FILE||(process.env.DATA_FILE?seed+'.sqlite':path.join(root,'storage/prometey.sqlite'));
(async()=>{const store=new Store(filename,seed);try{switch(process.argv[2]||'status'){
 case 'init':case 'status':console.log(JSON.stringify({database:store.filename,collections:Object.fromEntries(Object.entries(store.read()).map(([k,v])=>[k,Array.isArray(v)?v.length:typeof v]))},null,2));break;
 case 'backup':{const dest=process.argv[3]||path.join(root,'storage/backups/prometey-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');console.log('Backup saved: '+await store.backup(dest));break}
 default:throw new Error('Usage: node scripts/database.js [init|status|backup [new-file.sqlite]]');
}}finally{store.close()}})().catch(e=>{console.error(e.message);process.exitCode=1});
