import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
import {readMushroomLevelPolicy,archiveExcludedMushrooms,restoreMushroomLevelBackup} from '../lib/mushroom-level-cleanup.mjs';
import {isUsefulMushroomLevel} from '../lib/mushroom-policy.mjs';
import {browserWrite,privateJson} from '../lib/gps-access.mjs';
import {createApi} from './helpers/mushroom-api.mjs';

if (!globalThis.crypto) globalThis.crypto=webcrypto;
test('removed level controls have no remaining event bindings in either map',()=>{
 for(const file of ['../public/map.html','../../scanner/map.html']){
  const html=readFileSync(new URL(file,import.meta.url),'utf8');
  assert.doesNotMatch(html,/\blv[12]\b|mush-lv[12]/);
  assert.match(html,/id="lv3"/);assert.match(html,/id="lv4"/);
 }
});
function fixture(){
 const sql=new DatabaseSync(':memory:');let fail='';
 sql.exec(`CREATE TABLE mushrooms(id TEXT PRIMARY KEY,level INTEGER,payload TEXT);
  CREATE TABLE mushroom_observations(key TEXT PRIMARY KEY,level INTEGER,payload TEXT);
  CREATE TABLE retention_backups(table_name TEXT,row_key TEXT,row_json TEXT,archived_at INTEGER,expires_at INTEGER,batch_id TEXT,PRIMARY KEY(table_name,row_key));
  CREATE TABLE protected_state(kind TEXT PRIMARY KEY,value TEXT);
  INSERT INTO protected_state VALUES('receipt','unchanged'),('lease','unchanged'),('offset','unchanged'),('identity','unchanged');`);
 for(const [table,key] of [['mushrooms','id'],['mushroom_observations','key']]){
  const insert=sql.prepare(`INSERT INTO ${table}(${key},level,payload) VALUES(?,?,?)`);
  for(const level of [1,2,3,4,5])insert.run(`row-${level}`,level,`payload-${level}`);
 }
 const db={prepare(q){let args=[];return {bind(...a){args=a;return this},q,get args(){return args},
  async first(){return sql.prepare(q).get(...args)},async all(){return {results:sql.prepare(q).all(...args)}},
  async run(){const r=sql.prepare(q).run(...args);return {meta:{changes:Number(r.changes)}}}}},
  async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements){if(fail&&s.q.includes(fail))throw Error('injected');result.push(await s.run())}sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}}};
 return {sql,db,fail:value=>{fail=value}};
}

test('only3/4 retained; atomic recovery preserves all columns and protected state',async()=>{
 const f=fixture(),now=1700000000000;
 assert.deepEqual([1,2,3,4,5].map(isUsefulMushroomLevel),[false,false,true,true,false]);
 assert.equal((await readMushroomLevelPolicy(f.db,now)).excludedTotal,6);
 for(const t of ['mushrooms','mushroom_observations']){
  assert.deepEqual(await archiveExcludedMushrooms(f.db,t,now),{table:t,backedUp:3,deleted:3});
  assert.deepEqual(f.sql.prepare(`SELECT level FROM ${t} ORDER BY level`).all().map(r=>r.level),[3,4]);
  assert.equal(await restoreMushroomLevelBackup(f.db,t,'row-2',now+1),true);
  const key=t==='mushrooms'?'id':'key';
  assert.equal(f.sql.prepare(`SELECT payload FROM ${t} WHERE ${key}='row-2'`).get().payload,'payload-2');
 }
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM protected_state WHERE value='unchanged'").get().n,4);
});

