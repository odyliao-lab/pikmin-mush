import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import {baselineWindow,buildFleetBaseline} from '../lib/fleet-baseline-core.mjs';
import {readFleetBaseline,baselineReadStatements,BASELINE_READ_LIMITS} from '../lib/fleet-baseline-read.mjs';

const DAY=86400000,NOW=20*DAY,FROM=NOW-2*3600000,TO=NOW-3600000,HISTORY=NOW-7*DAY;
const params=(from=FROM,to=TO)=>new URLSearchParams({from:String(from),to:String(to)});
const options={from:FROM,to:TO,now:NOW,historyFrom:HISTORY};
const observation=(key='o',extra={})=>({key,challenge_key:'c',agent_id:'alpha',target_id:1,
  received_at:(FROM+5000)/1000,level:3,challenger_count:2,challenger_capacity:35,finish_ms:0,...extra});
const event=(id=1,extra={})=>({id,agent_id:'alpha',target_id:1,job_id:10,event_type:'target_completed',
  at:FROM+10000,duration_ms:10000,detail:JSON.stringify({evidence:{version:1,refresh_source:'object'}}),...extra});
const target=(id=1,extra={})=>({id,job_id:10,cycle:2,verification_kind:'',...extra});
function seed(t,extra={}) {
  const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
  for(const file of readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())
    sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  const s={complete:true,observations:[observation()],events:[event()],targets:[target()],
    archivedTargets:[],challenges:[{key:'c',identity_confidence:'challenge_start'}],...extra};
  sql.prepare('INSERT INTO maintenance_state(name,last_run_at) VALUES(?,?)').run('allocation-history-v2',HISTORY);
  for(const c of s.challenges)sql.prepare('INSERT INTO mushroom_challenges VALUES(?,?,?,?,?,?)')
    .run(c.key,'fixture-location',0,c.identity_confidence,1,1);
  for(const o of s.observations)sql.prepare(`INSERT INTO mushroom_observations
    (key,challenge_key,agent_id,target_id,received_at,level,challenger_count,challenger_capacity,finish_ms,type,total_power)
    VALUES(?,?,?,?,?,?,?,?,?,1,0)`).run(o.key,o.challenge_key,o.agent_id,o.target_id,o.received_at,o.level,
      o.challenger_count,o.challenger_capacity,o.finish_ms);
  for(const e of s.events)sql.prepare(`INSERT INTO scan_agent_events
    (id,agent_id,target_id,job_id,event_type,at,duration_ms,detail) VALUES(?,?,?,?,?,?,?,?)`)
    .run(e.id,e.agent_id,e.target_id,e.job_id,e.event_type,e.at,e.duration_ms,e.detail);
  for(const t of s.targets)sql.prepare(`INSERT INTO scan_targets
    (id,job_id,cycle,verification_kind,sequence,city,lat,lng,created_at,updated_at)
    VALUES(?,?,?,?,?,'fixture',0,0,1,1)`).run(t.id,t.job_id,t.cycle,t.verification_kind,t.id);
  for(const t of s.archivedTargets)sql.prepare(`INSERT INTO scan_target_history
    (id,job_id,cycle,verification_kind,country,archived_at) VALUES(?,?,?,?,'',1)`)
    .run(t.id,t.job_id,t.cycle,t.verification_kind);
  const hooks={queries:[],batches:0,transform:r=>r,beforeBatch:()=>{}};
  const bound=(query,args)=>Object.fromEntries([...new Set([...query.matchAll(/\?(\d+)/g)].map(m=>m[1]))]
    .map(k=>[k,args[Number(k)-1]]));
  const db={prepare(query){
    assert.match(query,/^(SELECT|WITH)\b/); // Only SELECTs can enter the adapter.
    const p={query,args:[],bind(...args){this.args=args;return this;},
      async first(){hooks.queries.push(query);return sql.prepare(query).get(bound(query,this.args));}};
    return p;
  },async batch(statements){
    hooks.batches++;hooks.beforeBatch();sql.exec('BEGIN');
    try {
      const result=statements.map(p=>{hooks.queries.push(p.query);return {success:true,
        meta:{rows_written:0,changed_db:false},results:sql.prepare(p.query).all(bound(p.query,p.args))};});
      sql.exec('COMMIT');return hooks.transform(result);
    } catch(e){sql.exec('ROLLBACK');throw e;}
  }};
  return {sql,db,hooks,s};
}
const reference=s=>({...buildFleetBaseline(s,options),mode:'bounded_read_candidate'});

