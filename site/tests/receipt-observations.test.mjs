import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,row} from './helpers/upload-regression.mjs';

test('distinct receipt ranges within one second preserve each target attribution', async (t) => {
  const f = fixture(t), body = row();
  assert.equal((await f.send(body)).status, 200);
  f.agent.current_target_id = 99;
  f.advance(100);
  assert.equal((await f.send(body, { start: Buffer.byteLength(body) })).status, 200);
  assert.equal(f.count('agent_upload_receipts'), 2);
  assert.equal(f.count('scan_agent_events'), 2);
  assert.equal(f.sql.prepare("SELECT uploaded_rows FROM scan_agents WHERE id='fixture'").get().uploaded_rows, 2);
  assert.deepEqual(f.sql.prepare('SELECT target_id FROM mushroom_observations ORDER BY target_id').all().map(r => r.target_id),
    [12, 99], 'second accepted upload must remain available to target-specific verification');
});


test('distinct receipts for the same target or a new stream survive, while retries stay idempotent', async t => {
  const f=fixture(t),body=row(),bytes=Buffer.byteLength(body);
  await f.send(body);
  await f.send(body,{start:bytes});
  const options={headers:{'x-upload-stream':'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}};
  await f.send(body,options);
  f.advance(5000);f.agent.current_target_id=99;
  await f.send(body,options);
  assert.equal(f.count('mushroom_observations'),3);
  assert.equal(f.count('agent_upload_receipts'),3);
  assert.equal(f.count('scan_agent_events'),3);
  assert.deepEqual(f.sql.prepare('SELECT DISTINCT target_id FROM mushroom_observations').all().map(r=>r.target_id),[12]);
  assert.equal(f.sql.prepare("SELECT uploaded_rows FROM scan_agents WHERE id='fixture'").get().uploaded_rows,3);
});
