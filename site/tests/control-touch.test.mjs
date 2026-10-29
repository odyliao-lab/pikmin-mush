import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';
import { scanInteger } from '../lib/scan-identifiers.mjs';
import * as policy from '../lib/fleet-policy.mjs';
import * as plans from '../lib/rotation-plan.mjs';

function load(file, deps) {
  const exports = {};
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  new Script(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports, URL, Date,
    require(p) { if (p in deps) return deps[p]; throw Error(p); }});
  return exports;
}
function fixture({paused = false, status = 'running', changes = 1, authorized = true} = {}) {
  const sql = [], events = [];
  const db = {prepare(q) { let binds; return {bind(...b) {binds=b; return this;},
    async first() {sql.push({q, binds}); return {status};},
    async run() {sql.push({q, binds}); return {meta: {changes}};}};}};
  const cloud = {runtime: () => ({DB: db}), ensureSchema: async () => {},
    plain: (s, status=200) => new Response(s, {status})};
  const fleet = load('../lib/fleet.ts', {'./cloud': cloud, './scans': {}, './rotation': {},
    './fleet-policy.mjs': policy, './rotation-plan.mjs': plans,
    './targets': {}, './target-history.mjs': {}, './scan-plans': {}, './scan-outcomes.mjs': {},
    './metrics': {HEARTBEAT_SAMPLE_MS: 300000, recordAgentEvent: async e => events.push(e)}});
  const versions = {version: 'v', gameVersion: '154.0', moduleVersion: '154.0'};
  const route = load('../app/api/agent/v2/control/route.ts', {
    '../../../../../lib/cloud': cloud,
    '../../../../../lib/scan-identifiers.mjs': {scanInteger},
    '../../../../../lib/fleet': {...fleet, authorizeFleetAgent: async () => authorized ? {id: 'fixture', paused} : null,
      agentRequestVersions: () => versions}});
  return {sql, events, async get(query='job_id=1&target_id=2&lease=valid') {
    return route.GET(new Request('https://example.test/api/agent/v2/control?'+query));}};
}
test('valid control renews lease and touches presence/version exactly once', async () => {
  const f = fixture(); assert.equal(await (await f.get()).text(), 'run\n');
  assert.equal(f.sql.filter(s=>s.q.includes('UPDATE scan_agents')).length, 1);
  assert.equal(f.sql.filter(s=>s.q.includes('UPDATE scan_targets')).length, 1);
  assert.equal(f.events.length, 1);
  const target = f.sql.find(s=>s.q.includes('UPDATE scan_targets'));
  assert.equal(target.binds[0] - target.binds[1], 12*60000);
  const touch = f.sql.find(s=>s.q.includes('UPDATE scan_agents'));
  assert.equal(touch.binds[3], 1); assert.equal(touch.binds[4], 1);
  assert.equal(touch.binds[5], 1); assert.equal(touch.binds[6], 2);
  assert.ok(touch.binds.includes('154.0'));
});
test('invalid lease touches presence once without changing current job/target', async () => {
  const f=fixture({changes:0}); assert.equal(await (await f.get()).text(), 'stop\n');
  const updates=f.sql.filter(s=>s.q.includes('UPDATE scan_agents'));
  assert.equal(updates.length,1); assert.equal(updates[0].binds[3],0); assert.equal(updates[0].binds[5],0);
});
test('pause, stopped job and missing lease preserve one heartbeat and do not renew', async () => {
  for (const [options, query, expected] of [[{paused:true},undefined,'pause'],
    [{status:'paused'},undefined,'pause'],[{status:'stopped'},undefined,'stop'],[{},'', 'stop']]) {
    const f=fixture(options); assert.equal(await (await f.get(query)).text(),expected+'\n');
    assert.equal(f.sql.filter(s=>s.q.includes('UPDATE scan_agents')).length,1);
    assert.equal(f.sql.filter(s=>s.q.includes('UPDATE scan_targets')).length,0);
    assert.equal(f.events.length,1);
  }
});
test('unauthorized control performs no touch or lease update', async () => {
  const f=fixture({authorized:false}); assert.equal((await f.get()).status,401);
  assert.equal(f.sql.length,0); assert.equal(f.events.length,0);
});
