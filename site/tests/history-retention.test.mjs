import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import {DAY,DRY_RUN_MS,RULES,INVENTORY,runHistoryRetention,archiveAndPrune,restoreRetentionBackup} from '../lib/history-retention.mjs';

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

test('48-hour dry run counts real rows and backlog, caches census, never deletes',async()=>{
 const f=fixture();event(f).run(now-20*DAY);event(f).run(now);
 const report=await runHistoryRetention(f.db,now);
 assert.equal(report.mode,'dry_run');assert.equal(report.databaseBytes,4096);
 const row=report.tables.find(t=>t.table==='scan_agent_events');
 assert.equal(row.row_count,2);assert.equal(row.eligible_count,1);assert.equal(row.oldest_eligible_at,now-20*DAY);
 assert.equal(f.count('scan_agent_events'),2);assert.equal(f.count('retention_backups'),0);
 const n=f.censuses();await runHistoryRetention(f.db,now+301000);assert.equal(f.censuses(),n);
 const active=await runHistoryRetention(f.db,now+DRY_RUN_MS+1);
 assert.equal(active.mode,'active');assert.equal(f.count('scan_agent_events'),1);
 assert.equal(f.count('retention_backups'),1);
 assert.ok(active.tables.every(t=>!t.last_error),JSON.stringify(active));
});

test('backup and delete are atomic, restore preserves exact rows and never overwrites newer data',async()=>{
 const f=fixture();event(f).run(now-20*DAY);const rule=RULES[0];
 f.fail('INSERT INTO retention_backups');await assert.rejects(archiveAndPrune(f.db,rule,now,1));
 assert.equal(f.count('scan_agent_events'),1);assert.equal(f.count('retention_backups'),0);
 f.fail('DELETE FROM');await assert.rejects(archiveAndPrune(f.db,rule,now,1));
 assert.equal(f.count('scan_agent_events'),1);assert.equal(f.count('retention_backups'),0);
 f.fail('');assert.equal(await archiveAndPrune(f.db,rule,now,1),1);
 assert.equal(await restoreRetentionBackup(f.db,rule.table,'1',now),true);
 assert.equal(f.sql.prepare('SELECT at FROM scan_agent_events WHERE id=1').get().at,now-20*DAY);
 f.sql.prepare('UPDATE scan_agent_events SET at=? WHERE id=1').run(now);
 assert.equal(await restoreRetentionBackup(f.db,rule.table,'1',now),false);
 assert.equal(f.sql.prepare('SELECT at FROM scan_agent_events WHERE id=1').get().at,now);
 assert.equal(await restoreRetentionBackup(f.db,rule.table,'1',now+8*DAY),false);
 await assert.rejects(restoreRetentionBackup(f.db,'scan_agents','primary',now));
});

test('pause intervals stay protected while open or recently replayed; seconds and ms have exact boundaries',async()=>{
 const f=fixture();
 f.sql.prepare(`INSERT INTO agent_power_pauses VALUES (?,?,?,?,?,?)`).run('open','primary',now-90*DAY,null,'thermal-severe',now-90*DAY);
 f.sql.prepare(`INSERT INTO agent_power_pauses VALUES (?,?,?,?,?,?)`).run('replay','primary',now-90*DAY,now-40*DAY,'thermal-severe',now);
 f.sql.prepare(`INSERT INTO agent_power_pauses VALUES (?,?,?,?,?,?)`).run('old','primary',now-90*DAY,now-40*DAY,'thermal-severe',now-40*DAY);
 const pause=RULES.find(r=>r.table==='agent_power_pauses');
 assert.equal(await archiveAndPrune(f.db,pause,now,250),1);
 assert.deepEqual(f.sql.prepare('SELECT key FROM agent_power_pauses ORDER BY key').all().map(r=>r.key),['open','replay']);
 const put=f.sql.prepare(`INSERT INTO copy_audit_events(at,bucket_minute,event_type,mushroom_id,mushroom_lat,mushroom_lng,mushroom_level,mushroom_type,source_hash) VALUES (?,?,'copy_info','poi',1,2,3,11,'hash')`);
 put.run((now-31*DAY)/1000,1);put.run((now-30*DAY)/1000,2);put.run(now/1000,3);
 assert.equal(await archiveAndPrune(f.db,RULES.find(r=>r.table==='copy_audit_events'),now,250),1);
 assert.equal(f.count('copy_audit_events'),2);
});

function job(f,id,status,finished) {
 f.sql.prepare(`INSERT INTO scan_jobs(id,status,config_json,plan_json,total_points,created_at,updated_at,finished_at)
  VALUES (?,?,'{}','[]',1,?,?,?)`).run(id,status,finished,finished,finished);
}
test('closed-job pruning respects active leases, parent order, history references and newest job',async()=>{
 const f=fixture();const old=now-100*DAY;
 job(f,1,'cancelled',old);job(f,2,'running',old);job(f,3,'completed',old);job(f,4,'completed',old);job(f,5,'completed',old);
 f.sql.prepare(`INSERT INTO scan_logs(job_id,at,level,message) VALUES (?,?, 'info','fixture')`).run(1,old);
 f.sql.prepare(`INSERT INTO scan_targets(job_id,sequence,country,city,lat,lng,region_index,point_index,status,created_at,updated_at)
  VALUES (?,0,'','fixture',0,0,0,0,?,?,?)`).run(1,'leased',old,old);
 const logs=RULES.find(r=>r.table==='scan_logs'),targets=RULES.find(r=>r.table==='scan_targets'),jobs=RULES.find(r=>r.table==='scan_jobs');
 assert.equal(await archiveAndPrune(f.db,logs,now,250),0);
 assert.equal(await archiveAndPrune(f.db,targets,now,250),0);
 f.sql.exec("UPDATE scan_targets SET status='cancelled'");
 f.sql.prepare(`INSERT INTO scan_target_history(id,job_id,cycle,country,verification_kind,archived_at) VALUES(10,3,1,'','',?)`).run(now);
 f.sql.prepare(`INSERT INTO scan_rotation_runs(schedule_date,status,job_id,assignments_json,message,created_at,updated_at)
  VALUES ('old','completed',4,'[]','',?,?)`).run(old,old);
 assert.equal(await archiveAndPrune(f.db,jobs,now,5),0);
 assert.equal(await archiveAndPrune(f.db,logs,now,250),1);
 assert.equal(await archiveAndPrune(f.db,targets,now,250),1);
 assert.equal(await archiveAndPrune(f.db,jobs,now,5),1);
 assert.deepEqual(f.sql.prepare('SELECT id FROM scan_jobs ORDER BY id').all().map(r=>r.id),[2,3,4,5]);
});

