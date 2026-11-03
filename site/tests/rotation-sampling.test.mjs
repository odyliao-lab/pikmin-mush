import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import * as landMask from "../lib/land-mask.mjs";
import { planDailyRotation, ROTATION_DAYS } from "../lib/rotation-plan.mjs";

const source = readFileSync(new URL("../lib/scan-plans.ts", import.meta.url), "utf8");
const exports = {};
new Script(ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText).runInNewContext({ exports, require: name => { assert.equal(name,"./land-mask.mjs"); return landMask; } });
const { buildScanPlan, normalizeScanConfig, COUNTRY_PACK_CATALOG } = exports;

test("curated route city counts match the catalogue", () => {
  const byId = new Map(COUNTRY_PACK_CATALOG.map((pack) => [pack.id, pack]));
  for (const slot of ROTATION_DAYS) for (const route of slot) {
    const actual = route.packs.reduce((count, id) => count + byId.get(id).cities.length, 0);
    assert.equal(route.cityCount, actual, route.id);
  }
});

test("three online Agents still materialize every city below the queue cap", () => {
  for (const time of ["04:00", "12:00", "20:00"]) {
    const plan = planDailyRotation(["a", "b", "c"], Date.parse(`2026-09-25T${time}:00+08:00`));
    const ids = [...new Set(plan.assignments.flatMap((route) => route.packs))];
    const cityCount = ids.reduce((count, id) => count +
      COUNTRY_PACK_CATALOG.find((pack) => pack.id === id).cities.length, 0);
    const sampleLimit = Math.max(1, Math.min(8, Math.floor(200 * 3 / cityCount)));
    const result = buildScanPlan(normalizeScanConfig({ mode: "auto", scanProfile: "global",
      countryPacks: ids, rotationSamplesPerCity: sampleLimit }), null);
    assert.equal(result.regions.length, cityCount);
    assert.equal(result.targets.length, cityCount * sampleLimit);
    assert.ok(result.targets.length < 30_000);
  }
});

test("scheduled sampling reaches every selected city and stays below materialization cap", () => {
  const config = normalizeScanConfig({ mode: "auto", scanProfile: "global",
    radiusKm: 8, countryPacks: ["gb", "fr", "de", "it", "es", "pt", "se", "no", "fi", "is"],
    rotationSamplesPerCity: 4 });
  const first = buildScanPlan(config, null, { cycle: 0 });
  const second = buildScanPlan(config, null, { cycle: 1 });
  assert.equal(first.targets.length, first.regions.length * 4);
  assert.ok(first.targets.length < 30_000);
  assert.equal(new Set(first.targets.map((target) => `${target.country}/${target.city}`)).size,
    first.regions.length);
  assert.notDeepEqual(first.targets.map((target) => [target.lat, target.lng]),
    second.targets.map((target) => [target.lat, target.lng]));
});

test("manual full-grid jobs are unchanged without a rotation sampling limit", () => {
  const base = { mode: "auto", scanProfile: "global", radiusKm: 8, countryPacks: ["sg"] };
  const full = buildScanPlan(normalizeScanConfig(base), null);
  const sparse = buildScanPlan(normalizeScanConfig({ ...base, rotationSamplesPerCity: 8 }), null);
  assert.ok(full.targets.length > sparse.targets.length);
  assert.equal(sparse.targets.length, 8);
});

test('noon Berlin is exactly 3x within its original route budget; other slots clear inherited weighting',()=>{
  const rotation=readFileSync(new URL('../lib/rotation.ts',import.meta.url),'utf8');
  const section=rotation.slice(rotation.indexOf('function scanConfig('),rotation.indexOf('async function stopActiveJobs'));
  const context={COUNTRY_PACK_CATALOG,normalizeScanConfig,packNames:ids=>ids.map(id=>COUNTRY_PACK_CATALOG.find(p=>p.id===id).name)};
  new Script(ts.transpileModule(section,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext(context);
  for(const count of [1,2,3,4,5,6]){
    for(const hour of ['04:00','12:00','20:00']){
      const plan=planDailyRotation(Array.from({length:count},(_,i)=>`a${i}`),Date.parse(`2026-10-23T${hour}:00+08:00`));
      const packs=[...new Set(plan.assignments.flatMap(r=>r.packs))];
      const cfg=context.scanConfig({rotationCitySampling:{policy:'berlin-3x-v1',donorCountries:['德國']}},packs,count,plan.slot,plan.assignments);
      const base={...cfg,rotationCitySampling:undefined};
      const old=buildScanPlan(normalizeScanConfig(base),null);
      const seenDonors=new Set();
      for(let cycle=0;cycle<4;cycle++){
        const result=buildScanPlan(cfg,null,{cycle});
        assert.equal(result.targets.length,old.targets.length);
        for(const route of plan.assignments){
          const names=new Set(route.packs.map(id=>COUNTRY_PACK_CATALOG.find(p=>p.id===id).name));
          assert.equal(result.targets.filter(t=>names.has(t.country)).length,old.targets.filter(t=>names.has(t.country)).length);
        }
        if(hour==='12:00'){
          const berlin=result.targets.filter(t=>t.city==='柏林 Berlin');
          assert.equal(berlin.length,cfg.rotationSamplesPerCity===1?1:3*cfg.rotationSamplesPerCity);
          assert.equal(new Set(berlin.map(t=>`${t.lat}/${t.lng}`)).size,berlin.length);
          const byCity=new Map();for(const t of result.targets)byCity.set(t.city,(byCity.get(t.city)||0)+1);
          for(const [city,n] of byCity){assert.ok(n>=1);if(n<cfg.rotationSamplesPerCity)seenDonors.add(city);}
        }else{
          assert.equal(cfg.rotationCitySampling,undefined);
          assert.equal(JSON.stringify(result.targets),JSON.stringify(buildScanPlan(base,null,{cycle}).targets));
        }
      }
      if(hour==='12:00' && cfg.rotationSamplesPerCity>1)assert.ok(seenDonors.size>2*cfg.rotationSamplesPerCity);
    }
  }
});

test('scheduled tiny saved radius cannot disable Berlin weighting or expand the sparse point budget',()=>{
  const rotation=readFileSync(new URL('../lib/rotation.ts',import.meta.url),'utf8');
  const section=rotation.slice(rotation.indexOf('function scanConfig('),rotation.indexOf('async function stopActiveJobs'));
  const context={COUNTRY_PACK_CATALOG,normalizeScanConfig,packNames:ids=>ids.map(id=>COUNTRY_PACK_CATALOG.find(p=>p.id===id).name)};
  new Script(ts.transpileModule(section,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext(context);
  const plan=planDailyRotation(Array.from({length:9},(_,i)=>`a${i}`),Date.parse('2026-11-03T14:00:00+08:00'));
  const packs=[...new Set(plan.assignments.flatMap(r=>r.packs))];
  const cfg=context.scanConfig({radiusKm:1.5},packs,9,'emea',plan.assignments);
  assert.equal(cfg.radiusKm,3);
  for(let cycle=0;cycle<4;cycle++){
    const result=buildScanPlan(cfg,null,{cycle});
    assert.equal(result.targets.filter(t=>t.city==='柏林 Berlin').length,3*cfg.rotationSamplesPerCity);
    assert.equal(result.targets.length,buildScanPlan({...cfg,rotationCitySampling:undefined},null,{cycle}).targets.length);
  }
});
