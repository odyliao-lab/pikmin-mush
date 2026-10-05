import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { CATALOGUE_REVISION } from '../lib/catalogue-seed.mjs';
const text = readFileSync(new URL('../lib/event-spots.ts',import.meta.url),'utf8');
const js = ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const exported = {}; new Function('exports',js)(exported);
test('Nashville period renders in Central time without changing existing cities',()=>{
  const html=readFileSync(new URL('../public/event-spots.html',import.meta.url),'utf8');
  const zone = new Function('return '+html.match(/const zone=(.*?);const fmt=/)[1])();
  assert.equal(zone({country:'美國',city:'田納西州－納許維爾 Nashville'}),'America/Chicago');
  assert.equal(zone({country:'美國',city:'紐約'}),'America/New_York');
  assert.equal(zone({country:'美國',city:'西雅圖'}),'America/Los_Angeles');
});
test('Nashville adds seven exact user coordinates with distinct rewards and provenance',()=>{
  const rows=exported.EVENT_SPOT_SEED.filter(s=>s.id.startsWith('us-nashville-mini-walk-'));
  assert.equal(rows.length,7);
  assert.deepEqual(rows.map(s=>[s.lat,s.lng]),[[36.159024,-86.776504],[36.160130,-86.775742],[36.160984,-86.775365],[36.162446,-86.774053],[36.162744,-86.775954],[36.161585,-86.777866],[36.160785,-86.779836]]);
  assert.equal(new Set(rows.map(s=>s.id)).size,7);
  for(const row of rows){
    assert.equal(row.verificationStatus,'community');
    assert.match(row.coordinateNote,/使用者提供/);
    assert.match(row.cooldownNote,/14 天/);
    assert.match(row.eligibilityNote,/官方公告/);
    assert.equal(row.startAt,Date.parse('2026-10-03T15:00:00Z')/1000);
    assert.equal(row.endAt,Date.parse('2026-11-02T00:00:00Z')/1000);
    assert.match(row.eligibilityNote,/2026\/10\/03 23:00–2026\/11\/02 08:00/);
  }
  assert.ok(exported.EVENT_SPOT_SEED.some(s=>s.id==='jp-nintendo-tokyo'));
  assert.ok(CATALOGUE_REVISION>2026100201);
});

test('Nashville official boundaries convert across daylight-saving transition',()=>{
  const row=exported.EVENT_SPOT_SEED.find(s=>s.id==='us-nashville-mini-walk-gift-sticker');
  const format=(t,timeZone)=>new Intl.DateTimeFormat('sv-SE',{
    timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).format(new Date(t*1000));
  assert.equal(format(row.startAt,'America/Chicago'),'2026-10-03 10:00');
  assert.equal(format(row.endAt,'America/Chicago'),'2026-11-01 18:00');
  assert.equal(format(row.startAt,'Asia/Taipei'),'2026-10-03 23:00');
  assert.equal(format(row.endAt,'Asia/Taipei'),'2026-11-02 08:00');
});
