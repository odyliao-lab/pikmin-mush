import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';

function load(path, dependencies) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  new Script(code).runInNewContext({exports, TypeError, Request, Response, URL,
    TextEncoder, TextDecoder, crypto: webcrypto, require(name) {
      if (!(name in dependencies)) throw Error(`Unexpected import: ${name}`);
      return dependencies[name];
    }});
  return exports;
}

function fixture({key = 'test-only-key-'.repeat(4), dbError} = {}) {
  const writes = [];
  const cloud = {
    runtime: () => ({COPY_AUDIT_HASH_KEY: key, DB: {prepare(sql) {
      return {bind(...values) {return {
        async run() {if (dbError) throw dbError; writes.push({sql, values});},
        async first() {return {id: 'fixture'};},
      };}};
    }}}),
    ensureSchema: async () => {},
  };
  // Exercise the production origin/body helpers, rather than replacing validation.
  const source = readFileSync(new URL('../lib/cloud.ts', import.meta.url), 'utf8');
  const helpers = source.slice(source.indexOf('export function sameOrigin('), source.indexOf('\nfunction integer('));
  new Script(ts.transpileModule(helpers, {compilerOptions: {module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports: cloud, URL, Response, TextDecoder});
  const audit = load('../lib/copy-audit.ts', {'./cloud': cloud});
  const route = load('../app/api/audit/event/route.ts', {
    '../../../../lib/cloud': cloud, '../../../../lib/copy-audit': audit,
  });
  return {audit, route, writes};
}

function request({broken = false, cf = {asn: 64500, country: 'tw'}, ip = '192.0.2.1',
  payload = {event_type: 'page_view'}, origin = 'https://audit.test'} = {}) {
  const raw = new Request('https://audit.test/api/audit/event', {method: 'POST',
    headers: {'cf-connecting-ip': ip, 'cf-ipcountry': 'jp', 'user-agent': 'iPhone Mobile',
      'x-asn': '12345', origin}, body: typeof payload === 'string' ? payload : JSON.stringify(payload)});
  Object.defineProperty(raw, 'cf', {get() {
    if (this !== raw) throw new TypeError('Illegal invocation');
    return cf;
  }});
  if (!broken) return raw;
  // Reproduce the native receiver brand check through a dispatcher-style proxy.
  return new Proxy(raw, {get(target, prop, receiver) {
    const value = Reflect.get(target, prop, prop === 'cf' ? receiver : target);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
}

for (const broken of [false, true]) {
  test(`usage route and copy audit retain privacy with ${broken ? 'incompatible proxy' : 'native metadata'}`, async () => {
    const f = fixture();
    const req = request({broken});
    if (broken) assert.throws(() => req.cf, /Illegal invocation/);
    assert.equal(req.headers.get('cf-ipcountry'), 'jp');
    const response = await f.route.POST(req);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await f.audit.recordCopyAuditEvent(request({broken}), {
      eventType: 'copy_gps', mushroomId: 'fixture', lat: 1, lng: 2, level: 3, type: 4,
    }), true);
    assert.equal(f.writes.length, 2);
    const usage = f.writes[0].values, copy = f.writes[1].values;
    assert.match(usage[5], /^[a-f0-9]{16}$/);
    assert.equal(copy[8], usage[5]);
    assert.deepEqual(usage.slice(6), [broken ? 'JP' : 'TW', broken ? 0 : 64500, 'mobile']);
    assert.deepEqual(copy.slice(9), usage.slice(6));
    assert.equal(JSON.stringify(f.writes).includes('192.0.2.1'), false);
    assert.equal(JSON.stringify(f.writes).includes('test-only-key-'), false);
    assert.equal(JSON.stringify(f.writes).includes('iPhone'), false);
    assert.match(f.writes[0].sql, /ON CONFLICT\(bucket_minute, event_type, dimension, mushroom_id, source_hash\)/);
    assert.match(f.writes[1].sql, /ON CONFLICT\(bucket_minute, event_type, mushroom_id, source_hash\)/);
  });
}

test('missing optional metadata and invalid ASN retain existing safe defaults', async () => {
  for (const cf of [undefined, {asn: -1, country: ''}, {asn: 'garbage'}]) {
    const f = fixture();
    // null also represents runtimes without CF metadata.
    await f.audit.recordPublicUsageEvent(request({cf: cf ?? null}), {eventType: 'page_view'});
    assert.equal(f.writes[0].values[7], 0);
  }
});

test('unconfigured hashing and invalid IP never produce audit writes', async () => {
  for (const options of [{key: ''}, {key: 'short'}, {}]) {
    const f = fixture(options);
    const result = await f.audit.recordPublicUsageEvent(request({broken: true,
      ip: options.key === undefined ? 'not-an-ip' : '192.0.2.1'}), {eventType: 'page_view'});
    assert.equal(result, false);
    assert.equal(f.writes.length, 0);
  }
});

test('database failures and unrelated metadata errors remain visible', async () => {
  const dbError = Error('database unavailable');
  await assert.rejects(fixture({dbError}).audit.recordPublicUsageEvent(request({broken: true}),
    {eventType: 'page_view'}), error => error === dbError);
  for (const error of [Error('metadata unavailable'), new TypeError('unexpected metadata type')]) {
    const req = new Request('https://audit.test', {headers: {'cf-connecting-ip': '192.0.2.1'}});
    Object.defineProperty(req, 'cf', {get() {throw error;}});
    await assert.rejects(fixture().audit.recordPublicUsageEvent(req, {eventType: 'page_view'}),
      actual => actual === error);
  }
});

test('route still rejects cross-origin, invalid and oversized payloads before audit writes', async () => {
  for (const [options, status] of [
    [{origin: 'https://other.test'}, 403], [{payload: '{'}, 400],
    [{payload: {event_type: 'unknown'}}, 400],
    [{payload: {event_type: 'map_focus'}}, 400],
    [{payload: 'x'.repeat(1501)}, 413],
  ]) {
    const f = fixture();
    assert.equal((await f.route.POST(request({broken: true, ...options}))).status, status);
    assert.equal(f.writes.length, 0);
  }
});
