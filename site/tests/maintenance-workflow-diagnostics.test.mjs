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
      HTTP_STATUS: '200', REQUEST_STARTED_AT: String(now),
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

function runFailure({body = {}, requestFailed = '1', status = '503', delivery = 'none', exitCode = 1,
  receivedAt = now, startedAt = receivedAt} = {}) {
  // The extracted parser runs against a stub transport only. Never execute curl.
  const harness = `import os, time, json, urllib.request, urllib.error\ntime.time = lambda: ${receivedAt}\n` +
    `def send(*args, **kwargs):\n` +
    `    if os.environ['TEST_DELIVERY'] == 'capture':\n` +
    `        print('capturedMessage ' + json.loads(args[0].data)['content'])\n` +
    `        class Reply:\n            status = 204\n            def __enter__(self): return self\n            def __exit__(self, *args): pass\n` +
    `        return Reply()\n` +
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
      REQUEST_STARTED_AT: startedAt === null ? '' : String(startedAt),
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
  const message=result.stdout.split(/\r?\n/).find(item=>item.startsWith('capturedMessage '));
  return {failure: diagnostic('maintenanceFailure'), fleet: diagnostic('fleetAlertFailure'), message:message?.slice('capturedMessage '.length)};
}

test('non-2xx receipt diagnostics survive curl failure without printing the response body', () => {
  const failure = {stage: 'history_receipt', reason: 'stale_receipt', source: 'schedule',
    attemptedAtMs: now * 1000, observedAtMs: now * 1000 + 500, sourceReceiptRecorded: false,
    mushroomLastRunAt: now, mushroomLastSucceededAt: now, mushroomConsecutiveFailures: 0,
    historyLastRunAtMs: now * 1000, historyLastSucceededAtMs: (now - 900) * 1000,
    historyConsecutiveFailures: 0, historyBusy: true};
  const output = runFailure({body: {maintenanceFailure: {...failure, error: 'PRIVATE_EXCEPTION'},
    fleet: [{name: 'PRIVATE_AGENT'}], token: 'PRIVATE_TOKEN'}});
  assert.deepEqual(output.failure, {httpStatus: 503, requestFailed: true, ...failure,
    clientStage: 'request', clientReason: 'transport_failure', requestStartedAt: now,
    observedAt: now, requestDurationSeconds: 0, receiptLastSucceededAt: null, receiptConsecutiveFailures: null});
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

function successBody(lastSucceededAt = now) {
  return {now: now * 1000, retention: {lastSucceededAt, consecutiveFailures: 0},
    alerts: {uploadSilentAgents: []}, maintenanceHealth: {severity: 'healthy'}};
}
function runOkResponse(body, options = {}) {
  return runFailure({body, requestFailed: '0', status: '200', ...options});
}

test('old data gaps remain unknown and confirmed stalls are reported separately',()=>{
  const old=runOkResponse({...successBody(),alerts:{uploadSilentAgents:['old-agent']}},{delivery:'capture',exitCode:0});
  assert.match(old.message,/待送狀態未知/);assert.doesNotMatch(old.message,/持續兩小時未上傳/);
  const current=runOkResponse({...successBody(),alerts:{uploadSilentAgents:['stalled'],uploadPendingUnknownAgents:['old-agent'],uploadDataGapAgents:['old-agent']}},{delivery:'capture',exitCode:0});
  assert.match(current.message,/待送資料持續兩小時未上傳：stalled/);
  assert.match(current.message,/待送狀態未知：old-agent/);
});

test('request-start freshness survives history/health/transport time without retrying cleanup', () => {
  for (const age of [295, 300]) {
    const body = successBody(now - age);
    assert.ok(now + 10 - body.retention.lastSucceededAt > 300,
      'the former receive-time check rejects this otherwise successful response');
    const output = runOkResponse(body, {startedAt: now, receivedAt: now + 10, exitCode: 0});
    assert.equal(output.failure, null);
  }
  // A successful cleanup can be produced during a request lasting more than 60s.
  // Keep the future bound at receipt time, not at request start.
  assert.equal(runOkResponse(successBody(now + 90), {
    startedAt: now, receivedAt: now + 90, exitCode: 0,
  }).failure, null);
});

test('freshness remains strict at request start and future skew remains strict at receipt time', () => {
  const stale = runOkResponse({...successBody(now - 300.001), now: (now - 1000) * 1000}, {
    startedAt: now, receivedAt: now + 10,
  }).failure;
  assert.equal(stale.clientStage, 'mushroom_receipt');
  assert.equal(stale.clientReason, 'stale_receipt');
  assert.equal(stale.receiptLastSucceededAt, now - 300.001);
  assert.equal(stale.requestStartedAt, now);
  assert.equal(stale.observedAt, now + 10);
  assert.equal(stale.requestDurationSeconds, 10);
  for (const [offset, exitCode] of [[60, 0], [60.001, 1]]) {
    const output = runOkResponse(successBody(now + 10 + offset), {
      startedAt: now, receivedAt: now + 10, exitCode,
    });
    assert.equal(output.failure?.clientReason ?? null, exitCode ? 'future_timestamp' : null);
  }
});

test('missing, invalid, reversed or overlong request timing fails closed', () => {
  for (const startedAt of [null, '', 'PRIVATE_TIMESTAMP', 'nan', 'inf', '-inf', 0, -1]) {
    const failure = runOkResponse(successBody(), {startedAt}).failure;
    assert.equal(failure.clientStage, 'request_timing');
    assert.equal(failure.clientReason, 'invalid_timestamp');
  }
  for (const startedAt of [now + 0.001, now - 91.001]) {
    const failure = runOkResponse(successBody(), {startedAt}).failure;
    assert.equal(failure.clientStage, 'request_timing');
    assert.equal(failure.clientReason, 'invalid_duration');
  }
  // The cap is curl's 90s plus only 1s for local process/timestamp overhead.
  assert.equal(runOkResponse(successBody(), {startedAt: now - 91, exitCode: 0}).failure, null);
});

test('HTTP 200 receipt and parse failures are distinguished without exposing remote content', () => {
  const cases = [
    ['<html>PRIVATE_BODY</html>', 'response_json', 'invalid_json'],
    [null, 'response_json', 'invalid_shape'],
    [[], 'response_json', 'invalid_shape'],
    [{}, 'mushroom_receipt', 'invalid_shape'],
    [{retention: 'PRIVATE_RETENTION'}, 'mushroom_receipt', 'invalid_shape'],
    [{retention: {lastSucceededAt: true}}, 'mushroom_receipt', 'invalid_timestamp'],
    [{retention: {lastSucceededAt: 0}}, 'mushroom_receipt', 'invalid_timestamp'],
    [{retention: {lastSucceededAt: 'PRIVATE_TIMESTAMP'}}, 'mushroom_receipt', 'invalid_timestamp'],
    ['{"retention":{"lastSucceededAt":1e9999}}', 'mushroom_receipt', 'invalid_timestamp'],
    [`{"retention":{"lastSucceededAt":${'9'.repeat(400)}}}`, 'mushroom_receipt', 'invalid_timestamp'],
    [{retention: {lastSucceededAt: now}}, 'mushroom_receipt', 'invalid_failure_count'],
    [{retention: {lastSucceededAt: now, consecutiveFailures: 1}}, 'mushroom_receipt', 'recorded_failure'],
    [{...successBody(), alerts: 'PRIVATE_ALERTS'}, 'alerts', 'invalid_shape'],
    [{...successBody(), alerts: {}}, 'alerts', 'invalid_shape'],
    [{...successBody(), alerts: {uploadSilentAgents: 'PRIVATE_AGENTS'}}, 'alerts', 'invalid_shape'],
    [{...successBody(), alerts: {uploadSilentAgents: [{token: 'PRIVATE_TOKEN'}]}}, 'alerts', 'invalid_shape'],
  ];
  for (const [body, stage, reason] of cases) {
    const {failure} = runOkResponse(body);
    assert.equal(failure.httpStatus, 200);
    assert.equal(failure.requestFailed, false);
    assert.equal(failure.clientStage, stage);
    assert.equal(failure.clientReason, reason);
    assert.equal(failure.stage, 'unknown', 'unavailable server diagnostics stay unknown');
  }
  for (const consecutiveFailures of [null, true, -1, 'PRIVATE_FAILURE']) {
    const body = successBody(); body.retention.consecutiveFailures = consecutiveFailures;
    assert.equal(runOkResponse(body).failure.clientReason, 'invalid_failure_count');
  }
  assert.equal(runOkResponse(successBody(), {status: '302'}).failure.clientReason, 'http_status');
});

test('shell captures fractional request start immediately before the unchanged bounded curl call', () => {
  assert.match(workflow, /request_started_at="\$\(date \+%s\.%N\)"\n\s+result="\$\(curl/);
  assert.match(workflow, /curl --fail-with-body --silent --show-error --max-time 90/);
  assert.match(workflow, /REQUEST_STARTED_AT="\$request_started_at" HTTP_STATUS=/);
  assert.doesNotMatch(workflow, /--retry/);
});
