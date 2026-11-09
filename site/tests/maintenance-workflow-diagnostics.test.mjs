import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const workflow = readFileSync(new URL('../../.github/workflows/mushroom-maintenance.yml', import.meta.url), 'utf8');
const python = workflow.split("python3 - <<'PY'")[1].split(/\r?\n          PY/)[0]
  .split(/\r?\n/).map(line => line.replace(/^ {10}/, '')).join('\n');
const now = 1_800_000_000;
function run(health) {
  const response = {now: now * 1000,
    retention: {lastSucceededAt: now, lastDeleted: 5, pending: 0, lastBatchSaturated: false,
      consecutiveFailures: 0, lastDurationMs: 100},
    alerts: {uploadSilentAgents: []}, maintenanceHealth: health,
    privateHistory: 'PRIVATE_CONTENT_MUST_NOT_BE_LOGGED'};
  // Execute only the actual response parser. curl is excluded and Python network access is trapped.
  const harness = `import os, time, urllib.request\ntime.time = lambda: ${now}\n` +
    `def forbidden(*args, **kwargs):\n    raise AssertionError('NETWORK_FORBIDDEN')\n` +
    `urllib.request.urlopen = forbidden\nexec(compile(os.environ['TEST_PARSER'], '<workflow>', 'exec'))`;
  const interpreter = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(interpreter, ['-c', harness], {
    encoding: 'utf8', timeout: 10_000, env: {...process.env, PYTHONIOENCODING: 'utf-8', TEST_PARSER: python,
      REQUEST_FAILED: '0', RESPONSE: JSON.stringify(response), SCHEDULE: '7,22,37,52 * * * *',
      DISCORD_WEBHOOK: '', GITHUB_SHA: 'a'.repeat(40)},
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.doesNotMatch(result.stdout, /PRIVATE_|NETWORK_FORBIDDEN/);
  const line = result.stdout.split(/\r?\n/).find(item => item.startsWith('maintenanceHealth '));
  assert.ok(line, result.stdout);
  return JSON.parse(line.slice('maintenanceHealth '.length));
}

test('workflow preserves history reasons even when mushroom counters are zero', () => {
  const health = {severity: 'critical', evaluatedAt: now, cleanupAge: 0, pending: 0,
    historyPending: 123, historyConsecutiveFailures: 0, historyBacklogSinceMs: (now - 86400) * 1000,
    schedulerDelayed: false, cleanupFailing: false, backlogPersistent: false,
    historyFailing: false, historyBacklogPersistent: true,
    githubLastSucceededAt: now, independentLastSucceededAt: now,
    remoteError: 'PRIVATE_ERROR_MUST_NOT_BE_LOGGED'};
  const output = run(health);
  const expected = {...health};
  delete expected.remoteError;
  assert.deepEqual(output, {...expected, responseAtMs: now * 1000, workflowSha: 'a'.repeat(40)});
  assert.equal(Object.hasOwn(output, 'deploymentSha'), false);
});

test('legacy or malformed diagnostics preserve unknowns and never print remote strings', () => {
  const legacy = run(undefined);
  assert.equal(legacy.severity, 'legacy');
  assert.equal(legacy.historyPending, null);
  assert.equal(legacy.historyFailing, null);
  const malformed = run({severity: 'PRIVATE_SEVERITY', historyPending: 'PRIVATE_COUNT',
    historyConsecutiveFailures: true, historyBacklogSinceMs: -1,
    historyBacklogPersistent: 'PRIVATE_REASON', cleanupAge: false});
  assert.equal(malformed.severity, 'unknown');
  for (const key of ['historyPending', 'historyConsecutiveFailures', 'historyBacklogSinceMs',
    'historyBacklogPersistent', 'cleanupAge']) assert.equal(malformed[key], null);
});

function runFailure({body = {}, requestFailed = '1', status = '503', delivery = 'none', exitCode = 1} = {}) {
  // The extracted parser runs against a stub transport only. Never execute curl.
  const harness = `import os, time, urllib.request, urllib.error\ntime.time = lambda: ${now}\n` +
    `def send(*args, **kwargs):\n` +
    `    if os.environ['TEST_DELIVERY'] == 'http':\n` +
    `        raise urllib.error.HTTPError('https://PRIVATE.invalid/TOKEN', 404, 'PRIVATE_ERROR', {}, None)\n` +
    `    if os.environ['TEST_DELIVERY'] == 'request':\n` +
    `        raise RuntimeError('PRIVATE_EXCEPTION https://PRIVATE.invalid')\n` +
    `    raise AssertionError('NETWORK_FORBIDDEN')\n` +
    `urllib.request.urlopen = send\nexec(compile(os.environ['TEST_PARSER'], '<workflow>', 'exec'))`;
  const interpreter = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(interpreter, ['-c', harness], {
    encoding: 'utf8', timeout: 10_000, env: {...process.env, PYTHONIOENCODING: 'utf-8', TEST_PARSER: python,
      REQUEST_FAILED: requestFailed, HTTP_STATUS: status,
      RESPONSE: typeof body === 'string' ? body : JSON.stringify(body),
      SCHEDULE: delivery === 'none' ? '7,22,37,52 * * * *' : '13 * * * *',
      DISCORD_WEBHOOK: delivery === 'none' ? '' : 'https://local.invalid/webhooks/fixture', TEST_DELIVERY: delivery},
  });
  assert.ifError(result.error);
  assert.equal(result.status, exitCode, result.stderr + result.stdout);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_|NETWORK_FORBIDDEN|local\.invalid|webhooks/);
  const diagnostic = label => {
    const line = result.stdout.split(/\r?\n/).find(item => item.startsWith(label + ' '));
    return line ? JSON.parse(line.slice(label.length + 1)) : null;
  };
  return {failure: diagnostic('maintenanceFailure'), fleet: diagnostic('fleetAlertFailure')};
}

test('non-2xx receipt diagnostics survive curl failure without printing the response body', () => {
  const failure = {stage: 'history_receipt', reason: 'stale_receipt', source: 'schedule',
    attemptedAtMs: now * 1000, observedAtMs: now * 1000 + 500, sourceReceiptRecorded: false,
    mushroomLastRunAt: now, mushroomLastSucceededAt: now, mushroomConsecutiveFailures: 0,
    historyLastRunAtMs: now * 1000, historyLastSucceededAtMs: (now - 900) * 1000,
    historyConsecutiveFailures: 0, historyBusy: true};
  const output = runFailure({body: {maintenanceFailure: {...failure, error: 'PRIVATE_EXCEPTION'},
    fleet: [{name: 'PRIVATE_AGENT'}], token: 'PRIVATE_TOKEN'}});
  assert.deepEqual(output.failure, {httpStatus: 503, requestFailed: true, ...failure});
});

test('malformed, legacy and untrusted failure fields stay unknown, and all requests still fail', () => {
  for (const body of ['<html>PRIVATE_RESPONSE</html>', 'null', {}, {maintenanceFailure: {
    stage: 'PRIVATE_STAGE', reason: 'PRIVATE_REASON', source: 'PRIVATE_SOURCE',
    historyConsecutiveFailures: true, historyLastRunAtMs: -1, historyBusy: 'PRIVATE_BUSY',
  }}]) {
    const {failure} = runFailure({body, status: '000'});
    assert.equal(failure.httpStatus, null);
    assert.equal(failure.stage, 'unknown');
    assert.equal(failure.reason, 'unknown');
    assert.equal(failure.source, 'unknown');
    assert.equal(failure.historyConsecutiveFailures, null);
    assert.equal(failure.historyLastRunAtMs, null);
    assert.equal(failure.historyBusy, null);
  }
  const {failure} = runFailure({requestFailed: '0', status: '200', body: {
    retention: {lastSucceededAt: now + 86400}, alerts: {uploadSilentAgents: []}}});
  assert.equal(failure.httpStatus, 200);
  assert.equal(failure.requestFailed, false);
});

test('fleet delivery status remains distinct from maintenance HTTP failure', () => {
  const http = runFailure({delivery: 'http'});
  assert.equal(http.failure.httpStatus, 503);
  assert.deepEqual(http.fleet, {httpStatus: 404, stage: 'http'});
  const transport = runFailure({delivery: 'request'});
  assert.equal(transport.failure.httpStatus, 503);
  assert.deepEqual(transport.fleet, {httpStatus: null, stage: 'request'});
});

test('successful cleanup remains successful when its separate hourly fleet warning gets HTTP 404', () => {
  const output = runFailure({requestFailed: '0', status: '200', delivery: 'http', exitCode: 0,
    body: {now: now * 1000, retention: {lastSucceededAt: now, consecutiveFailures: 0, pending: 0},
      alerts: {uploadSilentAgents: ['fixture-agent']}, maintenanceHealth: {severity: 'healthy'}}});
  assert.equal(output.failure, null);
  assert.deepEqual(output.fleet, {httpStatus: 404, stage: 'http'});
});
