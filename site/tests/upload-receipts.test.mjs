import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
import { observationStatements } from '../lib/observations.mjs';
import { isUsefulMushroomLevel } from '../lib/mushroom-policy.mjs';

function load(file, deps, globals={}) {
  const exports={};
  new Script(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)
    .runInNewContext({exports,TextEncoder,TextDecoder,Response,crypto:webcrypto,console,
      ...globals,require(p){return deps[p]??{};}});
  return exports;
}
const stream='12345678-1234-1234-1234-123456789abc';
const row='0\tfixture-poi\t1\t2\tcity\t0\t3\t2\t0\t1\t35\t10\t1000\n';

test('mixed-size receipt advances the full immutable range but retains only3/4; retries remain deduplicated',async()=>{
  const f=fixture();
  const body=[1,2,3,4].map(level=>row.replace('fixture-poi',`size-${level}`).replace('\t3\t2\t0\t','\t'+level+'\t2\t0\t')).join('');
  assert.equal(await(await f.send(body)).text(),'accepted=2\n');
  assert.equal(await(await f.send(body)).text(),'accepted=2\n');
  assert.equal(f.count('mushrooms'),2);assert.equal(f.count('mushroom_observations'),2);
  assert.equal(f.sql.prepare('SELECT end_offset FROM agent_upload_receipts').get().end_offset,Buffer.byteLength(body));
  const excluded=row.replace('\t3\t2\t0\t','\t2\t2\t0\t');
  assert.equal(await(await f.send(excluded,Buffer.byteLength(body))).text(),'accepted=0\n');
  assert.equal(f.count('mushrooms'),2);assert.equal(f.count('agent_upload_receipts'),2);
});

