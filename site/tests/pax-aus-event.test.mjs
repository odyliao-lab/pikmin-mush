import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { CATALOGUE_REVISION } from '../lib/catalogue-seed.mjs';
const source=readFileSync(new URL('../lib/event-spots.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const exported={}; new Function('exports',js)(exported);

test('PAX Aus preserves four user coordinates, AEDT window and access restrictions',()=>{
  const rows=exported.EVENT_SPOT_SEED.filter(s=>s.id.startsWith('au-melbourne-pax-2026-'));
  assert.equal(rows.length,4);
  assert.deepEqual(rows.map(s=>[s.lat,s.lng]),[[-37.826408,144.952772],[-37.82472,144.95225],[-37.825547,144.953019],[-37.825357,144.954512]]);
  assert.deepEqual(rows.map(s=>s.rewardSummary),['棋子飾品金色花苗','爆米花飾品金色花苗','藍色超級瑪利歐鑰匙圈飾品金色花苗','岩石遊戲卡匣飾品金色花苗']);
  for(const [i,row] of rows.entries()){
    assert.equal(row.startAt,Date.parse('2026-10-09T07:00:00+08:00')/1000);
    assert.equal(row.endAt,Date.parse('2026-10-11T15:00:00+08:00')/1000);
    assert.match(row.eligibilityNote,i===0||i===3?/僅限持票區域/:/一般大眾可前往/);
    assert.match(row.eligibilityNote,/2,000 步/);
    assert.match(row.eligibilityNote,/非本點位獎勵/);
    assert.match(row.cooldownNote,/限領 1 棵/);
    assert.match(row.coordinateNote,/使用者提供，非官方/);
    assert.equal(row.verificationStatus,'community');
    assert.equal(row.spotKind,'limited');
    assert.equal(row.rewardKind,'gold_seedling');
  }
  const historical=exported.EVENT_SPOT_SEED.filter(s=>!s.id.startsWith('au-melbourne-mini-walk-2026-')&&!s.id.includes('-pikmin4-spaceship-202611'));
  assert.equal(historical.length,47);
  assert.equal(new Set(historical.map(s=>s.id)).size,47);
  assert.equal(exported.EVENT_SPOT_SEED.filter(s=>s.id.startsWith('tw-ikea-')).length,0);
  assert.ok(CATALOGUE_REVISION>2026100902);
});
