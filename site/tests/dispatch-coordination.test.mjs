import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import {ensureDispatchSchema,admitDispatch,dispatchProof,dispatchInventory,closeDispatch,recoverCancelledReturn} from '../lib/dispatch-coordination.mjs';
import {cancelStoppedDispatch,OPERATOR_CANCELLED} from '../lib/dispatch-cancellation.mjs';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE scan_jobs(id INTEGER PRIMARY KEY,cycle INTEGER,status TEXT,
 created_at INTEGER NOT NULL DEFAULT 0, finished_at INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE scan_agents(id TEXT PRIMARY KEY,enabled INTEGER,paused INTEGER,last_seen INTEGER,current_lat REAL,current_lng REAL);
 CREATE TABLE scan_targets(id INTEGER PRIMARY KEY,job_id INTEGER,sequence INTEGER,cycle INTEGER,country TEXT,city TEXT,
 lat REAL,lng REAL,region_index INTEGER,point_index INTEGER,base_cooldown_s INTEGER,status TEXT,priority INTEGER,
 required_agent_id TEXT,verification_batch TEXT,verification_mushroom_id TEXT,verification_kind TEXT,
 created_at INTEGER,updated_at INTEGER,leased_at INTEGER DEFAULT 0,completed_at INTEGER DEFAULT 0,completed_agent_id TEXT DEFAULT '');
 CREATE TABLE scan_target_history AS SELECT * FROM scan_targets WHERE 0;
 CREATE TABLE mushroom_observations(key TEXT PRIMARY KEY,target_id INTEGER,agent_id TEXT,received_at INTEGER,level INTEGER DEFAULT 3);
 CREATE INDEX mushroom_observations_received_idx ON mushroom_observations(received_at);
 CREATE TABLE scan_agent_events(id INTEGER PRIMARY KEY,agent_id TEXT,event_type TEXT,at INTEGER,
  job_id INTEGER,target_id INTEGER,rows INTEGER,bytes INTEGER,detail TEXT);
 INSERT INTO scan_jobs(id,cycle,status) VALUES(1,0,'running');INSERT INTO scan_agents VALUES('leo',1,0,100000,1,2);`);
 sql.exec(`ALTER TABLE scan_agents ADD COLUMN current_target_id INTEGER;
 ALTER TABLE scan_targets ADD COLUMN lease_expires_at INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE scan_target_history ADD COLUMN lease_expires_at INTEGER;`);
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
 f.sql.prepare('INSERT INTO scan_agents(id,enabled,paused,last_seen,current_lat,current_lng) VALUES(?,1,0,100000,1,2)').run(id);
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
 f.sql.exec("INSERT INTO scan_targets(id,job_id,verification_kind,status,leased_at,completed_at,completed_agent_id) VALUES(9,1,'','completed',111000,120000,'leo');INSERT INTO mushroom_observations(key,target_id,agent_id,received_at) VALUES('resume',9,'leo',115)");
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
 f.sql.exec("INSERT INTO scan_targets(id,job_id,verification_kind,status,leased_at,completed_at,completed_agent_id) VALUES(3,1,'','completed',121000,130000,'leo');INSERT INTO mushroom_observations(key,target_id,agent_id,received_at) VALUES('o',3,'other',125)");
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

async function supersedingFixture(){
 const f=fixture();await ensureDispatchSchema(f.db);await admitDispatch(f.db,f.input,f.agent,f.job,100000);
 f.sql.exec(`UPDATE scan_targets SET status='completed',leased_at=101000,completed_at=110000,completed_agent_id='leo'
  WHERE verification_kind='candidate';
 UPDATE scan_targets SET status='completed',leased_at=111000,completed_at=120000,completed_agent_id='leo'
  WHERE verification_kind='return';
 INSERT INTO scan_agent_events VALUES(1,'leo','target_completed',120000,1,2,0,0,'');
 INSERT INTO scan_target_history SELECT * FROM scan_targets;
 DELETE FROM scan_targets;
 UPDATE scan_jobs SET status='cancelled',finished_at=125000 WHERE id=1;
 INSERT INTO scan_jobs VALUES(2,0,'running',125000,0);
 INSERT INTO scan_target_history(id,job_id,verification_kind,status,leased_at,completed_at,completed_agent_id)
  VALUES(3,2,'','completed',126000,130000,'leo');
 INSERT INTO scan_agent_events VALUES(2,'leo','target_completed',130000,2,3,1,121,'');
 INSERT INTO mushroom_observations VALUES('successor',3,'leo',129,3);`);
 return f;
}

test('original owner can close a stopped job using the next job’s durable ordinary observation',async()=>{
 const f=await supersedingFixture();
 const p=await dispatchProof(f.db,f.input.batch,131000);
 assert.equal(p.can_close,true);
 assert.deepEqual(p.superseding_ordinary_proof,{target_id:3,job_id:2,ack_at:130000,received_at:129,level:3});
 assert.equal((await closeDispatch(f.db,f.input.batch,'other',131000)).http,409);
 assert.equal((await closeDispatch(f.db,f.input.batch,f.input.owner,131000)).http,200);
 assert.equal((await dispatchProof(f.db,f.input.batch,131000)).state,'closed');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM scan_target_history').get().n,3);
 assert.equal((await closeDispatch(f.db,f.input.batch,f.input.owner,132000)).already_closed,true);
 f.sql.close();
});

test('successor proof rejects incomplete, misattributed and synthetic completions',async()=>{
 const guards=[
  "UPDATE scan_jobs SET status='running' WHERE id=1",
  "UPDATE scan_jobs SET created_at=124999 WHERE id=2",
  "UPDATE scan_target_history SET status='queued' WHERE id=1",
  "UPDATE scan_target_history SET completed_agent_id='other' WHERE id=1",
  "UPDATE scan_target_history SET status='cancelled' WHERE id=2",
  "DELETE FROM scan_agent_events WHERE id=1",
  "UPDATE scan_agent_events SET rows=0 WHERE id=2",
  "UPDATE scan_agent_events SET bytes=0 WHERE id=2",
  "UPDATE scan_agent_events SET job_id=9 WHERE id=2",
  "UPDATE scan_agent_events SET at=130001 WHERE id=2",
  "UPDATE scan_target_history SET leased_at=124999 WHERE id=3",
  "UPDATE scan_target_history SET verification_kind='candidate' WHERE id=3",
  "UPDATE mushroom_observations SET agent_id='other'",
  "UPDATE mushroom_observations SET level=2",
  "UPDATE mushroom_observations SET received_at=131",
  "INSERT INTO controller_return_recoveries VALUES('manual-one','recovery-one','leo',1,2,2,126000)",
  "UPDATE controller_dispatches SET state='operator-cancelled'",
 ];
 for(const change of guards){
  const f=await supersedingFixture();
  if(change.includes("state='operator-cancelled'")){
   f.sql.exec('CREATE TABLE controller_dispatch_cancellations(batch,agent_id,job_id,cancelled_at,pending_targets_json)');
  }
  f.sql.exec(change);
  assert.equal((await dispatchProof(f.db,f.input.batch,131000)).can_close,false,change);
  assert.equal((await closeDispatch(f.db,f.input.batch,f.input.owner,131000)).http,409,change);
  f.sql.close();
 }
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
   if(name.endsWith('/dispatch-cancellation.mjs'))return {cancelStoppedDispatch,OPERATOR_CANCELLED};
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
 f.sql.exec("UPDATE scan_targets SET status='completed',leased_at=101000,completed_at=110000,completed_agent_id='leo' WHERE verification_kind='candidate';UPDATE scan_targets SET status='cancelled' WHERE verification_kind='return';UPDATE scan_jobs SET status='cancelled';INSERT INTO scan_jobs(id,cycle,status) VALUES(2,0,'running');UPDATE scan_agents SET last_seen=130000");
 f.agent.last_seen=130000;f.job={id:2,cycle:0,status:'running'};return f;
}

test('operator cancellation preserves completed evidence and the replacement scan',async()=>{
 const f=await cancelledFixture();
 const input={batch:f.input.batch,owner:f.input.owner,agentId:'leo',jobId:1};
 f.sql.exec(`
   UPDATE scan_targets SET status='completed',leased_at=110000,completed_at=120000,completed_agent_id='leo'
    WHERE verification_kind='return';
   INSERT INTO scan_targets(id,job_id,verification_batch,verification_kind,required_agent_id,status)
    VALUES(10,1,'manual-one','candidate','leo','queued'),
          (11,2,'other-wave','candidate','leo','queued'),
          (12,2,'','','','leased');
   UPDATE scan_agents SET current_target_id=12 WHERE id='leo';
   INSERT INTO mushroom_observations(key,target_id,agent_id,received_at) VALUES('old-observation',1,'leo',108);
   INSERT INTO scan_agent_events VALUES(1,'leo','target_completed',120000,1,2,0,0,'{}');
 `);
 assert.equal((await cancelStoppedDispatch(f.db,{...input,jobId:2},130000)).http,409);
 assert.equal((await cancelStoppedDispatch(f.db,{...input,owner:'foreign'},130000)).http,409);
 const [one,two]=await Promise.all([130000,131000].map(now=>cancelStoppedDispatch(f.db,input,now)));
 assert.equal(one.http,200);assert.deepEqual(one,two);
 assert.deepEqual(one.cancellation.cancelled_targets,[{target_id:10,kind:'candidate',previous_status:'queued'}]);
 const state=await dispatchProof(f.db,input.batch);
 assert.equal(state.state,'operator-cancelled');assert.equal(state.return_ack,true);assert.equal(state.can_close,false);
 assert.equal((await closeDispatch(f.db,input.batch,input.owner,132000)).http,409);
 assert.equal((await admitDispatch(f.db,f.input,f.agent,f.job,132000)).http,409);
 assert.ok(!(await dispatchInventory(f.db)).batches.some(x=>x.batch===input.batch));
 assert.equal(f.sql.prepare('SELECT current_target_id FROM scan_agents').get().current_target_id,12);
 assert.deepEqual(f.sql.prepare('SELECT status FROM scan_targets ORDER BY id').all().map(r=>r.status),
  ['completed','completed','cancelled','queued','leased']);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM scan_agent_events').get().n,1);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM mushroom_observations').get().n,1);
 assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM controller_dispatches WHERE state='active'").get().n,0);
 f.sql.close();
});

test('stopped-job cancellation fails closed across live leases, foreign targets and closed batches',async()=>{
 for(const change of [
  "UPDATE scan_jobs SET status='running' WHERE id=1",
  "UPDATE scan_targets SET status='leased',lease_expires_at=200000 WHERE id=1",
  "UPDATE scan_targets SET status='queued',job_id=2 WHERE id=1",
  "UPDATE scan_targets SET status='queued',required_agent_id='foreign' WHERE id=1",
  "UPDATE scan_targets SET status='queued' WHERE id=1; UPDATE scan_agents SET current_target_id=1",
  "UPDATE controller_dispatches SET state='closed'"
 ]){
  const f=await cancelledFixture();
  f.sql.exec(change);
  assert.equal((await cancelStoppedDispatch(f.db,{batch:f.input.batch,owner:f.input.owner,agentId:'leo',jobId:1},130000)).http,409,change);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM controller_dispatches WHERE state='operator-cancelled'").get().n,0);
  f.sql.close();
 }
});

test('cancellation needs both the controller credential and separate dispatcher secret',async()=>{
 const f=await cancelledFixture();
 let authorized=false;
 const secret='a'.repeat(32),controller='b'.repeat(32);
 const env={DB:f.db,VERIFICATION_DISPATCHER_ID:f.input.owner,
  CONTROLLER_TOKEN:controller,VERIFICATION_DISPATCH_CANCEL_TOKEN:secret};
 const bindings={controllerAuthorized:()=>authorized,runtime:()=>env,
  safeEqual:(a,b)=>a===b,noStoreJson:(v,status=200)=>Response.json(v,{status}),
  readBoundedUtf8:async request=>({text:await request.text()})};
 const d=route('../app/api/controller/dispatches/route.ts',bindings);
 const post=(token,owner=f.input.owner)=>new Request('https://test/api/controller/dispatches',{
  method:'POST',headers:token?{'x-dispatch-cancel-token':token}:{},
  body:JSON.stringify({action:'cancel',batch:f.input.batch,owner,agent_id:'leo',job_id:1})
 });
 assert.equal((await d.POST(post(secret))).status,401);authorized=true;
 assert.equal((await d.POST(post())).status,403);
 assert.equal((await d.POST(post(secret,'foreign'))).status,409);
 env.VERIFICATION_DISPATCH_CANCEL_TOKEN=controller;
 assert.equal((await d.POST(post(controller))).status,403);
 env.VERIFICATION_DISPATCH_CANCEL_TOKEN=secret;
 assert.equal((await d.POST(post(secret))).status,200);
 const proof=await d.GET(new Request('https://test/api/controller/dispatches?batch='+f.input.batch));
 assert.equal((await proof.json()).coordination.cancellation.state,'operator-cancelled');
 f.sql.close();
});

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
 f.sql.exec("INSERT INTO scan_targets(id,job_id,verification_kind,status,leased_at,completed_at,completed_agent_id) VALUES(4,2,'','completed',141000,150000,'leo');INSERT INTO mushroom_observations(key,target_id,agent_id,received_at) VALUES('after-return',4,'other',145)");
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


test('empty recovery closes only a fresh post-return ordinary lease with complete object evidence',async()=>{
 const now=1794500021000;
 for(const bad of ['valid','query','pid','job','old-target','pending','stale','wrong-agent','verification','wrong-event-time','owner']){
  const f=fixture();await ensureDispatchSchema(f.db);await admitDispatch(f.db,f.input,f.agent,f.job,100000);
  f.sql.exec("UPDATE scan_targets SET status='completed',leased_at=101000,completed_at=110000,completed_agent_id='leo'");
  f.sql.prepare("INSERT INTO scan_targets(id,job_id,verification_kind,status,leased_at,completed_at,completed_agent_id) VALUES(123,1,'','completed',?,?,'leo')").run(now-21000,now);
  let e={version:1,job_id:1,target_id:123,game_pid:456,native_pid:456,pid_before:456,process_start:77,start_before:77,
   scan_started_s:1794500000,object_at_s:1794500010,sampled_at_s:1794500020,
   object_token:'179450000100000123',prefix_start:100,prefix_end:100,accepted_offset:100,pending_bytes:0,pending_acks:0};
  if(bad==='pid')e.native_pid=1;
  if(bad==='job')e.job_id=2;
  if(bad==='old-target')f.sql.exec("UPDATE scan_targets SET leased_at=109000 WHERE id=123");
  if(bad==='pending')e.pending_bytes=1;
  if(bad==='wrong-agent')f.sql.exec("UPDATE scan_targets SET completed_agent_id='other' WHERE id=123");
  if(bad==='verification')f.sql.exec("UPDATE scan_targets SET verification_kind='return' WHERE id=123");
  f.sql.prepare("INSERT INTO scan_agent_events(agent_id,event_type,at,job_id,target_id,rows,bytes,detail) VALUES('leo','target_completed',?,1,123,0,0,?)")
   .run(bad==='wrong-event-time'?now-1:now,JSON.stringify({evidence:{version:1,refresh_source:bad==='query'?'query':'object',recovery:e}}));
  const clock=bad==='stale'?now+120001:now+1000;
  const proof=await dispatchProof(f.db,f.input.batch,clock);
  assert.equal(proof.resumed_object_accepted,false,bad);
  assert.equal(proof.can_close,['valid','owner'].includes(bad),bad);
  const result=await closeDispatch(f.db,f.input.batch,bad==='owner'?'other':f.input.owner,clock);
  assert.equal(result.http,bad==='valid'?200:409,bad);
  f.sql.close();
 }
});
