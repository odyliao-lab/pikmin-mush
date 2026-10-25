import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,row} from './helpers/upload-regression.mjs';

test('malformed TSV participant count cannot become a zero-participant observation', async (t) => {
  const f = fixture(t);
  const response = await f.send(row({ count: 'not-a-count', capacity: 35 }));
  assert.equal(await response.text(), 'accepted=0\n', 'unknown participant count must not become an eligible empty mushroom');
  assert.equal(f.count('mushrooms'), 0);
  assert.equal(f.count('mushroom_observations'), 0);
});


test('participant count requires a complete bounded integer while preserving genuine zero', async t => {
  const f=fixture(t);
  for(const count of ['', ' ', '-1', '1.5', '3people', '1e2', 'NaN', 'Infinity', '10001', '9007199254740993']) {
    assert.equal(f.cloud.parseTsv(row({count})).length,0,JSON.stringify(count));
  }
  for(const count of [0,1,35,10000,' 2 ']) {
    assert.equal(f.cloud.parseTsv(row({count}))[0].challenger_count,Number(count));
  }
  assert.equal(await(await f.send(row({count:0}))).text(),'accepted=1\n');
  assert.equal(f.sql.prepare('SELECT challenger_count FROM mushroom_observations').get().challenger_count,0);
});
