import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';

test('retention checks coalesce as read-only probes and retry transient errors', async()=>{
 let now=1800000000000,calls=0,fail=false;
 class Clock extends Date { static now(){return now;} }
 const db={prepare(){return {bind(){return this},async run(){calls++;if(fail)throw Error('transient');return {meta:{changes:0}}},
   async first(){calls++;if(fail)throw Error('transient');return {last_run_at:Math.floor(now/1000),lastSucceededAt:Math.floor(now/1000),consecutiveFailures:0,last_deleted:1,pending:0}}}}};
 const source=readFileSync(new URL('../lib/cloud.ts',import.meta.url),'utf8');
 const section=source.slice(source.indexOf('export async function runMushroomRetention'));
 const exports={};
 new Script(ts.transpileModule(section,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)
  .runInNewContext({exports,Date:Clock,runtime:()=>({DB:db}),retentionStatus:r=>r,console,
   MUSHROOM_RETENTION_SECONDS:7*86400,LEVEL_TWO_THREE_INVALID_AFTER_SECONDS:2*86400,
   MUSHROOM_RETENTION_INTERVAL_SECONDS:300,MUSHROOM_RETENTION_BATCH_SIZE:1000,
   MUSHROOM_INVALIDATION_BATCH_SIZE:250,MUSHROOM_HISTORY_BATCH_SIZE:500});
 await Promise.all(Array.from({length:20},()=>exports.runMushroomRetention()));
 assert.equal(calls,1);
 now+=20000;await exports.runMushroomRetention();assert.equal(calls,1);
 now+=10001;fail=true;await assert.rejects(exports.runMushroomRetention());assert.equal(calls,2);
 fail=false;await exports.runMushroomRetention();assert.equal(calls,3);
 assert.match(section,/last_run_at<\?/); // cross-isolate lease remains authoritative
 assert.match(section,/MUSHROOM_INVALIDATION_BATCH_SIZE/);
 assert.match(section,/MUSHROOM_HISTORY_BATCH_SIZE/);
});

test('emergency cleanup is off the response path and only runs after an hour without success', async()=>{
 let now=1800000000000,successAt=Math.floor(now/1000)-100,runs=0;
 const scheduled=[];
 class Clock extends Date { static now(){return now;} }
 const source=readFileSync(new URL('../lib/cloud.ts',import.meta.url),'utf8');
 const section=source.slice(source.indexOf('// GitHub\'s scheduled event'),source.indexOf('export async function runMushroomRetention'));
 const exports={};
 new Script(ts.transpileModule(section,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)
  .runInNewContext({exports,Date:Clock,waitUntil:p=>scheduled.push(p),
   readMushroomRetentionStatus:async()=>({lastSucceededAt:successAt,pending:0,lastBatchSaturated:false}),
   runMushroomRetention:async()=>{runs++},checkMaintenanceHealth:async()=>{},console,
   MUSHROOM_RETENTION_INTERVAL_SECONDS:300,RETENTION_EMERGENCY_AFTER_SECONDS:3600});
 exports.scheduleRetentionEmergencyFallback();
 await scheduled[0];assert.equal(runs,0);
 now+=300001;successAt=Math.floor(now/1000)-3601;
 exports.scheduleRetentionEmergencyFallback();
 await scheduled[1];assert.equal(runs,1);
 exports.scheduleRetentionEmergencyFallback();assert.equal(scheduled.length,2);
});

test('emergency cleanup keeps draining saturated bounded batches',async()=>{
 let now=1800000000000,runs=0;
 const scheduled=[];
 class Clock extends Date { static now(){return now;} }
 const source=readFileSync(new URL('../lib/cloud.ts',import.meta.url),'utf8');
 const section=source.slice(source.indexOf('// GitHub\'s scheduled event'),source.indexOf('export async function runMushroomRetention'));
 const exports={};
 new Script(ts.transpileModule(section,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)
  .runInNewContext({exports,Date:Clock,waitUntil:p=>scheduled.push(p),
   readMushroomRetentionStatus:async()=>({lastSucceededAt:Math.floor(now/1000)-60,
     pending:0,lastBatchSaturated:true}),runMushroomRetention:async()=>{runs++},
   checkMaintenanceHealth:async()=>{},console,
   MUSHROOM_RETENTION_INTERVAL_SECONDS:300,RETENTION_EMERGENCY_AFTER_SECONDS:3600});
 exports.scheduleRetentionEmergencyFallback();await scheduled[0];assert.equal(runs,1);
 now+=300001;exports.scheduleRetentionEmergencyFallback();await scheduled[1];assert.equal(runs,2);
});

test('maintenance alerts dedupe each severity and retry failed sends after five minutes',async()=>{
 const source=readFileSync(new URL('../lib/cloud.ts',import.meta.url),'utf8');
 const section=source.slice(source.indexOf('async function notifyMaintenanceHealth'),
   source.indexOf('// GitHub\'s scheduled event'));
 let sends=0,ok=true;const records=new Map();
 const db={prepare(sql){return {
   bind(...args){this.args=args;return this},
   async run(){
     if(sql.includes('SET last_run_at')){
       const [now,name,attemptCutoff,sentCutoff]=this.args;
       const row=records.get(name)??{attempt:0,sent:0};
       if(row.attempt>=attemptCutoff||row.sent>=sentCutoff)return {meta:{changes:0}};
       row.attempt=now;records.set(name,row);return {meta:{changes:1}};
     }
     if(sql.includes('SET last_succeeded_at'))records.get(this.args[1]).sent=this.args[0];
     return {meta:{changes:0}};
   },
 }}};
 const exports={};
 new Script(`${ts.transpileModule(section,{compilerOptions:{module:ts.ModuleKind.CommonJS,
   target:ts.ScriptTarget.ES2022}}).outputText}\nexports.notify=notifyMaintenanceHealth;`)
  .runInNewContext({exports,runtime:()=>({DB:db,MAINTENANCE_DISCORD_WEBHOOK:
    'https://discord.com/api/webhooks/test'}),
   RETENTION_SCHEDULE_ALERT_REPEAT_SECONDS:24*3600,
   maintenanceMessage:()=> 'classified alert',
   fetch:async()=>{sends++;return {ok}},AbortSignal,console});
 const t=1800000000;
 await exports.notify(t,{}, {severity:'healthy'});assert.equal(sends,0);
 await exports.notify(t,{}, {severity:'degraded'});assert.equal(sends,1);
 await exports.notify(t+4*3600,{}, {severity:'degraded'});assert.equal(sends,1);
 ok=false;await exports.notify(t+10,{}, {severity:'critical'});assert.equal(sends,2);
 await exports.notify(t+20,{}, {severity:'critical'});assert.equal(sends,2);
 ok=true;await exports.notify(t+311,{}, {severity:'critical'});assert.equal(sends,3);
 await exports.notify(t+25*3600,{}, {severity:'degraded'});assert.equal(sends,4);
});

function memoFixture() {
  let now = 1_800_000_000_000, reads = 0;
  let row = {last_run_at: now / 1000 - 299, last_succeeded_at: now / 1000 - 299, consecutive_failures: 0};
  class Clock extends Date { static now() { return now; } }
  const db = {prepare() { return {async first() { reads++; return {...row}; }}; }};
  const source = readFileSync(new URL('../lib/cloud.ts', import.meta.url), 'utf8');
  const section = source.slice(source.indexOf('export async function runMushroomRetention'));
  const exports = {};
  new Script(ts.transpileModule(section, {compilerOptions: {module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports, Date: Clock, console,
    runtime: () => ({DB: db}),
    retentionStatus: r => ({lastRunAt: r.last_run_at, lastSucceededAt: r.last_succeeded_at,
      consecutiveFailures: r.consecutive_failures}),
    MUSHROOM_RETENTION_SECONDS: 7 * 86400, LEVEL_TWO_THREE_INVALID_AFTER_SECONDS: 2 * 86400,
    MUSHROOM_RETENTION_INTERVAL_SECONDS: 300,
  });
  return {run: exports.runMushroomRetention, reads: () => reads,
    advance(ms) { now += ms; }, state(next) { row = {...row, ...next}; }};
}

test('a read-only memo must not extend a successful receipt beyond its five-minute validity', async () => {
  const f = memoFixture();
  await f.run();
  f.advance(2000);
  f.state({last_run_at: 1_800_000_002, last_succeeded_at: 1_800_000_002});
  const recovered = await f.run();
  assert.equal(f.reads(), 2, 'probe D1 again when the cached receipt expires, even inside the 30-second memo');
  assert.equal(recovered.lastSucceededAt, 1_800_000_002);
});

test('an in-flight owner with no recent success cannot poison the next local receipt probe', async () => {
  const f = memoFixture();
  f.state({last_run_at: 1_800_000_000, last_succeeded_at: 1_799_999_000});
  assert.equal((await f.run()).lastSucceededAt, 1_799_999_000);
  f.advance(1000);
  f.state({last_succeeded_at: 1_800_000_000});
  assert.equal((await f.run()).lastSucceededAt, 1_800_000_000);
  assert.equal(f.reads(), 2, 'a prior lock loser must observe the owner success without a forced cleanup retry');
});
