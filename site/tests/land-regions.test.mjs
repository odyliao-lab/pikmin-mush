import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as land from '../lib/land-mask.mjs';
import {planDailyRotation} from '../lib/rotation-plan.mjs';

const catalog = {};
new Function('exports','require',ts.transpileModule(readFileSync(new URL('../lib/scan-plans.ts',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(catalog,name=>{
    assert.equal(name,'./land-mask.mjs'); return land;
  });
const {COUNTRY_PACK_CATALOG,buildScanPlan,normalizeScanConfig}=catalog;

test('independent offshore fixtures are excluded while inland/island centres survive',()=>{
  for(const [country,term,lat,lng] of [
    ['南非','Cape Town',-33.9249,18.34],
    ['冰島','Reykjavik',64.20,-21.9426],['新加坡','Singapore',1.24,103.85],
    ['埃及','Alexandria',31.25,29.9187],
  ]) {
    const pack=COUNTRY_PACK_CATALOG.find(p=>p.name===country);
    const city=pack.cities.find(c=>c[0].includes(term));assert.ok(city,term);
    assert.equal(land.cityLandAllows(country,city[0],lat,lng),false,term+' sea');
  }
  for(const id of ['na','bw','ls','sz','zw','zm','mz','za','fr','de','is']) {
    const pack=COUNTRY_PACK_CATALOG.find(p=>p.id===id);
    assert.ok(pack.cities.some(([name,lat,lng])=>land.cityLandAllows(pack.name,name,lat,lng)),id+' land');
  }
  assert.equal(land.cityLandAllows('unknown','unknown',0,0),false);
  assert.equal(land.cityLandAllows('南非','開普敦 Cape Town',NaN,18.4),false);
});

test('every scheduled city has land targets across all global phases and precision profile',()=>{
  const packs=COUNTRY_PACK_CATALOG.filter(p=>!['tw','jp'].includes(p.id));
  for(const radiusKm of [1.5,3,8,10]) for(const scanProfile of ['global','precision']) {
    const config=normalizeScanConfig({countryPacks:packs.map(p=>p.id),radiusKm,scanProfile,rotationSamplesPerCity:8});
    for(let cycle=0;cycle<(scanProfile==='global'?4:1);cycle++) {
      const plan=buildScanPlan(config,null,{cycle});
      assert.equal(new Set(plan.targets.map(t=>t.country+'/'+t.city)).size,packs.reduce((n,p)=>n+p.cities.length,0));
      assert.ok(plan.targets.length<30000);
      assert.equal(new Set(plan.targets.map(t=>`${t.country}/${t.city}/${t.lat}/${t.lng}`)).size,plan.targets.length);
      for(const t of plan.targets)assert.ok(land.cityLandAllows(t.country,t.city,t.lat,t.lng),t.city);
    }
  }
});

test('land costs balance all fleet sizes, including four; malformed costs fail closed',()=>{
  const at=Date.parse('2026-11-03T12:00:00+08:00');
  const weights={za:2,de:40,gb:30,fr:20};
  for(const count of [1,2,3,4,6,9,12]) {
    const ids=Array.from({length:count},(_,i)=>'a'+i);
    const plan=planDailyRotation(ids,at,weights);
    const loads=plan.assignments.map(a=>a.workload);
    assert.ok(Math.max(...loads)-Math.min(...loads)<=40);
    assert.equal(plan.assignments.flatMap(a=>a.packs).filter(p=>p==='de').length,1);
  }
  assert.throws(()=>planDailyRotation(['a'],at,{za:0}),/無效/);
  assert.throws(()=>planDailyRotation(['a'],at,{za:NaN}),/無效/);
});

test('custom bounding boxes remain explicit operator jobs',()=>{
  const config=normalizeScanConfig({mode:'custom',custom:{latMin:0,latMax:.01,lngMin:0,lngMax:.01}});
  assert.ok(buildScanPlan(config).targets.length>0);
  assert.equal(config.landMaskRevision,undefined);
});
