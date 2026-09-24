import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { Script } from "node:vm";
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
  assert.match(map, /EVENT_TYPE_IDS=new Set\(\['10','14','15','16','19','20','21','22','23','24','25'\]\)/);
  assert.match(map, /DEFAULT_HIDDEN_TYPE_KEYS=new Set\(\['event'\]\)/);
  assert.match(map, /selectedTypes\.has\(typeKey\(m\.type\)\)/);
  assert.match(map, /integrity="sha256-/);
  assert.match(map, /rel="noopener noreferrer"/);
  assert.doesNotMatch(map, /onclick=/);
  assert.match(adminPage, /requireChatGPTUser\("\/admin"\)/);
  assert.match(adminPage, /isAdminEmail/);
  assert.match(adminClient, /建立掃描工作/);
  assert.match(adminClient, /api\/admin\/scans\/start/);
  assert.match(adminClient, /api\/admin\/rotation\/redeploy/);
  assert.match(adminClient, /立即換區/);
  assert.match(adminClient, /暫停/);
  assert.match(adminClient, /持續循環/);
  assert.match(adminClient, /全球掃描節點/);
  assert.match(adminClient, /api\/admin\/agents\/enroll/);
  assert.doesNotMatch(adminClient, /獨立主要城市|CITY_CHOICES|cityIds/);
  assert.match(adminClient, /COUNTRY_PACK_GROUPS/);
  assert.match(adminClient, /<details className=\{styles\.packDisclosure\}>/);
  assert.doesNotMatch(adminClient, /<details className=\{styles\.packDisclosure\}\s+open/);
  assert.match(adminClient, /已選 \$\{packs\.length\} 個城市包/);
  assert.match(layout, /Pikmin 蘑菇探險隊/);
});

