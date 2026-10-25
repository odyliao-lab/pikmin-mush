import test from 'node:test';
import assert from 'node:assert/strict';
import {runHistoryRetention,readHistoryRetention} from '../lib/history-retention.mjs';
import {fixture,NOW,holdBackupExpiry,oldEvent,maintenanceRoute} from './helpers/maintenance-regression.mjs';

test('local regression: scheduled POST cannot acknowledge an uncompleted first history run', {timeout:10000}, async t => {
  const f = fixture(t); oldEvent(f);
  const route = maintenanceRoute(f), gate = holdBackupExpiry(f);
  const first = runHistoryRetention(f.db, NOW);
  await gate.entered;
  let status, receipts;
  try {
    const response = await route.POST(new Request('https://local.invalid/api/controller/maintenance', {
      method: 'POST', headers: {'x-maintenance-event': 'cloudflare-cron'},
    }));
    status = response.status;
    receipts = f.sql.prepare("SELECT COUNT(*) n FROM maintenance_state WHERE name='mushroom-retention-independent'").get().n;
    assert.equal((await readHistoryRetention(f.db, NOW)).lastSucceededAt, 0);
  } finally { gate.release(); await first; }
  assert.deepEqual({status, receipts}, {status: 503, receipts: 0},
    'pending history work must not mint a successful independent-source receipt');
});


test('source receipts require finite, recent, completed and successful history timestamps', async t => {
  for(const history of [
    {lastSucceededAt:0}, {lastSucceededAt:NaN}, {lastSucceededAt:Infinity},
    {lastSucceededAt:NOW-300001}, {lastSucceededAt:NOW+60001},
    {lastSucceededAt:NOW-1,lastRunAt:NOW}, {lastSucceededAt:NOW,consecutiveFailures:1},
  ]) {
    const f=fixture(t),route=maintenanceRoute(f,{tables:[],lastRunAt:0,consecutiveFailures:0,...history});
    const response=await route.POST(new Request('https://local.invalid/maintenance',{
      method:'POST',headers:{'x-maintenance-event':'cloudflare-cron'}}));
    assert.equal(response.status,503,JSON.stringify(history));
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM maintenance_state WHERE name='mushroom-retention-independent'").get().n,0);
  }
  for(const lastSucceededAt of [NOW-300000,NOW,NOW+60000]) {
    const f=fixture(t),route=maintenanceRoute(f,{tables:[],lastRunAt:lastSucceededAt,lastSucceededAt,consecutiveFailures:0});
    const response=await route.POST(new Request('https://local.invalid/maintenance',{
      method:'POST',headers:{'x-maintenance-event':'cloudflare-cron'}}));
    assert.equal(response.status,200);
    assert.equal(f.sql.prepare("SELECT last_run_at FROM maintenance_state WHERE name='mushroom-retention-independent'").get().last_run_at,NOW/1000);
  }
});
