import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import {pendingUploadState} from '../lib/upload-pending.mjs';

const NOW = 1_800_000_000_000;
const code = ts.transpileModule(readFileSync(new URL('../app/api/controller/maintenance/route.ts', import.meta.url), 'utf8'),
  {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
function routeFixture(options = {}) {
  const logs = [];
  let writes = 0, healthCalls = 0;
  const fail = stage => { if (options.fail === stage) throw Error('PRIVATE_EXCEPTION https://private.invalid/TOKEN'); };
  const completed = {lastRunAt: NOW / 1000, lastSucceededAt: NOW / 1000,
    consecutiveFailures: 0, pending: 0, ...options.completed};
  const history = {lastRunAt: NOW, lastSucceededAt: NOW, consecutiveFailures: 0,
    busy: false, tables: [], ...options.history};
  const db = {prepare() { return {bind() { return this; },
    async run() { fail('source_receipt'); writes++; return {meta: {changes: 1}}; },
    async all() { fail('snapshot'); return {results: []}; },
  }; }};
  class Clock extends Date { static now() { return options.now ?? NOW; } }
  const exports = {};
  new Script(code).runInNewContext({exports, Date: Clock,
    console: {warn: line => logs.push(JSON.parse(line))},
    fetch() { throw Error('NETWORK_FORBIDDEN'); },
    require(path) {
      if (path.endsWith('/history-retention.mjs')) return {
        runHistoryRetention: async () => { fail('history_run'); return history; },
        readHistoryRetention: async () => history,
      };
      if (path.endsWith('/upload-pending.mjs')) return {pendingUploadState};
      if (path.endsWith('/cloud')) return {
        maintenanceAuthorized: () => options.authorized !== false, controllerAuthorized: () => false,
        ensureSchema: async () => { fail('schema'); }, runtime: () => ({DB: db}),
        runMushroomRetention: async () => { fail('mushroom_run'); return completed; },
        readMushroomRetentionStatus: async () => completed,
        checkMaintenanceHealth: async () => { healthCalls++; fail('health'); return {severity: 'healthy'}; },
        noStoreJson: (body, status = 200) => Response.json(body, {status, headers: {'cache-control': 'no-store'}}),
      };
      throw Error('unexpected import');
    },
  });
  return {logs, writes: () => writes, healthCalls: () => healthCalls,
    post: (source = 'schedule') => exports.POST(new Request('https://local.invalid/maintenance', {
      method: 'POST', headers: {'x-maintenance-event': source, authorization: 'PRIVATE_TOKEN'},
    }))};
}

test('maintenance errors report fixed stages without leaking exception or request contents', async () => {
  for (const stage of ['schema', 'mushroom_run', 'history_run', 'source_receipt', 'health', 'snapshot']) {
    const f = routeFixture({fail: stage});
    const response = await f.post();
    assert.equal(response.status, 503, stage);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.maintenanceFailure.stage, stage);
    assert.equal(body.maintenanceFailure.reason, 'exception');
    assert.equal(body.maintenanceFailure.sourceReceiptRecorded, ['health', 'snapshot'].includes(stage));
    assert.equal(f.logs.length, 1);
    assert.deepEqual(f.logs[0], {event: 'maintenance_request_failed', ...body.maintenanceFailure});
    assert.doesNotMatch(JSON.stringify({body, logs: f.logs}), /PRIVATE_|private\.invalid|NETWORK_FORBIDDEN/);
  }
});

test('busy history is distinguished from a valid receipt, without minting success for stale work', async () => {
  for (const busy of [true, false]) {
    const f = routeFixture({history: {lastSucceededAt: NOW - 300_001, busy}});
    const response = await f.post();
    assert.equal(response.status, 503);
    const failure = (await response.json()).maintenanceFailure;
    assert.equal(failure.stage, 'history_receipt');
    assert.equal(failure.reason, 'stale_receipt');
    assert.equal(failure.historyBusy, busy);
    assert.equal(failure.historyLastSucceededAtMs, NOW - 300_001);
    assert.equal(f.writes(), 0);
  }
  const f = routeFixture({history: {lastRunAt: NOW, lastSucceededAt: NOW - 1000, busy: true}});
  assert.equal((await f.post()).status, 200);
  assert.equal(f.writes(), 2);
});

test('receipt rejection reasons retain strict five-minute and clock-skew boundaries', async () => {
  for (const [subject, patch, reason] of [
    ['completed', {lastSucceededAt: NaN}, 'invalid_timestamp'],
    ['completed', {lastSucceededAt: Infinity}, 'invalid_timestamp'],
    ['completed', {lastSucceededAt: NOW / 1000 + 61}, 'future_timestamp'],
    ['completed', {lastSucceededAt: NOW / 1000 - 301}, 'stale_receipt'],
    ['completed', {consecutiveFailures: 1}, 'recorded_failure'],
    ['history', {lastSucceededAt: 0}, 'invalid_timestamp'],
    ['history', {lastSucceededAt: NOW + 60001}, 'future_timestamp'],
    ['history', {lastSucceededAt: NOW - 1}, 'incomplete_run'],
    ['history', {consecutiveFailures: 1}, 'recorded_failure'],
    ['history', {tables: [{last_error: 'PRIVATE_TABLE_ERROR'}]}, 'table_failure'],
  ]) {
    const f = routeFixture({[subject]: patch});
    const response = await f.post();
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.maintenanceFailure.reason, reason);
    assert.equal(f.writes(), 0);
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE_/);
  }
  for (const offset of [-300, 0, 60]) {
    const f = routeFixture({completed: {lastSucceededAt: NOW / 1000 + offset}});
    assert.equal((await f.post()).status, 200);
  }
  // D1's integer-second lease can still be protected in this fractional second.
  // The endpoint must fail closed, not relax its receipt age to hide contention.
  const boundary = routeFixture({now: NOW + 1, completed: {lastSucceededAt: NOW / 1000 - 300}});
  const response = await boundary.post();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).maintenanceFailure.reason, 'stale_receipt');
  assert.equal(boundary.writes(), 0);
});

test('authentication precedes diagnostics and unrecognized event headers are not echoed', async () => {
  const unauthorized = routeFixture({authorized: false, fail: 'schema'});
  assert.equal((await unauthorized.post()).status, 401);
  assert.equal(unauthorized.logs.length, 0);
  assert.equal(unauthorized.healthCalls(), 0);
  const f = routeFixture({fail: 'mushroom_run'});
  assert.equal((await (await f.post('PRIVATE_EVENT')).json()).maintenanceFailure.source, 'unknown');
  assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE_/);
});