test("hardens uploads, public telemetry, controller credentials, and browser policy", async () => {
  const [upload, publicApi, eventSpotsApi, eventSpots, cloud, controller, phoneAgent, worker, map, eventSpotsPage, headers] = await Promise.all([
    readFile(new URL("app/api/agent/upload/route.ts", root), "utf8"),
    readFile(new URL("app/api/mushrooms/route.ts", root), "utf8"),
    readFile(new URL("app/api/event-spots/route.ts", root), "utf8"),
    readFile(new URL("lib/event-spots.ts", root), "utf8"),
    readFile(new URL("lib/cloud.ts", root), "utf8"),
    readFile(new URL("app/api/controller/command/route.ts", root), "utf8"),
    readFile(new URL("../phone_agent/agent.sh", root), "utf8"),
    readFile(new URL("worker/index.ts", root), "utf8"),
    readFile(new URL("public/map.html", root), "utf8"),
    readFile(new URL("public/event-spots.html", root), "utf8"),
    readFile(new URL("public/_headers", root), "utf8"),
  ]);

  assert.match(cloud, /request\.body\.getReader\(\)/);
  assert.match(cloud, /readBoundedUtf8/);
  assert.match(upload, /MAX_UPLOAD_BYTES = 512_000/);
  assert.match(upload, /MAX_PARTIAL_BYTES = 64_000/);
  assert.doesNotMatch(upload, /request\.text\(\)/);
  assert.doesNotMatch(publicApi, /\bagents,\s*\n/);
  assert.match(publicApi, /live_agents: liveAgents/);
  assert.match(publicApi, /Public map markers expose the assigned scan target/);
  assert.match(publicApi, /SELECT id, lat, lng, country, city FROM scan_targets/);
  assert.match(map, /renderLiveAgents/);
  assert.match(map, /agent-marker/);
  assert.match(publicApi, /const publicStatus =/);
  assert.match(cloud, /CONTROLLER_TOKEN/);
  assert.match(controller, /controllerAuthorized/);
  assert.match(phoneAgent, /MAX_UPLOAD_CHUNK_BYTES=262144/);
  assert.match(worker, /Strict-Transport-Security/);
  assert.match(worker, /Content-Security-Policy/);
  assert.match(headers, /Strict-Transport-Security/);
  assert.match(headers, /Content-Security-Policy/);
  assert.match(eventSpotsApi, /ensureSchema/);
  assert.match(eventSpotsApi, /\["active", "all", "ended"\]\.includes\(requestedStatus\)/);
  assert.match(eventSpots, /jp-nintendo-tokyo/);
  assert.match(eventSpots, /jp-miyajima-sa-shop/);
  assert.match(eventSpots, /us-seattle-pax-red-badge/);
  const catalogueUrl = new URL(eventSpots.match(/const sourceUrl = "([^"]+)"/)?.[1]);
  assert.equal(catalogueUrl.protocol, "https:");
  assert.equal(catalogueUrl.hostname, "collectworldmap.pixnet.net");
  assert.match(eventSpotsPage, /活動金盆地圖/);
  assert.match(eventSpotsPage, /api\/event-spots/);
  assert.match(eventSpotsPage, /data-copy=/);

  for (const [name, html] of [["map", map], ["event spots", eventSpotsPage]]) {
    const inlineScript = html.match(/<script>([\s\S]*)<\/script><\/body>/)?.[1];
    assert.ok(inlineScript, `${name} inline script must remain detectable for CSP hashing`);
    const expected = `sha256-${createHash("sha256")
      .update(inlineScript.replace(/\r\n/g, "\n")).digest("base64")}`;
    assert.doesNotThrow(() => new Script(inlineScript));
    assert.ok(html.includes('http-equiv="Content-Security-Policy"'));
    assert.ok(html.includes(expected), `${name} static clean URL needs its own CSP fallback`);
    assert.match(worker, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(headers, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("includes durable multi-agent leases, v2 protocol routes, and migrations", async () => {
  const [
    schema, cloud, plan, fleet, task, ack, control, verification, agentAction, adminClient,
    migration, pauseMigration, rotationMigration, phoneAgent, rotation, targets,
  ] = await Promise.all([
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("lib/cloud.ts", root), "utf8"),
    readFile(new URL("lib/scan-plans.ts", root), "utf8"),
    readFile(new URL("lib/fleet.ts", root), "utf8"),
    readFile(new URL("app/api/agent/v2/task/route.ts", root), "utf8"),
    readFile(new URL("app/api/agent/v2/ack/route.ts", root), "utf8"),
    readFile(new URL("app/api/agent/v2/control/route.ts", root), "utf8"),
    readFile(new URL("app/api/controller/verification/route.ts", root), "utf8"),
    readFile(new URL("app/api/admin/agents/action/route.ts", root), "utf8"),
    readFile(new URL("app/admin/admin-client.tsx", root), "utf8"),
    readFile(new URL("drizzle/0003_fair_dragon_man.sql", root), "utf8"),
    readFile(new URL("drizzle/0005_military_red_hulk.sql", root), "utf8"),
    readFile(new URL("drizzle/0006_naive_triton.sql", root), "utf8"),
    readFile(new URL("../phone_agent/agent.sh", root), "utf8"),
    readFile(new URL("lib/rotation.ts", root), "utf8"),
    readFile(new URL("lib/targets.ts", root), "utf8"),
  ]);

  assert.match(schema, /scanJobs/);
  assert.match(schema, /scanLogs/);
  assert.match(schema, /scanAgents/);
  assert.match(schema, /scanTargets/);
  assert.match(cloud, /CREATE TABLE IF NOT EXISTS scan_jobs/);
  assert.match(cloud, /async function probeSchema/);
  assert.match(cloud, /let schemaReady: Promise<void> \| null = null/);
  assert.match(cloud, /transient D1 failure must fail this request/);
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
  assert.match(plan, /scanProfile: "global" \| "precision"/);
  assert.match(plan, /gridPhaseForCycle/);
  assert.match(plan, /\[0\.5, 0\.5\]/);
  assert.match(fleet, /releaseExpiredLeases/);
  assert.match(fleet, /const LEASE_MS = 12 \* 60_000/);
  assert.match(fleet, /lease_token/);
  assert.match(fleet, /CASE country/);
  assert.match(fleet, /tags\.map\(\(_.*, index\) => `WHEN \? THEN \$\{index\}`\)/);
  assert.match(fleet, /AND country IN/);
  assert.match(fleet, /\.\.\.tags, \.\.\.tags/);
  assert.match(targets, /rowsPerInsert = 7/);
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
  assert.match(fleet, /rotation\.status !== "completed"/);
  assert.match(control, /if \(agent\.paused\) return plain\("pause\\n"\)/);
  assert.match(verification, /replaceExisting/);
  assert.match(verification, /DELETE FROM scan_targets WHERE verification_batch=\?/);
  assert.match(agentAction, /"rotate-token", "revoke-old-token"/);
  assert.match(agentAction, /region_tags_json=\?/);
  assert.match(agentAction, /每日自動換區已啟用/);
  assert.match(adminClient, /繼續掃描/);
  assert.match(adminClient, /套用北歐五國/);
  assert.match(adminClient, /尚未取得有效資料，不會以 0 筆或 0 台 Agent 代替/);
  assert.match(adminClient, /目前保留最近一次成功結果/);
  assert.match(pauseMigration, /ADD `paused` integer DEFAULT 0 NOT NULL/);
  assert.match(rotationMigration, /CREATE TABLE `scan_rotation_runs`/);
  assert.match(cloud, /SELECT paused FROM scan_agents LIMIT 1/);
  assert.match(schema, /scanRotationSettings/);
  assert.match(schema, /scanRotationRuns/);
  assert.match(cloud, /CREATE TABLE IF NOT EXISTS scan_rotation_runs/);
  assert.match(rotation, /ensureDailyRotation/);
  assert.match(rotation, /scanProfile: "global"/);
  assert.match(fleet, /buildScanPlan\(config, null, \{ cycle: nextCycle \}\)/);
  assert.match(fleet, /1km 偏移網格/);
  assert.match(rotation, /每日 04:00.*每日 12:00.*每日 20:00/s);
  assert.match(rotation, /SELECT \* FROM scan_rotation_runs WHERE schedule_date=\?/);
  assert.match(rotation, /30 \* 60_000/);
  assert.match(rotation, /existingPlan/);
  assert.match(rotation, /expectedPlan/);
  assert.match(rotation, /verification_kind='candidate'.*status IN \('queued','leased'\)/s);
  await access(new URL("dist/server/index.js", root));
});

test("adds fleet metrics, viewport pagination, version gates, and safe token rotation", async () => {
  const [
    schema, migration, metrics, metricsRoute, mushroomsApi, map, fleet,
    agentAction, adminClient, phoneAgent,
  ] = await Promise.all([
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("drizzle/0007_condemned_nekra.sql", root), "utf8"),
    readFile(new URL("lib/metrics.ts", root), "utf8"),
    readFile(new URL("app/api/admin/metrics/route.ts", root), "utf8"),
    readFile(new URL("app/api/mushrooms/route.ts", root), "utf8"),
    readFile(new URL("public/map.html", root), "utf8"),
    readFile(new URL("lib/fleet.ts", root), "utf8"),
    readFile(new URL("app/api/admin/agents/action/route.ts", root), "utf8"),
    readFile(new URL("app/admin/admin-client.tsx", root), "utf8"),
    readFile(new URL("../phone_agent/agent.sh", root), "utf8"),
  ]);

  assert.match(schema, /scanAgentEvents/);
  assert.match(schema, /previousTokenExpiresAt/);
  assert.match(migration, /CREATE TABLE `scan_agent_events`/);
  assert.match(migration, /ADD `completed_agent_id`/);
  assert.match(metrics, /buildSoakReport/);
  assert.match(metrics, /NO_DATA_WARN_STREAK = 12/);
  assert.match(metrics, /SUPPORTED_GAME_VERSIONS = \["149\.0", "150\.0", "151\.0", "152\.0", "153\.0"\]/);
  assert.match(metrics, /moduleVersion !== gameVersion/);
  assert.match(metricsRoute, /adminAuthorized/);
  assert.match(metricsRoute, /buildSoakReport/);
  assert.match(mushroomsApi, /parseBbox/);
  assert.match(mushroomsApi, /decodeCursor/);
  assert.match(mushroomsApi, /mode: "cursor"/);
  assert.doesNotMatch(mushroomsApi, /legacy-full/);
  assert.match(mushroomsApi, /MAX_PAGE_SIZE = 1_000/);
  assert.match(map, /viewportBbox/);
  assert.match(map, /MAX_VIEW_ROWS=3000/);
  assert.match(map, /map\.on\('moveend'/);
  assert.match(map, /AbortController/);
  assert.match(fleet, /previous_token_expires_at.*Date\.now\(\)/s);
  assert.match(fleet, /versionCompatibility/);
  assert.match(agentAction, /previous_token_hash/);
  assert.match(agentAction, /24 \* 60 \* 60_000/);
  assert.match(adminClient, /24 小時穩定度與無資料偵測/);
  assert.match(adminClient, /本輪 Agent 實際效率報告/);
  assert.match(adminClient, /api\/admin\/scans\/report/);
  assert.match(metrics, /buildJobEfficiencyReport/);
  assert.match(adminClient, /換發 Token/);
  assert.match(phoneAgent, /X-Game-Version/);
  assert.match(phoneAgent, /X-Module-Version/);
  assert.match(phoneAgent, /version-mismatch/);
});

test("bounds mushroom retention without making concurrent uploads purge repeatedly", async () => {
  const [schema, cloud, upload, publicApi, migration] = await Promise.all([
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("lib/cloud.ts", root), "utf8"),
    readFile(new URL("app/api/agent/upload/route.ts", root), "utf8"),
    readFile(new URL("app/api/mushrooms/route.ts", root), "utf8"),
    readFile(new URL("drizzle/0009_mushroom_retention.sql", root), "utf8"),
  ]);

  assert.match(schema, /maintenanceState/);
  assert.match(schema, /mushrooms_last_seen_id_idx/);
  assert.match(cloud, /MUSHROOM_RETENTION_SECONDS = 7 \* 24 \* 60 \* 60/);
  assert.match(cloud, /LEVEL_TWO_THREE_INVALID_AFTER_SECONDS = 2 \* 24 \* 60 \* 60/);
  assert.match(cloud, /SET mushroom_status='invalid', invalidated_at=\?/);
  assert.match(cloud, /level IN \(2, 3\) AND first_seen < \?/);
  assert.match(cloud, /MUSHROOM_RETENTION_INTERVAL_SECONDS = 5 \* 60/);
  assert.match(cloud, /UPDATE maintenance_state[\s\S]*last_run_at<\?/);
  assert.match(cloud, /DELETE FROM mushrooms WHERE id IN/);
  assert.match(cloud, /MUSHROOM_RETENTION_BATCH_SIZE/);
  assert.match(cloud, /MUSHROOM_INVALIDATION_BATCH_SIZE = 250/);
  assert.match(cloud, /MUSHROOM_HISTORY_BATCH_SIZE = 500/);
  assert.doesNotMatch(cloud, /waitUntil\(runMushroomRetention\(\)/);
  assert.doesNotMatch(upload, /scheduleMushroomRetention\(\)/);
  assert.match(upload, /scheduleRetentionEmergencyFallback\(\)/);
  assert.doesNotMatch(upload, /await runMushroomRetention\(\)/);
  assert.match(publicApi, /await readMushroomRetentionStatus\(\)/);
  assert.doesNotMatch(publicApi, /scheduleMushroomRetention\(\)/);
  assert.doesNotMatch(publicApi, /scheduleRetentionEmergencyFallback\(\)/);
  assert.doesNotMatch(publicApi, /await runMushroomRetention\(\)/);
  assert.match(publicApi, /policy_days: 7/);
  assert.match(publicApi, /level_2_3_inactive_after_days: 2/);
  assert.match(publicApi, /mushroom_status='active'/);
  assert.match(migration, /CREATE INDEX `mushrooms_last_seen_id_idx`/);
  assert.match(migration, /CREATE TABLE `maintenance_state`/);
});

test("defaults the public map to mushrooms with fewer than five participants", async () => {
  const map = await readFile(new URL("public/map.html", root), "utf8");
  assert.match(map, /id="under-five-only" checked> 僅列出未滿 5 人/);
  assert.match(map, /function isUnderFive\(m\)/);
  assert.match(map, /!underFiveOnly\|\|isUnderFive\(m\)/);
});

test("records privacy-preserving public-usage telemetry for the protected console", async () => {
  const [schema, cloud, audit, copyRoute, eventRoute, adminRoute, adminClient, map, migration, usageMigration] = await Promise.all([
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("lib/cloud.ts", root), "utf8"),
    readFile(new URL("lib/copy-audit.ts", root), "utf8"),
    readFile(new URL("app/api/audit/copy/route.ts", root), "utf8"),
    readFile(new URL("app/api/audit/event/route.ts", root), "utf8"),
    readFile(new URL("app/api/admin/copy-audit/route.ts", root), "utf8"),
    readFile(new URL("app/admin/admin-client.tsx", root), "utf8"),
    readFile(new URL("public/map.html", root), "utf8"),
    readFile(new URL("drizzle/0013_copy_audit_events.sql", root), "utf8"),
    readFile(new URL("drizzle/0014_public_usage_events.sql", root), "utf8"),
  ]);
  assert.match(schema, /copyAuditEvents/);
  assert.match(schema, /publicUsageEvents/);
  assert.match(cloud, /COPY_AUDIT_HASH_KEY/);
  assert.match(cloud, /CREATE TABLE IF NOT EXISTS copy_audit_events/);
  assert.match(audit, /CF-Connecting-IP/);
  assert.match(audit, /SHA-256/);
  assert.match(audit, /COPY_AUDIT_RETENTION_SECONDS = 30/);
  assert.doesNotMatch(audit, /INSERT[\s\S]*cf-connecting-ip/i);
  assert.match(copyRoute, /sameOrigin/);
  assert.match(copyRoute, /readBoundedUtf8/);
  assert.match(copyRoute, /SELECT id FROM mushrooms WHERE id=\?/);
  assert.match(eventRoute, /map_focus/);
  assert.match(eventRoute, /sameOrigin/);
  assert.match(adminRoute, /adminAuthorized/);
  assert.match(adminClient, /GPS 複製紀錄/);
  assert.match(map, /api\/audit\/copy/);
  assert.match(map, /api\/audit\/event/);
  assert.match(map, /daily_active_sources|page_view|map_focus/);
  assert.match(map, /data-id=/);
  assert.match(migration, /CREATE TABLE `copy_audit_events`/);
  assert.match(migration, /CREATE UNIQUE INDEX `copy_audit_events_bucket_uidx`/);
  assert.match(usageMigration, /CREATE TABLE `public_usage_events`/);
});

test("shows the Agent that discovered a mushroom without guessing legacy sources", async () => {
  const [schema, cloud, upload, publicApi, map, migration] = await Promise.all([
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("lib/cloud.ts", root), "utf8"),
    readFile(new URL("app/api/agent/upload/route.ts", root), "utf8"),
    readFile(new URL("app/api/mushrooms/route.ts", root), "utf8"),
    readFile(new URL("public/map.html", root), "utf8"),
    readFile(new URL("drizzle/0010_glossy_corsair.sql", root), "utf8"),
  ]);

  assert.match(schema, /discoveredByAgentId/);
  assert.match(cloud, /discovered_by_agent_id/);
  assert.match(upload, /upsertMushrooms\(rows, agent\.id, agent\.current_target_id\)/);
  assert.match(publicApi, /discovered_by:/);
  assert.match(map, /function discoveredBy\(m\)/);
  assert.match(map, /來源未記錄/);
  assert.match(migration, /discovered_by_agent_id/);
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
  assert.match(api, /"level >= \?"/);
  assert.match(phoneAgent, /\$7 \+ 0 >= 2/);
  assert.match(hook, /should_log = level >= 2/);
  assert.match(scanner, /WHERE level>=2/);
  assert.doesNotMatch(legacyMap, /id="lv1"|mush-lv1/);
});
