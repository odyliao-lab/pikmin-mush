import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import {DAY,DRY_RUN_MS,RULES,runHistoryRetention,archiveAndPrune,CATCH_UP_ROWS,ARCHIVE_BATCH_BYTES} from '../lib/history-retention.mjs';
const now=1_800_000_000_000;
function fixture() {
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())
  sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 let failure='',censuses=0;
 const db={prepare(q){return {q,args:[],bind(...a){this.args=a;return this},
  async first(){return sql.prepare(q).get(...this.args)},
  async all(){if(q.includes('COUNT(*) AS total'))censuses++;return {results:sql.prepare(q).all(...this.args),meta:{size_after:4096}}},
  async run(){return {meta:sql.prepare(q).run(...this.args)}}}},
  async batch(statements){sql.exec('BEGIN');try {
   const results=statements.map(s=>{if(failure&&s.q.includes(failure))throw Error('injected');
    assert.ok(s.args.length<=100);return {meta:sql.prepare(s.q).run(...s.args)}});
   sql.exec('COMMIT');return results;
  }catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,db,fail:s=>{failure=s},censuses:()=>censuses,
  count:t=>sql.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n,
  active(){sql.prepare(`INSERT INTO maintenance_state(name,last_run_at) VALUES ('history-retention-v1-policy',?)`).run(now-DRY_RUN_MS)}};
}
const event=f=>f.sql.prepare(`INSERT INTO scan_agent_events(agent_id,event_type,at) VALUES ('primary','upload',?)`);


function events(f,n,detail='') {
 f.sql.exec('BEGIN');const q=f.sql.prepare("INSERT INTO scan_agent_events(agent_id,event_type,at,detail) VALUES('primary','upload',?,?)");
 for(let i=0;i<n;i++)q.run(now-20*DAY,detail);f.sql.exec('COMMIT');
}
function seedPending(f,n){f.sql.prepare("INSERT INTO retention_table_stats(table_name,eligible_count,checked_at) VALUES('scan_agent_events',?,?)").run(n,now-1000);}

test('uncached backlog promotes on next pass, immediate owner release drains beyond old per-table cap',async()=>{
 const f=fixture();f.active();events(f,12000);
 event(f).run(now);
 const first=await runHistoryRetention(f.db,now);
 assert.equal(first.run.profile,'routine');assert.equal(first.run.deleted,2000);assert.equal(first.pendingTotal,10000);
 const second=await runHistoryRetention(f.db,now+1,{catchUp:true});
 assert.equal(second.busy,false);assert.equal(second.run.profile,'catch_up');assert.equal(second.pendingTotal,0);
 assert.equal(f.count('scan_agent_events'),1);assert.equal(f.count('retention_backups'),12000);
 assert.equal(f.sql.prepare('SELECT owner FROM history_retention_lock').get().owner,'');
 const third=await runHistoryRetention(f.db,now+2);assert.equal(third.run.profile,'routine');
});

test('catch-up has a hard total cap, backed-up rows and size-bounded transactions, caller cannot enlarge it',async()=>{
 const f=fixture();f.active();events(f,CATCH_UP_ROWS+1);seedPending(f,CATCH_UP_ROWS+1);
 const report=await runHistoryRetention(f.db,now,{maxRows:99999999,maxMs:99999999});
 assert.equal(report.run.profile,'catch_up');assert.equal(report.run.maxRows,CATCH_UP_ROWS);
 assert.ok(report.run.deleted<=CATCH_UP_ROWS);assert.ok(report.run.deleted>500);
 assert.equal(f.count('retention_backups'),report.run.deleted);
 assert.equal(f.count('scan_agent_events'),CATCH_UP_ROWS+1-report.run.deleted);
 for(const row of f.sql.prepare('SELECT batch_id,COUNT(*) n,SUM(length(CAST(row_json AS BLOB))) bytes FROM retention_backups GROUP BY batch_id').all()){
  assert.ok(row.n<=5000);assert.ok(row.bytes<=ARCHIVE_BATCH_BYTES);
 }
 assert.equal(report.pendingTotal,f.count('scan_agent_events'));
});

test('byte cap leaves large eligible rows live for the next atomic batch',async()=>{
 const f=fixture();events(f,8,'x'.repeat(450000));
 const n=await archiveAndPrune(f.db,RULES[0],now,5000);
 assert.equal(n,4);assert.equal(f.count('scan_agent_events'),4);assert.equal(f.count('retention_backups'),4);
 const bytes=f.sql.prepare('SELECT SUM(length(CAST(row_json AS BLOB))) n FROM retention_backups').get().n;assert.ok(bytes<=ARCHIVE_BATCH_BYTES);
});