test('real migrated SQLite SELECTs equal the reference union, late partitions and retry accounting',async t=>{
  const f=seed(t,{observations:[observation('old',{received_at:(FROM-5000)/1000}),
    observation(),observation('b',{agent_id:'beta',target_id:2,level:4}),
    observation('late',{received_at:(FROM+20000)/1000}),
    observation('verify',{target_id:3}),observation('return',{target_id:4}),
    observation('orphan',{target_id:999}),observation('background',{target_id:null}),
    observation('end',{received_at:TO/1000}),observation('normal',{level:2})],
    targets:[target(),target(3,{verification_kind:'candidate'}),target(4,{verification_kind:'return'})],
    archivedTargets:[target(1,{cycle:1,verification_kind:'return'}),target(2)],
    events:[event(),event(2,{at:FROM+15000}),event(3,{target_id:2,agent_id:'beta'}),
      event(4,{target_id:3,event_type:'target_failed'}),event(5,{target_id:999})]});
  const before=f.sql.prepare('SELECT total_changes() AS n').get().n;
  f.sql.exec('PRAGMA query_only=ON');
  const r=await readFleetBaseline(f.db,params(),NOW);
  assert.equal(r.status,200);assert.deepEqual(r.body,reference(f.s));assert.equal(f.hooks.batches,1);
  assert.equal(f.sql.prepare('SELECT total_changes() AS n').get().n,before);
  assert.equal(r.body.observations.repeat_in_retained_history,1);
  assert.equal(r.body.observations.resolved_challenges,1);
});

test('millisecond bounds, excluded levels, unresolved and missing challenge identities are not invented',async t=>{
  const f=seed(t,{observations:[observation('start',{received_at:FROM/1000}),
    observation('end',{received_at:TO/1000}),observation('small',{level:1})],
    challenges:[{key:'c',identity_confidence:'unresolved'}]});
  const r=await readFleetBaseline(f.db,params(FROM+1,TO+1),NOW);
  assert.equal(r.status,200);assert.equal(r.body.observations.stored_retained_rows,1);
  assert.equal(r.body.observations.unresolved_rows,1);
  f.sql.exec('DELETE FROM mushroom_challenges');
  const missing=await readFleetBaseline(f.db,params(),NOW);
  assert.equal(missing.status,503);assert.equal(missing.body.observations,null);
});

test('SQL lookback preserves cross-window ACK retry and numeric IDs beyond32bits',async t=>{
  const id=2**40+1,job=2**40+2;
  const f=seed(t,{targets:[target(id,{job_id:job})],observations:[observation('late',{target_id:id})],
    events:[event(1,{target_id:id,job_id:job,at:FROM-1000}),event(2,{target_id:id,job_id:job})]});
  const r=await readFleetBaseline(f.db,params(),NOW);
  assert.equal(r.status,200);assert.deepEqual(r.body,reference(f.s));
  assert.equal(r.body.effort.cross_window_completed_retry_targets,1);
  assert.equal(r.body.observations.attribution.ordinary_unaligned_rows,1);
});

test('irrelevant retained history over the old cap does not invalidate a small current window',async t=>{
  const old=Array.from({length:20001},(_,i)=>observation('old-'+i,{challenge_key:'old-'+i,
    target_id:i+2,received_at:(HISTORY+1000)/1000}));
  const f=seed(t,{observations:[observation(),...old],
    challenges:[{key:'c',identity_confidence:'challenge_start'},...old.map(o=>({key:o.challenge_key,identity_confidence:'challenge_start'}))]});
  const r=await readFleetBaseline(f.db,params(),NOW);
  assert.equal(r.status,200);assert.deepEqual(r.body,reference(f.s));
});

