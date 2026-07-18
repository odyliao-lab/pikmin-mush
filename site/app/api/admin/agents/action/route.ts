import {
  adminAuthorized, ensureSchema, noStoreJson, runtime, sameOrigin,
} from "../../../../../lib/cloud";

export async function POST(request: Request) {
  if (!adminAuthorized(request)) return noStoreJson({ error: "forbidden" }, 403);
  if (!sameOrigin(request)) return noStoreJson({ error: "invalid origin" }, 403);
  await ensureSchema();
  let body: { agentId?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: "invalid json" }, 400);
  }
  const agentId = String(body.agentId ?? "");
  const action = String(body.action ?? "");
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(agentId) ||
      !["enable", "disable"].includes(action)) {
    return noStoreJson({ error: "invalid action" }, 400);
  }
  const db = runtime().DB;
  const now = Date.now();
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
