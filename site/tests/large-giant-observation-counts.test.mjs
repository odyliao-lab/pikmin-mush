import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';

test('soak accepted rows and locations exclude small/normal/unknown and respect both receipt bounds',async()=>{
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE mushroom_challenges(key TEXT,location_id TEXT,first_recorded_at INTEGER);
 CREATE TABLE mushroom_observations(agent_id TEXT,challenge_key TEXT,received_at INTEGER,level INTEGER);
 INSERT INTO mushroom_challenges VALUES('one','p1',1794500000),('two','p2',1794500000);`);
 const now=1794503600000,start=Math.ceil((now-3600000)/1000);
 for(const [key,at,level] of [['one',start,3],['one',start+1,3],['two',now/1000,4],
  ['one',start-1,3],['two',now/1000+1,4],['one',start,1],['one',start,2],['one',start,null]])
  sql.prepare('INSERT INTO mushroom_observations VALUES(?,?,?,?)').run('a',key,at,level);
 const db={prepare(query){let args=[];return {bind(...values){args=values;return this;},async all(){
  if(query.includes('accepted_observation_rows'))return {results:sql.prepare(query).all(...args)};
  if(query.includes('SELECT * FROM scan_agents'))return {results:[{id:'a',display_name:'A',enabled:1,paused:0,last_seen:now,last_target_at:now,agent_version:'2.2.17',game_version:'157.0',module_version:'157.0'}]};
  return {results:[]};},async first(){return null;}};}};
 const exports={};class Clock extends Date{static now(){return now;}}
 new Script(ts.transpileModule(readFileSync(new URL('../lib/metrics.ts',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText).runInNewContext({exports,Date:Clock,require:()=>({runtime:()=>({DB:db})})});
 const report=await exports.buildSoakReport(1),obs=report.agents[0].observations;
 assert.equal(obs.accepted_observation_rows,3);assert.equal(obs.accepted_locations,2);
 assert.equal(obs.observed_challenges,2);sql.close();
});