test('lookback selects the actual earliest3/4 receipt and earliest completed event, not level2 or retry',async t=>{
  const f=seed(t,{observations:[observation(),observation('prior-normal',{level:2,received_at:(FROM-20000)/1000}),
    observation('prior',{level:4,received_at:(FROM-10000)/1000}),
    observation('later-prior',{received_at:(FROM-5000)/1000})],
    events:[event(20,{at:FROM-1000}),event(2,{at:FROM-10000}),
      event(1,{at:FROM-15000,event_type:'target_failed'}),event(99)]});
  const r=await readFleetBaseline(f.db,params(),NOW);
  assert.equal(r.status,200);assert.deepEqual(r.body,reference(f.s));
  assert.equal(r.body.observations.repeat_in_retained_history,1);
  assert.equal(r.body.effort.cross_window_completed_retry_targets,1);
});

test('SQL diagnostic projection keeps malformed/oversized detail unknown without leaking payloads',async t=>{
  for(const detail of ['broken',JSON.stringify({evidence:{version:'1',refresh_source:'object'}}),
    JSON.stringify({evidence:{version:1,refresh_source:'object'},lease:'x'.repeat(5000)})]){
    const f=seed(t,{events:[event(1,{detail})]});
    const r=await readFleetBaseline(f.db,params(),NOW);
    assert.equal(r.status,200);assert.equal(r.body.effort.refresh_source_targets.unknown,1);
    assert.equal(r.body.effort.verified_empty_targets,null);
    assert.doesNotMatch(JSON.stringify(r.body),/lease|broken/);
  }
});

test('real empty complete snapshot reports zero; absent/corrupt epoch and missing schema return unavailable',async t=>{
  const f=seed(t,{observations:[],events:[],targets:[],challenges:[]});
  let r=await readFleetBaseline(f.db,params(),NOW);
  assert.equal(r.status,200);assert.equal(r.body.observations.stored_retained_rows,0);
  for(const epoch of [0,NOW+1,1.5]){
    f.sql.prepare('UPDATE maintenance_state SET last_run_at=?').run(epoch);
    r=await readFleetBaseline(f.db,params(),NOW);assert.equal(r.status,503);
    assert.equal(r.body.reason,'history_unavailable');assert.equal(r.body.observations,null);
  }
  f.sql.exec('DELETE FROM maintenance_state');
  assert.equal((await readFleetBaseline(f.db,params(),NOW)).status,503);
  f.sql.exec('DROP TABLE maintenance_state');
  r=await readFleetBaseline(f.db,params(),NOW);assert.equal(r.body.reason,'read_unavailable');
  assert.doesNotMatch(JSON.stringify(r.body),/maintenance_state|SELECT|fixture-location/);
});

test('invalid, missing, duplicate, future and unretained bounds cause no DB work',async t=>{
  const f=seed(t);
  for(const query of ['',`from=${FROM}`,`from=${FROM}&to=`,
    `from=${FROM}&to=${TO}&to=${TO}`,`from=1e9&to=${TO}`,
    `from=${NOW-8*DAY}&to=${TO}`,`from=${FROM}&to=${NOW+1}`,
    `from=${FROM}&to=${FROM+3599999}`]){
    const r=await readFleetBaseline(f.db,new URLSearchParams(query),NOW);
    assert.equal(r.status,400);assert.equal(f.hooks.queries.length,0);
  }
  f.sql.prepare('UPDATE maintenance_state SET last_run_at=?').run(FROM+1);
  assert.equal((await readFleetBaseline(f.db,params(),NOW)).status,400);
  assert.equal(f.hooks.batches,0);
});

test('older epoch is clamped to physical7d retention; missing indexes fail without schema initialization',async t=>{
  const f=seed(t);f.sql.exec('UPDATE maintenance_state SET last_run_at=1');
  const r=await readFleetBaseline(f.db,params(),NOW);
  assert.equal(r.body.history_from,HISTORY);assert.equal(r.body.history_left_censored,true);
  f.sql.exec('DROP INDEX mushroom_observations_received_idx');
  assert.equal((await readFleetBaseline(f.db,params(),NOW)).status,503);
});

test('epoch change before batched snapshot is detected, no independent-query fallback',async t=>{
  const f=seed(t);f.hooks.beforeBatch=()=>f.sql.exec(`UPDATE maintenance_state SET last_run_at=${HISTORY+1}`);
  let r=await readFleetBaseline(f.db,params(),NOW);
  assert.equal(r.body.reason,'history_changed');assert.equal(r.body.observations,null);
  delete f.db.batch;r=await readFleetBaseline(f.db,params(),NOW);
  assert.equal(r.body.reason,'read_unavailable');assert.equal(r.status,503);
});

