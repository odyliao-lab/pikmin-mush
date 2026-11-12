import assert from "node:assert/strict";
import test from "node:test";
import { scoreRegions } from "../lib/allocation-shadow.mjs";
test("opportunity weights retain exploration and reject short experiments",()=>{
  const rows=[{country:"a",scan_ms:3600000,targets:50,eligible_unique:100},{country:"b",scan_ms:3600000,targets:50,eligible_unique:0}];
  const short=scoreRegions(rows,2);
  assert.ok(short.every(r=>!r.enough_evidence));
  assert.ok(scoreRegions(rows,48).every(r=>!r.enough_evidence));
  assert.ok(scoreRegions(rows,47,true).every(r=>!r.enough_evidence));
  const full=scoreRegions(rows,48,true);
  assert.ok(full.every(r=>r.enough_evidence));
  assert.ok(full.every(r=>r.suggested_share>=0.1));
  assert.ok(Math.abs(full.reduce((s,r)=>s+r.suggested_share,0)-1)<1e-9);
  assert.ok(full[0].suggested_share>full[1].suggested_share);
  assert.deepEqual(scoreRegions([],0),[]);
});
