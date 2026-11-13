import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import {pendingUploadState} from '../lib/upload-pending.mjs';

test('independent source is bound to its own key, not a forged header',()=>{
 const source=readFileSync(new URL('../lib/cloud.ts',import.meta.url),'utf8');
 const section=source.slice(source.indexOf('export function maintenanceAuthorized'),source.indexOf('export function adminEmails'));
 const exports={};let independent='b'.repeat(32);
 new Script(ts.transpileModule(section,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)
   .runInNewContext({exports,runtime:()=>({MAINTENANCE_TOKEN:'a'.repeat(32),INDEPENDENT_MAINTENANCE_TOKEN:independent}),safeEqual:(a,b)=>a===b});
 const request=(token,event)=>new Request('https://test',{headers:{authorization:`Bearer ${token}`,'x-maintenance-event':event}});
 assert.equal(exports.maintenanceAuthorized(request('a'.repeat(32),'schedule')),true);
 assert.equal(exports.maintenanceAuthorized(request('a'.repeat(32),'cloudflare-cron')),false);
 assert.equal(exports.maintenanceAuthorized(request('b'.repeat(32),'cloudflare-cron')),true);
 assert.equal(exports.maintenanceAuthorized(request('b'.repeat(32),'schedule')),false);
 independent='';assert.equal(exports.maintenanceAuthorized(request('','cloudflare-cron')),false);
});

test('maintenance writes require the dedicated secret and report bounded health', async () => {
  let dedicated=false, controller=false, runs=0, scheduledWrites=0, completes=true,historyFailed=false,historyBusy=false;
  const now=Date.now();
  const records=[
    {id:'active',display_name:'Aries',enabled:1,paused:0,last_seen:now-1000,
      last_data_at:now-7200001,current_job_id:1,current_target_id:2,created_at:now-86400000},
    {id:'held',display_name:'Cancer',enabled:1,paused:1,last_seen:now-86400000,
      last_data_at:0,current_job_id:2,current_target_id:3,created_at:now-86400000},
  ];
  const pendingSamples=[];
  const db={prepare(sql){return {bind(){return this},async run(){scheduledWrites++;return {meta:{changes:1}}},async all(){
    if(sql.includes("event_type='heartbeat'"))return {results:pendingSamples};
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
    if(p.endsWith('/upload-pending.mjs'))return {pendingUploadState};
    if(p.endsWith('/history-retention.mjs')) return {
      readHistoryRetention:async()=>({mode:'dry_run',tables:[]}),
      runHistoryRetention:async()=>({mode:'dry_run',busy:historyBusy,lastRunAt:historyBusy?now+1:now,lastSucceededAt:now,consecutiveFailures:0,tables:historyFailed?[{last_error:'archive_and_delete'}]:[]}),
    };
    if(p.endsWith('/cloud'))return {
      maintenanceAuthorized:()=>dedicated,controllerAuthorized:()=>controller,
      ensureSchema:async()=>{},runtime:()=>({DB:db}),
      readMushroomRetentionStatus:async()=>status,
      checkMaintenanceHealth:async()=>({severity:'healthy'}),
      runMushroomRetention:async()=>{runs++;
        if(completes){status.lastSucceededAt=Math.floor(Date.now()/1000);status.consecutiveFailures=0;}
        return status},
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
  const first=await read.json();
  assert.equal(first.alerts.maintenanceStale,true);
  assert.deepEqual(Array.from(first.alerts.uploadSilentAgents),[]);
  assert.deepEqual(Array.from(first.alerts.uploadPendingUnknownAgents),['active']);
  for(let i=0;i<=25;i++)pendingSamples.push({agent_id:'active',at:now-7500000+i*300000,detail:JSON.stringify({pendingBytes:100})});
  assert.equal((await exports.POST(request('POST'))).status,401);
  dedicated=true;
  const post=await exports.POST(request('POST'));
  assert.equal(post.status,200);
  const payload=await post.json();
  assert.equal(runs,1);
  assert.deepEqual(Array.from(payload.alerts.uploadSilentAgents),['active']);
  assert.equal(payload.alerts.retentionBacklog,true);
  assert.equal(scheduledWrites,0);
  const scheduled=new Request('https://test/api/controller/maintenance',
    {method:'POST',headers:{'x-maintenance-event':'schedule'}});
  assert.equal((await exports.POST(scheduled)).status,200);
  assert.equal(scheduledWrites,2);
  const independent=new Request('https://test/api/controller/maintenance',
    {method:'POST',headers:{'x-maintenance-event':'cloudflare-cron'}});
  assert.equal((await exports.POST(independent)).status,200);
  assert.equal(scheduledWrites,4);
  historyBusy=true;
  const busy=await exports.POST(request('POST'));assert.equal(busy.status,200);assert.equal((await busy.json()).history.busy,true);
  historyBusy=false;
  historyFailed=true;
  assert.equal((await exports.POST(scheduled)).status,503);
  assert.equal(scheduledWrites,4);
  historyFailed=false;historyBusy=false;
  completes=false;status.lastSucceededAt=Math.floor(Date.now()/1000)-1900;
  assert.equal((await exports.POST(scheduled)).status,503);
  assert.equal(scheduledWrites,4);
});