test('batch failure, malformed/truncated results and reported read limits remain unknown',async t=>{
  const f=seed(t);
  for(const transform of [()=>undefined,r=>r.slice(1),r=>{r[1].success=false;return r;},
    r=>{delete r[1].results;return r;},r=>{r[0].results=[];return r;},
    r=>{r[1].meta.rows_read=NaN;return r;},
    r=>{r[1].meta.rows_read=BASELINE_READ_LIMITS.reportedRowsRead+1;return r;},
    r=>{r[1].meta.rows_written=1;return r;}]){
    f.hooks.transform=transform;const r=await readFleetBaseline(f.db,params(),NOW);
    assert.equal(r.status,503);assert.equal(r.body.snapshot_complete,false);
    assert.equal(r.body.observations,null);assert.equal(r.body.activation_ready,false);
  }
  f.db.batch=async()=>{throw Error('fixture-only-secret-SQL');};
  const r=await readFleetBaseline(f.db,params(),NOW);
  assert.equal(r.status,503);assert.doesNotMatch(JSON.stringify(r),/fixture-only-secret-SQL/);
});

test('real sentinel overflow returns unknown instead of a truncated count, without retries',async t=>{
  const observations=Array.from({length:BASELINE_READ_LIMITS.rows+1},(_,i)=>observation('o'+i));
  const f=seed(t,{observations});const r=await readFleetBaseline(f.db,params(),NOW);
  assert.equal(r.status,503);assert.equal(r.body.reason,'row_limit');
  assert.equal(r.body.observations,null);assert.equal(f.hooks.batches,0);
});

