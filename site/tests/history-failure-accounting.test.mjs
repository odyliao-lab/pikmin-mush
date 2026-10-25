import test from 'node:test';
import assert from 'node:assert/strict';
import {runHistoryRetention,readHistoryRetention} from '../lib/history-retention.mjs';
import {fixture,NOW,LEASE} from './helpers/maintenance-regression.mjs';

test('local regression: repeated backup-expiry failures count toward maintenance failure health', async t => {
  const f = fixture(t), priorSuccess = NOW - 600_000;
  f.sql.prepare('INSERT INTO maintenance_state(name,last_succeeded_at) VALUES (?,?)').run(LEASE, priorSuccess);
  f.hooks.beforeRun = async query => {
    if (query.startsWith('DELETE FROM retention_backups')) throw Error('local injected backup expiry failure');
  };
  for (const now of [NOW, NOW + 300_001]) {
    await assert.rejects(runHistoryRetention(f.db, now), /local injected backup expiry failure/);
  }
  const state = await readHistoryRetention(f.db, NOW + 300_001);
  assert.equal(state.lastSucceededAt, priorSuccess, 'failed pass must preserve previous success');
  assert.equal(state.consecutiveFailures, 2, 'expiry failure must reach the same health accounting as table failures');
});


test('run-level failures preserve success, record safe stages, and reset after recovery', async t => {
  for(const [query,stage] of [['DELETE FROM retention_backups','backup_expiry'],["WHERE name='history-retention-v1-backlog'",'backlog']]) {
    const f=fixture(t),prior=NOW-600000;
    f.sql.prepare('INSERT INTO maintenance_state(name,last_succeeded_at) VALUES (?,?)').run(LEASE,prior);
    let fail=true;
    f.hooks.beforeRun=async sql=>{if(fail&&sql.includes(query))throw Error('PRIVATE_SENTINEL');};
    await assert.rejects(runHistoryRetention(f.db,NOW),/PRIVATE_SENTINEL/);
    const state=f.sql.prepare('SELECT * FROM maintenance_state WHERE name=?').get(LEASE);
    assert.equal(state.last_succeeded_at,prior);
    assert.equal(state.consecutive_failures,1);
    assert.equal(state.last_failed_at,NOW);
    assert.equal(state.last_failure_stage,stage);
    assert.ok(!JSON.stringify(state).includes('PRIVATE_SENTINEL'));
    // A caller that did not claim the lease must not count another failure.
    await runHistoryRetention(f.db,NOW+1);
    assert.equal((await readHistoryRetention(f.db,NOW+1)).consecutiveFailures,1);
    fail=false;
    const recovered=await runHistoryRetention(f.db,NOW+300001);
    assert.equal(recovered.consecutiveFailures,0);
    assert.equal(recovered.lastSucceededAt,NOW+300001);
    assert.equal(f.sql.prepare('SELECT last_failure_stage FROM maintenance_state WHERE name=?').get(LEASE).last_failure_stage,'');
  }
});
