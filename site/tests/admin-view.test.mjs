import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import {renderToStaticMarkup} from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';
import {ADMIN_PAGES,ageLabel,agentState,needsAttention,pollWhileVisible} from '../lib/admin-view.mjs';
import * as audit from '../lib/admin-report-view.mjs';
import * as fleetPolicy from '../lib/fleet-policy.mjs';

test('admin navigation and status preserve paused, unknown and last receipt semantics',()=>{
 assert.deepEqual(ADMIN_PAGES.map(p=>p.label),['總覽','機隊','情報','更多']);
 const a={enabled:true,paused:false,online:true,current_target_id:1,health:{status:'healthy'}};
 assert.equal(agentState(a),'掃描中');assert.equal(needsAttention(a),false);
 assert.equal(needsAttention({...a,online:false}),true);
 assert.equal(needsAttention({...a,online:false,paused:true}),false);
 assert.equal(agentState({...a,paused:true}),'已暫停');
 assert.equal(agentState({...a,enabled:false}),'已停用');
 assert.equal(ageLabel(null,1000),'尚未回報');assert.equal(ageLabel(1000,121000),'2 分鐘前');
});
test('polling skips hidden pages, resumes visibility and cannot overlap or restart after disposal',async()=>{
 let id=0,calls=0,release;const pending=new Map(),listeners=new Map();
 const timers={setTimeout(fn){pending.set(++id,fn);return id},clearTimeout(n){pending.delete(n)}};
 const doc={hidden:true,addEventListener(k,v){listeners.set(k,v)},removeEventListener(k){listeners.delete(k)}};
 const stop=pollWhileVisible(()=>{calls++;return new Promise(r=>{release=r})},1000,doc,timers);
 await [...pending.values()][0]();assert.equal(calls,0);
 doc.hidden=false;listeners.get('visibilitychange')();assert.equal(calls,1);
 listeners.get('visibilitychange')();assert.equal(calls,1);
 stop();release();await new Promise(r=>setImmediate(r));assert.equal(pending.size,0);assert.equal(listeners.size,0);
});
test('protected report summary counts whole batches, latest chunks and confirmed message IDs',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE report_audit_events(key TEXT PRIMARY KEY,batch TEXT,phase TEXT,kind TEXT,at INTEGER,payload TEXT)');
 const put=(key,phase,at,rows)=>db.prepare('INSERT INTO report_audit_events VALUES(?,?,?,?,?,?)').run(key,'batch-test',phase,'large',at,JSON.stringify({key,batch:'batch-test',phase,kind:'large',at,window:[100,200],rows}));
 for(let chunk=0;chunk<60;chunk++)put('c'+chunk,'candidates',100,[{id:'id'+chunk,reason:'candidate'}]);
 put('old','selection',99,[{id:'old',reason:'eligible'}]);
 put('new','selection',101,[{id:'a',reason:'eligible'},{id:'b',reason:'participants_full'}]);
 put('d','delivery',102,[{id:'chunk0',reason:'sent',message_id:'123'},{id:'chunk1',reason:'sent',message_id:''},{id:'chunk2',reason:'uncertain'}]);
 put('empty','verification',100,[]);
 let authorized=true;
 const adapter={prepare(sql){let binds=[];return{bind(...b){binds=b;return this},async all(){return{results:db.prepare(sql).all(...binds)}}}}};
 const exports={};new Script(ts.transpileModule(readFileSync(new URL('../app/api/admin/report-audit/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports,URL,require(p){
  if(p.endsWith('/cloud'))return{adminAuthorized:()=>authorized,runtime:()=>({DB:adapter}),noStoreJson:(d,status=200)=>Response.json(d,{status})};
  if(p.endsWith('/admin-report-view.mjs'))return audit;throw Error(p);
 }});
 const response=await exports.GET(new Request('https://example.test/api/admin/report-audit?view=summary'));assert.equal(response.status,200);const body=await response.json();
 assert.equal(body.phases.find(p=>p.phase==='candidates').items,60);
 const selection=body.phases.find(p=>p.phase==='selection');assert.equal(selection.items,2);assert.equal(selection.eligible,1);
 assert.equal(body.phases.find(p=>p.phase==='verification').items,0);
 assert.equal(audit.deliveryLabel(body.phases.find(p=>p.phase==='delivery')),'送達不明，需核對');
 assert.equal(audit.deliveryLabel(undefined),'尚無送達紀錄');
 assert.equal(audit.deliveryLabel({items:1,confirmed:1}),'已確認送達 1 段訊息');
 assert.equal(body.reasons.length,2);
 assert.equal((await (await exports.GET(new Request('https://example.test/api/admin/report-audit'))).json()).events.length,50);
 authorized=false;assert.equal((await exports.GET(new Request('https://example.test/api/admin/report-audit?view=summary'))).status,403);
 db.close();
});

