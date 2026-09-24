import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import { planDailyRotation, ROTATION_DAYS } from "../lib/rotation-plan.mjs";

const source = readFileSync(new URL("../lib/scan-plans.ts", import.meta.url), "utf8");
const exports = {};
new Script(ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText).runInNewContext({ exports });
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
