import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import {qualifiedForSlot} from '../lib/fleet-policy.mjs';

test('worker discovery is authenticated, read-only, excludes protection and incompatible route, exposes safe fields',async()=>{
 const source=readFileSync(new URL('../app/api/controller/verification-workers/route.ts',import.meta.url),'utf8');
 let authorized=false,queries=0;const exports={};
 const base={id:'leo',display_name:'Leo',current_job_id:1,last_data_at:99999,capabilities_json:'{}',mockHealth:'healthy',power_hold:0};
 const agents=[base,{...base,id:'paused',mockHealth:'paused'},{...base,id:'hold',power_hold:1},
  {...base,id:'wrong-slot',capabilities_json:'{"rotation_slots":["emea"]}'},
  {...base,id:'wrong-job',current_job_id:2},{...base,id:'stale-data',last_data_at:-999999},
  {...base,id:'bad-version',mockHealth:'version_mismatch'}];
 const db={prepare(sql){queries++;return {bind(){return this;},async all(){return {results:sql.includes('FROM scan_agents')?agents:[]};}};}};
 new Script(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText).runInNewContext({
  exports,Request,Response,Date:class extends Date{static now(){return 100000;}},require:name=>{
   if(name.endsWith('/cloud'))return {controllerAuthorized:()=>authorized,ensureSchema:async()=>{},runtime:()=>({DB:db}),noStoreJson:(v,s=200)=>Response.json(v,{status:s})};
   if(name.endsWith('/scans'))return {activeJob:async()=>({id:1})};
   if(name.endsWith('/metrics'))return {agentHealth:r=>({status:r.mockHealth})};
   if(name.endsWith('/fleet-policy.mjs'))return {qualifiedForSlot};
   if(name.endsWith('/rotation-plan.mjs'))return {rotationWindow:()=>({slot:'asia'})};
   throw new Error('unexpected import');
  },
 });
 assert.equal((await exports.GET(new Request('https://test'))).status,401);assert.equal(queries,0);
 authorized=true;const body=await (await exports.GET(new Request('https://test'))).json();
 assert.equal(body.parallel_contract,1);assert.equal(body.max_parallel,3);
 assert.deepEqual(body.workers.filter(w=>w.eligible).map(w=>w.id),['leo']);
 assert.equal(Object.hasOwn(body.workers[0],'capabilities_json'),false);
 assert.equal(Object.hasOwn(body.workers[0],'current_job_id'),false);
});
