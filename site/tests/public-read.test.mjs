import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemo, createPublicReader, createReadLimiter, createQueryTrace, createResponseMemo, publicCacheKey } from '../lib/public-read.mjs';

const url = query => new Request('https://example.test/api/mushrooms?' + query);
function harness() {
  let now = 1000, loads = 0;
  const values = new Map(), logs = [];
  const cache = { match: async key => values.get(key.url)?.clone(), put: async (key, res) => values.set(key.url, res.clone()) };
  const read = createPublicReader({ now: () => now, cache: () => cache,
    trace: () => createQueryTrace({ now: () => now, sample: () => 0, log: record => logs.push(record) }) });
  const load = async trace => {
    loads++;
    await trace.query('mushrooms', async () => ({ meta: { rows_read: 101, rows_written: 0 } }));
    return Response.json({ mushrooms: [{ id: 'test-' + loads }] }, { headers: { 'Cache-Control': 'no-store' } });
  };
  return { read, load, logs, values, advance: ms => { now += ms; }, get loads() { return loads; } };
}

test('opt-in public cache canonicalizes order/cache-busters and expires after 15 seconds', async () => {
  const h = harness();
  const first = await h.read(url('cache=brief&levels=4,3&limit=1&_=one'), h.load);
  assert.equal(first.headers.get('X-Map-Cache'), 'MISS');
  const second = await h.read(url('limit=1&levels=3,4&cache=brief&_=two'), h.load);
  assert.equal(second.headers.get('X-Map-Cache'), 'HIT');
  assert.equal(second.headers.get('X-Map-Cache-Backend'), 'named');
  assert.deepEqual(await first.json(), await second.json());
  assert.equal(h.loads, 1);
  h.advance(15001);
  assert.equal((await h.read(url('levels=3,4&cache=brief&limit=1'), h.load)).headers.get('X-Map-Cache'), 'MISS');
  assert.equal(h.loads, 2);
  assert.equal(h.logs[0].queries[0].rows_read, 101);
  assert.deepEqual(h.logs[1].queries, []);
});

test('production default opens a named cache without accessing disabled caches.default', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const values = new Map(), names = [];
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: {
    get default() { throw Error('disabled in isolated namespace'); },
    async open(name) { names.push(name); return {
      match: async key => values.get(key.url)?.clone(),
      put: async (key, response) => values.set(key.url, response.clone()),
    }; },
  } });
  try {
    const read = createPublicReader({ trace: () => createQueryTrace({ log: () => {} }) });
    await read(url('cache=brief'), async () => Response.json({ ok: true }));
    const cached = await read(url('cache=brief'), async () => { throw Error('cache should hit'); });
    assert.equal(cached.headers.get('X-Map-Cache'), 'HIT');
    assert.equal(cached.headers.get('X-Map-Cache-Backend'), 'named');
    assert.deepEqual(names, ['pikmin-public-map-v2-redacted', 'pikmin-public-map-v2-redacted']);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'caches', previous);
    else delete globalThis.caches;
  }
});

test('cache isolates filters, cursors, bounds, metadata and host; never caches errors or cookies', async () => {
  const original = publicCacheKey(url('cache=brief&limit=1')).url;
  for (const query of ['levels=3','types=event','q=city','cursor=next','bbox=1,2,3,4','under_five=1',
    'discovered_from=1&discovered_to=2','discovered_within_hours=6','include_meta=0','sort=level','prioritize_low=1']) {
    assert.notEqual(publicCacheKey(url('cache=brief&limit=1&'+query)).url, original);
  }
  assert.notEqual(publicCacheKey(new Request('https://other.test/api/mushrooms?limit=1')).url, original);
  const h = harness();
  await h.read(url('cache=brief'), async () => Response.json({ error: 'bad' }, { status: 400 }));
  await h.read(url('cache=brief'), async () => Response.json({}, { headers: { 'Set-Cookie': 'test=yes' } }));
  assert.equal(h.values.size, 0);
  assert.equal((await h.read(url('cache=brief&limit=1&limit=2'), h.load)).status, 400);
  assert.equal(h.loads, 0);
});

