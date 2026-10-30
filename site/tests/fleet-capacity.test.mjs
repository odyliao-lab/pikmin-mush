import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
import * as policy from '../lib/fleet-policy.mjs';
import * as plans from '../lib/rotation-plan.mjs';

function load(path, dependencies = {}, extra = '') {
  const exports = {};
  new Script(ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8')+extra,
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)
    .runInNewContext({exports,Response,TextEncoder,crypto:webcrypto,Date,console,
      require(name) { assert.ok(Object.hasOwn(dependencies,name),name); return dependencies[name]; }});
  return exports;
}
const catalog = load('lib/scan-plans.ts');

function fixture(t, count=5) {
  const sql = new DatabaseSync(':memory:'); t.after(()=>sql.close());
  for(const file of ['0002_left_luckman.sql','0003_fair_dragon_man.sql']) {
    // The base job schema below is intentionally scoped; the actual agent and
    // target migrations supply defaults used by the production endpoints.
    if(file.startsWith('0003')) sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  }
  sql.exec(`ALTER TABLE scan_agents ADD paused INTEGER DEFAULT 0;
    CREATE TABLE controller_dispatches(batch TEXT PRIMARY KEY,state TEXT);
    ALTER TABLE scan_targets ADD verification_kind TEXT DEFAULT '';
    ALTER TABLE scan_targets ADD required_agent_id TEXT DEFAULT '';
    ALTER TABLE scan_targets ADD priority INTEGER DEFAULT 0;
    CREATE TABLE scan_rotation_settings(id INTEGER PRIMARY KEY,enabled INTEGER,config_json TEXT);
    INSERT INTO scan_rotation_settings VALUES(1,1,'{}');
    CREATE TABLE scan_rotation_runs(schedule_date TEXT PRIMARY KEY,status TEXT,job_id INTEGER,
      assignments_json TEXT,message TEXT,created_at INTEGER,updated_at INTEGER);
    CREATE TABLE scan_jobs(id INTEGER PRIMARY KEY,status TEXT,config_json TEXT,plan_json TEXT,
      total_points INTEGER,loop INTEGER,message TEXT,created_at INTEGER,updated_at INTEGER,
      finished_at INTEGER,cycle INTEGER DEFAULT 0);`);
  const now = Date.parse('2026-10-29T12:00:00+08:00');
  for(let i=0;i<count;i++) sql.prepare(`INSERT INTO scan_agents
    (id,display_name,last_seen,created_at,updated_at) VALUES(?,?,?,0,0)`).run('a'+i,'A'+i,now);
  sql.prepare(`INSERT INTO scan_agents(id,display_name,enabled,last_seen,created_at,updated_at)
    VALUES('scorpio','Scorpio',0,?,0,0)`).run(now);
  const db={prepare(query){return {query,args:[],bind(...args){assert.ok(args.length<=100);this.args=args;return this;},
    async first(){return sql.prepare(query).get(...this.args)??null;},
    async all(){return {results:sql.prepare(query).all(...this.args)};},
    async run(){return {meta:sql.prepare(query).run(...this.args)};}};},
    async batch(items){sql.exec('BEGIN');try{const r=items.map(x=>({meta:sql.prepare(x.query).run(...x.args)}));sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const cloud={runtime:()=>({DB:db}),ensureSchema:async()=>{},adminAuthorized:r=>r.headers.get('Authorization')==='admin',
    sameOrigin:r=>r.headers.get('Origin')==='https://fixture.test',noStoreJson:(v,s=200)=>Response.json(v,{status:s})};
  const scans={appendScanLog:async()=>{},parseJobPlan:j=>JSON.parse(j.plan_json)};
  const targets=load('lib/targets.ts',{'./cloud':cloud,'./scans':scans});
  const rotation=load('lib/rotation.ts',{'./cloud':cloud,'./scan-plans':catalog,'./scans':scans,'./targets':targets,
    './rotation-plan.mjs':plans,'./fleet-policy.mjs':policy});
  let sequence=0;
  const fleet=load('lib/fleet.ts',{'./cloud':cloud,'./scans':scans,'./rotation':rotation,'./targets':targets,
    './target-history.mjs':{},'./scan-plans':catalog,'./scan-outcomes.mjs':{},'./metrics':{},
    './fleet-policy.mjs':policy,'./rotation-plan.mjs':plans},'\nexport {candidateTarget};');
  const auth={hashAgentToken:async token=>'hashed-'+token,issueAgentCredential:()=>({id:'new'+(++sequence),token:'fixture-independent-'+sequence})};
  const dependencies={'../../../../../lib/cloud':cloud,'../../../../../lib/fleet':auth,'../../../../../lib/fleet-policy.mjs':policy};
  const enroll=load('app/api/admin/agents/enroll/route.ts',dependencies);
  const action=load('app/api/admin/agents/action/route.ts',dependencies);
  const post=(route,body,authorized=true)=>route.POST(new Request('https://fixture.test/api',{method:'POST',
    headers:{'Content-Type':'application/json',Origin:'https://fixture.test',Authorization:authorized?'admin':'controller'},body:JSON.stringify(body)}));
  return {sql,db,now,rotation,fleet,enroll,action,post};
}

test('enrollment stages unique disabled nodes; qualification and atomic eight-node activation gates',async t=>{
  const f=fixture(t,7);
  assert.equal((await f.post(f.enroll,{name:'Gemini'},false)).status,403);
  const a=await (await f.post(f.enroll,{name:'Gemini'})).json();
  const b=await (await f.post(f.enroll,{name:'Reserve'})).json();
  assert.notEqual(a.token,b.token);
  assert.equal(f.sql.prepare('SELECT enabled FROM scan_agents WHERE id=?').get(a.agent.id).enabled,0);
  assert.equal((await f.post(f.action,{agentId:a.agent.id,action:'enable'})).status,409);
  for(const id of [a.agent.id,b.agent.id]) assert.equal((await f.post(f.action,{agentId:id,action:'update-qualification',rotationSlots:['emea']})).status,200);
  const results=await Promise.all([a,b].map(x=>f.post(f.action,{agentId:x.agent.id,action:'enable'})));
  assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM scan_agents WHERE enabled=1').get().n,8);
  assert.equal(f.sql.prepare("SELECT enabled FROM scan_agents WHERE id='scorpio'").get().enabled,0);
  const enabled=f.sql.prepare("SELECT id FROM scan_agents WHERE id LIKE 'new%' AND enabled=1").get().id;
  assert.equal((await f.post(f.action,{agentId:enabled,action:'update-qualification',rotationSlots:['asia']})).status,409);
  assert.equal((await f.post(f.action,{agentId:enabled,action:'disable'})).status,200);
  assert.equal((await f.post(f.action,{agentId:enabled,action:'update-qualification',rotationSlots:['world']})).status,400);
});

test('automatic and manual rotation retain coordinated work until return and resumed-data close',async t=>{
 const f=fixture(t,6);
 f.sql.exec("INSERT INTO controller_dispatches VALUES('return-awaiting-ack','active')");
 assert.equal(await f.rotation.ensureDailyRotation(f.now),null);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM scan_jobs').get().n,0);
 await assert.rejects(f.rotation.redeployDailyRotation(f.now),/回程/);
 f.sql.exec("UPDATE controller_dispatches SET state='closed'");
 const run=await f.rotation.ensureDailyRotation(f.now);assert.ok(run.job_id);
});

for(const count of [4,5,6,7,8]) test(`${count} eligible devices materialize automatic and manual routes without loss`,async t=>{
  const f=fixture(t,count);
  for(const [index,time] of ['04:00','12:00','20:00'].entries()) {
    const now=Date.parse(`2026-10-29T${time}:00+08:00`);
    f.sql.prepare('UPDATE scan_agents SET last_seen=?').run(now);
    for(const manual of [false,true]) {
      const run=manual?await f.rotation.redeployDailyRotation(now):await f.rotation.ensureDailyRotation(now);
      const assignments=manual?run.assignments:JSON.parse(run.assignments_json);
      assert.equal(assignments.length,count);
      assert.ok(assignments.every(a=>a.agentId!=='scorpio'&&a.packs.length));
      const packs=assignments.flatMap(a=>a.packs);
      assert.equal(packs.length,new Set(packs).size);
      assert.deepEqual([...packs].sort(),plans.ROTATION_DAYS[index].flatMap(r=>r.packs).sort());
      const job=f.sql.prepare('SELECT * FROM scan_jobs WHERE id=?').get(run.job_id);
      const rows=f.sql.prepare('SELECT * FROM scan_targets WHERE job_id=?').all(job.id);
      assert.equal(rows.length,job.total_points);
      assert.ok(rows.length>0&&rows.length<30000);
      assert.equal(rows.length,new Set(rows.map(x=>`${x.country}/${x.city}/${x.lat}/${x.lng}`)).size);
      for(const assignment of assignments) assert.ok(rows.some(x=>assignment.countries.includes(x.country)));
      const expectedCities=catalog.COUNTRY_PACK_CATALOG.filter(p=>packs.includes(p.id)).reduce((n,p)=>n+p.cities.length,0);
      assert.equal(new Set(rows.map(x=>`${x.country}/${x.city}`)).size,expectedCities);
      const cfg=JSON.parse(job.config_json);
      if(index===1) assert.equal(rows.filter(x=>x.city==='柏林 Berlin').length,3*cfg.rotationSamplesPerCity);
      else assert.equal(cfg.rotationCitySampling,undefined);
    }
  }
});

test('qualification excludes untested slots, paused/offline/disabled nodes; fallback cannot escape it',async t=>{
  const f=fixture(t);
  const rows=f.sql.prepare('SELECT * FROM scan_agents').all();
  const gemini={...rows[0],id:'gemini',capabilities_json:'{"rotation_slots":["emea"]}'};
  const all=[...rows,gemini,{...gemini,id:'paused',paused:1},{...gemini,id:'offline',last_seen:0}];
  assert.equal(policy.rotationEligibleAgents(all,'emea',f.now).length,6);
  assert.equal(policy.rotationEligibleAgents(all,'asia',f.now).length,5);
  assert.deepEqual(policy.rotationSlots('{broken'),[]);
  assert.deepEqual(policy.rotationSlots('{"rotation_slots":["world"]}'),[]);
  assert.equal(policy.rotationSlots('{}'),null);
  const run=await f.rotation.ensureDailyRotation(f.now);
  const job=f.sql.prepare('SELECT * FROM scan_jobs WHERE id=?').get(run.job_id);
  const candidate=await f.fleet.candidateTarget(job,{...gemini,region_tags_json:'["日本"]'},true);
  assert.ok(candidate);
  const countries=plans.ROTATION_DAYS[1].flatMap(r=>r.packs).map(id=>catalog.COUNTRY_PACK_CATALOG.find(p=>p.id===id).name);
  assert.ok(countries.includes(candidate.country));
  f.sql.prepare('UPDATE scan_targets SET country=?').run('日本');
  assert.equal(await f.fleet.candidateTarget(job,gemini,true),null);
  assert.ok(await f.fleet.candidateTarget(job,rows[0],true),'legacy fallback preserved');
});


test('region expansion keeps the current job and lease when Virgo rejoins; next switch redistributes',async t=>{
  const f=fixture(t,6);
  const at=iso=>Date.parse(iso+'+08:00');
  const before=at('2026-10-30T13:00:00');
  f.sql.prepare('UPDATE scan_agents SET last_seen=?').run(before);
  const first=await f.rotation.ensureDailyRotation(before);
  // Model the deployed six-agent route before the new city packs existed.
  const added=new Set(['ua','ke','za']);
  const addedCountries=catalog.COUNTRY_PACK_CATALOG.filter(p=>added.has(p.id)).map(p=>p.name);
  for(const country of addedCountries)f.sql.prepare('DELETE FROM scan_targets WHERE country=?').run(country);
  const oldAssignments=JSON.parse(first.assignments_json).map(a=>({...a,
    packs:a.packs.filter(p=>!added.has(p)),countries:a.countries.filter(c=>!addedCountries.includes(c))}));
  const frozen=JSON.stringify(oldAssignments);
  f.sql.prepare('UPDATE scan_rotation_runs SET assignments_json=? WHERE schedule_date=?').run(frozen,first.schedule_date);
  const leased=f.sql.prepare('SELECT id FROM scan_targets WHERE job_id=? LIMIT 1').get(first.job_id).id;
  f.sql.prepare("UPDATE scan_targets SET status='leased',lease_agent_id='a0',lease_token='fixture-lease' WHERE id=?").run(leased);
  f.sql.prepare(`INSERT INTO scan_agents(id,display_name,last_seen,created_at,updated_at)
    VALUES('virgo','Virgo',?,0,0)`).run(before);
  const resumed=await f.rotation.ensureDailyRotation(at('2026-10-30T13:01:00'));
  assert.equal(resumed.job_id,first.job_id);
  assert.equal(resumed.assignments_json,frozen);
  assert.equal(f.sql.prepare('SELECT status FROM scan_targets WHERE id=?').get(leased).status,'leased');
  for(const country of addedCountries)assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM scan_targets WHERE country=?').get(country).n,0);
  const switchAt=at('2026-10-30T20:00:00');
  f.sql.prepare('UPDATE scan_agents SET last_seen=?').run(switchAt);
  const next=await f.rotation.ensureDailyRotation(switchAt);
  assert.notEqual(next.job_id,first.job_id);
  assert.equal(JSON.parse(next.assignments_json).length,7);
  assert.equal(f.sql.prepare('SELECT status FROM scan_targets WHERE id=?').get(leased).status,'cancelled');
  const noon=at('2026-10-31T12:00:00');
  f.sql.prepare('UPDATE scan_agents SET last_seen=?').run(noon);
  const expanded=await f.rotation.ensureDailyRotation(noon);
  const packs=JSON.parse(expanded.assignments_json).flatMap(a=>a.packs);
  for(const id of added)assert.equal(packs.filter(p=>p===id).length,1);
  for(const country of addedCountries)assert.ok(f.sql.prepare('SELECT COUNT(*) n FROM scan_targets WHERE job_id=? AND country=?').get(expanded.job_id,country).n>0);
});
