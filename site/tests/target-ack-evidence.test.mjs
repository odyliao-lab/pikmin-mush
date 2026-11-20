import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import {parseTargetAckEvidence,readTargetAckEvidence} from '../lib/target-ack-evidence.mjs';

const now=1794475000000;
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE scan_agent_events(id INTEGER PRIMARY KEY,agent_id TEXT,event_type TEXT,at INTEGER,job_id INTEGER,target_id INTEGER,rows INTEGER,bytes INTEGER,duration_ms INTEGER,detail TEXT)`);
 const insert=sql.prepare('INSERT INTO scan_agent_events VALUES(?,?,?,?,?,?,?,?,?,?)');
 for(const [id,agent,type,at,target,rows] of [[1,'agent-a','target_completed',now-1000,10,2],[2,'agent-b','target_completed',now-500,10,3],[3,'agent-a','target_claimed',now-500,11,0],[4,'agent-a','target_completed',now-8*86400000,12,1],[5,'agent-a','target_completed',now-500,13,0]])
  insert.run(id,agent,type,at,450,target,rows,rows*100,12000,'{"lease":"PRIVATE","lat":12.345678,"token":"SECRET"}');
 let reads=0;
 return {sql,get reads(){return reads},db:{prepare(q){let args=[];return {bind(...a){args=a;return this},async all(){reads++;return {results:sql.prepare(q).all(...args)}}}}}};
}
function api(db,authorized=true){
 const exports={};const code=ts.transpileModule(readFileSync(new URL('../app/api/admin/scans/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const unavailable=()=>{throw Error('evidence query must not materialize rotation or the full fleet')};
 const modules={
  '../../../../lib/cloud':{adminAuthorized:()=>authorized,ensureSchema:unavailable,runtime:()=>({DB:db}),noStoreJson:(body,status=200)=>new Response(JSON.stringify(body),{status})},
  '../../../../lib/scans':{activeOrLatestJob:unavailable,publicJob:unavailable},
  '../../../../lib/fleet':{publicAgent:unavailable},'../../../../lib/rotation':{rotationStatus:unavailable},
  // The helper runs outside the VM, so pass the fixture clock explicitly.
  '../../../../lib/target-ack-evidence.mjs':{
   parseTargetAckEvidence,
   readTargetAckEvidence:(db,query)=>readTargetAckEvidence(db,query,now),
  },
 };
 new Script(code).runInNewContext({exports,require:key=>{assert.ok(modules[key],key);return modules[key]},URL,Promise,Date});return exports;
}
test('evidence query has strict agent/ID bounds and deduplicates numeric IDs',()=>{
 assert.deepEqual(parseTargetAckEvidence(new URLSearchParams('evidence_agent=agent-a&evidence_targets=10,10,13')),{agentId:'agent-a',targetIds:[10,13]});
 for(const value of ['', '0','-1','1.2','1e2','9007199254740992','1,2,3,4,5,6,7,8,9,10,11','1);DELETE FROM scan_agents'])
  assert.throws(()=>parseTargetAckEvidence(new URLSearchParams({evidence_agent:'agent-a',evidence_targets:value})));
 assert.throws(()=>parseTargetAckEvidence(new URLSearchParams({evidence_agent:"agent-a' OR 1=1",evidence_targets:'10'})));
});
test('historical ACKs are agent scoped, bounded in time, and independent of replaced target queues',async()=>{
 const f=fixture();const result=await readTargetAckEvidence(f.db,{agentId:'agent-a',targetIds:[10,11,12,13]},now);
 assert.deepEqual(result.target_acknowledgements.map(x=>x.id),[5,1]);
 assert.equal(result.target_acknowledgements[0].rows,0); // Query truth, not a nonzero success claim.
 assert.equal(result.target_acknowledgements[1].bytes,200);
 for(const row of result.target_acknowledgements)assert.deepEqual(Object.keys(row).sort(),['id','agent_id','event_type','at','job_id','target_id','rows','bytes','duration_ms'].sort());
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SECRET|lease|latitude/);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM scan_agent_events').get().n,5);
});
test('existing admin auth applies before any evidence read; malformed input is rejected',async()=>{
 const f=fixture();const request=new Request('https://mush.odyliao.cc/api/admin/scans?evidence_agent=agent-a&evidence_targets=10');
 assert.equal((await api(f.db,false).GET(request)).status,403);assert.equal(f.reads,0);
 assert.equal((await api(f.db).GET(new Request('https://mush.odyliao.cc/api/admin/scans?evidence_targets=10'))).status,400);assert.equal(f.reads,0);
});
test('admin evidence mode does not invoke rotation/fleet writes or expose database errors',async()=>{
 const f=fixture();const request=new Request('https://mush.odyliao.cc/api/admin/scans?evidence_agent=agent-a&evidence_targets=10');
 const response=await api(f.db).GET(request);assert.equal(response.status,200);assert.equal((await response.json()).target_acknowledgements.length,1);
 const bad=await api({prepare(){throw Error('PRIVATE SQL/token')}}).GET(request);
 assert.equal(bad.status,503);assert.doesNotMatch(await bad.text(),/PRIVATE|SQL|token/);
});

test('opt-in acceptance requires a nonzero ordinary ACK and a same-target retained observation inside its lease',async()=>{
 const f=fixture(), at=now-1000, receive=Math.floor(at/1000)-2;
 f.sql.exec(`CREATE TABLE scan_targets(id INTEGER PRIMARY KEY,job_id INTEGER,verification_kind TEXT,status TEXT,
  completed_agent_id TEXT,leased_at INTEGER,completed_at INTEGER);
  CREATE TABLE scan_target_history(id INTEGER PRIMARY KEY,job_id INTEGER,verification_kind TEXT,status TEXT,
   completed_agent_id TEXT,leased_at INTEGER,completed_at INTEGER);
  CREATE TABLE mushroom_observations(target_id INTEGER,agent_id TEXT,received_at INTEGER,level INTEGER);
  CREATE INDEX mushroom_observations_received_idx ON mushroom_observations(received_at);`);
 const target=f.sql.prepare("INSERT INTO scan_targets VALUES(?,?,?,'completed',?,?,?)");
 const ack=f.sql.prepare("INSERT INTO scan_agent_events VALUES(?,'agent-a','target_completed',?,450,?,1,100,12000,'PRIVATE')");
 const observation=f.sql.prepare('INSERT INTO mushroom_observations VALUES(?,?,?,?)');
 target.run(10,450,'','agent-a',at-9000,at);
 for(const [id,job,kind,agent,lease,end] of [
  [20,450,'','agent-a',at-12000,at],
  [21,450,'return','agent-a',at-12000,at],
  [22,451,'','agent-a',at-12000,at],
  [23,450,'','agent-a',at-16*60000,at],
  [24,450,'','agent-b',at-12000,at],
  [25,450,'','agent-a',at-12000,at+10],
 ]) {
  target.run(id,job,kind,agent,lease,end);
  ack.run(id,at,id);
  observation.run(id,'agent-a',receive,3);
 }
 observation.run(10,'agent-a',receive,2);
 observation.run(10,'agent-b',receive,4);
 observation.run(10,'agent-a',receive-20,4);
 observation.run(10,'agent-a',receive+5,4);
 observation.run(13,'agent-a',receive,4);
 f.sql.exec('INSERT INTO scan_target_history SELECT * FROM scan_targets WHERE id IN(20,24); DELETE FROM scan_targets WHERE id=20;');
 f.sql.exec("UPDATE scan_target_history SET completed_agent_id='agent-a' WHERE id=24;");
 const query={agentId:'agent-a',targetIds:[10,13,20,21,22,23,24,25],includeObservations:true};
 const result=await readTargetAckEvidence(f.db,query,now);
 assert.deepEqual(result.accepted_observations,[{target_id:20,job_id:450,ack_at:at,received_at:receive,level:3}]);
 observation.run(10,'agent-a',receive,4);
 const response=await api(f.db).GET(new Request('https://mush.odyliao.cc/api/admin/scans?evidence_agent=agent-a&evidence_targets=10&evidence_observations=1'));
 assert.equal(response.status,200);
 const positive=await response.json();
 assert.deepEqual(positive.accepted_observations,[{target_id:10,job_id:450,ack_at:at,received_at:receive,level:4}]);
 assert.doesNotMatch(JSON.stringify(positive),/PRIVATE|SECRET|lease|latitude/);
});

test('observation evidence flag is bounded and zero ACKs cause no observation-table query',async()=>{
 const f=fixture();
 const make=value=>new URLSearchParams('evidence_agent=agent-a&evidence_targets=13&evidence_observations='+value);
 for(const value of ['0','','true','1&evidence_observations=1'])assert.throws(()=>parseTargetAckEvidence(make(value)));
 const query=parseTargetAckEvidence(make('1'));
 const result=await readTargetAckEvidence(f.db,query,now);
 assert.deepEqual(result.accepted_observations,[]);
 assert.equal(f.reads,1);
});
