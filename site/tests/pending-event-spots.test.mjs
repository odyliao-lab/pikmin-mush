import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {CATALOGUE_REVISION} from '../lib/catalogue-seed.mjs';

const html=readFileSync(new URL('../public/event-spots.html',import.meta.url),'utf8');
const notices=JSON.parse(readFileSync(new URL('../public/event-spot-notices.json',import.meta.url),'utf8'));
const source=readFileSync(new URL('../lib/event-spots.ts',import.meta.url),'utf8');
const out={};new Function('exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(out);
const located=new Function('return '+html.match(/const located=(.*?);const gps=/)[1])();
const gps=new Function('located','return '+html.match(/const gps=(.*?);const source=/)[1])(located);

test('pending venues remain searchable records without fake map or GPS coordinates',()=>{
 assert.equal(notices.length,4);
 assert.equal(out.EVENT_SPOT_SEED.length,91);
 assert.equal(new Set([...out.EVENT_SPOT_SEED,...notices].map(s=>s.id)).size,95);
 const pending=notices.filter(s=>!located(s));
 assert.equal(pending.length,1);
 for(const s of pending){
  assert.equal(s.lat,null);assert.equal(s.lng,null);
  assert.equal(located(s),false);assert.equal(gps(s),'座標待確認');
  assert.match(s.source_url,/^https:\/\/(www\.)?pikminbloom\.com\//);
 }
 assert.equal([...out.EVENT_SPOT_SEED,...notices].filter(located).length,94);
 assert.equal(located({lat:0,lng:null}),false);
 assert.equal(located({lat:'37.5',lng:'127.1'}),false);
});

test('reference venues cannot masquerade as verified in-game special spots',()=>{
 const busan=out.EVENT_SPOT_SEED.find(s=>s.id==='kr-lotte-2026-busan-main');
 assert.equal(busan.verificationStatus,'community');assert.match(busan.name,/場館參考點/);assert.match(busan.coordinateNote,/非遊戲金盆精確GPS/);
});

test('Tokaido pairs retain station IDs and show seven-decimal map coordinates for all 34 pins',()=>{
 const spots=out.EVENT_SPOT_SEED.filter(s=>s.id.startsWith('jp-tokaido-shinkansen-2026-'));
 assert.equal(spots.length,34);
 assert.equal(new Set(spots.map(gps)).size,34);
 for(let i=0;i<spots.length;i+=2){
  const [station,nearby]=spots.slice(i,i+2);
  assert.equal(nearby.id,station.id+'-nearby');
  assert.match(station.rewardSummary,/本站專屬新幹線明信片/);
  assert.match(nearby.rewardSummary,/周邊地點專屬明信片/);
 }
 for(const spot of spots){
  assert.match(gps(spot),/^\d+\.\d{7},\d+\.\d{7}$/);
  assert.equal(spot.verificationStatus,'official');
  assert.equal(spot.startAt,Date.parse('2026-11-19T23:00:00+08:00')/1000);
  assert.equal(spot.endAt,Date.parse('2027-02-28T22:59:59+08:00')/1000);
  assert.match(spot.eligibilityNote,/活動布章與 2 張額外限定明信片，獎勵與領取方式待確認/);
 }
 assert.equal(gps(spots.find(s=>s.id.endsWith('-gifu-hashima'))),'35.3160042,136.6857446');
 assert.equal(gps(spots.find(s=>s.id.endsWith('-gifu-hashima-nearby'))),'35.3160633,136.6856561');
 assert.equal(gps(spots.at(-1)),'34.7335110,135.5012965');
});

test('shared GPS updates preserve IDs, official periods and separate Nintendo popup without claiming game verification',()=>{
 const jamsil=out.EVENT_SPOT_SEED.find(s=>s.id==='kr-lotte-2026-jamsil');
 const outdoor=notices.find(s=>s.id==='sg-vivocity-2026-outdoor-plaza');
 const popup=notices.find(s=>s.id==='sg-vivocity-2026-nintendo-popup');
 assert.deepEqual([jamsil.lat,jamsil.lng],[37.513180,127.101810]);
 assert.deepEqual([outdoor.lat,outdoor.lng],[1.265306,103.821615]);
 assert.equal(gps(outdoor),'1.265306,103.821615');
 assert.equal(jamsil.startAt,Date.parse('2026-11-13T10:30:00+09:00')/1000);
 assert.equal(jamsil.endAt,Date.parse('2026-11-22T20:30:00+09:00')/1000);
 assert.equal(outdoor.start_at,null);assert.match(outdoor.period_note,/2026\/11\/13–12\/27/);
 assert.equal(popup.lat,null);assert.equal(popup.lng,null);assert.match(popup.period_note,/2026\/12\/01–12\/27/);
 for(const s of [jamsil,outdoor]){
  assert.equal(s.verificationStatus??s.verification_status,'community');
  assert.match(s.coordinateNote??s.coordinate_note,/water0129/);
  assert.match(s.coordinateNote??s.coordinate_note,/尚未由本站進遊戲複核/);
  assert.match(s.eligibilityNote??s.eligibility_note,/活動布章，官方公告未明列/);
 }
 assert.ok(CATALOGUE_REVISION>2026111202);
});

test('event periods preserve published CET boundaries and unpublished Singapore activation time',()=>{
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

test('Dutch Comic Con uses the existing card and keeps reported badge and coordinate provenance',()=>{
 const id='nl-dutch-comic-con-2026-nintendo';
 const dutch=notices.find(s=>s.id===id);
 assert.equal([...out.EVENT_SPOT_SEED,...notices].filter(s=>s.id===id).length,1);
 assert.equal(gps(dutch),'52.0835137,5.1041178');
 assert.equal(dutch.verification_status,'community');
 assert.match(dutch.name,/Heroes Dutch Comic Con/);
 assert.match(dutch.reward_summary,/紅色照片鈕扣徽章金色花苗/);
 assert.match(dutch.cooldown_note,/限領1株/);
 assert.match(dutch.period_note,/11\/21、11\/22 各17:00–翌日01:00/);
 assert.match(dutch.eligibility_note,/社群回報另有 1 枚活動布章，獎勵與領取方式待確認/);
 assert.match(dutch.coordinate_note,/座標由使用者提供/);
});

test('Paris fills its existing card without duplicating venues or shifting the CET closing instant',()=>{
 const paris=notices.find(s=>s.id==='fr-lafayette-champs-elysees-2026');
 assert.deepEqual([paris.lat,paris.lng],[48.87056,2.30641]);
 assert.equal(gps(paris),'48.870560,2.306410');
 assert.equal(notices.filter(s=>s.id===paris.id).length,1);
 assert.match(paris.name,/老佛爺/);
 assert.equal(paris.verification_status,'community');
 assert.match(paris.coordinate_note,/使用者分享/);
 assert.match(paris.coordinate_note,/尚未由本站進遊戲複核/);
 assert.equal(paris.start_at,Date.parse('2026-11-13T10:00:00+01:00')/1000);
 assert.equal(paris.end_at,Date.parse('2027-01-04T21:00:00+01:00')/1000);
 assert.match(paris.period_note,/巴黎時間2026\/11\/13 10:00–2027\/01\/04 21:00（CET）/);
 assert.match(paris.period_note,/台灣時間2026\/11\/13 17:00–2027\/01\/05 04:00/);
 assert.match(paris.eligibility_note,/完成2000步後另得/);
 assert.match(paris.eligibility_note,/活動布章1，官方公告未明列/);
 assert.ok(CATALOGUE_REVISION>2026111301);
});

test('updated inline event script has exact CSP hashes without broader script permissions',()=>{
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const hash=createHash('sha256').update(script).digest('base64');
 for(const file of ['../public/_headers','../worker/index.ts'])assert.ok(readFileSync(new URL(file,import.meta.url),'utf8').includes('sha256-'+hash));
 assert.ok(html.includes('sha256-'+hash));
 assert.doesNotMatch(html,/'unsafe-eval'/);
});
