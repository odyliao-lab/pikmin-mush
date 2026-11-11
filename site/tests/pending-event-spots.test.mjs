import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';

const html=readFileSync(new URL('../public/event-spots.html',import.meta.url),'utf8');
const notices=JSON.parse(readFileSync(new URL('../public/event-spot-notices.json',import.meta.url),'utf8'));
const source=readFileSync(new URL('../lib/event-spots.ts',import.meta.url),'utf8');
const out={};new Function('exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(out);
const located=new Function('return '+html.match(/const located=(.*?);const gps=/)[1])();
const gps=new Function('located','return '+html.match(/const gps=(.*?);const source=/)[1])(located);

test('pending venues remain searchable records without fake map or GPS coordinates',()=>{
 assert.equal(notices.length,4);
 assert.equal(out.EVENT_SPOT_SEED.length,57);
 assert.equal(new Set([...out.EVENT_SPOT_SEED,...notices].map(s=>s.id)).size,61);
 for(const s of notices){
  assert.equal(s.lat,null);assert.equal(s.lng,null);
  assert.equal(located(s),false);assert.equal(gps(s),'座標待確認');
  assert.match(s.source_url,/^https:\/\/(www\.)?pikminbloom\.com\//);
 }
 assert.equal([...out.EVENT_SPOT_SEED,...notices].filter(located).length,57);
 assert.equal(located({lat:0,lng:null}),false);
 assert.equal(located({lat:'37.5',lng:'127.1'}),false);
});

test('reference venues cannot masquerade as verified in-game special spots',()=>{
 const rows=out.EVENT_SPOT_SEED.filter(s=>s.id.startsWith('kr-lotte-2026-'));
 assert.equal(rows.length,2);
 for(const s of rows){assert.equal(s.verificationStatus,'community');assert.match(s.name,/場館參考點/);assert.match(s.coordinateNote,/非遊戲金盆精確GPS/);}
});

test('pending periods preserve published CET boundaries and unpublished Singapore activation time',()=>{
 const paris=notices.find(s=>s.country==='法國');
 assert.equal(paris.start_at,Date.parse('2026-11-13T17:00:00+08:00')/1000);
 assert.equal(paris.end_at,Date.parse('2027-01-05T04:00:00+08:00')/1000);
 const dutch=notices.find(s=>s.country==='荷蘭');
 assert.equal(dutch.start_at,Date.parse('2026-11-21T17:00:00+08:00')/1000);
 assert.equal(dutch.end_at,Date.parse('2026-11-23T01:00:00+08:00')/1000);
 for(const s of notices.filter(s=>s.country==='新加坡')){assert.equal(s.start_at,null);assert.match(s.eligibility_note,/未公布/);}
 const zone=new Function('return '+html.match(/const zone=(.*?);const fmt=/)[1])();
 assert.equal(zone({country:'韓國'}),'Asia/Seoul');assert.equal(zone({country:'法國'}),'Europe/Paris');assert.equal(zone({country:'荷蘭'}),'Europe/Amsterdam');assert.equal(zone({country:'新加坡'}),'Asia/Singapore');
});

test('updated inline event script has exact CSP hashes without broader script permissions',()=>{
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const hash=createHash('sha256').update(script).digest('base64');
 for(const file of ['../public/_headers','../worker/index.ts'])assert.ok(readFileSync(new URL(file,import.meta.url),'utf8').includes('sha256-'+hash));
 assert.ok(html.includes('sha256-'+hash));
 assert.doesNotMatch(html,/'unsafe-eval'/);
});
