import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { catalogueStatements, CATALOGUE_REVISION, CATALOGUE_STATE } from '../lib/catalogue-seed.mjs';

const source=readFileSync(new URL('../lib/event-spots.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const exported={}; new Function('exports',js)(exported);
const all=exported.EVENT_SPOT_SEED;
const rows=all.filter(s=>s.id.startsWith('au-melbourne-mini-walk-2026-'));

test('Melbourne MINI WALK preserves six supplied GPS and verified AEDT/Taipei window',()=>{
  assert.equal(rows.length,6);
  assert.deepEqual(rows.map(s=>[s.lat,s.lng]),[
    [-37.8062290,144.9703030],[-37.8100005,144.9644355],[-37.8106646,144.9630521],
    [-37.8108850,144.9639360],[-37.8101367,144.9631035],[-37.8119920,144.9604610],
  ]);
  assert.equal(all.length,53);
  assert.equal(new Set(all.map(s=>s.id)).size,53);
  for(const row of rows){
    assert.equal(row.startAt,Date.parse('2026-10-29T07:00:00+08:00')/1000);
    assert.equal(row.endAt,Date.parse('2026-11-01T19:00:00+08:00')/1000);
    assert.equal(row.startAt,Date.parse('2026-10-28T23:00:00Z')/1000);
    assert.equal(row.endAt,Date.parse('2026-11-01T11:00:00Z')/1000);
    assert.equal(row.spotKind,'limited');
    assert.equal(row.rewardKind,'gold_seedling');
    assert.equal(row.country,'澳洲');
    assert.equal(row.verificationStatus,'community');
    assert.match(row.coordinateNote,/使用者提供，非官方 GPS/);
    assert.match(row.cooldownNote,/整場活動每位玩家每個特殊地點限領 1 棵/);
    assert.match(row.cooldownNote,/並非每日重置/);
    assert.match(row.eligibilityNote,/免費、開放所有玩家/);
    assert.match(row.eligibilityNote,/10\/29–30 10:00–21:00、10\/31–11\/01 10:00–19:00/);
    assert.match(row.eligibilityNote,/07:00–18:00、07:00–16:00/);
    assert.match(row.eligibilityNote,/皮克敏顏色可能隨機/);
    assert.equal(row.sourceUrl,'https://pikminbloom.com/en/news/oct26-melbournecentral');
  }
  assert.ok(CATALOGUE_REVISION>2026101001);
});

test('official map rewards do not invent a mapping for the two indoor GPS',()=>{
  for(const [suffix,reward] of [['carlton-gardens','四葉幸運草'],['state-library','迷你書'],['bakemono-bakers','糕點'],['hardware-societe','下午茶']]){
    assert.equal(rows.find(s=>s.id.endsWith(suffix)).rewardSummary,`${reward}飾品金色花苗`);
  }
  const indoor=rows.filter(s=>/central-[ab]$/.test(s.id));
  assert.equal(indoor.length,2);
  for(const row of indoor){
    assert.match(row.name,/獎勵對應待確認/);
    assert.equal(row.rewardSummary,'巧克力／宇宙飛船飾品金色花苗（兩點對應待確認）');
    assert.match(row.coordinateNote,/#1：Level 1 Pikmin 攤位為宇宙飛船/);
    assert.match(row.coordinateNote,/#2：Level 2 Godiva 為巧克力/);
    assert.match(row.coordinateNote,/並非同一點可領兩種/);
  }
});

test('catalogue upgrade retains the previous 47 rows and resists an older Worker',()=>{
  const sqlite=new DatabaseSync(':memory:');
  try{
    sqlite.exec(`CREATE TABLE maintenance_state(name TEXT PRIMARY KEY,last_run_at INTEGER DEFAULT 0);
      CREATE TABLE event_spots(id TEXT PRIMARY KEY,country,city,name,lat,lng,spot_kind,reward_kind,reward_summary,
      start_at,end_at,cooldown_note,eligibility_note,coordinate_note,verification_status,source_title,source_url,last_verified_at,updated_at);`);
    sqlite.prepare('INSERT INTO maintenance_state(name) VALUES(?)').run(CATALOGUE_STATE);
    const db={prepare(sql){return{bind(...args){return()=>sqlite.prepare(sql).run(...args);}}}};
    const apply=(spots,revision)=>{sqlite.exec('BEGIN');try{for(const statement of catalogueStatements(db,spots,revision,1))statement();sqlite.exec('COMMIT');}catch(error){sqlite.exec('ROLLBACK');throw error;}};
    const historical=all.filter(s=>!rows.includes(s));
    apply(historical,2026101001);
    apply(all,CATALOGUE_REVISION);
    apply(historical,2026101001);
    assert.deepEqual(sqlite.prepare('SELECT id FROM event_spots ORDER BY id').all().map(s=>s.id),all.map(s=>s.id).sort());
    assert.equal(sqlite.prepare('SELECT last_run_at FROM maintenance_state WHERE name=?').get(CATALOGUE_STATE).last_run_at,CATALOGUE_REVISION);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM event_spots WHERE country=? AND end_at>=?').get('澳洲',Date.parse('2026-10-29T00:00:00Z')/1000).n,6);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM event_spots WHERE country=? AND end_at>=?').get('澳洲',Date.parse('2026-11-01T11:00:01Z')/1000).n,0);
  }finally{sqlite.close();}
});
