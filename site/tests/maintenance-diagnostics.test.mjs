import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import {maintenanceHealth, maintenanceMessage} from '../lib/maintenance-health.mjs';
import {fixture, NOW, LEASE} from './helpers/maintenance-regression.mjs';

const DAY = 86_400_000;
const ALERT = 'mushroom-retention-alert-critical';
const source = readFileSync(new URL('../lib/cloud.ts', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('export async function checkMaintenanceHealth'),
  source.indexOf('// GitHub\'s scheduled event'));
const script = new Script(ts.transpileModule(section, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
}}).outputText);

function healthFixture(t, send = async () => ({ok: true, status: 204})) {
  const f = fixture(t);
  f.sql.prepare('INSERT INTO maintenance_state(name,last_succeeded_at) VALUES (?,?)')
    .run('mushroom-retention', NOW / 1000);
  f.sql.prepare('INSERT INTO maintenance_state(name,last_run_at) VALUES (?,?)')
    .run('mushroom-retention-independent', NOW / 1000);
  f.sql.prepare('INSERT INTO maintenance_state(name,pending) VALUES (?,?)').run(LEASE, 12);
  f.sql.prepare('INSERT INTO maintenance_state(name,last_run_at) VALUES (?,?)')
    .run('history-retention-v1-backlog', NOW - DAY);
  const exports = {}, logs = [], requests = [];
  script.runInNewContext({exports, Date, Map, maintenanceHealth, maintenanceMessage, AbortSignal,
    retentionStatus: r => ({lastSucceededAt: r.last_succeeded_at, pending: r.pending,
      consecutiveFailures: r.consecutive_failures}),
    runtime: () => ({DB: f.db, MAINTENANCE_DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/local-fixture'}),
    fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return send(); },
    console: {info: line => logs.push(JSON.parse(line)), warn: line => logs.push(JSON.parse(line))},
    RETENTION_SCHEDULE_ALERT_REPEAT_SECONDS: 86400,
  });
  return {...f, check: exports.checkMaintenanceHealth, logs, requests,
    alert: () => f.sql.prepare('SELECT * FROM maintenance_state WHERE name=?').get(ALERT)};
}

test('history backlog becomes critical at 24 hours while mushroom cleanup stays healthy', async t => {
  const f = healthFixture(t);
  f.sql.prepare("UPDATE maintenance_state SET last_run_at=? WHERE name='history-retention-v1-backlog'")
    .run(NOW - DAY + 1);
  let health = await f.check(NOW);
  assert.equal(health.severity, 'healthy');
  assert.equal(health.historyBacklogPersistent, false);
  assert.equal(f.requests.length, 0);
  health = await f.check(NOW + 1);
  assert.equal(health.severity, 'critical');
  assert.equal(health.evaluatedAt, NOW / 1000);
  assert.equal(health.historyBacklogSinceMs, NOW - DAY + 1);
  assert.equal(health.historyPending, 12);
  assert.equal(health.historyConsecutiveFailures, 0);
  assert.equal(health.historyFailing, false);
  assert.equal(health.historyBacklogPersistent, true);
  assert.equal(health.pending, 0);
  assert.equal(health.cleanupFailing, false);
  assert.equal(health.backlogPersistent, false);
  assert.match(f.requests[0].content, /^【歷史資料清理異常】.*至少24小時/);
  assert.doesNotMatch(f.requests[0].content, /蘑菇清理異常|蘑菇清理逾一小時/);
  assert.deepEqual(f.requests[0].allowed_mentions, {parse: []});
  assert.equal(f.alert().last_succeeded_at, NOW / 1000);
});

test('history failure threshold and a drained backlog remain separate reasons', async t => {
  const f = healthFixture(t);
  f.sql.prepare('UPDATE maintenance_state SET pending=0,consecutive_failures=1 WHERE name=?').run(LEASE);
  let health = await f.check(NOW);
  assert.equal(health.severity, 'healthy');
  assert.equal(health.historyBacklogPersistent, false);
  assert.equal(health.historyConsecutiveFailures, 1);
  f.sql.prepare('UPDATE maintenance_state SET consecutive_failures=2 WHERE name=?').run(LEASE);
  health = await f.check(NOW);
  assert.equal(health.severity, 'critical');
  assert.equal(health.historyFailing, true);
  assert.equal(health.historyBacklogPersistent, false);
  assert.match(f.requests[0].content, /歷史資料清理連續失敗至少兩次/);
  assert.doesNotMatch(f.requests[0].content, /至少24小時/);
  const mixed = maintenanceMessage({...health, cleanupFailing: true, backlogPersistent: true},
    {consecutiveFailures: 2});
  assert.match(mixed, /^【資料清理異常】/);
  assert.match(mixed, /蘑菇過期資料持續積壓/);
  assert.match(mixed, /歷史資料清理連續失敗/);
});

test('HTTP rejection records only status/stage, preserves cleanup, and keeps retry throttling', async t => {
  let reject = true;
  const f = healthFixture(t, async () => ({ok: !reject, status: reject ? 429 : 204,
    text() { throw Error('PRIVATE_RESPONSE_MUST_NOT_BE_READ'); }}));
  const cleanupBefore = f.sql.prepare("SELECT * FROM maintenance_state WHERE name='mushroom-retention'").get();
  const historyBefore = f.sql.prepare('SELECT * FROM maintenance_state WHERE name=?').get(LEASE);
  assert.equal((await f.check(NOW)).severity, 'critical');
  assert.equal(f.alert().last_failed_at, NOW / 1000);
  assert.equal(f.alert().last_failure_stage, 'http_429');
  assert.equal(f.alert().last_succeeded_at, 0);
  assert.deepEqual(f.logs, [{event: 'mushroom_retention_health_alert_failed', severity: 'critical',
    attemptedAt: NOW / 1000, httpStatus: 429, failureStage: 'http_429'}]);
  await f.check(NOW + 299_000);
  assert.equal(f.requests.length, 1);
  reject = false;
  assert.equal((await f.check(NOW + 301_000)).severity, 'critical');
  assert.equal(f.requests.length, 2);
  assert.equal(f.alert().last_succeeded_at, NOW / 1000 + 301);
  assert.equal(f.logs[1].event, 'mushroom_retention_health_alert_sent');
  assert.equal(f.logs[1].httpStatus, 204);
  await f.check(NOW + 602_000);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.sql.prepare("SELECT * FROM maintenance_state WHERE name='mushroom-retention'").get(), cleanupBefore);
  assert.deepEqual(f.sql.prepare('SELECT * FROM maintenance_state WHERE name=?').get(LEASE), historyBefore);
  assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE_|discord\.com|local-fixture/);
});

test('transport failure does not expose exception content or claim an HTTP rejection', async t => {
  const f = healthFixture(t, async () => { throw Error('PRIVATE_TOKEN https://private.invalid'); });
  assert.equal((await f.check(NOW)).severity, 'critical');
  assert.equal(f.alert().last_failure_stage, 'request');
  assert.equal(f.logs[0].httpStatus, null);
  assert.equal(f.logs[0].failureStage, 'request');
  assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE_|private\.invalid|local-fixture/);
});

test('successful HTTP delivery followed by receipt failure has a distinct diagnostic', async t => {
  const f = healthFixture(t);
  f.hooks.beforeRun = async query => {
    if (query.includes('SET last_succeeded_at=?')) throw Error('PRIVATE_DATABASE_DETAIL');
  };
  assert.equal((await f.check(NOW)).severity, 'critical');
  assert.equal(f.alert().last_succeeded_at, 0);
  assert.equal(f.alert().last_failure_stage, 'record_success');
  assert.equal(f.logs[0].httpStatus, 204);
  assert.equal(f.logs[0].failureStage, 'record_success');
  assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE_DATABASE_DETAIL/);
});
