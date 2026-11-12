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
  '../../../../lib/cloud':{adminAuthorized:()=>authorized,ensureSchema:async()=>{},runtime:()=>({DB:db}),noStoreJson:(body,status=200)=>new Response(JSON.stringify(body),{status})},
  '../../../../lib/scans':{activeOrLatestJob:unavailable,publicJob:unavailable},
  '../../../../lib/fleet':{publicAgent:unavailable},'../../../../lib/rotation':{rotationStatus:unavailable},
  '../../../../lib/target-ack-evidence.mjs':{parseTargetAckEvidence,readTargetAckEvidence},
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
