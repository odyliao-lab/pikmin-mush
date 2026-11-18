import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import {
  archiveAndDeleteTargets, canRollScanCycle, rollScanCycle, TARGET_HISTORY_CTE,
} from '../lib/target-history.mjs';
import { closeDispatch, dispatchProof } from '../lib/dispatch-coordination.mjs';

test('loop deletion preserves country attribution without duplicate joins', async () => {
  const sql=new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE scan_targets(id INTEGER PRIMARY KEY,job_id INTEGER,cycle INTEGER,country TEXT,verification_kind TEXT);
    CREATE TABLE scan_target_history(id INTEGER PRIMARY KEY,job_id INTEGER,cycle INTEGER,country TEXT,verification_kind TEXT,archived_at INTEGER);
    CREATE TABLE mushroom_observations(target_id INTEGER,challenge_key TEXT);
    INSERT INTO scan_targets VALUES(1,9,1,'country',''),(2,8,1,'other','candidate');
    INSERT INTO mushroom_observations VALUES(1,'a'),(1,'a'),(2,'b');`);
  const db={prepare:s=>({bind:(...args)=>()=>sql.prepare(s).run(...args)}),
    batch:async steps=>{sql.exec('BEGIN');try{steps.forEach(f=>f());sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}}};
  for (const table of ['scan_targets','scan_target_history']) {
    for (const name of ['verification_batch','verification_mushroom_id','status','completed_agent_id','city'])
      sql.exec(`ALTER TABLE ${table} ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`);
    for (const name of ['leased_at','completed_at','lat','lng'])
      sql.exec(`ALTER TABLE ${table} ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`);
  }
  const count=()=>sql.prepare(`${TARGET_HISTORY_CTE} SELECT COUNT(DISTINCT o.challenge_key) AS n
    FROM mushroom_observations o JOIN durable_targets t ON o.target_id=t.id WHERE t.verification_kind=''`).get().n;
  assert.equal(count(),1);
  sql.exec("UPDATE scan_targets SET city='Berlin' WHERE id=1");
  await archiveAndDeleteTargets(db,9,1000);
  assert.equal(sql.prepare('SELECT city FROM scan_target_history WHERE id=1').get().city,'Berlin');
  assert.equal(count(),1);
  assert.equal(sql.prepare('SELECT count(*) n FROM scan_targets WHERE job_id=9').get().n,0);
  await archiveAndDeleteTargets(db,9,2000);
  assert.equal(count(),1);
  sql.exec("INSERT INTO scan_targets(id,job_id,cycle,country,verification_kind) VALUES(1,9,1,'country','')");
  assert.equal(count(),1);
  sql.exec("CREATE TRIGGER refuse_archive BEFORE INSERT ON scan_target_history BEGIN SELECT RAISE(ABORT,'fail'); END;");
  await assert.rejects(archiveAndDeleteTargets(db,9,3000));
  assert.equal(sql.prepare('SELECT count(*) n FROM scan_targets WHERE job_id=9').get().n,1);
  sql.close();
});

function rotationFixture(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) {
    sql.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  }
  sql.exec(`INSERT INTO scan_jobs
    (id,status,config_json,plan_json,loop,cycle,total_points,current_index,created_at,updated_at)
    VALUES(9,'running','{}','[]',1,2,2,1,1,1);
    INSERT INTO scan_targets(id,job_id,sequence,cycle,city,status,lat,lng,created_at,updated_at)
    VALUES(10,9,0,2,'existing','completed',1,2,1,1),
      (11,9,1,1,'stale generation','queued',3,4,1,1);`);
  const db = {
    prepare(query) {
      return { bind(...args) {
        return {
          first: () => sql.prepare(query).get(...args),
          all: () => ({ results: sql.prepare(query).all(...args) }),
          run: () => ({ meta: { changes: sql.prepare(query).run(...args).changes } }),
        };
      } };
    },
    async batch(steps) {
      sql.exec('BEGIN');
      try {
        const results = steps.map(step => step.run());
        sql.exec('COMMIT');
        return results;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const next = [{ country: 'test', city: 'next grid', lat: 5, lng: 6,
    regionIndex: 0, pointIndex: 4, cooldownS: 45 }];
  return { sql, db, next };
}

test('a stalled mixed-cycle queue advances once, with stale targets and completed work preserved in history', async t => {
  const { sql, db, next } = rotationFixture(t);
  assert.ok(await canRollScanCycle(db, 9, 2));
  assert.deepEqual(await Promise.all([rollScanCycle(db, 9, 2, next, 1000),
    rollScanCycle(db, 9, 2, next, 1001)]), [true, false]);
  const job = sql.prepare('SELECT * FROM scan_jobs WHERE id=9').get();
  assert.equal(job.cycle, 3);
  assert.equal(job.current_index, 0);
  assert.equal(job.total_points, 1);
  assert.deepEqual(JSON.parse(job.plan_json), next);
  const queued = sql.prepare('SELECT * FROM scan_targets WHERE job_id=9').all();
  assert.equal(queued.length, 1);
  assert.ok(queued[0].id > 11);
  assert.equal(queued[0].cycle, 3);
  assert.equal(queued[0].status, 'queued');
  assert.equal(queued[0].base_cooldown_s, 45);
  const archive = sql.prepare('SELECT * FROM scan_target_history ORDER BY id').all();
  assert.deepEqual(archive.map(row => [row.id, row.cycle, row.status]), [[10, 2, 'completed'], [11, 1, 'cancelled']]);
});

test('live leases, current queued targets and queued verification keep the current cycle', async t => {
  const { sql, db, next } = rotationFixture(t);
  for (const [cycle, status, verification] of [
    [1, 'leased', ''], [2, 'queued', ''], [3, 'queued', ''], [1, 'queued', 'candidate'],
  ]) {
    sql.prepare('UPDATE scan_targets SET cycle=?, status=?, verification_kind=? WHERE id=11')
      .run(cycle, status, verification);
    assert.equal(await canRollScanCycle(db, 9, 2), undefined);
    assert.equal(await rollScanCycle(db, 9, 2, next, 1000), false);
    assert.equal(sql.prepare('SELECT cycle FROM scan_jobs WHERE id=9').get().cycle, 2);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM scan_target_history').get().n, 0);
  }
  sql.exec(`UPDATE scan_targets SET verification_kind='' WHERE id=11;
    INSERT INTO controller_dispatches
      (batch,owner,payload_sha,admission,agent_id,job_id,candidate_count,created_at)
      VALUES ('batch','controller','fixture','fixture','agent',9,1,1);`);
  assert.equal(await canRollScanCycle(db, 9, 2), undefined);
  assert.equal(await rollScanCycle(db, 9, 2, next, 1000), false);
});

test('returned active batches permit one ordinary rollover without closing or losing their proof', async t => {
  const { sql, db, next } = rotationFixture(t);
  sql.exec(`INSERT INTO controller_dispatches
    (batch,owner,payload_sha,admission,agent_id,job_id,candidate_count,created_at)
    VALUES ('wave-a','controller','fixture-a','fixture-a','agent-a',9,1,1),
      ('wave-b','controller','fixture-b','fixture-b','agent-b',9,1,1),
      ('stopped-wave','controller','fixture-c','fixture-c','agent-c',8,1,1);
    INSERT INTO scan_targets
      (id,job_id,sequence,cycle,city,status,lat,lng,created_at,updated_at,
       verification_batch,verification_kind,required_agent_id,completed_agent_id,leased_at,completed_at)
    VALUES (12,9,-4,2,'candidate-a','completed',1,2,1,1,'wave-a','candidate','agent-a','agent-a',20,30),
      (13,9,-3,2,'return-a','completed',1,2,1,1,'wave-a','return','agent-a','agent-a',40,50),
      (14,9,-2,2,'candidate-b','failed',1,2,1,1,'wave-b','candidate-giant','agent-b','agent-b',20,30),
      (15,9,-1,2,'return-b','completed',1,2,1,1,'wave-b','return','agent-b','agent-b',40,50);`);
  for (const [column, badValue, validValue] of [
    ['status', 'failed', 'completed'],
    ['completed_agent_id', 'agent-a', 'agent-b'],
    ['required_agent_id', 'agent-a', 'agent-b'],
    ['leased_at', 0, 40],
    ['completed_at', 39, 50],
  ]) {
    const set = sql.prepare(`UPDATE scan_targets SET ${column}=? WHERE id=15`);
    set.run(badValue);
    assert.equal(await rollScanCycle(db, 9, 2, next, 1000), false, column);
    set.run(validValue);
  }
  sql.exec("UPDATE controller_dispatches SET candidate_count=2 WHERE batch='wave-b'");
  assert.equal(await rollScanCycle(db, 9, 2, next, 1000), false);
  sql.exec("UPDATE controller_dispatches SET candidate_count=1 WHERE batch='wave-b'");
  assert.ok(await canRollScanCycle(db, 9, 2));
  assert.deepEqual(await Promise.all([rollScanCycle(db, 9, 2, next, 1000),
    rollScanCycle(db, 9, 2, next, 1001)]), [true, false]);
  const target = sql.prepare('SELECT * FROM scan_targets WHERE job_id=9').get();
  assert.equal(target.cycle, 3);
  assert.equal(target.verification_kind, '');
  assert.equal(target.status, 'queued');
  const archived = sql.prepare("SELECT id,status,completed_agent_id,completed_at FROM scan_target_history WHERE verification_kind='return' ORDER BY id").all();
  assert.deepEqual(archived.map(x => [x.id,x.status,x.completed_agent_id,x.completed_at]),
    [[13,'completed','agent-a',50],[15,'completed','agent-b',50]]);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM controller_dispatches WHERE state='active'").get().n, 3);
  const p = await dispatchProof(db, 'wave-a', 3000);
  assert.equal(p.return_ack, true);
  assert.equal(p.can_close, false);
  sql.prepare("UPDATE scan_targets SET status='completed', completed_agent_id='agent-a', leased_at=1100, completed_at=2500 WHERE id=?").run(target.id);
  assert.equal(await rollScanCycle(db, 9, 3, next, 2600), false);
  const storeObservation = sql.prepare("INSERT INTO mushroom_observations VALUES(?,?,?,2,3,1,0,5,100,4000,?)");
  storeObservation.run('wrong-agent','demo','agent-b',target.id);
  assert.equal((await closeDispatch(db, 'wave-a', 'controller', 3000)).http, 409);
  storeObservation.run('matching','demo','agent-a',target.id);
  assert.equal((await closeDispatch(db, 'wave-a', 'controller', 3000)).http, 200);
  assert.equal((await dispatchProof(db, 'wave-b', 3000)).can_close, false);
  assert.equal(await rollScanCycle(db, 9, 3, next, 3100), false);
  sql.exec("UPDATE controller_dispatches SET state='closed' WHERE job_id=9");
  assert.equal(await rollScanCycle(db, 9, 3, next, 3200), true);
});

test('a failed next-cycle insert leaves the previous queue, job pointer and archive intact', async t => {
  const { sql, db, next } = rotationFixture(t);
  sql.exec("CREATE TRIGGER refuse_next_cycle BEFORE INSERT ON scan_targets BEGIN SELECT RAISE(ABORT,'insert failed'); END");
  await assert.rejects(rollScanCycle(db, 9, 2, next, 1000), /insert failed/);
  assert.equal(sql.prepare('SELECT cycle FROM scan_jobs WHERE id=9').get().cycle, 2);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM scan_targets').get().n, 2);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM scan_target_history').get().n, 0);
});
