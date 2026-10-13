import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/metrics.ts", import.meta.url), "utf8");
const exports = {};
new Script(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText).runInNewContext({ exports, require() { return {}; } });

test("155 rollout preserves older matching versions and rejects mismatches", () => {
  for (const version of ["149.0", "150.0", "151.0", "152.0", "153.0", "154.0", "155.0"]) {
    assert.equal(exports.versionCompatibility({ agent_version: "2.2.0",
      game_version: version, module_version: version }).compatible, true);
  }
  for (const [game, module, agent] of [
    ["152.0", "151.0", "2.2.0"], ["151.0", "152.0", "2.2.0"],
    ["153.0", "152.0", "2.2.0"], ["152.0", "153.0", "2.2.0"],
    ["154.0", "153.0", "2.2.0"], ["153.0", "154.0", "2.2.0"],
    ["155.0", "154.0", "2.2.0"], ["154.0", "155.0", "2.2.0"],
    ["156.0", "156.0", "2.2.0"], ["152.0", "152.0", "1.9.9"],
  ]) {
    assert.equal(exports.versionCompatibility({ agent_version: agent,
      game_version: game, module_version: module }).compatible, false);
  }
});