test('growth after advisory preflight still fails closed in the actual snapshot',async t=>{
  const f=seed(t);
  f.hooks.beforeBatch=()=>f.sql.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<20001)
    INSERT INTO mushroom_observations(key,challenge_key,agent_id,target_id,received_at,level,type,
      challenger_count,challenger_capacity,total_power,finish_ms)
    SELECT 'grown-'||n,'c','alpha',1,${FROM/1000+5},3,1,2,35,0,0 FROM seq`);
  const r=await readFleetBaseline(f.db,params(),NOW);
  assert.equal(r.status,503);assert.equal(r.body.reason,'row_limit');assert.equal(r.body.observations,null);
});

test('observation text-byte overflow is rejected before materializing the main result',async t=>{
  const f=seed(t,{observations:Array.from({length:9000},(_,i)=>observation('k'.repeat(480)+i))});
  const r=await readFleetBaseline(f.db,params(),NOW);
  assert.equal(r.status,503);assert.equal(r.body.reason,'snapshot_byte_limit');assert.equal(f.hooks.batches,0);
});

test('snapshot byte and output-cycle caps reject complete-looking overlarge responses',async t=>{
  const f=seed(t);
  f.hooks.transform=r=>{r[1].results=Array.from({length:7000},(_,i)=>observation('k'.repeat(500)+i));return r;};
  let r=await readFleetBaseline(f.db,params(),NOW);
  assert.equal(r.body.reason,'snapshot_byte_limit');
  const targets=Array.from({length:257},(_,i)=>target(i+1,{cycle:i}));
  const events=targets.map(t=>event(t.id,{target_id:t.id}));
  const many=seed(t,{targets,events});
  r=await readFleetBaseline(many.db,params(),NOW);
  assert.equal(r.body.reason,'response_limit');assert.equal(r.body.cycles,null);
});

test('oversized identifiers are unavailable; raw event payload is projected away before returning',async t=>{
  const f=seed(t,{events:[event(1,{detail:JSON.stringify({lease:'private-fixture',
    evidence:{version:1,refresh_source:'object'}})})]});
  const r=await readFleetBaseline(f.db,params(),NOW);
  assert.equal(r.status,200);assert.equal(r.body.effort.refresh_source_targets.object,1);
  assert.doesNotMatch(JSON.stringify(r.body),/private-fixture|alpha|fixture-location/);
  const big=seed(t,{observations:[observation('k'.repeat(513))]});
  assert.equal((await readFleetBaseline(big.db,params(),NOW)).body.reason,'invalid_snapshot');
});

test('SQLite plan uses existing time indexes and primary-key lookups, with fixed sentinel limits',t=>{
  const f=seed(t),plan=baselineReadStatements(baselineWindow(options));
  for(const p of plan){
    const used=[...new Set([...p.sql.matchAll(/\?(\d+)/g)].map(m=>m[1]))];
    const args=Object.fromEntries(used.map(k=>[k,p.args[Number(k)-1]]));
    const details=f.sql.prepare('EXPLAIN QUERY PLAN '+p.sql).all(args).map(r=>r.detail).join('\n');
    if(p.name==='observations')assert.match(details,/mushroom_observations_received_idx/);
    if(p.name==='events')assert.match(details,/scan_agent_events_type_at_idx/);
    if(['targets','archivedTargets','challenges'].includes(p.name))assert.match(details,/PRIMARY KEY|sqlite_autoindex/);
    if(p.name!=='epoch')assert.equal(p.args[4],BASELINE_READ_LIMITS.rows+1);
    assert.equal(p.args.length,Math.max(0,...[...p.sql.matchAll(/\?(\d+)/g)].map(m=>Number(m[1]))),
      'D1 bind requires the exact largest positional slot, unlike a permissive SQLite named-map fixture');
  }
});

function route(f,{admin=false,controller=false,enabled='1'}={}){
  const exports={};let envCalls=0;
  class Clock extends Date { static now(){return NOW;} }
  const source=readFileSync(new URL('../app/api/admin/fleet-baseline/route.ts',import.meta.url),'utf8');
  new Script(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,
    target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports,URL,Date:Clock,
    require(path){
      if(path.endsWith('/cloud'))return {adminAuthorized:()=>admin,controllerAuthorized:()=>controller,
        runtime:()=>{envCalls++;return {DB:f.db,FLEET_BASELINE_READ_ENABLED:enabled};},
        noStoreJson:(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})};
      if(path.endsWith('/fleet-baseline-read.mjs'))return {readFleetBaseline};
      throw Error('unexpected import: '+path);
    }});
  return {...exports,envCalls:()=>envCalls};
}
const request=()=>new Request('https://example.test/api/admin/fleet-baseline?'+params());

test('actual route authorizes before runtime/DB and defaults off without enabling another service',async t=>{
  const f=seed(t),anon=route(f);
  const r=await anon.GET(request());assert.equal(r.status,403);
  assert.equal(anon.envCalls(),0);assert.equal(f.hooks.queries.length,0);
  assert.equal(r.headers.get('Cache-Control'),'private, no-store');
  for(const enabled of [undefined,'','0','true']){
    const off=route(f,{admin:true,enabled:enabled??''});
    assert.equal((await off.GET(request())).status,503);assert.equal(f.hooks.queries.length,0);
  }
  assert.equal(anon.POST,undefined);
});

test('actual admin and controller GETs are private, SELECT-only and never imply production qualification',async t=>{
  const f=seed(t);f.sql.exec('PRAGMA query_only=ON');
  const before=f.sql.prepare('SELECT total_changes() AS n').get().n;
  for(const authorization of [{admin:true},{controller:true}]){
    const r=await route(f,authorization).GET(request());
    assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'private, no-store');
    const body=await r.json();assert.equal(body.mode,'bounded_read_candidate');
    assert.equal(body.qualification_complete,false);assert.equal(body.activation_ready,false);
    assert.equal(body.active_qualified_agent_hours,null);
  }
  assert.equal(f.sql.prepare('SELECT total_changes() AS n').get().n,before);
});

test('actual route permits only one report read per isolate and releases the guard after failure',async t=>{
  const f=seed(t),r=route(f,{controller:true});
  let release,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const original=f.db.batch;
  f.db.batch=async statements=>{entered();await new Promise(resolve=>{release=resolve;});return original(statements);};
  const first=r.GET(request());await started;
  const queries=f.hooks.queries.length;
  const busy=await r.GET(request());assert.equal(busy.status,503);
  assert.equal((await busy.json()).error,'baseline read busy');assert.equal(f.hooks.queries.length,queries);
  release();assert.equal((await first).status,200);
  f.db.batch=async()=>{throw Error('fixture-only-failure');};
  assert.equal((await r.GET(request())).status,503);
  f.db.batch=original;assert.equal((await r.GET(request())).status,200);
});
