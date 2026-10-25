import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,row} from './helpers/upload-regression.mjs';

test('blank TSV coordinates cannot become a real observation at zero latitude and longitude', async (t) => {
  const f = fixture(t);
  const response = await f.send(row({ lat: '', lng: '' }));
  assert.equal(await response.text(), 'accepted=0\n', 'missing coordinates must be rejected, not coerced to zero');
  assert.equal(f.count('mushrooms'), 0);
  assert.equal(f.count('mushroom_observations'), 0);
});


test('coordinate validation rejects missing, nonfinite and out-of-range axes but accepts real zero and edges', async t => {
  const f=fixture(t);
  for(const values of [{lat:''},{lng:''},{lat:' '},{lng:' '},{lat:'NaN'},{lng:'Infinity'},{lat:90.01},{lng:-180.01}]) {
    assert.equal(f.cloud.parseTsv(row(values)).length,0,JSON.stringify(values));
  }
  for(const values of [{lat:0,lng:0},{lat:90,lng:180},{lat:-90,lng:-180}]) {
    const parsed=f.cloud.parseTsv(row(values));
    assert.equal(parsed.length,1);
    assert.equal(parsed[0].lat,values.lat);assert.equal(parsed[0].lng,values.lng);
  }
  assert.equal(await(await f.send(row({lat:0,lng:0}))).text(),'accepted=1\n');
  const location=f.sql.prepare('SELECT lat,lng FROM mushroom_locations').get();
  assert.deepEqual({...location},{lat:0,lng:0});
});