test('legacy in-flight lease is respected; expired or superseded owners cannot archive or delete',async()=>{
 const f=fixture();f.active();events(f,2);
 f.sql.prepare("INSERT INTO maintenance_state(name,last_run_at) VALUES('history-retention-v1-run',?)").run(now-1);
 assert.equal((await runHistoryRetention(f.db,now)).busy,true);assert.equal(f.count('retention_backups'),0);
 const report=await runHistoryRetention(f.db,now+300001);assert.equal(report.busy,false);
 events(f,2);f.sql.prepare("UPDATE history_retention_lock SET owner='new-owner',expires_at=?").run(now+600000);
 assert.equal(await archiveAndPrune(f.db,RULES[0],now,5000,{owner:'old-owner',clock:()=>now}),0);
 assert.equal(await archiveAndPrune(f.db,RULES[0],now,5000,{owner:'new-owner',clock:()=>now+600001}),0);
 assert.equal(f.count('scan_agent_events'),2);
});

test('closed target index supports ordered bounded pruning; active job and active lease stay protected',async()=>{
 const f=fixture();f.active();
 f.sql.exec(`INSERT INTO scan_jobs(id,status,config_json,plan_json,total_points,created_at,updated_at,finished_at)
 VALUES(1,'completed','{}','[]',1,1,1,1),(2,'running','{}','[]',1,1,1,1);`);
 const q=f.sql.prepare("INSERT INTO scan_targets(job_id,sequence,country,city,lat,lng,region_index,point_index,status,created_at,updated_at) VALUES(?,?,'','fixture',0,0,0,0,?,1,1)");
 f.sql.exec('BEGIN');for(let i=0;i<6000;i++)q.run(1,i,'completed');q.run(2,0,'completed');q.run(2,1,'leased');f.sql.exec('COMMIT');
 f.sql.prepare("INSERT INTO retention_table_stats(table_name,eligible_count,checked_at) VALUES('scan_targets',6000,?)").run(now-1);
 const batch=f.db.batch.bind(f.db);let verifiedPlan=false;
 f.db.batch=async statements=>{
  if(statements[0].args[0]==='scan_targets'){
   const plan=f.sql.prepare('EXPLAIN QUERY PLAN '+statements[0].q).all(...statements[0].args);
   assert.ok(plan.some(x=>x.detail.includes('scan_targets_retention_idx')),JSON.stringify(plan));
   assert.ok(!plan.some(x=>x.detail.includes('SEARCH scan_targets USING INDEX scan_targets_claim_idx')),JSON.stringify(plan));
   verifiedPlan=true;
  }
  return batch(statements);
 };
 const result=await runHistoryRetention(f.db,now,{catchUp:true});assert.equal(result.pendingTotal,0);assert.equal(verifiedPlan,true);
 assert.equal(f.count('scan_targets'),2);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM retention_backups WHERE table_name='scan_targets'").get().n,6000);
});

test('failure after earlier successful chunks remains visible and does not record a new success',async()=>{
 const f=fixture();f.active();events(f,12000);seedPending(f,12000);
 const batch=f.db.batch.bind(f.db);let attempted=0;
 f.db.batch=async statements=>{if(statements[0].q.includes('INSERT INTO retention_backups')&&statements[0].args[0]==='scan_agent_events'&&++attempted===2)throw Error('injected');return batch(statements);};
 const result=await runHistoryRetention(f.db,now,{catchUp:true});
 assert.equal(result.consecutiveFailures,1);assert.equal(result.lastSucceededAt,0);
 assert.equal(result.tables.find(t=>t.table==='scan_agent_events').last_error,'archive_and_delete');
 assert.equal(f.count('scan_agent_events')+f.count('retention_backups'),12000);
});

