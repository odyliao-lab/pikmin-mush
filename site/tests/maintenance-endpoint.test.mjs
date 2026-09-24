import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';

test('maintenance writes require the dedicated secret and report bounded health', async () => {
  let dedicated=false, controller=false, runs=0;
  const now=Date.now();
  const records=[
    {id:'active',display_name:'Aries',enabled:1,paused:0,last_seen:now-1000,
      last_data_at:now-7200001,current_job_id:1,current_target_id:2,created_at:now-86400000},
    {id:'held',display_name:'Cancer',enabled:1,paused:1,last_seen:now-86400000,
      last_data_at:0,current_job_id:2,current_target_id:3,created_at:now-86400000},
  ];
  const db={prepare(sql){return {bind(){return this},async all(){
    if(sql.includes('scan_agent_events'))return {results:[]};
    if(sql.includes('scan_agents'))return {results:records};
    throw Error(sql);
  }}}};
  const status={lastSucceededAt:Math.floor(now/1000)-1900,lastDeleted:1000,pending:8,
    lastBatchSaturated:true,consecutiveFailures:2,lastDurationMs:4100};
  const exports={};
  const code=ts.transpileModule(readFileSync(new URL('../app/api/controller/maintenance/route.ts',import.meta.url),'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Script(code).runInNewContext({exports,Date,require(p){
    if(p.endsWith('/cloud'))return {
      maintenanceAuthorized:()=>dedicated,controllerAuthorized:()=>controller,
      ensureSchema:async()=>{},runtime:()=>({DB:db}),
      readMushroomRetentionStatus:async()=>status,
      runMushroomRetention:async()=>{runs++},
      noStoreJson:(body,code=200)=>Response.json(body,{status:code,headers:{'cache-control':'no-store'}}),
    };
    throw Error(p);
  }});
  const request=method=>new Request('https://test/api/controller/maintenance',{method});
  assert.equal((await exports.GET(request('GET'))).status,401);
  assert.equal((await exports.POST(request('POST'))).status,401);
  controller=true;
  const read=await exports.GET(request('GET'));
  assert.equal(read.status,200);
  assert.equal(read.headers.get('cache-control'),'no-store');
  assert.equal((await read.json()).alerts.maintenanceStale,true);
  assert.equal((await exports.POST(request('POST'))).status,401);
  dedicated=true;
  const post=await exports.POST(request('POST'));
  assert.equal(post.status,200);
  const payload=await post.json();
  assert.equal(runs,1);
  assert.deepEqual(Array.from(payload.alerts.uploadSilentAgents),['active']);
  assert.equal(payload.alerts.retentionBacklog,true);
});
