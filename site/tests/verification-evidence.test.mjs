import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import * as reportEvidence from '../lib/report-evidence.mjs';

test('actual controller verification requires matching receipt from completed target and agent',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE scan_targets(id INTEGER,verification_batch TEXT,verification_mushroom_id TEXT,status TEXT,leased_at INTEGER,completed_at INTEGER,completed_agent_id TEXT,verification_kind TEXT,verification_result TEXT);
 CREATE TABLE mushrooms(id TEXT,level INTEGER,type INTEGER,start_ms INTEGER,challenger_count INTEGER,challenger_capacity INTEGER,last_seen INTEGER,finish_ms INTEGER);
 CREATE TABLE mushroom_challenges(key TEXT,location_id TEXT,start_ms INTEGER);
 CREATE TABLE mushroom_observations(target_id INTEGER,agent_id TEXT,challenge_key TEXT,received_at INTEGER,level INTEGER,type INTEGER,challenger_count INTEGER,challenger_capacity INTEGER);
 INSERT INTO scan_targets VALUES(1,'batch-test','poi','completed',100001,110000,'leo','candidate','');
 INSERT INTO mushrooms VALUES('poi',3,2,90000,1,35,109,0);
 INSERT INTO mushroom_challenges VALUES('challenge','poi',90000);`);
 let authorized=true;
 const adapter={prepare(sql){let values=[];return{bind(...v){values=v;return this},async all(){return{results:db.prepare(sql).all(...values)}}}}};
 const exports={};
 new Script(ts.transpileModule(readFileSync(new URL('../app/api/controller/verification/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports,URL,require(p){
  if(p.endsWith('/cloud'))return{controllerAuthorized:()=>authorized,ensureSchema:async()=>{},runtime:()=>({DB:adapter}),noStoreJson:(d,status=200)=>Response.json(d,{status})};
  if(p.endsWith('/scans'))return{};if(p.endsWith('/report-evidence.mjs'))return reportEvidence;throw Error(p);
 }});
 const result=async()=> (await (await exports.GET(new Request('https://test/api/controller/verification?batch=batch-test'))).json()).candidates[0];
 // Old last_seen-only code incorrectly approves this without any target receipt.
 assert.equal((await result()).eligible,false);
 const put=(overrides={})=>{db.exec('DELETE FROM mushroom_observations');const o={target_id:1,agent_id:'leo',challenge_key:'challenge',received_at:109,level:3,type:2,challenger_count:1,challenger_capacity:35,...overrides};db.prepare('INSERT INTO mushroom_observations VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(o));};
 put();assert.equal((await result()).eligible,true);
 for(const bad of [{target_id:2},{agent_id:'aries'},{challenge_key:'old'},{received_at:100},{received_at:111},{level:2},{type:3},{challenger_count:2},{challenger_capacity:40}]){put(bad);assert.equal((await result()).eligible,false,JSON.stringify(bad));}
 put();db.exec("UPDATE mushroom_challenges SET start_ms=80000");assert.equal((await result()).eligible,false);
 db.exec('UPDATE mushroom_challenges SET start_ms=90000; UPDATE mushrooms SET challenger_count=4,challenger_capacity=3');put({challenger_count:4,challenger_capacity:3});assert.equal((await result()).eligible,false);
 db.exec('UPDATE mushrooms SET challenger_count=5,challenger_capacity=35');put({challenger_count:5});assert.equal((await result()).eligible,false);
 db.exec('UPDATE mushrooms SET challenger_count=1,level=2');put({level:2});assert.equal((await result()).eligible,false);
 db.exec('UPDATE mushrooms SET level=3,finish_ms=1');put();assert.equal((await result()).eligible,false);
 db.exec("UPDATE mushrooms SET finish_ms=0; UPDATE scan_targets SET status='failed'");assert.equal((await result()).eligible,false);
 // Pre-publication giant checks use the same exact receipt but require Lv4.
 db.exec("UPDATE scan_targets SET status='completed',verification_kind='candidate-giant'; UPDATE mushrooms SET level=4");
 put({level:4});assert.equal((await result()).eligible,true);
 db.exec('UPDATE mushrooms SET level=3');put();assert.equal((await result()).eligible,false);
 db.exec('UPDATE mushrooms SET level=4,challenger_count=5');put({level:4,challenger_count:5});assert.equal((await result()).eligible,false);
 db.exec('UPDATE mushrooms SET challenger_count=1');put({level:4,agent_id:'aries'});assert.equal((await result()).eligible,false);
 authorized=false;assert.equal((await exports.GET(new Request('https://test/api/controller/verification?batch=batch-test'))).status,401);
 db.close();
});

test('giant candidate POST is explicit, authenticated and distinct from the legacy recheck', async()=>{
 let authorized=true; const exports={};
 new Script(ts.transpileModule(readFileSync(new URL('../app/api/controller/verification/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports,URL,require(p){
  if(p.endsWith('/cloud'))return {controllerAuthorized:()=>authorized,ensureSchema:async()=>{},readBoundedUtf8:async r=>({text:await r.text()}),runtime:()=>({DB:{prepare:()=>({bind(){return this},async first(){return {count:1}}})}}),noStoreJson:(d,status=200)=>Response.json(d,{status})};
  if(p.endsWith('/scans'))return {};if(p.endsWith('/report-evidence.mjs'))return reportEvidence;throw Error(p);
 }});
 const post=(kind,candidates)=>exports.POST(new Request('https://test/api/controller/verification',{method:'POST',body:JSON.stringify({agentId:'leo',batch:'giant-test-batch',kind,candidates})}));
 assert.equal((await post('candidate-giant',[])).status,400);
 assert.equal((await post('giant-recheck',[{id:'poi',lat:25,lng:121}])).status,400);
 assert.equal((await post('unknown',[{id:'poi',lat:25,lng:121}])).status,400);
 assert.equal((await post('candidate-giant',[{id:'poi',lat:25,lng:121}])).status,200);
 authorized=false;assert.equal((await post('candidate-giant',[{id:'poi',lat:25,lng:121}])).status,401);
});
