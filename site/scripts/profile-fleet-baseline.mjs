// Manual, local-only synthetic profile. Never reads hosting config or credentials.
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import WebSocket from 'ws';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const site=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const output=arg('--out');
if(!output)throw Error('Provide --out <private output directory>; only synthetic local data is used.');
const out=resolve(output);await mkdir(out,{recursive:true});
const sourceRef=arg('--source-ref');
if(sourceRef)assert.match(sourceRef,/^[0-9a-f]{40}$/);
const fromSource=async path=>sourceRef?execFileSync('git',['show',`${sourceRef}:site/${path}`],
  {cwd:site,encoding:'utf8'}):readFile(resolve(site,path),'utf8');
const samples=Number(arg('--samples')??7);
assert.ok(Number.isInteger(samples)&&samples>=3&&samples<=20);
const token=randomBytes(24).toString('hex'); // Ephemeral local fixture, never saved.
const HOUR=3600000,now=Math.floor(Date.now()/1000)*1000,from=now-48*HOUR,to=now-60000;
const history=now-6*24*HOUR;
const headers={authorization:'Bearer '+token};
const points=[];
let trace=[];
const source=await fromSource('lib/fleet-baseline-read.mjs');
const routeSource=await fromSource('app/api/admin/fleet-baseline/route.ts');
const instrument={name:'profile-only-checkpoints',setup(b){
  b.onLoad({filter:/api[\\/]admin[\\/]fleet-baseline[\\/]route\.ts$/},()=>({loader:'ts',
    contents:routeSource,resolveDir:resolve(site,'app/api/admin/fleet-baseline')}));
  b.onLoad({filter:/fleet-baseline-read\.mjs$/},()=>({loader:'js',contents:source
    .replace('  let w;','  const original=db; db={prepare:q=>original.prepare(q),batch:async s=>{const r=await original.batch(s);globalThis.__trace=r.map(x=>({rows:x.results?.length,meta:x.meta}));return r;}};\n  let w;')
    .replace('    let reportedRows=0;','    globalThis.__point="after-read";if(globalThis.__memory)debugger;\n    let reportedRows=0;')
    .replace('    // D1 batch executes','    globalThis.__point="after-preflight";if(globalThis.__memory)debugger;\n    // D1 batch executes')
    .replace('    const snapshot={complete:true};','    globalThis.__point="after-byte-check";if(globalThis.__memory)debugger;\n    const snapshot={complete:true};')
    .replaceAll('catch {','catch (error) { globalThis.__profileError=String(error);')
    .replace('    if(!body.snapshot_complete)','    globalThis.__point="after-core";if(globalThis.__memory)debugger;\n    if(!body.snapshot_complete)'),
    resolveDir:resolve(site,'lib')}));
}};
const result=await build({stdin:{contents:`import {GET} from './app/api/admin/fleet-baseline/route.ts';
export default {async fetch(request){
 globalThis.__trace=[];globalThis.__profileError=null;globalThis.__memory=request.headers.get('x-profile-memory')==='1';
 globalThis.__point='before';if(globalThis.__memory)debugger;
 const r=await GET(request);const text=await r.text();
 globalThis.__point='after-response';if(globalThis.__memory)debugger;
 return Response.json({status:r.status,body:JSON.parse(text),bytes:new TextEncoder().encode(text).length,trace:globalThis.__trace,localError:globalThis.__profileError});
}}`,resolveDir:site,sourcefile:'local-baseline-profile-entry.mjs'},bundle:true,write:false,
  format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers'],plugins:[instrument]});
const code=result.outputFiles[0].text;
await writeFile(resolve(out,'profile-worker.mjs'),code);
const mf=new Miniflare(convertV4MiniflareOptions({name:'fleet-baseline-profile',modules:true,script:code,
  compatibilityDate:'2026-10-23',compatibilityFlags:['nodejs_compat'],
  host:'127.0.0.1',port:0,inspectorHost:'127.0.0.1',inspectorPort:0,
  d1Databases:{DB:'synthetic-baseline-only'},d1Persist:false,
  bindings:{CONTROLLER_TOKEN:token,FLEET_BASELINE_READ_ENABLED:'1'},
  outboundService:async()=>new Response('External network disabled for local profile',{status:503})}));
let ws;
let heapChunks=null;
const pending=new Map();let sequence=0;
function send(method,params={}){
 const id=++sequence;
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Inspector timeout: '+method));},15000);
 pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
 ws.send(JSON.stringify({id,method,params}));});
}
async function heap(){
 const usage=await send('Runtime.getHeapUsage');
 if(Number.isFinite(usage?.usedSize))return {method:'Runtime.getHeapUsage',...usage};
 // workerd may acknowledge an unsupported Runtime method with no result.
 // Heap snapshots are supported by its DevTools memory profiler. They collect
 // garbage, so their retained self-size is NOT a continuous peak/RSS measure.
 heapChunks=[];
 await send('HeapProfiler.takeHeapSnapshot',{reportProgress:false});
 const chunks=heapChunks;heapChunks=null;
 assert.ok(chunks.length,'Inspector must supply an actual heap snapshot');
 const snapshot=JSON.parse(chunks.join(''));
 const fields=snapshot.snapshot.meta.node_fields;
 const width=fields.length,index=fields.indexOf('self_size');
 assert.ok(index>=0);
 let retainedBytes=0;
 for(let i=index;i<snapshot.nodes.length;i+=width)retainedBytes+=snapshot.nodes[i];
 return {method:'HeapProfiler.snapshot_self_size_after_gc',retainedBytes,
   nodes:snapshot.nodes.length/width};
}
async function retainedHeap(){
 // A real snapshot forces collection; do not use a merely acknowledged but
 // unsupported inspector command as proof that GC happened.
 heapChunks=[];await send('HeapProfiler.takeHeapSnapshot',{reportProgress:false});
 const chunks=heapChunks;heapChunks=null;
 assert.ok(chunks.length);
 const data=JSON.parse(chunks.join('')),fields=data.snapshot.meta.node_fields;
 const index=fields.indexOf('self_size');let retainedBytes=0;
 for(let i=index;i<data.nodes.length;i+=fields.length)retainedBytes+=data.nodes[i];
 return {method:'HeapProfiler.snapshot_self_size_after_gc',retainedBytes};
}
async function inspector(){
 const u=await mf.getInspectorURL();u.protocol='http:';
 const targets=await (await fetch(new URL('/json/list',u))).json();
 const target=targets.find(t=>t.title?.includes('fleet-baseline-profile')||t.id?.includes('fleet-baseline-profile'));
 assert.ok(target,'User Worker inspector target must be identified');
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 ws.on('message',async data=>{
   const m=JSON.parse(String(data));
   if(m.method==='HeapProfiler.addHeapSnapshotChunk'){heapChunks?.push(m.params.chunk);return;}
   if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);
     if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}
   if(m.method==='Debugger.paused'){
     try{
       const tag=await send('Debugger.evaluateOnCallFrame',{callFrameId:m.params.callFrames[0].callFrameId,
         expression:'globalThis.__point',returnByValue:true});
       const usage=await heap();
       points.push({point:tag.result?.value,...usage});
     }catch(error){points.push({error:error.message});}
     finally{await send('Debugger.resume');}
   }
 });
 await send('Runtime.enable');
 return await heap();
}
async function migrate(db){
 const files=(await readdir(resolve(site,'drizzle'))).filter(f=>f.endsWith('.sql')).sort();
 for(const f of files){const sql=await readFile(resolve(site,'drizzle',f),'utf8');
  const statements=sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
  await db.batch(statements.map(s=>db.prepare(s)));
 }
}
async function seed(db,n,{long=false,irrelevant=0}={}){
 for(const table of ['mushroom_observations','mushroom_challenges','scan_agent_events','scan_targets','scan_target_history','maintenance_state'])
   await db.prepare('DELETE FROM '+table).run();
 await db.prepare("INSERT INTO maintenance_state(name,last_run_at) VALUES('allocation-history-v2',?)").bind(history).run();
 if(!n&&!irrelevant)return;
 const total=n+irrelevant;
 const cte=`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<${total})`;
 const at=`CASE WHEN n<=${n} THEN ${from}+1000+(n%1000)*1000 ELSE ${history}+1000 END`;
 const key=long?`printf('%0480d',n)`:`'o'||n`;
 await db.prepare(`${cte} INSERT INTO mushroom_challenges(key,location_id,start_ms,identity_confidence,first_recorded_at,last_observed_at)
   SELECT 'c'||n,'fixture-'||n,0,'challenge_start',1,1 FROM seq`).run();
 await db.prepare(`${cte} INSERT INTO mushroom_observations(key,challenge_key,agent_id,target_id,received_at,level,type,challenger_count,challenger_capacity,total_power,finish_ms)
   SELECT ${key},'c'||n,'agent-fixture-'||(n%10),n,(${at})/1000,3+(n%2),1,2,35,0,0 FROM seq`).run();
 await db.prepare(`${cte} INSERT INTO scan_targets(id,job_id,sequence,cycle,verification_kind,city,lat,lng,created_at,updated_at)
   SELECT n,1,n,1,'','fixture',0,0,1,1 FROM seq`).run();
 await db.prepare(`${cte} INSERT INTO scan_agent_events(id,agent_id,target_id,job_id,event_type,at,duration_ms,detail)
   SELECT n,'agent-fixture-'||(n%10),n,1,'target_completed',(${at})+1000,10000,
   '{"evidence":{"version":1,"refresh_source":"object"}}' FROM seq`).run();
}
async function call(extra={},query={from,to}){
 const start=performance.now();
 const r=await mf.dispatchFetch('http://local.test/api/admin/fleet-baseline?'+new URLSearchParams(query),{headers:{...headers,...extra}});
 const data=await r.json();
 return {elapsedMs:performance.now()-start,...data};
}
const percentile=(a,p)=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*p)-1];
const report={mode:'local_workerd_synthetic',productionVerified:false,
 node:process.version,sourceRef:sourceRef??'working-tree',
 sourceSha256:createHash('sha256').update(source).digest('hex'),
 routeSha256:createHash('sha256').update(routeSource).digest('hex'),
 instrumentedWorkerSha256:createHash('sha256').update(code).digest('hex'),
 inspectorMemory:'User Worker isolate at stage checkpoints; heap snapshot self-size is retained after GC, not continuous peak/RSS; timings exclude debugger pauses',
 limits:{workerTotalMemoryNotMeasured:true,productionCpuNotMeasured:true},samples,cases:[]};