test('legacy mixed-size upload accepts transport with excluded rows and drains partial state safely',async()=>{
  const f=fixture({legacy:true});
  const normal=row.replace('\t3\t2\t0\t','\t2\t2\t0\t');
  const body=normal+row;
  assert.equal((await f.sendLegacy(body.slice(0,-2))).status,200);
  assert.equal(f.count('mushrooms'),0);
  assert.equal((await f.sendLegacy(body.slice(-2))).status,200);
  assert.equal(f.count('mushrooms'),1);assert.equal(f.count('mushroom_observations'),1);
  assert.equal(f.sql.prepare('SELECT partial_text FROM scan_agents WHERE id=?').get('fixture').partial_text,'');
  assert.equal((await f.sendLegacy(normal)).status,200);assert.equal(f.count('mushrooms'),1);
});
function fixture({legacy=false}={}) {
  const sql=new DatabaseSync(':memory:'); let fail='',clock=1000000000000,batchCount=0,maxStatements=0;
  for(const file of ['0015_slimy_klaw.sql','0016_superb_random.sql'])
    sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../drizzle/0023_puzzling_cyclops.sql',import.meta.url),'utf8'));
  sql.exec(`CREATE TABLE mushrooms(id TEXT PRIMARY KEY,lat REAL,lng REAL,level INTEGER,type INTEGER,
    cluster TEXT,cooldown INTEGER,finish_ms INTEGER,first_seen INTEGER,discovered_by_agent_id TEXT,
    last_seen INTEGER,challenger_count INTEGER,challenger_capacity INTEGER,total_power REAL,start_ms INTEGER,
    participants_verified_at INTEGER DEFAULT 0,giant_recheck_status TEXT DEFAULT '',giant_rechecked_at INTEGER DEFAULT 0,
    mushroom_status TEXT DEFAULT 'active',invalidated_at INTEGER DEFAULT 0);
    CREATE TABLE scan_agents(id TEXT PRIMARY KEY,partial_text TEXT DEFAULT '',uploaded_rows INTEGER DEFAULT 0,
    uploaded_bytes INTEGER DEFAULT 0,last_data_at INTEGER DEFAULT 0,last_seen INTEGER,updated_at INTEGER,
    agent_version TEXT,game_version TEXT,module_version TEXT);
    INSERT INTO scan_agents(id) VALUES('fixture'),('other'),('primary');
    CREATE TABLE agent_state(id INTEGER,uploaded_rows INTEGER DEFAULT 0,uploaded_bytes INTEGER DEFAULT 0,last_seen INTEGER);
    INSERT INTO agent_state(id) VALUES(1);
    CREATE TABLE scan_agent_events(agent_id TEXT,event_type TEXT,at INTEGER,rows INTEGER,bytes INTEGER,detail TEXT);`);
  const db={prepare(q){return {q,v:[],bind(...v){this.v=v;return this;},
    async first(){return sql.prepare(this.q).get(...this.v);},
    async run(){return {meta:sql.prepare(this.q).run(...this.v)};}};},
    async batch(statements){batchCount++; maxStatements=Math.max(maxStatements,statements.length);
      sql.exec('BEGIN');try{for(const s of statements){
        if(fail && s.q.includes(fail))throw Error('injected batch failure');
        assert.ok(s.v.length<=100,'D1 binding limit');sql.prepare(s.q).run(...s.v);
      }sql.exec('COMMIT');return [];}catch(e){sql.exec('ROLLBACK');throw e;}}};
  class Clock extends Date {static now(){return clock;}}
  const cloud=load('../lib/cloud.ts',{'cloudflare:workers':{env:{DB:db}},
    './observations.mjs':{observationStatements},'./mushroom-policy.mjs':{isUsefulMushroomLevel}}, {Date:Clock});
  const receipts=load('../lib/upload-receipts.ts',{'./cloud':cloud},{Date:Clock});
  const agent={id:'fixture',current_target_id:12}; let authorized=true;
  const route=load('../app/api/agent/upload/route.ts',{
    '../../../../lib/cloud':{...cloud,ensureSchema:async()=>{},scheduleRetentionEmergencyFallback:()=>{}},
    '../../../../lib/upload-receipts':receipts,
    '../../../../lib/fleet':{authorizeFleetAgent:async()=>authorized?agent:null,agentRequestVersions:()=>({version:'2.2.1',gameVersion:'154.0',moduleVersion:'154.0'}),
      touchAgent:async()=>{if(!legacy)throw Error('receipt path must not call late touch');}},
    '../../../../lib/metrics':{recordAgentEvent:async()=>{if(!legacy)throw Error('event must be atomic');}}});
  return {sql,agent,fail(v){fail=v;},advance(){clock+=2000;},unauthorize(){authorized=false;},
    stats(){return {batchCount,maxStatements};},
    async send(body=row,start=0,headers={}){return route.POST(new Request('https://example.invalid/api/agent/upload',
      {method:'POST',body,headers:{'x-upload-protocol':'receipt-v1','x-upload-stream':stream,
        'x-upload-start':String(start),'x-upload-end':String(start+Buffer.byteLength(body)),...headers}}));},
    async sendLegacy(body){return route.POST(new Request('https://example.invalid/api/agent/upload',{method:'POST',body}));},
    count(table){return sql.prepare('SELECT COUNT(*) n FROM '+table).get().n;}};
}
test('response loss replay preserves original observation/time/counters and target',async()=>{
  const f=fixture(); assert.equal(await(await f.send()).text(),'accepted=1\n');
  f.advance(); f.agent.current_target_id=99;
  assert.equal(await(await f.send()).text(),'accepted=1\n');
  assert.equal(f.count('mushroom_observations'),1);assert.equal(f.count('scan_agent_events'),1);
  assert.equal(f.count('agent_upload_receipts'),1);
  assert.equal(f.sql.prepare('SELECT received_at,target_id FROM mushroom_observations').get().received_at,1000000000);
  assert.equal(f.sql.prepare('SELECT target_id FROM mushroom_observations').get().target_id,12);
  assert.equal(f.sql.prepare("SELECT uploaded_rows FROM scan_agents WHERE id='fixture'").get().uploaded_rows,1);
});
test('any late statement failure rolls back data, receipt and counters; retry commits once',async()=>{
  for(const stage of ['UPDATE scan_agents','INSERT INTO scan_agent_events','UPDATE agent_state']){
    const f=fixture();f.agent.id='primary';f.fail(stage);
    await assert.rejects(f.send(),/injected/);
    assert.equal(f.count('mushroom_observations'),0);assert.equal(f.count('mushrooms'),0);
    assert.equal(f.count('agent_upload_receipts'),0);f.fail('');f.advance();
    assert.equal((await f.send()).status,200);assert.equal(f.count('mushroom_observations'),1);
    assert.equal(f.sql.prepare('SELECT uploaded_rows FROM agent_state').get().uploaded_rows,1);
  }
});
test('concurrent duplicate envelopes commit once, changed content and overlaps are rejected',async()=>{
  const f=fixture(); const responses=await Promise.all([f.send(),f.send()]);
  assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal(f.count('mushroom_observations'),1);
  assert.equal((await f.send(row.replace('city','town'))).status,409);
  assert.equal((await f.send(row+row)).status,409);
  assert.equal(f.count('scan_agent_events'),1);
});
test('new non-overlapping observations and separate agents are not collapsed',async()=>{
  const f=fixture();await f.send();f.advance();await f.send(row,Buffer.byteLength(row));
  f.advance();f.agent.id='other';await f.send();
  assert.equal(f.count('mushroom_observations'),3);assert.equal(f.count('agent_upload_receipts'),3);
});
test('protocol limits/auth/legacy partial are fail-closed; max payload is one bounded batch',async()=>{
  const f=fixture();f.unauthorize();assert.equal((await f.send()).status,401);assert.equal(f.stats().batchCount,0);
  const g=fixture();assert.equal((await g.send(row.repeat(101))).status,422);
  assert.equal((await g.send(row,0,{'x-upload-end':'999'})).status,422);
  assert.equal((await g.send(row.slice(0,-1))).status,422);
  g.sql.exec("UPDATE scan_agents SET partial_text='pending' WHERE id='fixture'");
  assert.equal((await g.send()).status,409);
  g.sql.exec("UPDATE scan_agents SET partial_text='' WHERE id='fixture'");
  assert.equal((await g.send(row.repeat(100))).status,200);
  assert.ok(g.stats().maxStatements<=72,'single bounded ingestion batch');
});
