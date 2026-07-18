import {
  adminAuthorized, ensureSchema, noStoreJson, runtime, sameOrigin,
} from "../../../../../lib/cloud";
import { buildScanPlan, normalizeScanConfig } from "../../../../../lib/scan-plans";
import { activeJob, appendScanLog } from "../../../../../lib/scans";
import { materializeTargets } from "../../../../../lib/fleet";

export async function POST(request: Request) {
  if (!adminAuthorized(request)) return noStoreJson({ error: "forbidden" }, 403);
  if (!sameOrigin(request)) return noStoreJson({ error: "invalid origin" }, 403);
  await ensureSchema();
  if (await activeJob()) return noStoreJson({ error: "已有掃描工作執行中" }, 409);
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return noStoreJson({ error: "invalid json" }, 400);
  }
  try {
    const config = normalizeScanConfig(input);
    const db = runtime().DB;
    const agent = await db.prepare(`SELECT current_lat, current_lng FROM scan_agents
      WHERE enabled=1 AND last_seen>? ORDER BY last_seen DESC LIMIT 1`)
      .bind(Date.now() - 15_000).first();
    const location = agent?.current_lat == null ? null :
      { lat: Number(agent.current_lat), lng: Number(agent.current_lng) };
    const { regions, targets } = buildScanPlan(config, location);
    const now = Date.now();
    const created = await db.prepare(`INSERT INTO scan_jobs (
      status, config_json, plan_json, total_points, loop, message,
      created_at, updated_at
    ) VALUES ('queued', ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .bind(JSON.stringify(config), JSON.stringify(targets), targets.length,
        config.loop ? 1 : 0, "等待手機 Agent 接手", now, now)
      .first();
    const id = Number(created?.id ?? 0);
    await materializeTargets(id, targets);
    await appendScanLog(id, "info",
      `建立分散式掃描工作：${regions.length} 城市、${targets.length} 點${config.loop ? "、持續循環" : "、單輪"}`);
    return noStoreJson({ ok: true, id, regions: regions.length, points: targets.length });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "無法建立掃描工作" }, 400);
  }
}
