import test from 'node:test';
import assert from 'node:assert/strict';
import {runMaintenance} from './index.mjs';

const NOW = 1_800_000_000_000;
const ENDPOINT = 'https://mush.odyliao.cc/api/controller/maintenance';
function environment(webhook = '') {
  const state = new Map();
  return {MAINTENANCE_TOKEN: 'local-fixture-only-'.padEnd(32, 'x'), DISCORD_WEBHOOK: webhook,
    ALERT_STATE: {get: async key => state.get(key), put: async (key, value) => state.set(key, value)}};
}
test('local regression: webhook transport rejection cannot expose the private URL in the thrown error', async () => {
  const env = environment('https://discord.com/api/webhooks/local-fixture/PRIVATE_SENTINEL');
  let endpointCalls = 0, webhookCalls = 0;
  const result = await runMaintenance(env, {now: NOW, fetch: async url => {
    if (url === ENDPOINT) { endpointCalls++; throw Error('offline fixture'); }
    assert.equal(url, env.DISCORD_WEBHOOK); webhookCalls++;
    throw Error(`request failed for ${url}`);
  }}).then(() => null, error => error);
  assert.equal(endpointCalls, 2);
  assert.equal(webhookCalls, 1);
  assert.ok(result instanceof Error);
  assert.doesNotMatch(String(result), /PRIVATE_SENTINEL|discord\.com/);
  assert.equal(result.message, 'Independent maintenance did not receive a valid acknowledgement');
});


test('KV read/write failures and webhook failures preserve the sanitized failure contract', async () => {
  for(const stage of ['read','write','webhook']) {
    const env=environment('https://discord.com/api/webhooks/local-fixture/PRIVATE_SENTINEL');
    let endpointCalls=0,webhookCalls=0,puts=0;
    env.ALERT_STATE.get=async()=>{if(stage==='read')throw Error('PRIVATE_SENTINEL');return null;};
    env.ALERT_STATE.put=async()=>{puts++;if(stage==='write')throw Error('PRIVATE_SENTINEL');};
    const error=await runMaintenance(env,{now:NOW,fetch:async url=>{
      if(url===ENDPOINT){endpointCalls++;throw Error('PRIVATE_SENTINEL');}
      webhookCalls++;
      if(stage==='webhook')throw Error('PRIVATE_SENTINEL');
      return new Response('',{status:200});
    }}).then(()=>null,error=>error);
    assert.equal(error.message,'Independent maintenance did not receive a valid acknowledgement');
    assert.equal(error.cause,undefined);
    assert.doesNotMatch(String(error.stack),/PRIVATE_SENTINEL/);
    assert.equal(endpointCalls,2);
    assert.equal(webhookCalls,stage==='read'?0:1);
    assert.equal(puts,stage==='write'?1:0,'failed delivery cannot set the success throttle');
  }
});

test('a thrown webhook transport error stays retryable on the next scheduled run', async () => {
  const env=environment('https://discord.com/api/webhooks/local-fixture/PRIVATE_SENTINEL');let sends=0;
  const request=async url=>{
    if(url===ENDPOINT)throw Error('offline');
    if(++sends===1)throw Error('PRIVATE_SENTINEL');
    return new Response('',{status:200});
  };
  await assert.rejects(runMaintenance(env,{now:NOW,fetch:request}));
  assert.equal(await env.ALERT_STATE.get('last-failure-alert'),undefined);
  await assert.rejects(runMaintenance(env,{now:NOW+900000,fetch:request}));
  assert.equal(sends,2);
  assert.equal(await env.ALERT_STATE.get('last-failure-alert'),String((NOW+900000)/1000));
});
