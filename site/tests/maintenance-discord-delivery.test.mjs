import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const workflow = readFileSync(new URL('../../.github/workflows/mushroom-maintenance.yml', import.meta.url), 'utf8');
const python = workflow.split("python3 - <<'PY'")[1].split(/\r?\n          PY/)[0]
  .split(/\r?\n/).map(line => line.replace(/^ {10}/, '')).join('\n');
const now = 1_800_000_000;
function run({status = 403, body = '{"code":50013,"message":"PRIVATE_BODY"}',
  media = 'application/json; charset=utf-8', mode = 'http', schedule = '13 * * * *',
  cleanupFailed = false, notify = true} = {}) {
  const harness = `import os, io, json, socket, time, urllib.request, urllib.error
 time.time = lambda: ${now}
 def forbidden(*args, **kwargs):
     raise AssertionError('NETWORK_FORBIDDEN')
 socket.create_connection = forbidden
 urllib.request.urlopen = forbidden
 class Body(io.BytesIO):
     def read(self, size=-1):
         assert size == 4097, 'READ_NOT_BOUNDED'
         print('boundedRead')
         return super().read(size)
 class Reply:
     status = int(os.environ['TEST_STATUS'])
     def __enter__(self): return self
     def __exit__(self, *args): pass
 def send(request, timeout):
     assert timeout == 20
     assert request.get_header('User-agent') == 'DiscordBot (https://mush.odyliao.cc, 1.0)'
     assert request.get_header('Content-type') == 'application/json'
     assert request.method == 'POST'
     assert json.loads(request.data)['allowed_mentions'] == {'parse': []}
     print('sent')
     if os.environ['TEST_MODE'] == 'success': return Reply()
     if os.environ['TEST_MODE'] == 'transport': raise RuntimeError('PRIVATE_EXCEPTION')
     raise urllib.error.HTTPError('https://PRIVATE.invalid/TOKEN', int(os.environ['TEST_STATUS']),
         'PRIVATE_ERROR', {'Content-Type': os.environ['TEST_MEDIA'], 'Secret': 'PRIVATE_HEADER'},
         Body(os.environ['TEST_BODY'].encode()))
 def opener(handler):
     for code in (301, 302, 303, 307, 308):
         assert handler.redirect_request(None, None, code, 'PRIVATE_REASON', {}, 'https://PRIVATE.invalid/TOKEN') is None
     return type('Opener', (), {'open': staticmethod(send)})()
 urllib.request.build_opener = opener
 exec(compile(os.environ['TEST_PARSER'], '<workflow>', 'exec'))
`.split('\n').map(line => line.replace(/^ /, '')).join('\n');
  const response = {retention: {lastSucceededAt: now, consecutiveFailures: 0},
    alerts: {uploadSilentAgents: notify ? ['fixture'] : []}};
  const result = spawnSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-c', harness], {
    encoding: 'utf8', timeout: 10_000, env: {...process.env, PYTHONIOENCODING: 'utf-8',
      TEST_PARSER: python, TEST_BODY: body, TEST_MEDIA: media, TEST_STATUS: String(status), TEST_MODE: mode,
      REQUEST_FAILED: cleanupFailed ? '1' : '0', HTTP_STATUS: cleanupFailed ? '503' : '200',
      REQUEST_STARTED_AT: String(now), RESPONSE: JSON.stringify(response), SCHEDULE: schedule,
      DISCORD_WEBHOOK: 'https://PRIVATE.invalid/TOKEN'},
  });
  assert.ifError(result.error);
  assert.equal(result.status, cleanupFailed ? 1 : 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_|NETWORK_FORBIDDEN|READ_NOT_BOUNDED/);
  const parse = label => {
    const line = result.stdout.split(/\r?\n/).find(line => line.startsWith(label + ' '));
    return line ? JSON.parse(line.slice(label.length + 1)) : null;
  };
  return {failure: parse('fleetAlertFailure'), success: parse('fleetAlertSuccess'), stdout: result.stdout};
}

test('Discord 403 diagnostics classify bounded JSON code without body, headers or credentials', () => {
  const output = run();
  assert.deepEqual(output.failure, {httpStatus: 403, stage: 'http', contentType: 'json', discordCode: 50013});
  assert.match(output.stdout, /boundedRead/);
  assert.equal(output.success, null);
});

test('untrusted Discord bodies and content types never escape the diagnostic allowlist', () => {
  for (const body of ['PRIVATE_INVALID', '[]', 'null', '{"code":true}', '{"code":-1}',
    '{"code":1.5}', '{"code":1000000001}', '{"code":"PRIVATE_CODE"}',
    '{"code":50013,"message":"' + 'PRIVATE_BODY'.repeat(500) + '"}']) {
    assert.equal(run({body}).failure.discordCode, null);
  }
  for (const [media, expected] of [['text/html', 'html'], ['text/plain', 'text'],
    ['PRIVATE_MEDIA', 'other'], ['', 'unknown']]) {
    const output = run({media, body: 'PRIVATE_BODY'});
    assert.equal(output.failure.contentType, expected);
    assert.equal(output.failure.discordCode, null);
    assert.doesNotMatch(output.stdout, /boundedRead/);
  }
});

test('Discord 200/204 success receipt never changes cleanup failure or reads response content', () => {
  for (const status of [200, 204]) for (const cleanupFailed of [false, true]) {
    const output = run({status, mode: 'success', cleanupFailed});
    assert.deepEqual(output.success, {httpStatus: status, stage: 'http'});
    assert.equal(output.failure, null);
    assert.doesNotMatch(output.stdout, /boundedRead/);
  }
});

test('redirects, rate limits and transport errors remain separate from cleanup outcome', () => {
  for (const status of [302, 307, 308, 429, 500]) {
    assert.equal(run({status}).failure.httpStatus, status);
  }
  assert.deepEqual(run({mode: 'transport'}).failure,
    {httpStatus: null, stage: 'request', contentType: 'unknown', discordCode: null});
});

test('fallback/manual runs and healthy hourly runs do not gain notification sends', () => {
  for (const options of [{schedule: '7,22,37,52 * * * *'}, {schedule: ''}, {notify: false}]) {
    const output = run(options);
    assert.equal(output.success, null);
    assert.equal(output.failure, null);
    assert.doesNotMatch(output.stdout, /sent|boundedRead/);
  }
});
