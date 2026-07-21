import {
  adminAuthorized, ensureSchema, noStoreJson, runtime, sameOrigin,
} from "../../../../../lib/cloud";

export async function POST(request: Request) {
  if (!adminAuthorized(request)) return noStoreJson({ error: "forbidden" }, 403);
  if (!sameOrigin(request)) return noStoreJson({ error: "invalid origin" }, 403);
  await ensureSchema();
  let body: { agentId?: unknown; action?: unknown; regionTags?: unknown };
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: "invalid json" }, 400);
  }
  const agentId = String(body.agentId ?? "");
  const action = String(body.action ?? "");
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(agentId) ||
      !["enable", "disable", "pause", "resume", "update-regions"].includes(action)) {
    return noStoreJson({ error: "invalid action" }, 400);
  }
  const db = runtime().DB;
  const now = Date.now();

  if (action === "update-regions") {
    if (!Array.isArray(body.regionTags)) {
      return noStoreJson({ error: "區域偏好格式不正確" }, 400);
    }
    const regionTags = [...new Set(body.regionTags
      .map(String).map((value) => value.trim()).filter(Boolean))]
      .slice(0, 40);
    if (regionTags.some((value) => value.length > 48)) {
      return noStoreJson({ error: "單一國家名稱不可超過 48 個字元" }, 400);
    }
    const result = await db.prepare(
      "UPDATE scan_agents SET region_tags_json=?, updated_at=? WHERE id=?",
    ).bind(JSON.stringify(regionTags), now, agentId).run();
    if (!result.meta.changes) return noStoreJson({ error: "Agent 不存在" }, 404);
    return noStoreJson({ ok: true, region_tags: regionTags });
  }

  // 暫停／繼續掃描：只切換 paused 旗標，保留憑證與 lease；Agent 仍在線但停止派工，
  // 進行中的掃描會在下一次 control polling 收到 pause 而停下（見 v2/control）。
  if (action === "pause" || action === "resume") {
    const paused = action === "pause" ? 1 : 0;
    const result = await db.prepare(
      "UPDATE scan_agents SET paused=?, updated_at=? WHERE id=?",
    ).bind(paused, now, agentId).run();
    if (!result.meta.changes) return noStoreJson({ error: "Agent 不存在" }, 404);
    return noStoreJson({ ok: true, paused: Boolean(paused) });
  }

  // 啟用／停用節點：停用等同除役，會立即釋放其 lease。
  const enabled = action === "enable" ? 1 : 0;
  const result = await db.prepare("UPDATE scan_agents SET enabled=?, updated_at=? WHERE id=?")
    .bind(enabled, now, agentId).run();
  if (!result.meta.changes) return noStoreJson({ error: "Agent 不存在" }, 404);
  if (!enabled) {
    await db.batch([
      db.prepare(`UPDATE scan_targets SET status='queued', lease_agent_id='',
        lease_token='', lease_expires_at=0, updated_at=?
        WHERE status='leased' AND lease_agent_id=?`).bind(now, agentId),
      db.prepare(`UPDATE scan_agents SET current_job_id=NULL, current_target_id=NULL
        WHERE id=?`).bind(agentId),
    ]);
  }
  return noStoreJson({ ok: true, enabled: Boolean(enabled) });
}
