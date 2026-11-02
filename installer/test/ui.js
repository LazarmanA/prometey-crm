const {chromium}=require('playwright');const {spawn,spawnSync}=require('node:child_process');const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const BIN=path.resolve(__dirname,'../dist/prometey-setup-linux');const base=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-ui-'));const shots=process.env.SHOTS;
function launch(uiPort){return new Promise((res,rej)=>{const p=spawn(BIN,['--base',base,'--no-browser','--ui-port',String(uiPort)],{env:{...process.env,PROMETEY_TEST_NODE:process.execPath}});let out='';p.stdout.on('data',d=>{out+=d;const m=out.match(/(http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+)/);if(m)res(m[1])});setTimeout(()=>rej(new Error(out)),15000)})}
(async()=>{let b;try{b=await chromium.launch({args:['--no-sandbox']});const pg=await b.newPage({viewport:{width:1100,height:860}});const errs=[];pg.on('pageerror',e=>errs.push(e.message));
 const shot=async n=>shots&&pg.screenshot({path:path.join(shots,n+'.png'),fullPage:true});
 await pg.goto(await launch(47201));await pg.locator('#steps li').first().waitFor();await pg.waitForTimeout(500);await shot('i1-progress');
 await pg.locator('#s3').waitFor({state:'visible',timeout:120000});await shot('i2-done');
 assert.equal(await pg.locator('#login').innerText(),'admin@prometey.local');assert.ok((await pg.locator('#pass').innerText()).length>=12);
 await pg.locator('#reset').click();await pg.waitForFunction(()=>!document.getElementById('reset').disabled,null,{timeout:120000});
 await pg.locator('#close').click();await pg.getByText('Окно можно закрыть').waitFor();await shot('i3-closed');
 const pg2=await b.newPage({viewport:{width:1100,height:860}});pg2.on('pageerror',e=>errs.push(e.message));await pg2.goto(await launch(47202));
 await pg2.locator('#s3').waitFor({state:'visible',timeout:120000});assert.match(await pg2.locator('#done-title').innerText(),/Обновлено/);assert.ok(await pg2.locator('#pass').isHidden());if(shots)await pg2.screenshot({path:path.join(shots,'i4-updated.png'),fullPage:true});
 assert.deepEqual(errs,[]);console.log('PASS installer UI: auto install → done with temp password → reset → update screen');
}catch(e){console.error(e);process.exitCode=1}finally{await b?.close();try{spawnSync(process.execPath,[path.join(base,'app','scripts','windows-launcher.js'),'--stop'])}catch{};try{spawnSync('pkill',['-f',base])}catch{};fs.rmSync(base,{recursive:true,force:true})}})();
