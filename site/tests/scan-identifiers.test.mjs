import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import * as ids from '../lib/scan-identifiers.mjs';

function load(path, dependencies) {
  const exports = {};
  new Script(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText).runInNewContext({exports, URL, require(name) {
    for (const [suffix, value] of Object.entries(dependencies)) if (name.endsWith(suffix)) return value;
    throw Error(name);
  }});
  return exports;
}

test('IDs retain exact values beyond one million and 32 bits; malformed/unsafe IDs fail closed', () => {
  for (const n of [1, 999999, 1000000, 1000001, 1000003, 1000395, 1000456, 2147483648, Number.MAX_SAFE_INTEGER])
    assert.equal(ids.scanInteger(String(n)), n);
  for (const value of [null, '', '0', '-1', '1.2', '1e6', '123x', ' 1', 'Infinity', '9007199254740992'])
    assert.equal(ids.scanInteger(value), null);
  assert.equal(ids.scanInteger('0', 0), 0);
});

test('real v2 ACK route forwards exact identities and preserves retry/lease statuses', async () => {
  let payload, calls = 0, result = 'ok';
  const route = load('../app/api/agent/v2/ack/route.ts', {
    '/cloud': {plain: (body, status = 200) => new Response(body, {status})},
    '/scan-identifiers.mjs': ids, '/scan-evidence.mjs': {scanEvidence: () => ({})},
    '/fleet': {authorizeFleetAgent: async () => ({id: 'test'}), touchAgent: async () => {},
      agentRequestVersions: () => ({}), completeTask: async (_, input) => {payload = input; calls++; return result;}},
  });
  for (const target of [1000003, 1000395, 1000456, 2147483648, Number.MAX_SAFE_INTEGER]) {
    const response = await route.POST(new Request(`https://example.test/ack?job_id=1000002&target_id=${target}&lease=test&ok=1&rows=4`));
    assert.equal(response.status, 200); assert.equal(payload.targetId, target);
    assert.equal(payload.jobId, 1000002); assert.equal(payload.leaseToken, 'test');
  }
  const before = calls;
  for (const target of ['1000003junk', '9007199254740992', '-1', ''])
    assert.equal((await route.POST(new Request(`https://example.test/ack?job_id=201&target_id=${target}`))).status, 400);
  assert.equal(calls, before);
  for (const [state, code] of [['duplicate', 200], ['missing', 404], ['stale', 409], ['stop', 409]]) {
    result = state;
    assert.equal((await route.POST(new Request('https://example.test/ack?job_id=201&target_id=1000395'))).status, code);
  }
});

test('online heartbeats do not hide prolonged unfinished targets; paused/idle remain distinct', () => {
  const {agentHealth} = load('../lib/metrics.ts', {'/cloud': {}});
  const now = 10000000;
  const row = {enabled: 1, paused: 0, last_seen: now, last_data_at: now,
    last_target_at: now - 61 * 60000, no_data_streak: 0, current_target_id: 1000395,
    agent_version: '2.2.0', game_version: '152.0', module_version: '152.0'};
  assert.equal(agentHealth(row, now).status, 'critical');
  assert.equal(agentHealth({...row, last_target_at: now - 31 * 60000}, now).status, 'warning');
  assert.equal(agentHealth({...row, paused: 1}, now).status, 'paused');
  assert.equal(agentHealth({...row, current_target_id: null}, now).status, 'healthy');
  assert.equal(agentHealth({...row, last_target_at: now}, now).status, 'healthy');
  assert.equal(agentHealth({...row, last_target_at: now, last_data_at: 1, no_data_streak: 100}, now).status, 'collecting');
  assert.equal(agentHealth({...row, last_target_at: now - 61 * 60000, no_data_streak: 100}, now).status, 'critical');
});

test('an unconfirmed scan cannot make the fleet soak verdict pass', () => {
  const {soakVerdict} = load('../lib/metrics.ts', {'/cloud': {}});
  assert.equal(soakVerdict(true, 0, 0, 1), 'collecting');
  assert.equal(soakVerdict(true, 1, 0, 1), 'fail');
  assert.equal(soakVerdict(true, 0, 1, 1), 'warn');
  assert.equal(soakVerdict(true, 0, 0, 0), 'pass');
});

test('Agent pending byte telemetry rejects malformed and unsafe numbers', () => {
  const source=readFileSync(new URL('../lib/fleet.ts',import.meta.url),'utf8');
  const section=source.slice(source.indexOf('export function agentRequestVersions'),source.indexOf('export async function touchAgent'));
  const exports={};
  new Script(ts.transpileModule(section,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText).runInNewContext({exports});
  const read=value=>exports.agentRequestVersions(new Request('https://example.test',{headers:value===null?{}:{'x-agent-pending-bytes':value}})).pendingBytes;
  assert.equal(read('0'),0);assert.equal(read('12345'),12345);
  for(const value of [null,'','-1','1e9','9007199254740992'])assert.equal(read(value),undefined);
});