test('notifier defaults and authenticated/control/upload requests bypass public cache', async () => {
  const h = harness();
  for (const req of [url('limit=1'), url('limit=1'),
    new Request('https://example.test/api/mushrooms?cache=brief', { headers: { Authorization: 'Bearer fake-test' } }),
    new Request('https://example.test/api/mushrooms?cache=brief', { headers: { 'Cache-Control': 'no-cache' } }),
    new Request('https://example.test/api/agent/upload?cache=brief', { method: 'POST' }),
    new Request('https://example.test/api/admin/metrics?cache=brief')]) {
    assert.equal((await h.read(req, h.load)).status, 200);
  }
  assert.equal(h.values.size, 0); assert.equal(h.loads, 6);
});

test('cache outage still serves data; origin failure is non-cacheable and redacted', async () => {
  const read = createPublicReader({ cache: () => ({ match: async()=>{throw Error('cache')},put:async()=>{throw Error('cache')} }),
    trace: () => createQueryTrace({log:()=>{}}) });
  assert.equal((await read(url('cache=brief'), async()=>Response.json({ok:true}))).status, 200);
  const cached = await read(url('cache=brief'), async()=>{throw Error('must use fallback')});
  assert.equal(cached.status,200);assert.equal(cached.headers.get('X-Map-Cache-Backend'),'isolate');
  const error = await read(url('cache=brief&limit=1'), async()=>{throw Error('private SQL GPS')});
  assert.equal(error.status, 503); assert.equal(error.headers.get('Cache-Control'), 'no-store');
  assert.doesNotMatch(await error.text(), /private|GPS|SQL/);
});

test('unavailable named cache falls back without weakening cache exclusions', async()=>{
 let now=1000,loads=0;
 const read=createPublicReader({now:()=>now,cache:async()=>{throw Error('unavailable')},trace:()=>createQueryTrace({log:()=>{}})});
 const load=async()=>Response.json({number:++loads});
 await read(url('cache=brief'),load);
 assert.equal((await read(url('cache=brief'),load)).headers.get('X-Map-Cache'),'HIT');
 await read(url('limit=1'),load);assert.equal(loads,2); // fresh notifier read
 now+=15001;assert.equal((await read(url('cache=brief'),load)).headers.get('X-Map-Cache'),'MISS');
 assert.equal(loads,3);
});

test('response fallback is bounded by size/count and never extends expiration on reads',async()=>{
 let now=1000;
 const memo=createResponseMemo({now:()=>now,maxEntries:2,maxBytes:2000});
 const response=body=>new Response(body,{headers:{'X-Map-Cache-Until':'16000'}});
 await memo.put(url('a'),response('first'));await memo.put(url('b'),response('second'));
 assert.equal(await (await memo.match(url('a'))).text(),'first');
 await memo.put(url('c'),response('third'));assert.equal(await memo.match(url('b')),null);
 await memo.put(url('large'),response('x'.repeat(2000)));assert.equal(await memo.match(url('large')),null);
 now=16000;assert.equal(await memo.match(url('a')),null);assert.equal(await memo.match(url('c')),null);
});

test('rate limiting returns Retry-After without poisoning other clients or cache', async () => {
  let now=0;
  const limiter=createReadLimiter({now:()=>now,burst:2,perSecond:1});
  const req=ip=>new Request('https://example.test/api/mushrooms', {headers:{'CF-Connecting-IP':ip}});
  const read=createPublicReader({now:()=>now,limit:limiter});
  assert.equal((await read(req('192.0.2.1'),async()=>Response.json({}))).status,200);
  assert.equal((await read(req('192.0.2.1'),async()=>Response.json({}))).status,200);
  const blocked=await read(req('192.0.2.1'),async()=>{throw Error('must not run')});
  assert.equal(blocked.status,429);assert.equal(blocked.headers.get('Retry-After'),'1');
  assert.equal(blocked.headers.get('Cache-Control'),'no-store');
  assert.equal((await read(req('192.0.2.2'),async()=>Response.json({}))).status,200);
  now+=1001;assert.equal(limiter(req('192.0.2.1')),0);
});

test('metadata memo coalesces concurrent loads, expires and retries failures', async () => {
  let now=0,loads=0;
  const memo=createMemo({now:()=>now,ttlMs:15,maxEntries:2});
  const load=async()=>++loads;
  assert.deepEqual(await Promise.all([memo('a',load),memo('a',load)]),[1,1]);
  now=16;assert.equal(await memo('a',load),2);
  await assert.rejects(memo('b',async()=>{throw Error('transient')}));
  assert.equal(await memo('b',load),3);
  await memo('c',load);assert.equal(await memo('a',load),5);
});
