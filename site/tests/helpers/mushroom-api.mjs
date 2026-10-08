import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as query from '../../lib/query-contract.mjs';
import * as list from '../../lib/list-query.mjs';
import * as publicRead from '../../lib/public-read.mjs';
import * as gps from '../../lib/gps-access.mjs';
import * as guard from '../../lib/public-read-guard.mjs';

export function createApi({ size = 2305, gpsAuthorized = true, realAccess = false, realGuard = false, requestConstructor = Request } = {}) {
  let clock = Date.now();
  class Clock extends Date { static now() { return clock; } }
  const db = new DatabaseSync(':memory:'), statements = [];
  db.exec(`CREATE TABLE mushrooms(id TEXT PRIMARY KEY,lat REAL,lng REAL,level INTEGER,type INTEGER,cluster TEXT,cooldown INTEGER,finish_ms INTEGER,first_seen INTEGER,last_seen INTEGER,challenger_count INTEGER,challenger_capacity INTEGER,total_power REAL,start_ms INTEGER,giant_recheck_status TEXT,giant_rechecked_at INTEGER,participants_verified_at INTEGER,discovered_by_agent_id TEXT,mushroom_status TEXT);
    CREATE INDEX mushrooms_status_level_first_seen_idx ON mushrooms(mushroom_status,level,first_seen);
    CREATE INDEX mushrooms_last_seen_id_idx ON mushrooms(last_seen,id);
    CREATE INDEX mushrooms_finish_ms_idx ON mushrooms(finish_ms);
    CREATE TABLE gps_access_settings(id INTEGER PRIMARY KEY,salt TEXT,password_hash TEXT,revision INTEGER,updated_at INTEGER);
    CREATE TABLE gps_unlock_budgets(source TEXT PRIMARY KEY,window INTEGER,attempts INTEGER,updated_at INTEGER);
    CREATE TABLE public_read_budgets(source TEXT PRIMARY KEY,window INTEGER,requests INTEGER,spatial INTEGER,last_bbox TEXT,leases TEXT,updated_at INTEGER);`);
  const insert = db.prepare('INSERT INTO mushrooms VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (let i=0; i<size; i++) insert.run('fixture-'+String(i).padStart(5,'0'), i%2?25:-33, i%2?121:-70,
    3, i%2?2:12, '',0,0,Math.floor(clock/1000)-3000+i,Math.floor(clock/1000)-3000+i,
    i%6,35,0,0,'',0,0,'fixture-agent','active');
  const adapter = { prepare(sql) { let binds=[]; return {
    bind(...b){binds=b;return this;},
    async first(){return db.prepare(sql).get(...binds);},
    async run(){return db.prepare(sql).run(...binds);},
    async all(){
      statements.push(sql);
      if(sql.includes('FROM scan_targets')||sql.includes('FROM scanner_status'))return {results:[]};
      if(sql.includes('FROM scan_agents'))return {results:[{id:'fixture-agent',display_name:'Fixture Agent'}]};
      return {results:db.prepare(sql).all(...binds)};
    },
  }; } };
  const exports={};
  const source=readFileSync(new URL('../../app/api/mushrooms/route.ts',import.meta.url),'utf8');
  new Script(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)
    .runInNewContext({exports,Request:requestConstructor,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,btoa,atob,Date:Clock,require(p){
      if(p.endsWith('/cloud'))return {controllerAuthorized:r=>r.headers.get('authorization')==='Bearer fixture-controller',ensureSchema:async()=>{},readMushroomRetentionStatus:async()=>({}),scheduleMushroomRetention:()=>{},runtime:()=>({DB:adapter,COPY_AUDIT_HASH_KEY:'test-only-key'.repeat(4)}),noStoreJson:(data,status=200)=>Response.json(data,{status})};
      if(p.endsWith('/gps-access.mjs'))return realAccess?gps:{access:async()=>({owner:false,authorized:gpsAuthorized,expires_at:null}),privateJson:(data,status=200)=>Response.json(data,{status})};
      if(p.endsWith('/fleet'))return {publicAgent:row=>({id:row.id,name:row.display_name,online:false})};
      if(p.endsWith('/mushroom-policy.mjs'))return {MIN_MUSHROOM_LEVEL:2};
      if(p.endsWith('/scan-plans'))return {COUNTRY_PACK_CATALOG:[{name:'fixture-east',cities:[['east',25,121]]},{name:'fixture-west',cities:[['west',-33,-70]]}]};
      if(p.endsWith('/query-contract.mjs'))return query;
      if(p.endsWith('/list-query.mjs'))return list;
      if(p.endsWith('/public-read.mjs'))return {...publicRead,
        createMemo:options=>publicRead.createMemo({...options,now:()=>clock}),
        createPublicReader:options=>publicRead.createPublicReader({...realGuard?options:{},now:()=>clock,trace:()=>publicRead.createQueryTrace({log:()=>{}})})};
      if(p.endsWith('/public-read-guard.mjs'))return {acquirePublicRead:(db,r,key)=>guard.acquirePublicRead(db,r,key,clock)};
      throw Error(p);
    }});
  return {db,statements,GET:exports.GET,env:{DB:adapter,COPY_AUDIT_HASH_KEY:'test-only-key'.repeat(4)},advance:ms=>{clock+=ms},now:()=>clock,
    async get(params='',headers={}){return exports.GET(new Request('https://example.test/api/mushrooms?'+params,{headers}));}};
}