test('report audit remains while a matching verification batch is queued',async()=>{
 const f=fixture();job(f,1,'running',now-40*DAY);
 f.sql.prepare(`INSERT INTO scan_targets(job_id,sequence,country,city,lat,lng,region_index,point_index,
  status,created_at,updated_at,verification_batch) VALUES(1,0,'','fixture',0,0,0,0,'queued',?,?,'batch')`).run(now,now);
 f.sql.prepare(`INSERT INTO report_audit_events(key,batch,phase,kind,at,payload)
  VALUES('report','batch','candidates','large',?,'{}')`).run(now-40*DAY);
 const rule=RULES.find(r=>r.table==='report_audit_events');
 assert.equal(await archiveAndPrune(f.db,rule,now,250),0);
 f.sql.exec("UPDATE scan_targets SET status='completed'");
 assert.equal(await archiveAndPrune(f.db,rule,now,250),1);
});

test('oversize rows remain live; batch deletion and expiring backups are bounded',async()=>{
 const f=fixture();event(f).run(now-20*DAY);
 f.sql.prepare('UPDATE scan_agent_events SET detail=?').run('x'.repeat(500001));
 assert.equal(await archiveAndPrune(f.db,RULES[0],now,500),0);
 f.sql.exec('DELETE FROM scan_agent_events');
 const insert=event(f);for(let i=0;i<505;i++)insert.run(now-20*DAY);
 assert.equal(await archiveAndPrune(f.db,RULES[0],now,500),500);assert.equal(f.count('scan_agent_events'),5);
 f.active();await runHistoryRetention(f.db,now+8*DAY);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM retention_backups WHERE expires_at<?').get(now+8*DAY).n,0);
});

test('protected identities, receipt anchors, and existing history TTL ownership are never pruned by new rules',async()=>{
 const f=fixture();f.active();
 f.sql.exec(`INSERT INTO mushroom_locations VALUES('poi',1,2,1,1);
  INSERT INTO mushroom_challenges VALUES('challenge','poi',1,'challenge_start',1,1);
  INSERT INTO agent_upload_receipts VALUES('primary','stream',0,1,'hash',1,1);`);
 await runHistoryRetention(f.db,now);
 for(const name of ['mushroom_locations','mushroom_challenges','agent_upload_receipts'])assert.equal(f.count(name),1);
 assert.ok(INVENTORY.filter(r=>r.managed==='existing').every(r=>!RULES.includes(r)));
 assert.ok(!RULES.some(r=>['scan_agents','agent_state','scan_rotation_settings'].includes(r.table)));
});

test('a failed archive keeps live data, records a safe stage, and preserves the previous success time',async()=>{
 const f=fixture();f.active();event(f).run(now-20*DAY);
 f.sql.prepare(`INSERT INTO maintenance_state(name,last_succeeded_at) VALUES ('history-retention-v1-run',?)`).run(now-400000);
 f.fail('INSERT INTO retention_backups');
 const report=await runHistoryRetention(f.db,now);
 assert.equal(f.count('scan_agent_events'),1);assert.equal(f.count('retention_backups'),0);
 assert.equal(report.tables.find(r=>r.table==='scan_agent_events').last_error,'archive_and_delete');
 const state=f.sql.prepare(`SELECT * FROM maintenance_state WHERE name='history-retention-v1-run'`).get();
 assert.equal(state.consecutive_failures,1);assert.equal(state.last_succeeded_at,now-400000);
 assert.ok(!JSON.stringify(report).includes('injected'));
});

test('inventory endpoint authenticates before reads and never exposes backup JSON or a refresh/write action',async()=>{
 const f=fixture();let admin=false,controller=false,reads=0;
 const exports={};
 const source=ts.transpileModule(readFileSync(new URL('../app/api/admin/retention/route.ts',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Script(source).runInNewContext({exports,require(p){
  if(p.endsWith('/cloud')) return {adminAuthorized:()=>admin,controllerAuthorized:()=>controller,
   ensureSchema:async()=>{reads++},runtime:()=>({DB:f.db}),
   noStoreJson:(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}})};
  if(p.endsWith('/history-retention.mjs'))return {readHistoryRetention:async()=>({tables:[],mode:'not_started'})};
  throw Error(p);
 }});
 const req=new Request('https://test/api/admin/retention?refresh=1&sql=DROP');
 assert.equal((await exports.GET(req)).status,403);assert.equal(reads,0);
 controller=true;const response=await exports.GET(req);
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(exports.POST,undefined);assert.equal(reads,1);
 admin=true;controller=false;assert.equal((await exports.GET(req)).status,200);
});
