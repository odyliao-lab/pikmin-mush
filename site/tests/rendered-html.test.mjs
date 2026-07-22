import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  isUsefulMushroomLevel, MIN_MUSHROOM_LEVEL,
} from "../lib/mushroom-policy.mjs";

const root = new URL("../", import.meta.url);

test("ships the public mushroom map and protected scan console", async () => {
  const [map, adminPage, adminClient, layout] = await Promise.all([
    readFile(new URL("public/map.html", root), "utf8"),
    readFile(new URL("app/admin/page.tsx", root), "utf8"),
    readFile(new URL("app/admin/admin-client.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
  ]);

  assert.match(map, /Pikmin 蘑菇探險隊/);
  assert.match(map, /href="\/admin"/);
  assert.match(map, /api\/mushrooms/);
  assert.doesNotMatch(map, /id="lv1"/);
  assert.match(map, /\[2,3,4\]/);
  assert.match(map, /DEFAULT_HIDDEN_TYPES=new Set\(\['15'\]\)/);
  assert.match(map, /!DEFAULT_HIDDEN_TYPES\.has\(v\)/);
  assert.match(map, /integrity="sha256-/);
  assert.match(map, /rel="noopener noreferrer"/);
  assert.doesNotMatch(map, /onclick=/);
  assert.match(adminPage, /requireChatGPTUser\("\/admin"\)/);
  assert.match(adminPage, /isAdminEmail/);
  assert.match(adminClient, /建立掃描工作/);
  assert.match(adminClient, /api\/admin\/scans\/start/);
  assert.match(adminClient, /暫停/);
  assert.match(adminClient, /持續循環/);
  assert.match(adminClient, /全球掃描節點/);
  assert.match(adminClient, /api\/admin\/agents\/enroll/);
  assert.doesNotMatch(adminClient, /獨立主要城市|CITY_CHOICES|cityIds/);
  assert.match(adminClient, /COUNTRY_PACK_GROUPS/);
  assert.match(layout, /Pikmin 蘑菇探險隊/);
});

test("hardens uploads, public telemetry, controller credentials, and browser policy", async () => {
  const [upload, publicApi, cloud, controller, phoneAgent, worker, map, headers] = await Promise.all([
    readFile(new URL("app/api/agent/upload/route.ts", root), "utf8"),
    readFile(new URL("app/api/mushrooms/route.ts", root), "utf8"),
    readFile(new URL("lib/cloud.ts", root), "utf8"),
    readFile(new URL("app/api/controller/command/route.ts", root), "utf8"),
    readFile(new URL("../phone_agent/agent.sh", root), "utf8"),
    readFile(new URL("worker/index.ts", root), "utf8"),
    readFile(new URL("public/map.html", root), "utf8"),
    readFile(new URL("public/_headers", root), "utf8"),
  ]);

  assert.match(cloud, /request\.body\.getReader\(\)/);
  assert.match(cloud, /readBoundedUtf8/);
  assert.match(upload, /MAX_UPLOAD_BYTES = 512_000/);
  assert.match(upload, /MAX_PARTIAL_BYTES = 64_000/);
  assert.doesNotMatch(upload, /request\.text\(\)/);
  assert.doesNotMatch(publicApi, /\bagents,\s*\n/);
  assert.doesNotMatch(publicApi, /current_location:/);
  assert.match(publicApi, /const publicStatus =/);
  assert.match(cloud, /CONTROLLER_TOKEN/);
  assert.match(controller, /controllerAuthorized/);
  assert.match(phoneAgent, /MAX_UPLOAD_CHUNK_BYTES=262144/);
  assert.match(worker, /Strict-Transport-Security/);
  assert.match(worker, /Content-Security-Policy/);
  assert.match(headers, /Strict-Transport-Security/);
  assert.match(headers, /Content-Security-Policy/);

  const inlineScript = map.match(/<script>([\s\S]*)<\/script><\/body>/)?.[1];
  assert.ok(inlineScript, "map inline script must remain detectable for CSP hashing");
  const expected = `sha256-${createHash("sha256").update(inlineScript).digest("base64")}`;
  assert.match(worker, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(headers, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("includes durable multi-agent leases, v2 protocol routes, and migrations", async () => {
  const [
    schema, cloud, plan, fleet, task, ack, control, agentAction, adminClient,
    migration, pauseMigration, phoneAgent,
  ] = await Promise.all([
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("lib/cloud.ts", root), "utf8"),
    readFile(new URL("lib/scan-plans.ts", root), "utf8"),
    readFile(new URL("lib/fleet.ts", root), "utf8"),
    readFile(new URL("app/api/agent/v2/task/route.ts", root), "utf8"),
    readFile(new URL("app/api/agent/v2/ack/route.ts", root), "utf8"),
    readFile(new URL("app/api/agent/v2/control/route.ts", root), "utf8"),
    readFile(new URL("app/api/admin/agents/action/route.ts", root), "utf8"),
    readFile(new URL("app/admin/admin-client.tsx", root), "utf8"),
    readFile(new URL("drizzle/0003_fair_dragon_man.sql", root), "utf8"),
    readFile(new URL("drizzle/0005_military_red_hulk.sql", root), "utf8"),
    readFile(new URL("../phone_agent/agent.sh", root), "utf8"),
  ]);

  assert.match(schema, /scanJobs/);
  assert.match(schema, /scanLogs/);
  assert.match(schema, /scanAgents/);
  assert.match(schema, /scanTargets/);
  assert.match(cloud, /CREATE TABLE IF NOT EXISTS scan_jobs/);
  assert.match(cloud, /ADMIN_EMAILS/);
  assert.match(plan, /COUNTRY_PACK_CATALOG/);
  assert.match(plan, /name: "瑞典", region: "北歐"/);
  assert.match(plan, /name: "挪威", region: "北歐"/);
  assert.match(plan, /name: "丹麥", region: "北歐"/);
  assert.match(plan, /name: "芬蘭", region: "北歐"/);
  assert.match(plan, /name: "冰島", region: "北歐"/);
  assert.match(plan, /name: "阿拉伯聯合大公國", region: "中東"/);
  assert.match(plan, /name: "德國", region: "中歐"/);
  assert.match(plan, /name: "義大利", region: "南歐"/);
  assert.match(plan, /name: "埃及", region: "北非"/);
  assert.match(plan, /name: "哥斯大黎加", region: "中美洲"/);
  assert.match(plan, /name: "美國東部", region: "北美洲"/);
  assert.match(plan, /name: "美國中部", region: "北美洲"/);
  assert.match(plan, /name: "美國西部", region: "北美洲"/);
  assert.doesNotMatch(plan, /CITY_CHOICES|cityIds/);
  assert.match(plan, /buildScanPlan/);
  assert.match(fleet, /releaseExpiredLeases/);
  assert.match(fleet, /lease_token/);
  assert.match(fleet, /CASE country/);
  assert.match(fleet, /tags\.map\(\(_.*, index\) => `WHEN \? THEN \$\{index\}`\)/);
  assert.match(fleet, /AND country IN/);
  assert.match(fleet, /\.\.\.tags, \.\.\.tags/);
  assert.match(fleet, /rowsPerInsert = 7/);
  assert.match(fleet, /count\?\.count.*>= Number\(job\.total_points\)/);
  assert.match(task, /claimTask/);
  assert.match(ack, /completeTask/);
  assert.match(migration, /CREATE TABLE `scan_agents`/);
  assert.match(migration, /CREATE TABLE `scan_targets`/);
  assert.match(phoneAgent, /api\/agent\/v2\/task/);
  assert.match(phoneAgent, /X-Agent-Id/);
  assert.match(phoneAgent, /interruptible_wait/);
  assert.match(schema, /paused: integer\("paused"\)/);
  assert.match(fleet, /if \(agent\.paused\)/);
  assert.match(control, /if \(agent\.paused\) return plain\("pause\\n"\)/);
  assert.match(agentAction, /\["enable", "disable", "pause", "resume", "update-regions"\]/);
  assert.match(agentAction, /region_tags_json=\?/);
  assert.match(adminClient, /繼續掃描/);
  assert.match(adminClient, /套用北歐五國/);
  assert.match(pauseMigration, /ADD `paused` integer DEFAULT 0 NOT NULL/);
  assert.match(cloud, /SELECT paused FROM scan_agents LIMIT 1/);
  await access(new URL("dist/server/index.js", root));
});

test("excludes level 1 mushrooms throughout the ingest and public API paths", async () => {
  const [cloud, api, phoneAgent, hook, scanner, legacyMap] = await Promise.all([
    readFile(new URL("lib/cloud.ts", root), "utf8"),
    readFile(new URL("app/api/mushrooms/route.ts", root), "utf8"),
    readFile(new URL("../phone_agent/agent.sh", root), "utf8"),
    readFile(new URL("../module/cpp/il2cpp_dump.cpp", root), "utf8"),
    readFile(new URL("../scanner/scanner.py", root), "utf8"),
    readFile(new URL("../scanner/map.html", root), "utf8"),
  ]);

  assert.equal(MIN_MUSHROOM_LEVEL, 2);
  assert.equal(isUsefulMushroomLevel(1), false);
  assert.equal(isUsefulMushroomLevel(2), true);
  assert.equal(isUsefulMushroomLevel(4), true);
  assert.match(cloud, /isUsefulMushroomLevel\(level\)/);
  assert.match(cloud, /rows\.filter\(\(row\) => isUsefulMushroomLevel\(row\.level\)\)/);
  assert.match(api, /WHERE level >= \?/);
  assert.match(phoneAgent, /\$7 \+ 0 >= 2/);
  assert.match(hook, /should_log = level >= 2/);
  assert.match(scanner, /WHERE level>=2/);
  assert.doesNotMatch(legacyMap, /id="lv1"|mush-lv1/);
});
