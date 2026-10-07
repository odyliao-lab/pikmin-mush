import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { acquirePublicRead } from '../lib/public-read-guard.mjs';
import { createPublicReader } from '../lib/public-read.mjs';

const secret='fixture-key-only-'.repeat(3);
const request=(bbox='',ip='192.0.2.1')=>new Request('https://fixture.test/api/mushrooms'+
  (bbox?'?bbox='+bbox:''),{headers:{'CF-Connecting-IP':ip}});
test('real D1 guards separate instances, rates, concurrency, spatial changes and expiring leases',async()=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',
  compatibilityDate:'2026-06-01',d1Databases:{DB:'fixture-public-guard'}});
 try {
  const db=await mf.getD1Database('DB');
  await db.prepare(`CREATE TABLE public_read_budgets(source TEXT PRIMARY KEY,window INTEGER,
   requests INTEGER,spatial INTEGER,last_bbox TEXT,leases TEXT,updated_at INTEGER)`).run();
  const now=600000;
  const reservations=await Promise.all(Array.from({length:9},()=>acquirePublicRead(db,request(),secret,now)));
  assert.equal(reservations.filter(x=>x.allowed).length,4);
  for(const r of reservations.filter(x=>x.allowed))await r.release();
  for(let i=4;i<60;i++){const r=await acquirePublicRead(db,request(),secret,now);assert.equal(r.allowed,true);await r.release();}
  assert.equal((await acquirePublicRead(db,request(),secret,now)).allowed,false);
  const next=await acquirePublicRead(db,request(),secret,now+60000);assert.equal(next.allowed,true);await next.release();
  for(let i=0;i<12;i++){const r=await acquirePublicRead(db,request(`${i},0,${i+1},1`,'192.0.2.2'),secret,now);assert.equal(r.allowed,true);await r.release();}
  assert.equal((await acquirePublicRead(db,request('20,0,21,1','192.0.2.2'),secret,now)).allowed,false);
  const same=await acquirePublicRead(db,request('11,0,12,1','192.0.2.2'),secret,now);assert.equal(same.allowed,true);await same.release();
  await Promise.all(Array.from({length:4},()=>acquirePublicRead(db,request(),'expired-key-'+secret,now)));
  assert.equal((await acquirePublicRead(db,request(),'expired-key-'+secret,now+61000)).allowed,true);
  await assert.rejects(acquirePublicRead(db,request(),'short',now));
  const stored=await db.prepare('SELECT source,last_bbox,leases FROM public_read_budgets').all();
  assert.ok(stored.results.every(r=>!r.source.includes('192.0.2')&&!r.last_bbox.includes(',')));
 }finally{await mf.dispose();}
});
test('denied or unavailable admission never loads mushrooms; arbitrary Authorization is not trusted',async()=>{
 let loads=0,releases=0;
 const read=createPublicReader({limit:()=>0,admit:async()=>({allowed:false,retryAfter:60})});
 const response=await read(request(),async()=>{loads++;return Response.json({})});
 assert.equal(response.status,429);assert.equal(loads,0);
 assert.equal(response.headers.get('Retry-After'),'60');
 const unavailable=createPublicReader({admit:async()=>{throw Error('private DB details')}});
 assert.equal((await unavailable(request(),async()=>{loads++})).status,503);assert.equal(loads,0);
 const release=createPublicReader({admit:async()=>({allowed:true,release:async()=>{releases++}})});
 assert.equal((await release(request(),async()=>{throw Error('query failed')})).status,503);
 assert.equal(releases,1);
 const trusted=createPublicReader({trusted:r=>r.headers.get('Authorization')==='Bearer fixture',
   limit:()=>1,admit:async()=>{throw Error('trusted must not use budget')}});
 assert.equal((await trusted(new Request('https://fixture.test/api/mushrooms',{headers:{Authorization:'Bearer fixture'}}),async()=>Response.json({}))).status,200);
 assert.equal((await trusted(new Request('https://fixture.test/api/mushrooms',{headers:{Authorization:'Bearer fake'}}),async()=>{loads++})).status,429);
});

test('cache hits spend no shared budget and successful origin reads release their leases',async()=>{
 let admitted=0,released=0,loaded=0;
 const read=createPublicReader({cache:()=>null,limit:()=>0,
   admit:async()=>{admitted++;return {allowed:true,release:async()=>{released++}}}});
 const req=new Request('https://fixture.test/api/mushrooms?cache=brief&limit=1');
 const load=async()=>{loaded++;return Response.json({mushrooms:[]})};
 assert.equal((await read(req,load)).headers.get('X-Map-Cache'),'MISS');
 assert.equal((await read(req,load)).headers.get('X-Map-Cache'),'HIT');
 assert.deepEqual([admitted,released,loaded],[1,1,1]);
});
