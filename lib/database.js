const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');
const TOUCHED=Symbol('touchedTables');
const TABLES=['users','sessions','clients','partners','objects','equipment','orders','orderItems','assignments','shifts','modules','audit','legalEntities','documents','documentSequences','documentVersions','leads','roles','departments','feed','realizations','payments','templates'];
// One row per entity; JSON preserves optional and future CRM fields without loss.
class Store {
 constructor(filename,seedFile){
  this.filename=path.resolve(filename);fs.mkdirSync(path.dirname(this.filename),{recursive:true});
  this.db=new DatabaseSync(this.filename);
  try{
   this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
   this.db.exec('BEGIN IMMEDIATE');
   const version=this.db.prepare('PRAGMA user_version').get().user_version;
   if(version>2)throw new Error('Database schema is newer than this application');
   this.db.exec('CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;');
   for(const t of TABLES){
    this.db.exec(`CREATE TABLE IF NOT EXISTS "${t}"(id TEXT PRIMARY KEY NOT NULL,position INTEGER NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload) AND json_type(payload)='object' AND json_extract(payload,'$.id')=id)) STRICT;`);
   }
   for(const [t,fields]of Object.entries({realizations:['clientId','date'],payments:['clientId','date'],feed:['createdAt'],clients:['inn','phone','name'],orders:['clientId','managerId','start'],objects:['managerId'],orderItems:['orderId','equipmentId'],assignments:['objectId','orderId','equipmentId'],shifts:['assignmentId','date'],audit:['at','entityId']}))for(const f of fields)this.db.exec(`CREATE INDEX IF NOT EXISTS "idx_${t}_${f}" ON "${t}"(json_extract(payload,'$.${f}'));`);
   if(!this.db.prepare("SELECT value FROM metadata WHERE key='initialized'").get()){
    const seed=JSON.parse(fs.readFileSync(seedFile,'utf8'));for(const t of TABLES)if(!Array.isArray(seed[t]))seed[t]=[];this.save(seed);
    this.db.prepare('INSERT INTO metadata VALUES(?,?)').run('initialized',new Date().toISOString());
   }
   this.db.exec('PRAGMA user_version=2; COMMIT');this.cache=null;this.pending=null;fs.chmodSync(this.filename,0o600);
  }catch(e){try{this.db.exec('ROLLBACK')}catch{}this.db.close();throw e}
 }
 read(){if(this.inTransaction)return this.readRows();this.db.exec('BEGIN');try{const data=this.readRows();this.db.exec('COMMIT');return data}catch(e){this.db.exec('ROLLBACK');throw e}}
 // In-memory snapshot cache. PRAGMA data_version changes only when ANOTHER connection commits,
 // so the cache is reused while this process is the only writer and reloaded otherwise.
 // Callers always receive a deep copy, so in-place mutations cannot corrupt the cache.
 dataVersion(){return this.db.prepare('PRAGMA data_version').get().data_version}
 invalidate(){this.cache=null}
 loadCache(){
  const extras=this.db.prepare("SELECT value FROM metadata WHERE key='extras'").get()?.value||'{}';
  const data=JSON.parse(extras),rows={};
  for(const t of TABLES){const list=this.db.prepare(`SELECT id,position,payload FROM "${t}" ORDER BY position`).all();rows[t]=new Map(list.map((r,i)=>[r.id,{payload:r.payload,position:i}]));data[t]=list.map(r=>JSON.parse(r.payload))}
  this.cache={version:this.dataVersion(),data,rows,extras};return this.cache;
 }
 readRows(){
  let c=this.cache;if(!c||c.version!==this.dataVersion())c=this.loadCache();
  // Lazy copy-on-access: a table is deep-copied only when the caller touches it.
  const data=structuredClone(Object.fromEntries(Object.entries(c.data).filter(([k])=>!TABLES.includes(k)))),touched=new Map();
  for(const t of TABLES)Object.defineProperty(data,t,{enumerable:true,configurable:true,get(){if(!touched.has(t))touched.set(t,structuredClone(c.data[t]));return touched.get(t)},set(v){touched.set(t,v)}});
  Object.defineProperty(data,TOUCHED,{value:touched,enumerable:false});return data;
 }
 save(data){
  let c=this.cache;if(!c||c.version!==this.dataVersion())c=this.loadCache();
  const nextRows={};
  for(const t of TABLES){
   const touched=data[TOUCHED];
   if(touched&&!touched.has(t)&&c.rows[t]){nextRows[t]=c.rows[t];continue}
   if(!Array.isArray(data[t]))throw new Error('Missing collection: '+t);
   const ids=new Set(),prev=c.rows[t]||new Map(),next=new Map();let put;
   data[t].forEach((row,i)=>{if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id))throw new Error('Invalid or duplicate ID in '+t);ids.add(row.id);const payload=JSON.stringify(row),old=prev.get(row.id);next.set(row.id,{payload,position:i});if(old&&old.payload===payload&&old.position===i)return;put??=this.db.prepare(`INSERT INTO "${t}"(id,position,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position,payload=excluded.payload WHERE position<>excluded.position OR payload<>excluded.payload`);put.run(row.id,i,payload)});
   let del;for(const id of prev.keys())if(!ids.has(id)){del??=this.db.prepare(`DELETE FROM "${t}" WHERE id=?`);del.run(id)}
   nextRows[t]=next;
  }
  const extrasObj=Object.fromEntries(Object.entries(data).filter(([k])=>!TABLES.includes(k))),extras=JSON.stringify(extrasObj);
  if(extras!==c.extras)this.db.prepare("INSERT INTO metadata(key,value) VALUES('extras',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(extras);
  const snapshot=JSON.parse(extras);for(const t of TABLES)snapshot[t]=nextRows[t]===c.rows[t]?c.data[t]:[...nextRows[t].values()].map(r=>JSON.parse(r.payload));
  this.pending={data:snapshot,rows:nextRows,extras};
 }
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');this.inTransaction=true;this.pending=null;try{const data=this.read(),result=fn(data);if(result&&typeof result.then==='function')throw new Error('Database transactions must be synchronous');if(result.changed)this.save(data);this.db.exec('COMMIT');if(this.pending)this.cache={...this.pending,version:this.dataVersion()};return result}catch(e){try{this.db.exec('ROLLBACK')}catch{}this.cache=null;throw e}finally{this.inTransaction=false;this.pending=null}}
 async backup(destination){destination=path.resolve(destination);if(destination===this.filename||fs.existsSync(destination))throw new Error('Backup destination must be a new file');fs.mkdirSync(path.dirname(destination),{recursive:true});await backup(this.db,destination);fs.chmodSync(destination,0o600);return destination}
 close(){this.db.close()}
}
module.exports={Store,TABLES};
