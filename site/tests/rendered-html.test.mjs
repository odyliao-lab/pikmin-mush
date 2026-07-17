import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(adminPage, /requireChatGPTUser\("\/admin"\)/);
  assert.match(adminPage, /isAdminEmail/);
  assert.match(adminClient, /建立掃描工作/);
  assert.match(adminClient, /api\/admin\/scans\/start/);
  assert.match(adminClient, /暫停/);
  assert.match(adminClient, /持續循環/);
  assert.match(layout, /Pikmin 蘑菇探險隊/);
});

test("includes durable scan state, agent protocol routes, and migrations", async () => {
  const [schema, cloud, plan, task, ack, migration, phoneAgent] = await Promise.all([
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("lib/cloud.ts", root), "utf8"),
    readFile(new URL("lib/scan-plans.ts", root), "utf8"),
    readFile(new URL("app/api/agent/scan-task/route.ts", root), "utf8"),
    readFile(new URL("app/api/agent/scan-ack/route.ts", root), "utf8"),
    readFile(new URL("drizzle/0002_closed_deadpool.sql", root), "utf8"),
    readFile(new URL("../phone_agent/agent.sh", root), "utf8"),
  ]);

  assert.match(schema, /scanJobs/);
  assert.match(schema, /scanLogs/);
  assert.match(cloud, /CREATE TABLE IF NOT EXISTS scan_jobs/);
  assert.match(cloud, /ADMIN_EMAILS/);
  assert.match(plan, /日本: JAPAN/);
  assert.match(plan, /buildScanPlan/);
  assert.match(task, /source: "web-admin"/);
  assert.match(ack, /current_index/);
  assert.match(migration, /CREATE TABLE `scan_jobs`/);
  assert.match(phoneAgent, /api\/agent\/scan-task/);
  assert.match(phoneAgent, /interruptible_wait/);
  await access(new URL("dist/server/index.js", root));
});