test('backup/delete failure rolls back both; limits and byte cap never discard unbacked data',async()=>{
 const f=fixture();f.fail('DELETE FROM mushrooms');await assert.rejects(archiveExcludedMushrooms(f.db,'mushrooms'),/injected/);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM retention_backups').get().n,0);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM mushrooms').get().n,5);
 f.fail('');assert.equal((await archiveExcludedMushrooms(f.db,'mushrooms',Date.now(),1)).deleted,1);
 await assert.rejects(archiveExcludedMushrooms(f.db,'scan_agents'),/not allowed/);
 await assert.rejects(archiveExcludedMushrooms(f.db,'mushrooms',Date.now(),5001),/limit/);
 f.sql.prepare('INSERT INTO mushrooms VALUES(?,?,?)').run('oversize',2,'x'.repeat(500001));
 await archiveExcludedMushrooms(f.db,'mushrooms');
 assert.equal(f.sql.prepare("SELECT level FROM mushrooms WHERE id='oversize'").get().level,2);
});

test('recovery never overwrites a later large snapshot and expires after7days',async()=>{
 const f=fixture(),now=1700000000000;await archiveExcludedMushrooms(f.db,'mushrooms',now);
 f.sql.exec("INSERT INTO mushrooms VALUES('row-2',3,'new-large')");
 assert.equal(await restoreMushroomLevelBackup(f.db,'mushrooms','row-2',now+1),false);
 assert.equal(f.sql.prepare("SELECT payload FROM mushrooms WHERE id='row-2'").get().payload,'new-large');
 assert.equal(await restoreMushroomLevelBackup(f.db,'mushrooms','row-1',now+7*86400000),false);
});

test('aggregate recovery JSON stays below2MiB even for a5k-row batch',async()=>{
 const f=fixture();f.sql.exec('DELETE FROM mushrooms');
 const insert=f.sql.prepare('INSERT INTO mushrooms VALUES(?,?,?)');
 for(let i=0;i<2500;i++)insert.run(String(i).padStart(6,'0'),2,'x'.repeat(1500));
 const result=await archiveExcludedMushrooms(f.db,'mushrooms');
 assert.ok(result.deleted>0&&result.deleted<2500);
 assert.ok(f.sql.prepare('SELECT SUM(length(CAST(row_json AS BLOB))) bytes FROM retention_backups').get().bytes<=2*1024*1024);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM mushrooms').get().n,2500-result.deleted);
});

test('public query cannot expose small/normal/future levels, including legacy level filters',async()=>{
 const f=createApi({size:5});f.db.exec('UPDATE mushrooms SET level=CAST(substr(id,-1) AS INTEGER)+1');
 const d=await(await f.get('levels=2,3,4')).json();assert.deepEqual(d.mushrooms.map(r=>r.level).sort(),[3,4]);
 assert.equal((await(await f.get('levels=2')).json()).mushrooms.length,0);
 const all=await(await f.get()).json();assert.deepEqual(all.mushrooms.map(r=>r.level).sort(),[3,4]);
});

test('cleanup route rejects anonymous/controller writes, cross-origin and arbitrary actions',async()=>{
 const exports={};let owner=false,controller=false,calls=0;
 const src=ts.transpileModule(readFileSync(new URL('../app/api/admin/mushroom-policy/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Script(src).runInNewContext({exports,JSON,Object,Error,require(p){
  if(p.endsWith('/cloud'))return {adminAuthorized:()=>owner,controllerAuthorized:()=>controller,ensureSchema:async()=>{},runtime:()=>({DB:{}}),readBoundedUtf8:async r=>({text:await r.text()})};
  if(p.endsWith('/gps-access.mjs'))return {browserWrite,privateJson};
  if(p.endsWith('/mushroom-level-cleanup.mjs'))return {readMushroomLevelPolicy:async()=>{throw Error('inventory unavailable after commit')},archiveExcludedMushrooms:async()=>{calls++;return {deleted:1}}};
  throw Error(p);
 }});
 const req=(origin='https://example.test',action='archive-excluded')=>new Request('https://example.test/api/admin/mushroom-policy',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action})});
 assert.equal((await exports.POST(req())).status,403);controller=true;assert.equal((await exports.POST(req())).status,403);
 owner=true;assert.equal((await exports.POST(req('https://evil.invalid'))).status,403);
 assert.equal((await exports.POST(req('https://example.test','drop-all'))).status,400);assert.equal(calls,0);
 assert.equal((await exports.POST(req())).status,200);assert.equal(calls,2);
});
