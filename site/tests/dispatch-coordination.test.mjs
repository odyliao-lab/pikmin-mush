import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import {ensureDispatchSchema,admitDispatch,dispatchProof,dispatchInventory,closeDispatch,recoverCancelledReturn} from '../lib/dispatch-coordination.mjs';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE scan_jobs(id INTEGER PRIMARY KEY,cycle INTEGER,status TEXT);
 CREATE TABLE scan_agents(id TEXT PRIMARY KEY,enabled INTEGER,paused INTEGER,last_seen INTEGER,current_lat REAL,current_lng REAL);
 CREATE TABLE scan_targets(id INTEGER PRIMARY KEY,job_id INTEGER,sequence INTEGER,cycle INTEGER,country TEXT,city TEXT,
 lat REAL,lng REAL,region_index INTEGER,point_index INTEGER,base_cooldown_s INTEGER,status TEXT,priority INTEGER,
 required_agent_id TEXT,verification_batch TEXT,verification_mushroom_id TEXT,verification_kind TEXT,
 created_at INTEGER,updated_at INTEGER,leased_at INTEGER DEFAULT 0,completed_at INTEGER DEFAULT 0,completed_agent_id TEXT DEFAULT '');
 CREATE TABLE scan_target_history AS SELECT * FROM scan_targets WHERE 0;
 CREATE TABLE mushroom_observations(key TEXT PRIMARY KEY,target_id INTEGER,agent_id TEXT,received_at INTEGER);
 INSERT INTO scan_jobs VALUES(1,0,'running');INSERT INTO scan_agents VALUES('leo',1,0,100000,1,2);`);
 const db={prepare(text){let args=[];return {bind(...v){args=v;return this;},
  async first(){return sql.prepare(text).get(...args)??null;},async all(){return {results:sql.prepare(text).all(...args)};},
  async run(){return {meta:sql.prepare(text).run(...args)};},exec(){return sql.prepare(text).run(...args);}};},
  async batch(ss){sql.exec('BEGIN IMMEDIATE');try{const r=ss.map(s=>s.exec());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const agent={id:'leo',enabled:1,paused:0,last_seen:100000,current_lat:1,current_lng:2,country:'X'};
 const job={id:1,cycle:0,status:'running'};
 const input={batch:'manual-one',owner:'taichung-one',agentId:'leo',kind:'candidate',candidates:[{id:'p',lat:3,lng:4}]};
 return {sql,db,agent,job,input};
}

function second(f,id,batch){
 f.sql.prepare('INSERT INTO scan_agents VALUES(?,1,0,100000,1,2)').run(id);
 return {agent:{...f.agent,id},input:{...f.input,batch,agentId:id,parallel:true,candidates:[{id:batch,lat:3,lng:4}]}};
}
test('parallel mode permits three distinct agents under one owner; legacy remains exclusive',async()=>{
 const f=fixture();await ensureDispatchSchema(f.db);const first={...f.input,parallel:true};
 assert.equal((await admitDispatch(f.db,first,f.agent,f.job,100000)).http,200);
 const two=second(f,'aries','parallel-two'),three=second(f,'libra','parallel-three'),four=second(f,'gemini','parallel-four');
 assert.equal((await admitDispatch(f.db,{...two.input,owner:'foreign'},two.agent,f.job,100000)).http,409);
 assert.equal((await admitDispatch(f.db,{...first,batch:'same-agent'},f.agent,f.job,100000)).http,409);
 assert.equal((await admitDispatch(f.db,{...two.input,parallel:false},two.agent,f.job,100000)).http,409);
 assert.equal((await admitDispatch(f.db,two.input,two.agent,f.job,100000)).http,200);
 assert.equal((await admitDispatch(f.db,three.input,three.agent,f.job,100000)).http,200);
 assert.equal((await admitDispatch(f.db,four.input,four.agent,f.job,100000)).http,409);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM controller_dispatches WHERE state='active'").get().n,3);
 assert.equal((await dispatchProof(f.db,first.batch)).parallel,true);f.sql.close();
});
test('parallel admission retains old admission, unknown queue and duplicate-location barriers',async()=>{
 for(const mode of ['legacy-admission','legacy-queue','duplicate']){
  const f=fixture();await ensureDispatchSchema(f.db);const two=second(f,'aries','parallel-two');
  if(mode==='legacy-admission')await admitDispatch(f.db,f.input,f.agent,f.job,100000);
  if(mode==='legacy-queue')f.sql.exec("INSERT INTO scan_targets(verification_batch,verification_kind,status,required_agent_id) VALUES('unknown','return','queued','other')");
  if(mode==='duplicate'){
   await admitDispatch(f.db,{...f.input,parallel:true},f.agent,f.job,100000);
   two.input.candidates=f.input.candidates;
  }
  assert.equal((await admitDispatch(f.db,two.input,two.agent,f.job,100000)).http,409,mode);f.sql.close();
 }
});
test('additive parallel migration retains unresolved legacy claim and blocks takeover',async()=>{
 const f=fixture();f.sql.exec(readFileSync(new URL('../drizzle/0028_fresh_black_tom.sql',import.meta.url),'utf8'));
 f.sql.exec("INSERT INTO controller_dispatches(batch,owner,payload_sha,admission,agent_id,job_id,candidate_count,state,created_at) VALUES('old-one','owner','hash','cap','leo',1,1,'active',1)");
 f.sql.exec(readFileSync(new URL('../drizzle/0034_robust_clint_barton.sql',import.meta.url),'utf8'));
 const old=f.sql.prepare('SELECT parallel_mode,state FROM controller_dispatches').get();assert.equal(old.parallel_mode,0);assert.equal(old.state,'active');
 await ensureDispatchSchema(f.db);const two=second(f,'aries','parallel-two');
 assert.equal((await admitDispatch(f.db,two.input,two.agent,f.job,100000)).http,409);f.sql.close();
});

test('closing one parallel Agent requires its own proof and preserves the other Agent queue',async()=>{
 const f=fixture();await ensureDispatchSchema(f.db);
 await admitDispatch(f.db,{...f.input,parallel:true},f.agent,f.job,100000);
 const two=second(f,'aries','parallel-two');await admitDispatch(f.db,two.input,two.agent,f.job,100000);
 f.sql.exec("UPDATE scan_targets SET status='completed',leased_at=101000,completed_at=110000,completed_agent_id='leo' WHERE required_agent_id='leo'");
 f.sql.exec("INSERT INTO scan_targets(id,job_id,verification_kind,status,leased_at,completed_at,completed_agent_id) VALUES(9,1,'','completed',111000,120000,'leo');INSERT INTO mushroom_observations VALUES('resume',9,'leo',115)");
 assert.equal((await closeDispatch(f.db,f.input.batch,f.input.owner,121000)).http,200);
 assert.equal((await dispatchProof(f.db,two.input.batch)).state,'active');
 assert.equal((await dispatchProof(f.db,two.input.batch)).can_close,false);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM scan_targets WHERE required_agent_id='aries' AND status='queued'").get().n,2);
 f.sql.close();
});
test('atomic sticky admission, immutable replay, no expiry stealing or second owner',async()=>{
 const f=fixture();await ensureDispatchSchema(f.db);
 assert.equal((await admitDispatch(f.db,f.input,f.agent,f.job,100000)).http,200);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM scan_targets').get().n,2);
 assert.equal((await admitDispatch(f.db,f.input,f.agent,f.job,100001)).existing,true);
 assert.equal((await admitDispatch(f.db,{...f.input,candidates:[{id:'q',lat:3,lng:4}]},f.agent,f.job,100002)).http,409);
 assert.equal((await admitDispatch(f.db,{...f.input,batch:'manual-two',owner:'other'},f.agent,f.job,100000)).http,409);
 f.sql.exec("UPDATE scan_targets SET status='cancelled'");
 assert.equal((await admitDispatch(f.db,{...f.input,batch:'manual-two'},f.agent,f.job,100000)).http,409);
 assert.equal((await closeDispatch(f.db,f.input.batch,f.input.owner,200000)).http,409);
 f.sql.close();
});
test('legacy pending or return, paused/offline agent, changed job/position block admission',async()=>{
 for(const change of ["UPDATE scan_agents SET paused=1","UPDATE scan_agents SET enabled=0",
  "UPDATE scan_agents SET last_seen=1","UPDATE scan_agents SET current_lat=9","UPDATE scan_jobs SET status='paused'",
  "INSERT INTO scan_targets(verification_batch,verification_kind,status) VALUES('legacy','return','leased')"]){
  const f=fixture();await ensureDispatchSchema(f.db);f.sql.exec(change);
  assert.equal((await admitDispatch(f.db,f.input,f.agent,f.job,100000)).http,409,change);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM controller_dispatches').get().n,0);f.sql.close();
 }
});
test('terminal or archived unregistered batch IDs cannot be adopted or reused',async()=>{
 for(const table of ['scan_targets','scan_target_history']){
  const f=fixture();await ensureDispatchSchema(f.db);
  f.sql.prepare(`INSERT INTO ${table}(verification_batch,verification_kind,status) VALUES(?,'candidate','completed')`).run(f.input.batch);
  assert.equal((await admitDispatch(f.db,f.input,f.agent,f.job,100000)).http,409);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM controller_dispatches').get().n,0);
  assert.equal(f.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,1);f.sql.close();
 }
});

test('candidate ACK, return ACK and same-agent original-job resumed object are separate',async()=>{
 const f=fixture();await ensureDispatchSchema(f.db);await admitDispatch(f.db,f.input,f.agent,f.job,100000);
 f.sql.exec("UPDATE scan_targets SET status='completed',leased_at=101000,completed_at=110000,completed_agent_id='leo' WHERE verification_kind='candidate'");
 let p=await dispatchProof(f.db,f.input.batch);assert.equal(p.candidates_terminal,true);assert.equal(p.return_ack,false);assert.equal(p.can_close,false);
 f.sql.exec("UPDATE scan_targets SET status='completed',leased_at=111000,completed_at=120000,completed_agent_id='leo' WHERE verification_kind='return'");
 assert.equal((await dispatchProof(f.db,f.input.batch)).can_close,false);
 f.sql.exec("INSERT INTO scan_targets(id,job_id,verification_kind,status,leased_at,completed_at,completed_agent_id) VALUES(3,1,'','completed',121000,130000,'leo');INSERT INTO mushroom_observations VALUES('o',3,'other',125)");
 assert.equal((await dispatchProof(f.db,f.input.batch)).can_close,false);
 f.sql.exec("UPDATE mushroom_observations SET agent_id='leo',received_at=119");
 assert.equal((await dispatchProof(f.db,f.input.batch)).can_close,false);
 f.sql.exec("UPDATE mushroom_observations SET received_at=125");
 assert.equal((await dispatchProof(f.db,f.input.batch)).can_close,true);
 assert.equal((await closeDispatch(f.db,f.input.batch,'other',131000)).http,409);
 assert.equal((await closeDispatch(f.db,f.input.batch,f.input.owner,131000)).http,200);
 assert.equal((await closeDispatch(f.db,f.input.batch,f.input.owner,132000)).already_closed,true);
 assert.equal((await dispatchInventory(f.db)).batches.length,0);
 f.sql.close();
});
test('return proof survives atomic queue archive; missing history never becomes success',async()=>{
 const f=fixture();await ensureDispatchSchema(f.db);await admitDispatch(f.db,f.input,f.agent,f.job,100000);
 f.sql.exec("UPDATE scan_targets SET status='completed',leased_at=101000,completed_at=110000,completed_agent_id='leo';INSERT INTO scan_target_history SELECT * FROM scan_targets;DELETE FROM scan_targets;");
 let p=await dispatchProof(f.db,f.input.batch);assert.equal(p.return_ack,true);assert.equal(p.can_close,false);
 f.sql.exec("DELETE FROM scan_target_history WHERE verification_kind='return'");
 p=await dispatchProof(f.db,f.input.batch);assert.equal(p.return_scheduled,false);assert.equal(p.can_close,false);f.sql.close();
});
test('global inventory paginates all sources including return-only and sticky unknown',async()=>{
 const f=fixture();await ensureDispatchSchema(f.db);
 for(let i=0;i<105;i++)f.sql.prepare("INSERT INTO scan_targets(verification_batch,verification_kind,status) VALUES(?,'return','queued')").run('legacy-'+String(i).padStart(3,'0'));
 let p=await dispatchInventory(f.db);assert.equal(p.batches.length,100);assert.ok(p.next_cursor);
 p=await dispatchInventory(f.db,p.next_cursor);assert.equal(p.batches.length,5);assert.equal(p.next_cursor,null);
 assert.equal(p.batches[0].pending[0].kind,'return');assert.equal(p.batches[0].coordination,null);
 await assert.rejects(dispatchInventory(f.db,'x'.repeat(101)));f.sql.close();
});
test('target insertion failure rolls the durable reservation back, allowing no half-wave',async()=>{
 const f=fixture();await ensureDispatchSchema(f.db);
 f.sql.exec("CREATE TRIGGER reject_return BEFORE INSERT ON scan_targets WHEN NEW.verification_kind='return' BEGIN SELECT RAISE(ABORT,'injected'); END;");
 await assert.rejects(admitDispatch(f.db,f.input,f.agent,f.job,100000));
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM scan_targets').get().n,0);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM controller_dispatches').get().n,0);f.sql.close();
});

test('concurrent clients cannot commit two active reservations or half-waves',async()=>{
 const f=fixture();await ensureDispatchSchema(f.db);
 const results=await Promise.allSettled([
  admitDispatch(f.db,f.input,f.agent,f.job,100000),
  admitDispatch(f.db,{...f.input,batch:'other-batch'},f.agent,f.job,100000)]);
 assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.http===200).length,1);
 assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM controller_dispatches WHERE state='active'").get().n,1);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM scan_targets').get().n,2);f.sql.close();
});

test('generated migration supports admission and fixture initialization preserves existing rows',async()=>{
 const f=fixture();f.sql.exec(readFileSync(new URL('../drizzle/0028_fresh_black_tom.sql',import.meta.url),'utf8'));
 await ensureDispatchSchema(f.db);
 assert.equal((await admitDispatch(f.db,f.input,f.agent,f.job,100000)).http,200);f.sql.close();
});

function route(path,bindings){
 const source=readFileSync(new URL(path,import.meta.url),'utf8');const exports={};
 new Script(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)
  .runInNewContext({exports,require:name=>{
   if(name.endsWith('/cloud'))return bindings;
   if(name.endsWith('/scans'))return {activeJob:async()=>bindings.job};
   if(name.endsWith('/report-evidence.mjs'))return {};
   if(name.endsWith('/dispatch-coordination.mjs'))return {admitDispatch,dispatchProof,dispatchInventory,closeDispatch,recoverCancelledReturn};
   throw new Error('unexpected import');
  },Request,Response,URL,Date:class extends Date{static now(){return 100000;}}});
 return exports;
}
test('authenticated route opt-in, old-client refusal, exact owner and inventory without coordinates',async()=>{
 const f=fixture();await ensureDispatchSchema(f.db);
 f.sql.exec(`ALTER TABLE scan_agents ADD COLUMN region_tags_json TEXT DEFAULT '["X"]';`);
 let configured='';let auth=false;
 const bindings={job:f.job,controllerAuthorized:()=>auth,ensureSchema:async()=>{},
  runtime:()=>({DB:f.db,VERIFICATION_DISPATCHER_ID:configured}),
  noStoreJson:(v,s=200)=>Response.json(v,{status:s,headers:{'cache-control':'no-store'}}),
  readBoundedUtf8:async request=>({text:await request.text()})};
 const v=route('../app/api/controller/verification/route.ts',bindings);
 const body={contract:2,agentId:'leo',batch:'manual-one',kind:'candidate',candidates:f.input.candidates};
 const req=(b=body)=>new Request('https://test/api/controller/verification',{method:'POST',body:JSON.stringify(b)});
 assert.equal((await v.POST(req())).status,401);auth=true;
 assert.equal((await v.POST(req({...body,dispatcher_id:'taichung-one'}))).status,503);
 configured='taichung-one';
 assert.equal((await v.POST(req())).status,409);
 assert.equal((await v.POST(req({...body,dispatcher_id:'wrong'}))).status,409);
 assert.equal((await v.POST(req({...body,dispatcher_id:configured,replaceExisting:true}))).status,409);
 assert.equal((await v.POST(req({...body,dispatcher_id:configured}))).status,200);
 const d=route('../app/api/controller/dispatches/route.ts',bindings);
 const response=await d.GET(new Request('https://test/api/controller/dispatches'));
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const data=await response.json();assert.equal(data.batches.length,1);assert.equal(data.coordinated_admission_required,true);
 assert.doesNotMatch(JSON.stringify(data),/"lat"|"lng"|"admission"|"payload_sha"/);
 assert.equal((await d.POST(new Request('https://test',{method:'POST',body:'null'}))).status,409);
 auth=false;assert.equal((await d.GET(new Request('https://test'))).status,401);f.sql.close();
});

async function cancelledFixture(){
 const f=fixture();await ensureDispatchSchema(f.db);await admitDispatch(f.db,f.input,f.agent,f.job,100000);
 f.sql.exec("UPDATE scan_targets SET status='completed',leased_at=101000,completed_at=110000,completed_agent_id='leo' WHERE verification_kind='candidate';UPDATE scan_targets SET status='cancelled' WHERE verification_kind='return';UPDATE scan_jobs SET status='cancelled';INSERT INTO scan_jobs VALUES(2,0,'running');UPDATE scan_agents SET last_seen=130000");
 f.agent.last_seen=130000;f.job={id:2,cycle:0,status:'running'};return f;
}

test('cancelled return recovery preserves the original and still requires fresh return ACK plus ordinary accepted data',async()=>{
 const f=await cancelledFixture();
 assert.equal((await recoverCancelledReturn(f.db,f.input.batch,f.input.owner,'recovery-one',f.agent,f.job,130000)).http,200);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM scan_targets WHERE verification_kind='return' AND status='cancelled'").get().n,1);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM scan_targets WHERE verification_kind='return-recovery'").get().n,1);
 assert.equal((await dispatchProof(f.db,f.input.batch)).can_close,false);
 assert.equal((await recoverCancelledReturn(f.db,f.input.batch,f.input.owner,'recovery-one',f.agent,f.job,140000)).existing,true);
 assert.equal((await recoverCancelledReturn(f.db,f.input.batch,f.input.owner,'different-id',f.agent,f.job,130000)).http,409);
 assert.equal(f.sql.prepare('SELECT job_id FROM controller_dispatches').get().job_id,1,'immutable original claim');
 f.sql.exec("UPDATE scan_targets SET status='completed',leased_at=131000,completed_at=140000,completed_agent_id='leo' WHERE verification_kind='return-recovery'");
 assert.equal((await dispatchProof(f.db,f.input.batch)).return_ack,true);
 assert.equal((await dispatchProof(f.db,f.input.batch)).can_close,false);
 f.sql.exec("INSERT INTO scan_targets(id,job_id,verification_kind,status,leased_at,completed_at,completed_agent_id) VALUES(4,2,'','completed',141000,150000,'leo');INSERT INTO mushroom_observations VALUES('after-return',4,'other',145)");
 assert.equal((await dispatchProof(f.db,f.input.batch)).can_close,false);
 f.sql.exec("UPDATE mushroom_observations SET agent_id='leo'");
 const p=await dispatchProof(f.db,f.input.batch);assert.equal(p.can_close,true);
 assert.equal(p.return_recovery.original_job_id,1);assert.equal(p.return_recovery.job_id,2);
 assert.equal((await closeDispatch(f.db,f.input.batch,f.input.owner,151000)).http,200);
 assert.equal((await dispatchInventory(f.db)).batches.length,0);f.sql.close();
});

test('recovery rejects unproven cancellation, active original job, unknown agent and other live work',async()=>{
 for(const change of ["UPDATE scan_targets SET status='queued' WHERE verification_kind='candidate'",
  "UPDATE scan_jobs SET status='running' WHERE id=1", "UPDATE scan_targets SET status='failed' WHERE verification_kind='return'",
  "INSERT INTO scan_targets(verification_batch,verification_kind,status) VALUES('unmanaged','return','queued')",
  "UPDATE scan_agents SET paused=1", "UPDATE scan_agents SET last_seen=1"]){
  const f=await cancelledFixture();f.sql.exec(change);
  assert.equal((await recoverCancelledReturn(f.db,f.input.batch,f.input.owner,'recovery-one',f.agent,f.job,130000)).http,409,change);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM controller_return_recoveries').get().n,0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM scan_targets WHERE verification_kind='return-recovery'").get().n,0);f.sql.close();
 }
});

test('recovery target insertion failure rolls back the audit reservation; ambiguous retry never duplicates',async()=>{
 const f=await cancelledFixture();
 f.sql.exec("CREATE TRIGGER reject_recovery BEFORE INSERT ON scan_targets WHEN NEW.verification_kind='return-recovery' BEGIN SELECT RAISE(ABORT,'injected'); END;");
 await assert.rejects(recoverCancelledReturn(f.db,f.input.batch,f.input.owner,'recovery-one',f.agent,f.job,130000));
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM controller_return_recoveries').get().n,0);
 f.sql.exec('DROP TRIGGER reject_recovery');
 await recoverCancelledReturn(f.db,f.input.batch,f.input.owner,'recovery-one',f.agent,f.job,130000);
 await recoverCancelledReturn(f.db,f.input.batch,f.input.owner,'recovery-one',f.agent,f.job,130000);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM scan_targets WHERE verification_kind='return-recovery'").get().n,1);f.sql.close();
});