test('admin catch-up rejects controllers, absent/cross origin, non-JSON and arbitrary options before writes',async()=>{
 let admin=false,runs=0,bodyReads=0,ensures=0;
 const exports={};const code=ts.transpileModule(readFileSync(new URL('../app/api/admin/retention/run/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Script(code).runInNewContext({exports,Date,Object,JSON,require(p){
  if(p.endsWith('/cloud'))return {adminAuthorized:()=>admin,ensureSchema:async()=>{ensures++},runtime:()=>({DB:{}}),readBoundedUtf8:async req=>{bodyReads++;return {text:await req.text()}}};
  if(p.endsWith('/gps-access.mjs'))return {browserWrite:req=>req.headers.get('origin')==='https://test'&&req.headers.get('content-type')==='application/json',privateJson:(b,s=200)=>Response.json(b,{status:s})};
  if(p.endsWith('/history-retention.mjs'))return {runHistoryRetention:async()=>{runs++;return {consecutiveFailures:0,tables:[],pendingTotal:0}}};throw Error(p);
 }});
 const req=(origin='https://test',type='application/json',payload={action:'run'})=>new Request('https://test/api/admin/retention/run',{method:'POST',headers:{...(origin?{origin}:{}),'content-type':type},body:JSON.stringify(payload)});
 assert.equal((await exports.POST(req())).status,403);assert.equal(bodyReads,0);
 admin=true;for(const [origin,type] of [['https://evil','application/json'],['','application/json'],['https://test','text/plain']])assert.equal((await exports.POST(req(origin,type))).status,403);
 assert.equal((await exports.POST(req('https://test','application/json',{action:'run',sql:'DELETE'}))).status,400);
 assert.equal(ensures,0);assert.equal(runs,0);
 assert.equal((await exports.POST(req())).status,200);assert.equal(runs,1);
});


test('concurrent invocation is busy; expired older invocation is fenced and cannot overwrite newer success',async()=>{
 const f=fixture();f.active();events(f,1);let release,enter;
 const gate=new Promise(r=>{release=r}),entered=new Promise(r=>{enter=r});
 const batch=f.db.batch.bind(f.db);let held=false;
 f.db.batch=async statements=>{
  if(!held&&statements[0].args[0]==='scan_agent_events'){held=true;enter();await gate;}
  return batch(statements);
 };
 const older=runHistoryRetention(f.db,now);await entered;
 assert.equal((await runHistoryRetention(f.db,now+1)).busy,true);
 const newer=await runHistoryRetention(f.db,now+300001);
 assert.equal(newer.busy,false);assert.equal(newer.lastSucceededAt,now+300001);
 release();await assert.rejects(older,/lease lost/);
 assert.equal(f.count('scan_agent_events'),0);assert.equal(f.count('retention_backups'),1);
 assert.equal(f.sql.prepare("SELECT last_succeeded_at FROM maintenance_state WHERE name='history-retention-v1-run'").get().last_succeeded_at,now+300001);
 assert.equal(f.sql.prepare('SELECT owner FROM history_retention_lock').get().owner,'');
});

test('runtime budget stops starting batches while preserving positive backlog and releasing the owner',async()=>{
 const f=fixture();f.active();events(f,12000);seedPending(f,12000);let elapsed=0;
 const batch=f.db.batch.bind(f.db);let calls=0;
 f.db.batch=async statements=>{calls++;const result=await batch(statements);elapsed+=2000;return result;};
 const report=await runHistoryRetention(f.db,now,{catchUp:true,maxMs:1000,clock:()=>now+elapsed});
 assert.equal(calls,1);assert.ok(report.pendingTotal>0);assert.ok(report.run.deleted<=5000);
 assert.equal(f.sql.prepare('SELECT owner FROM history_retention_lock').get().owner,'');
});


test('expired recovery copies count as backlog; catch-up GC is bounded and preserves unexpired copies',async()=>{
 const f=fixture();f.active();const q=f.sql.prepare("INSERT INTO retention_backups VALUES('scan_agent_events',?,'{}',?,?,?)");
 f.sql.exec('BEGIN');for(let i=0;i<10005;i++)q.run(String(i),now-8*DAY,now-1,'old');q.run('keep',now,now+DAY,'keep');f.sql.exec('COMMIT');
 f.sql.prepare("INSERT INTO retention_table_stats(table_name,eligible_count,checked_at) VALUES('retention_backups',10005,?)").run(now-1);
 const report=await runHistoryRetention(f.db,now);
 assert.equal(report.run.profile,'catch_up');assert.equal(report.run.expiredBackupsDeleted,10000);
 assert.equal(report.pendingTotal,5);assert.equal(f.count('retention_backups'),6);
 assert.equal(report.tables.find(t=>t.table==='retention_backups').deleted_last_run,10000);
});
