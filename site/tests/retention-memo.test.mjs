import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';

test('retention checks coalesce as read-only probes and retry transient errors', async()=>{
 let now=1800000000000,calls=0,fail=false;
 class Clock extends Date { static now(){return now;} }
 const db={prepare(){return {bind(){return this},async run(){calls++;if(fail)throw Error('transient');return {meta:{changes:0}}},
   async first(){calls++;if(fail)throw Error('transient');return {last_run_at:Math.floor(now/1000),last_deleted:1,pending:0}}}}};
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
