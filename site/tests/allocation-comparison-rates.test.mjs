import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonRates} from '../lib/allocation-comparison.mjs';

test('eligible opportunities are normalized by actual effort',()=>{
 const row={targets:50,scan_ms:3600000,eligible_unique:5,completed_targets:48,zero_row_targets:40};
 const rates=comparisonRates(row,2);
 assert.equal(rates.eligible_per_100_targets,10);
 assert.equal(rates.eligible_per_scan_hour,5);
 assert.equal(rates.eligible_per_wall_hour,2.5);
 assert.equal(comparisonRates({...row,targets:0,scan_ms:0},2).eligible_per_100_targets,null);
});