test('actual admin component renders only the selected surface and preserves native disclosures',()=>{
 const source=ts.transpileModule(readFileSync(new URL('../app/admin/admin-client.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const firstStart=Date.parse('2026-11-03T07:00:00+08:00');
 const secondStart=Date.parse('2026-11-03T10:30:00+08:00');
 const fleetPage=ADMIN_PAGES.find(page=>page.id==='fleet');
 const cases=[
  ...ADMIN_PAGES.map(page=>({page})),
  {page:fleetPage,cycle:0,starts:[],expected:['第一輪開始於 <time','2026-11-03 07:00']},
  {page:fleetPage,cycle:2,starts:[{cycle:1,started_at:secondStart}],
   expected:['第一輪開始於 <time','第二輪開始於 <time','2026-11-03 10:30','第三輪開始時間尚無紀錄']},
 ];
 for(const {page,cycle,starts,expected} of cases){
  let state=0;const exports={};
  const dashboard=cycle===undefined?null:{
   job:{id:999,cycle,started_at:firstStart, status:'running',current_index:2,total_points:10},
   cycle_starts:starts,agents:[],logs:[],rotation:{enabled:false},
  };
  new Script(source).runInNewContext({exports,Intl,Date,URL,require(p){
   if(p==='react')return {useState(initial){const index=state++;return[index===0?dashboard:index===1?page.id:initial,()=>{}]},useCallback:f=>f,useMemo:f=>f(),useRef:initial=>({current:initial})};
   if(p==='react/jsx-runtime')return jsx;
   if(p==='next/link')return{__esModule:true,default:({children,href})=>jsx.jsx('a',{href,children})};
   if(p.endsWith('/report-audit'))return{__esModule:true,default:()=>jsx.jsx('div',{children:'情報流程測試入口'})};
   if(p.endsWith('/gps-settings'))return{__esModule:true,default:()=>jsx.jsx('div',{children:'GPS 複製密碼'})};
   if(p.endsWith('/use-visible-polling'))return{useVisiblePolling(){}};
   if(p.endsWith('/admin-view.mjs'))return{ADMIN_PAGES,agentState,needsAttention,ageLabel};
   if(p.endsWith('/scan-plans'))return{COUNTRY_PACK_LABELS:[]};
   if(p.endsWith('/fleet-policy.mjs'))return fleetPolicy;
   if(p.endsWith('.css'))return{__esModule:true,default:new Proxy({},{get:(_,k)=>k})};throw Error(p);
  }});
  const html=renderToStaticMarkup(jsx.jsx(exports.default,{displayName:'Test admin',signOutPath:'/signout'}));
  assert.equal((html.match(/aria-pressed="true"/g)||[]).length,page.id==='fleet'?1+0+1:1); // active page, plus default scan-density button
  assert.equal(html.includes('機隊總覽'),page.id==='overview');
  assert.equal(html.includes('全球掃描節點'),page.id==='fleet');
  assert.equal(html.includes('情報流程測試入口'),page.id==='reports');
  assert.equal(html.includes('使用者行為與複製紀錄'),page.id==='more');
  assert.equal(html.includes('open=""'),false);
  assert.equal(html.includes('min-height: 560px'),false);
  for(const line of expected??[])assert.ok(html.includes(line),line);
  if(cycle===0)assert.doesNotMatch(html,/第二輪/);
 }
});

test('dashboard city belongs to a live owned lease and log omission is opt-in',async()=>{
 const now=Date.now(),db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE scan_agents(id TEXT,enabled INTEGER,last_seen INTEGER,current_target_id INTEGER,current_job_id INTEGER,token_hash TEXT);
 CREATE TABLE scan_targets(id INTEGER,job_id INTEGER,lease_agent_id TEXT,status TEXT,lease_expires_at INTEGER,country TEXT,city TEXT,
   sequence INTEGER,cycle INTEGER,verification_kind TEXT,created_at INTEGER);
 CREATE TABLE scan_target_history(job_id INTEGER,cycle INTEGER,verification_kind TEXT,archived_at INTEGER);
 CREATE TABLE scan_logs(id INTEGER,job_id INTEGER,at INTEGER,level TEXT,message TEXT);`);
 const a=db.prepare('INSERT INTO scan_agents VALUES(?,1,?, ?,1,?)');
 for(let i=1;i<=4;i++)a.run('a'+i,now,i,'secret-hash');
 const t=db.prepare('INSERT INTO scan_targets (id,job_id,lease_agent_id,status,lease_expires_at,country,city) VALUES(?,?,?,?,?,?,?)');
 t.run(1,1,'a1','leased',now+60000,'國家','城市');
 t.run(2,1,'someone-else','leased',now+60000,'錯誤國家','錯誤城市');
 t.run(3,1,'a3','leased',now-60000,'過期','過期');
 t.run(4,2,'a4','leased',now+60000,'舊工作','舊工作');
 db.exec(`UPDATE scan_targets SET sequence=0,cycle=3,verification_kind='',created_at=400 WHERE id=1;
 INSERT INTO scan_target_history VALUES
   (1,0,'',200),(1,0,'',300),(1,1,'',300),(1,4,'candidate',300),
   (1,3,'',500),(2,0,'',150);`);
 db.exec("INSERT INTO scan_logs VALUES(1,1,1,'info','test')");
 const adapter={prepare(sql){let binds=[];return{bind(...b){binds=b;return this},async all(){return{results:db.prepare(sql).all(...binds)}}}}};
 const exports={};const source=readFileSync(new URL('../app/api/admin/scans/route.ts',import.meta.url),'utf8');
 new Script(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports,URL,Date,require(p){
  if(p.endsWith('/cloud'))return{adminAuthorized:()=>true,ensureSchema:async()=>{},runtime:()=>({DB:adapter}),noStoreJson:d=>Response.json(d)};
  if(p.endsWith('/scans'))return{activeOrLatestJob:async()=>({id:1,cycle:3,started_at:100}),publicJob:x=>x};
  if(p.endsWith('/fleet'))return{publicAgent:a=>({id:a.id,online:true,uploaded_rows:0,uploaded_bytes:0})};
  if(p.endsWith('/rotation'))return{rotationStatus:async()=>({enabled:true})};
  if(p.endsWith('/target-ack-evidence.mjs'))return{parseTargetAckEvidence(){throw Error('default dashboard must not enter evidence mode')},readTargetAckEvidence(){throw Error('default dashboard must not read evidence')}};
  throw Error(p);
 }});
 const get=async suffix=>(await exports.GET(new Request('https://example.test/api/admin/scans'+suffix))).json();
 const body=await get('?logs=0');assert.equal(body.logs.length,0);assert.equal(body.agents[0].current_city,'城市');
 assert.deepEqual(body.cycle_starts,[
  {cycle:1,started_at:200},{cycle:2,started_at:300},{cycle:3,started_at:400},
 ]);
 assert.ok(body.agents.slice(1).every(a=>a.current_city===''));assert.equal(JSON.stringify(body).includes('secret-hash'),false);
 assert.equal((await get('')).logs.length,1);db.close();
});
