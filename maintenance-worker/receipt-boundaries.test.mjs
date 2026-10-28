import test from 'node:test';
import assert from 'node:assert/strict';
import {runMaintenance} from './index.mjs';

const NOW = 1_800_000_000_000;
const ENDPOINT = 'https://mush.odyliao.cc/api/controller/maintenance';

test('a successful catch-up response after 26 seconds is accepted without a retry or alert', async t => {
  // Model elapsed network time without waiting in the test. A deadline shorter
  // than the observed production request has expired when the receipt arrives.
  t.mock.method(AbortSignal, 'timeout', ms => {
    const controller = new AbortController();
    if (ms <= 26_000) controller.abort();
    return controller.signal;
  });
  let calls = 0;
  await runMaintenance(environment(), {now: NOW, fetch: async (url, options) => {
    assert.equal(url, ENDPOINT);
    calls++;
    options.signal.throwIfAborted();
    return Response.json(receipt());
  }});
  assert.equal(calls, 1);
});
function environment(webhook = '') {
  const state = new Map();
  return {MAINTENANCE_TOKEN: 'local-fixture-only-'.padEnd(32, 'x'), DISCORD_WEBHOOK: webhook,
    ALERT_STATE: {get: async key => state.get(key), put: async (key, value) => state.set(key, value)}};
}
function receipt(independent = NOW / 1000) {
  return {retention: {lastSucceededAt: NOW / 1000, pending: 0},
    maintenanceHealth: {independentLastSucceededAt: independent, severity: 'healthy'}};
}

test('local regression: a future independent-source receipt cannot acknowledge scheduled maintenance', async () => {
  let calls = 0;
  await assert.rejects(runMaintenance(environment(), {now: NOW, fetch: async url => {
    assert.equal(url, ENDPOINT); calls++;
    return Response.json(receipt(NOW / 1000 + 86_400));
  }}), /Independent maintenance did not receive a valid acknowledgement/);
  assert.equal(calls, 2);
});

test('local regression: malformed acknowledgement retries once and valid boundary receipt stops without alert', async () => {
  const env = environment('https://discord.com/api/webhooks/local-fixture/unused');
  let calls = 0;
  await runMaintenance(env, {now: NOW, fetch: async (url, options) => {
    assert.equal(url, ENDPOINT, 'no webhook request after a recovered retry');
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    calls++;
    if (calls === 1) return new Response('{not-json', {status: 200});
    const valid = receipt(NOW / 1000 - 300);
    valid.retention.lastSucceededAt = NOW / 1000 - 300;
    return Response.json(valid);
  }});
  assert.equal(calls, 2);
  assert.equal(await env.ALERT_STATE.get('last-failure-alert'), undefined);
});

test('independent receipt uses the same finite timestamp and skew boundaries as cleanup', async () => {
  for(const offset of [-300,0,60]) {
    let calls=0;
    await runMaintenance(environment(),{now:NOW,fetch:async()=>{calls++;return Response.json(receipt(NOW/1000+offset));}});
    assert.equal(calls,1);
  }
  for(const value of [NOW/1000-301,NOW/1000+61,null,undefined,String(NOW/1000),NaN,Infinity]) {
    let calls=0;
    await assert.rejects(runMaintenance(environment(),{now:NOW,fetch:async()=>{
      calls++;const data=receipt();data.maintenanceHealth.independentLastSucceededAt=value;return Response.json(data);
    }}),/Independent maintenance did not receive a valid acknowledgement/);
    assert.equal(calls,2);
  }
});
