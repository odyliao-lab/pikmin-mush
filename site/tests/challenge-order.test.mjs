import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,row,NEW_START,OLD_START} from './helpers/upload-regression.mjs';

test('delayed older challenge across Taipei midnight cannot replace the newer current challenge', async (t) => {
  const f = fixture(t);
  assert.equal((await f.send(row({ start: NEW_START, count: 7 }))).status, 200);
  f.sql.exec("UPDATE mushrooms SET mushroom_status='invalid',invalidated_at=123,giant_recheck_status='invalid'");
  f.advance(500);
  f.agent.id = 'other';
  assert.equal((await f.send(row({ start: OLD_START, count: 1 }))).status, 200);
  assert.equal(f.count('mushroom_challenges'), 2, 'history must retain delayed evidence');
  const current = f.sql.prepare('SELECT start_ms,challenger_count,mushroom_status,invalidated_at FROM mushrooms').get();
  assert.deepEqual({ ...current }, {
    start_ms: NEW_START, challenger_count: 7, mushroom_status: 'invalid', invalidated_at: 123,
  }, 'older challenge must not overwrite or reactivate the newer snapshot');
});


test('known challenge cannot regress to unknown; equal challenge updates and newer challenge resets invalidation', async t => {
  const f=fixture(t);
  await f.send(row());
  f.sql.exec("UPDATE mushrooms SET mushroom_status='invalid',invalidated_at=123,giant_recheck_status='invalid'");
  f.agent.id='other';
  await f.send(row({start:0,count:0}));
  assert.equal(f.sql.prepare('SELECT start_ms FROM mushrooms').get().start_ms,NEW_START);
  assert.equal(f.count('mushroom_challenges'),2);
  f.agent.id='fixture';
  const same=row({count:4});
  await f.send(same,{start:Buffer.byteLength(row())});
  let current=f.sql.prepare('SELECT * FROM mushrooms').get();
  assert.equal(current.challenger_count,4);
  assert.equal(current.mushroom_status,'invalid');
  assert.equal(current.invalidated_at,123);
  const next=row({start:NEW_START+1000,count:1});
  await f.send(next,{start:Buffer.byteLength(row())+Buffer.byteLength(same)});
  current=f.sql.prepare('SELECT * FROM mushrooms').get();
  assert.equal(current.start_ms,NEW_START+1000);
  assert.equal(current.mushroom_status,'active');
  assert.equal(current.invalidated_at,0);
  assert.equal(current.giant_recheck_status,'');
});

test('unknown challenge may advance to a known challenge', async t => {
  const f=fixture(t),unknown=row({start:0});
  await f.send(unknown);
  await f.send(row(),{start:Buffer.byteLength(unknown)});
  assert.equal(f.sql.prepare('SELECT start_ms FROM mushrooms').get().start_ms,NEW_START);
  assert.equal(f.count('mushroom_challenges'),2);
});