try{
 await mf.ready;const db=await mf.getD1Database('DB');await migrate(db);
 const initial=await inspector();report.initialHeap=initial;
 for(const c of [{name:'empty',n:0},{name:'sparse',n:100},{name:'dense',n:6000},
   {name:'long-keys',n:6000,long:true},{name:'near-cap',n:19000},
   {name:'max-key-bytes',n:20000,long:true},{name:'overflow',n:20001},
   {name:'short-window-large-history',n:100,irrelevant:25000}]){
   if(arg('--cases')&&!arg('--cases').split(',').includes(c.name))continue;
   await seed(db,c.n,c);const startHeap=await retainedHeap();const results=[];
   for(let i=0;i<samples;i++)results.push(await call());
   trace=results.at(-1).trace;const beforePoints=points.length;
   await send('Debugger.enable');await call({'x-profile-memory':'1'});await send('Debugger.disable');
   const memory=points.slice(beforePoints);assert.ok(memory.length&&memory.every(m=>!m.error),'Every checkpoint needs real memory evidence');
   const post=await heap();
   const row={...c,startHeap,statuses:results.map(r=>r.status),reasons:results.map(r=>r.body.reason??null),
     elapsedMs:results.map(r=>r.elapsedMs),medianMs:percentile(results.map(r=>r.elapsedMs),0.5),
     p95Ms:percentile(results.map(r=>r.elapsedMs),0.95),responseBytes:results.at(-1).bytes,
     returnedRows:results.at(-1).body.observations?.stored_retained_rows??null,trace,memory,postHeap:post,localError:results.at(-1).localError};
   report.cases.push(row);console.log(JSON.stringify({name:c.name,status:row.statuses[0],reason:row.reasons[0],medianMs:row.medianMs,p95Ms:row.p95Ms,localError:row.localError,memory}));
   await writeFile(resolve(out,'profile.json'),JSON.stringify(report,null,2)+'\n');
   const expectedStatus=['long-keys','near-cap','max-key-bytes','overflow'].includes(c.name)?503:200;
   const historicalOverflow=sourceRef&&c.name==='short-window-large-history';
   for(const r of results){
     assert.equal(r.status,historicalOverflow?503:expectedStatus,c.name);
     assert.equal(r.localError,null,c.name+' must not hide a runtime error');
     if(r.status===200)assert.equal(r.body.observations.stored_retained_rows,c.n,c.name);
   }
 }
 // Natural repeated reads only; no blocked upload/pending/cursor fixture exists.
 await seed(db,100);const warm=[];
 for(let i=0;i<30;i++){await call();if(i%5===0)warm.push(await retainedHeap());}
 report.repeatReadHeap=warm;
 if(!sourceRef){
   await seed(db,6000);
   report.concurrentRead=await Promise.all(Array.from({length:4},()=>call()));
   report.concurrentRead=report.concurrentRead.map(r=>({status:r.status,error:r.body.error??null,elapsedMs:r.elapsedMs}));
   assert.ok(report.concurrentRead.some(r=>r.status===200));
   assert.ok(report.concurrentRead.every(r=>r.status===200 || r.error==='baseline read busy'));
   // Arrival over local HTTP is not simultaneous; later arrivals may succeed
   // after the previous read ends. The unit test holds the first read to prove exclusion.
 }
 report.assertionsPassed=true;
 report.hostProcessMemory=process.memoryUsage(); // Harness, not Worker memory.
 await writeFile(resolve(out,'profile.json'),JSON.stringify(report,null,2)+'\n');
}finally{
 ws?.close();await mf.dispose();
}
