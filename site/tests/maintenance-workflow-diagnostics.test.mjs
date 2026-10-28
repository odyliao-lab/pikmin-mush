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
