'use strict';
// Компании: ответственный, массовые действия (ответственный, задача, архив, удаление — только админ), лента и история карточки.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prometey-co-'));process.env.DATA_FILE=path.join(temp,'data.json');process.env.PROMETEY_CHROMIUM='/nonexistent';
fs.copyFileSync(path.join(__dirname,'../storage/data.demo.json'),process.env.DATA_FILE);const server=require('../server');let base,checks=0;
const ok=(c,l)=>{assert.ok(c,l);checks++;console.log('PASS',l)};
async function req(p,t,method='GET',body){const r=await fetch(base+p,{method,headers:{...(t?{Authorization:'Bearer '+t}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)}}
(async()=>{try{await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 const login=async role=>{const t=(await req('/api/login',null,'POST',{email:role+'@prometey.local',password:role})).body.token;const pv=await req('/api/privacy',t);await req('/api/privacy/accept',t,'POST',{agree:true,version:pv.body.version});return t};
 const D=await login('director'),M=await login('manager');const D_=()=>server.store.read();
 // компания с одним названием; ответственный при создании
 let r=await req('/api/clients',M,'POST',{name:'Только название'});ok(r.status===201&&r.body.managerId==='u-manager','company with just a name; creator is responsible');const solo=r.body.id;
 r=await req('/api/clients',M,'POST',{name:'Чужая',managerId:'u-director'});ok(r.status===403,'manager cannot assign another responsible');
 r=await req('/api/clients',D,'POST',{name:'Для менеджера',managerId:'u-manager'});ok(r.status===201&&r.body.managerId==='u-manager','director creates a company for a manager');
 r=await req('/api/clients/'+solo,M,'PATCH',{phone:'+7 900 000-00-01'});ok(r.status===200,'imported-style company edits without request date and address');
 // массовые действия
 const ids=[];for(let i=0;i<5;i++)ids.push((await req('/api/clients',D,'POST',{name:'Массовая '+i})).body.id);
 r=await req('/api/clients/bulk',M,'POST',{ids,action:'owner',managerId:'u-manager'});ok(r.status===403,'manager cannot reassign in bulk');
 r=await req('/api/clients/bulk',D,'POST',{ids,action:'owner',managerId:'u-manager'});ok(r.status===200&&r.body.done===5&&ids.every(id=>D_().clients.find(c=>c.id===id).managerId==='u-manager'),'director reassigns 5 companies at once');
 r=await req('/api/clients/bulk',D,'POST',{ids,action:'task',title:'Позвонить, предложить автокран',due:'2026-11-20'});ok(r.body.done===5&&D_().clients.find(c=>c.id===ids[0]).workspace[0].type==='task','task added to each selected company');
 r=await req('/api/clients/bulk',M,'POST',{ids:ids.slice(0,2),action:'archive'});ok(r.body.done===2&&D_().clients.find(c=>c.id===ids[0]).archivedAt,'responsible manager archives selected');
 r=await req('/api/clients/bulk',M,'POST',{ids:ids.slice(0,2),action:'restore'});ok(r.body.done===2,'and restores them');
 r=await req('/api/clients/bulk',D,'POST',{ids:[ids[4]],action:'delete'});const isAdmin=r.status===200;
 const adminLogin=isAdmin?D:null;ok(r.status===200||r.status===403,'delete: admin only');
 r=await req('/api/clients/bulk',M,'POST',{ids:[ids[3]],action:'delete'});ok(r.status===403,'manager cannot delete');
 if(adminLogin){r=await req('/api/clients/bulk',D,'POST',{ids:['c1',ids[3]],action:'delete'});ok(r.body.done===1&&r.body.skipped[0].reason.includes('архив')&&D_().clients.some(c=>c.id==='c1')&&!D_().clients.some(c=>c.id===ids[3]),'company with deals is not deleted, empty one is')}
 r=await req('/api/clients/bulk',D,'POST',{ids:[],action:'owner'});ok(r.status===400,'empty selection refused');
 // лента и история
 r=await req('/api/workspaces/clients/c1/items',M,'POST',{type:'comment',content:'Прораб просит подачу к 8:00'});ok(r.status===201,'comment without a title');
 r=await req('/api/workspaces/clients/c1/items',M,'POST',{type:'comment',content:''});ok(r.status===400,'empty comment refused');
 await req('/api/workspaces/clients/c1/owner',D,'PATCH',{managerId:'u-manager'});
 await req('/api/accounting/payments',D,'POST',{clientId:'c1',amount:50000,date:'2026-11-10',number:'12'});
 r=await req('/api/workspaces/clients/c1',D);const tl=r.body.timeline;const kinds=new Set(tl.map(e=>e.kind));
 ok(r.status===200&&kinds.has('comment')&&kinds.has('deal')&&kinds.has('payment')&&kinds.has('log')&&r.body.canAssign===true,'timeline: comments, deals, payments and history');
 ok(tl.every((e,i)=>!i||String(tl[i-1].at)>=String(e.at)),'timeline is newest first');
 r=await req('/api/workspaces/clients/c1',M);ok(r.status===200&&r.body.canAssign===false&&r.body.timeline.some(e=>e.kind==='comment'),'manager sees the feed but cannot reassign');
 console.log(`OK companies: ${checks} checks`);
}catch(e){console.error(e);process.exitCode=1}finally{server.close();fs.rmSync(temp,{recursive:true,force:true})}})();
