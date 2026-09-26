import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { archiveAndDeleteTargets, TARGET_HISTORY_CTE } from '../lib/target-history.mjs';

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
    for (const name of ['verification_batch','verification_mushroom_id','status','completed_agent_id'])
      sql.exec(`ALTER TABLE ${table} ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`);
    for (const name of ['leased_at','completed_at','lat','lng'])
      sql.exec(`ALTER TABLE ${table} ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`);
  }
  const count=()=>sql.prepare(`${TARGET_HISTORY_CTE} SELECT COUNT(DISTINCT o.challenge_key) AS n
    FROM mushroom_observations o JOIN durable_targets t ON o.target_id=t.id WHERE t.verification_kind=''`).get().n;
  assert.equal(count(),1);
  await archiveAndDeleteTargets(db,9,1000);
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
