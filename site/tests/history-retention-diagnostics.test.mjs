import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {Script} from 'node:vm';
import ts from 'typescript';
import {DAY} from '../lib/history-retention.mjs';
import {diagnoseHistoryJobs} from '../lib/history-retention-diagnostics.mjs';
const NOW=1800000000000;
function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 for(const file of readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const queries=[],returned=[];
 const db={prepare(q){queries.push(q);assert.ok(/^(SELECT|PRAGMA table_info)/.test(q));return {args:[],bind(...args){this.args=args;return this;},
 async all(){const rows=sql.prepare(q).all(...this.args);returned.push(...rows);return {results:rows};},
 async first(){const row=sql.prepare(q).get(...this.args);if(row)returned.push(row);return row;}};}};
 const job=(id,plan='[]',status='completed',finished=NOW-40*DAY)=>sql.prepare(`INSERT INTO scan_jobs(id,status,config_json,plan_json,total_points,created_at,updated_at,finished_at)
 VALUES(?,?,'{}',?,1,1,1,?)`).run(id,status,plan,finished);
 return {sql,db,job,queries,returned};
}
test('read-only bounded page proves oversized lower bounds without serializing large private plans',async t=>{
 const f=fixture(t);for(let i=1;i<=7;i++)f.job(i,'PRIVATE_SENTINEL'+ 'x'.repeat(600000));
 f.sql.exec('PRAGMA query_only=ON');
 const report=await diagnoseHistoryJobs(f.db,0,NOW);
 assert.equal(report.scanned,5);assert.equal(report.eligible,5);assert.equal(report.categories.oversize_raw_lower_bound,5);
 assert.equal(report.backupJsonBytes.measuredRows,0);assert.equal(report.nextCursor,5);assert.equal(report.hasMore,true);
 assert.ok(!f.queries.some(q=>q.includes('json_object')));
 assert.ok(!JSON.stringify(f.returned).includes('PRIVATE_SENTINEL'));assert.ok(!JSON.stringify(report).includes('plan_json'));
 const tail=await diagnoseHistoryJobs(f.db,report.nextCursor,NOW);
 assert.equal(tail.scanned,2);assert.equal(tail.categories.newest_job,1);assert.equal(tail.hasMore,false);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM scan_jobs').get().n,7);
});
test('exact recovery size includes escaping and JSON overhead, never infers fit from text lower bound',async t=>{
 const f=fixture(t);f.job(1,'\u0001'.repeat(90000));f.job(2,'ok');f.job(3);
 const r=await diagnoseHistoryJobs(f.db,0,NOW);
 assert.equal(r.categories.oversize_backup_json,1);assert.equal(r.categories.within_backup_row_limit,1);
 assert.ok(r.rawTextBytes.max<500000);assert.ok(r.backupJsonBytes.max>500000);
});
test('candidate query is keyset bounded before filters; all protected rows require paging too',async t=>{
 const f=fixture(t);for(let i=1;i<=20;i++)f.job(i,'[]','running',NOW);
 const r=await diagnoseHistoryJobs(f.db,0,NOW);
 assert.equal(r.scanned,5);assert.equal(r.categories.retention_window,5);assert.equal(r.nextCursor,5);
 assert.ok(!f.queries.some(q=>q.includes(' AS bytes')));
 const plan=f.sql.prepare('EXPLAIN QUERY PLAN SELECT id FROM scan_jobs WHERE id>? ORDER BY id LIMIT 6').all(0);
 assert.ok(plan.some(r=>r.detail.includes('INTEGER PRIMARY KEY (rowid>?)')));
});
test('job state, children and newest-job blockers match pruning protections',async t=>{
 const f=fixture(t);for(let i=1;i<=8;i++)f.job(i);
 f.sql.exec(`UPDATE scan_jobs SET status='paused' WHERE id=1;
 INSERT INTO scan_logs(job_id,at,level,message) VALUES(2,1,'info','private');
 INSERT INTO scan_target_history(id,job_id,cycle,country,verification_kind,archived_at) VALUES(3,3,1,'','',1);
 INSERT INTO scan_rotation_runs(schedule_date,status,job_id,assignments_json,message,created_at,updated_at) VALUES('old','completed',4,'[]','',1,1);
 INSERT INTO scan_targets(job_id,sequence,country,city,lat,lng,region_index,point_index,status,created_at,updated_at) VALUES(5,1,'','',0,0,0,0,'completed',1,1);`);
 const r=await diagnoseHistoryJobs(f.db,0,NOW);
 for(const name of ['job_state','logs','history','rotation','targets'])assert.equal(r.categories[name],1);
 assert.equal(r.eligible,0);assert.equal(r.rawTextBytes.measuredRows,0);
});
test('schema drift fails closed and time exhaustion reports an unfinished page',async t=>{
 const f=fixture(t);f.job(1);f.job(2);
 let calls=0;const r=await diagnoseHistoryJobs(f.db,0,NOW,()=>calls++?3000:0);
 assert.equal(r.scanned,0);assert.equal(r.hasMore,true);assert.equal(r.nextCursor,0);assert.equal(r.stopReason,'time_budget');
 f.sql.exec('ALTER TABLE scan_jobs ADD COLUMN private_new_column TEXT');
 await assert.rejects(diagnoseHistoryJobs(f.db,0,NOW),/schema mismatch/);
 await assert.rejects(diagnoseHistoryJobs(f.db,-1,NOW),/invalid cursor/);
});
test('concurrent oversized change cannot bypass SQL-side JSON budget guard',async t=>{
 const f=fixture(t);f.job(1,'small');f.job(2);
 const prepare=f.db.prepare.bind(f.db);
 f.db.prepare=q=>{if(q.includes('THEN length(CAST(json_object'))f.sql.prepare('UPDATE scan_jobs SET plan_json=? WHERE id=1').run('x'.repeat(600001));return prepare(q);};
 const r=await diagnoseHistoryJobs(f.db,0,NOW);
 assert.equal(r.categories.changed_or_size_unclassified,1);assert.equal(r.backupJsonBytes.measuredRows,0);
});
test('exact serialization reserves bounded raw byte allowance across at most five rows',async t=>{
 const f=fixture(t);for(let i=1;i<=6;i++)f.job(i,'\u0001'.repeat(180000));
 const r=await diagnoseHistoryJobs(f.db,0,NOW);
 assert.equal(r.backupJsonBytes.measuredRows,1);assert.equal(r.categories.size_unclassified_budget,4);
 assert.ok(r.backupJsonBytes.total<2*1024*1024);
});
test('owner-only route validates before reads, rejects controller, leaks no failures, has no writes or CORS',async()=>{
 let admin=false,calls=0,fail=false;const exports={};
 const src=ts.transpileModule(readFileSync(new URL('../app/api/admin/retention/diagnostics/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const {privateJson}=await import('../lib/gps-access.mjs');
 new Script(src).runInNewContext({exports,URL,Number,require(path){
 if(path.endsWith('/cloud'))return {adminAuthorized:()=>admin,runtime:()=>{calls++;return {DB:{}};},ensureSchema:()=>{throw Error('write forbidden');}};
 if(path.endsWith('/gps-access.mjs'))return {privateJson};
 if(path.endsWith('/history-retention-diagnostics.mjs'))return {diagnoseHistoryJobs:async(db,after)=>{if(fail)throw Error('PRIVATE_SENTINEL');return {after};}};
 throw Error(path);
 }});
 const req=q=>new Request('https://test/api/admin/retention/diagnostics'+q,{headers:{authorization:'Bearer controller'}});
 assert.equal((await exports.GET(req(''))).status,403);assert.equal(calls,0);
 admin=true;
 for(const q of ['?sql=SELECT','?after=-1','?after=1&after=2','?after=1e3','?after=9007199254740992','?table=scan_jobs'])assert.equal((await exports.GET(req(q))).status,400);
 assert.equal(calls,0);
 const ok=await exports.GET(req('?after=5'));assert.deepEqual(await ok.json(),{after:5});
 assert.equal(ok.headers.get('cache-control'),'private, no-store');assert.equal(ok.headers.get('access-control-allow-origin'),null);
 assert.equal(exports.POST,undefined);fail=true;
 const bad=await exports.GET(req(''));assert.equal(bad.status,503);assert.ok(!(await bad.text()).includes('PRIVATE_SENTINEL'));
});

test('exact 500000-byte backup is allowed and 500001 bytes is oversized',async t=>{
 const f=fixture(t);f.job(1,'');f.job(2,'');f.job(3);
 const baseline=await diagnoseHistoryJobs(f.db,0,NOW);
 const overhead=baseline.backupJsonBytes.max;
 f.sql.prepare('UPDATE scan_jobs SET plan_json=? WHERE id=1').run('\u0001'.repeat(Math.floor((500000-overhead)/6))+'x'.repeat((500000-overhead)%6));
 f.sql.prepare('UPDATE scan_jobs SET plan_json=? WHERE id=2').run('\u0001'.repeat(Math.floor((500001-overhead)/6))+'x'.repeat((500001-overhead)%6));
 const r=await diagnoseHistoryJobs(f.db,0,NOW);
 assert.equal(r.categories.within_backup_row_limit,1);assert.equal(r.categories.oversize_backup_json,1);
 assert.equal(r.backupJsonBytes.max,500001);
 const empty=await diagnoseHistoryJobs(f.db,3,NOW);assert.equal(empty.scanned,0);assert.equal(empty.hasMore,false);
});

test('time budget is checked before every subsequent SQL statement',async t=>{
 for(const stop of ['PRAGMA table_info','SELECT id FROM',' AS category',' AS bytes']){
  const f=fixture(t);f.job(1);f.job(2);let elapsed=0;
  const prepare=f.db.prepare.bind(f.db);
  f.db.prepare=q=>{assert.ok(elapsed<2000,'no SQL after time exhaustion');const stmt=prepare(q);
   for(const method of ['all','first']){const original=stmt[method];stmt[method]=async function(){const result=await original.call(this);if(q.includes(stop))elapsed=3000;return result;};}return stmt;};
  const r=await diagnoseHistoryJobs(f.db,0,NOW,()=>elapsed);
  assert.ok(r.hasMore||r.categories.size_unclassified_budget);
 }
});

test('SQLite dynamic types cannot hide large text in numeric columns or change types before JSON',async t=>{
 const f=fixture(t);f.job(1);f.job(2);
 f.sql.prepare('UPDATE scan_jobs SET captured_bytes=? WHERE id=1').run('x'.repeat(3000000));
 const initial=await diagnoseHistoryJobs(f.db,0,NOW);
 assert.equal(initial.categories.unclassified_type,1);assert.equal(initial.backupJsonBytes.measuredRows,0);
 assert.ok(!f.queries.some(q=>q.includes('THEN length(CAST(json_object')));
 f.sql.exec('UPDATE scan_jobs SET captured_bytes=0 WHERE id=1');
 const prepare=f.db.prepare.bind(f.db);
 f.db.prepare=q=>{if(q.includes('THEN length(CAST(json_object'))f.sql.prepare('UPDATE scan_jobs SET captured_bytes=? WHERE id=1').run('x'.repeat(3000000));return prepare(q);};
 const changed=await diagnoseHistoryJobs(f.db,0,NOW);
 assert.equal(changed.categories.unclassified_type,1);assert.equal(changed.backupJsonBytes.measuredRows,0);
});

test('NULL finished time and status cannot be classified eligible in a drifted nullable table',async t=>{
 const f=fixture(t);f.job(1);f.job(2);f.job(3);
 // Retain exact columns but deliberately remove NOT NULL constraints.
 f.sql.exec(`CREATE TABLE nullable_jobs AS SELECT * FROM scan_jobs;
 DROP TABLE scan_jobs;ALTER TABLE nullable_jobs RENAME TO scan_jobs;
 UPDATE scan_jobs SET finished_at=NULL WHERE id=1;
 UPDATE scan_jobs SET status=NULL WHERE id=2;`);
 const r=await diagnoseHistoryJobs(f.db,0,NOW);
 assert.equal(r.categories.retention_window,1);assert.equal(r.categories.job_state,1);
 assert.equal(r.eligible,0);assert.equal(r.backupJsonBytes.measuredRows,0);
});
