import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { createApi } from './helpers/mushroom-api.mjs';
import { setPassword, unlock } from '../lib/gps-access.mjs';

test('granted visitor route preserves framework request, real admission and cache isolation', async () => {
  // Simulate Workers' strict Request branding. The original route tried to
  // reconstruct the proxy; the corrected route must pass it through untouched.
  let clones = 0;
  class StrictRequest extends Request {
    constructor(input, init) {
      if (typeof input !== 'string') { clones++; throw new TypeError('Invalid URL: [object Request]'); }
      super(input, init);
    }
  }
  const api = createApi({size:25,realAccess:true,realGuard:true,requestConstructor:StrictRequest});
  try {
    await setPassword(api.env,'test-password');
    const unlocked = await unlock(new Request('https://example.test/api/gps/unlock'),api.env,'test-password');
    assert.equal(unlocked.status,200);
    const cookie = unlocked.headers.get('Set-Cookie').split(';')[0];
    const query = 'limit=3&cache=brief';
    const headers = {'CF-Connecting-IP':'192.0.2.10'};
    const anonymous = await api.get(query,headers);
    assert.equal(anonymous.status,200);
    assert.equal((await anonymous.json()).mushrooms[0].lat,null);
    for (let i=0;i<3;i++) {
      const original = new Request('https://example.test/api/mushrooms?'+query,{headers:{...headers,cookie}});
      const proxy = new Proxy(original,{get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
      const response = await api.GET(proxy);
      assert.equal(response.status,200);
      assert.equal(response.headers.get('X-Map-Cache'),'BYPASS');
      assert.match(response.headers.get('Cache-Control'),/private, no-store/);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
      const data = await response.json();
      assert.equal(data.gps_access.owner,false);
      assert.equal(data.gps_access.authorized,true);
      assert.notEqual(data.mushrooms[0].lat,null);
    }
    assert.equal(clones,0);
    const budget = api.db.prepare('SELECT requests,leases FROM public_read_budgets').get();
    assert.equal(budget.requests,4);
    assert.equal(budget.leases,'{}');
    const again = await api.get(query,headers);
    assert.equal(again.headers.get('X-Map-Cache'),'HIT');
    assert.equal((await again.json()).mushrooms[0].lat,null);
    // Exact reads still enforce shared budgets; no bypass of abuse admission.
    api.db.exec('UPDATE public_read_budgets SET requests=60');
    assert.equal((await api.get(query,{...headers,cookie})).status,429);
    const controller = await api.get(query,{Authorization:'Bearer fixture-controller'});
    assert.equal(controller.status,200);
    assert.notEqual((await controller.json()).mushrooms[0].lat,null);
    await setPassword(api.env,'rotated-password');
    const revoked = await api.get(query,{...headers,cookie});
    assert.equal((await revoked.json()).mushrooms[0].lat,null);
  } finally { api.db.close(); }
});

test('real Workers Request proxy reproduces old clone failure; cache bypass keeps D1 guard', async () => {
  const script = `import {createPublicReader} from './public-read.mjs';
    import {acquirePublicRead} from './public-read-guard.mjs';
    const secret='fixture-key-only-'.repeat(3);
    export default {async fetch(request,env){
      const proxy=new Proxy(request,{get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
      let oldFailure=false;try{new Request(proxy,{headers:new Headers(proxy.headers)});}catch{oldFailure=true;}
      let cacheCalls=0;
      const read=createPublicReader({cache:()=>{cacheCalls++;throw Error('private reads must not touch shared cache');},
        trace:()=>({finish(){}}),admit:r=>acquirePublicRead(env.DB,r,secret)});
      const response=await read(proxy,async()=>Response.json({fixture:true},{headers:{'Cache-Control':'private, no-store'}}),{bypassCache:true});
      const budgets=await env.DB.prepare('SELECT requests,leases FROM public_read_budgets').all();
      return Response.json({oldFailure,status:response.status,cache:response.headers.get('X-Map-Cache'),policy:response.headers.get('Cache-Control'),cacheCalls,budgets:budgets.results});
    }};`;
  const mf = new Miniflare({modules:[
    {type:'ESModule',path:'worker.mjs',contents:script},
    ...['public-read.mjs','public-read-guard.mjs'].map(name=>({type:'ESModule',path:name,contents:readFileSync(new URL('../lib/'+name,import.meta.url),'utf8')})),
  ],compatibilityDate:'2026-06-01',d1Databases:{DB:'gps-visitor-regression'}});
  try {
    const db=await mf.getD1Database('DB');
    await db.prepare('CREATE TABLE public_read_budgets(source TEXT PRIMARY KEY,window INTEGER,requests INTEGER,spatial INTEGER,last_bbox TEXT,leases TEXT,updated_at INTEGER)').run();
    const run=async()=>await (await mf.dispatchFetch('https://fixture.test/api/mushrooms?cache=brief',{headers:{'CF-Connecting-IP':'192.0.2.20'}})).json();
    const first=await run();
    assert.equal(first.oldFailure,true);
    assert.equal(first.status,200);
    assert.equal(first.cache,'BYPASS');
    assert.match(first.policy,/private, no-store/);
    assert.equal(first.cacheCalls,0);
    assert.deepEqual(first.budgets,[{requests:1,leases:'{}'}]);
    assert.deepEqual((await run()).budgets,[{requests:2,leases:'{}'}]);
    await db.prepare('UPDATE public_read_budgets SET requests=60').run();
    assert.equal((await run()).status,429);
  } finally { await mf.dispose(); }
});
