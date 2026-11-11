import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { CATALOGUE_REVISION } from '../lib/catalogue-seed.mjs';
const text=readFileSync(new URL('../lib/event-spots.ts',import.meta.url),'utf8');
const js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const exported={};new Function('exports',js)(exported);
test('Ocean Expo preserves all seven user spots, postcard distinctions and annual rules',()=>{
  const rows=exported.EVENT_SPOT_SEED.filter(s=>s.id.startsWith('jp-ocean-expo-mini-walk-'));
  assert.equal(rows.length,7);
  assert.deepEqual(rows.map(s=>[s.lat,s.lng]),[[26.693512,127.877850],[26.692926,127.875831],[26.690939,127.877518],[26.687729,127.876157],[26.690656,127.877971],[26.698471,127.878590],[26.684883,127.875184]]);
  assert.equal(rows.filter(s=>s.rewardSummary==='活動明信片').length,3);
  assert.equal(rows.filter(s=>s.rewardKind==='gold_seedling').length,4);
  for(const row of rows){
    assert.equal(row.verificationStatus,'community');
    assert.match(row.coordinateNote,/使用者提供/);
    assert.match(row.eligibilityNote,/官方公告為日本時間 09:00/);
    assert.match(row.eligibilityNote,/滑動 4 個特殊地點/);
    assert.match(row.eligibilityNote,/藍色金色禮物貼紙/);
    assert.match(row.cooldownNote,/各領取 1 次/);
    assert.equal(row.startAt,Date.parse('2026-10-07T01:00:00Z')/1000);
    assert.equal(row.endAt,Date.parse('2026-12-31T14:59:59Z')/1000);
  }
  assert.equal(new Set(exported.EVENT_SPOT_SEED.map(s=>s.id)).size,exported.EVENT_SPOT_SEED.length);
  assert.equal(exported.EVENT_SPOT_SEED.filter(s=>s.id.startsWith('us-nashville-mini-walk-')).length,7);
  assert.ok(CATALOGUE_REVISION>2026100202);
});

test('ended IKEA campaign is removed without losing other event spots',()=>{
  assert.equal(exported.EVENT_SPOT_SEED.filter(s=>!s.id.startsWith('au-melbourne-pax-2026-')&&!s.id.startsWith('au-melbourne-mini-walk-2026-')&&!s.id.includes('-pikmin4-spaceship-202611')).length,43);
  assert.equal(exported.EVENT_SPOT_SEED.filter(s=>s.id.startsWith('tw-ikea-')).length,0);
  assert.equal(exported.EVENT_SPOT_SEED.filter(s=>s.id.startsWith('jp-ocean-expo-mini-walk-')).length,7);
  assert.ok(exported.EVENT_SPOT_SEED.some(s=>s.id==='jp-nintendo-tokyo'));
  assert.ok(CATALOGUE_REVISION>2026100901);
});
