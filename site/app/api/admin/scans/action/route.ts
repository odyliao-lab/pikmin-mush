import {
  adminAuthorized, ensureSchema, noStoreJson, runtime, sameOrigin,
} from "../../../../../lib/cloud";
import { appendScanLog } from "../../../../../lib/scans";

export async function POST(request: Request) {
  if (!adminAuthorized(request)) return noStoreJson({ error: "forbidden" }, 403);
  if (!sameOrigin(request)) return noStoreJson({ error: "invalid origin" }, 403);
  await ensureSchema();
  let body: { jobId?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: "invalid json" }, 400);
  }
  const jobId = Number(body.jobId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(jobId) || !["pause", "resume", "stop"].includes(action)) {
    return noStoreJson({ error: "invalid action" }, 400);
  }
  const db = runtime().DB;
  const now = Date.now();
  const nextStatus = action === "pause" ? "paused" :
    action === "resume" ? "running" : "cancelled";
  const allowed = action === "pause" ? ["queued", "running"] :
    action === "resume" ? ["paused"] : ["queued", "running", "paused"];
  const placeholders = allowed.map(() => "?").join(",");
  const result = await db.prepare(`UPDATE scan_jobs SET
      status = ?, updated_at = ?, finished_at = CASE WHEN ? = 'cancelled' THEN ? ELSE finished_at END,
      message = ?
    WHERE id = ? AND status IN (${placeholders})`)
    .bind(nextStatus, now, nextStatus, now,
      action === "pause" ? "已暫停，續跑時會重試目前座標" :
        action === "resume" ? "已要求手機繼續掃描" : "已停止掃描",
      jobId, ...allowed)
    .run();
  if (!result.meta.changes) return noStoreJson({ error: "工作狀態已變更，請重新整理" }, 409);
  if (action === "stop") {
    await db.batch([
      db.prepare(`UPDATE scan_targets SET status='cancelled', lease_agent_id='',
        lease_token='', lease_expires_at=0, updated_at=?
        WHERE job_id=? AND status IN ('queued','leased')`).bind(now, jobId),
      db.prepare(`UPDATE scan_agents SET current_job_id=NULL, current_target_id=NULL,
        updated_at=? WHERE current_job_id=?`).bind(now, jobId),
    ]);
  }
  await appendScanLog(jobId, "info",
    action === "pause" ? "後台暫停掃描" : action === "resume" ? "後台繼續掃描" : "後台停止掃描");
  const status = {
    running: nextStatus === "running",
    last_msg: action === "pause" ? "掃描已暫停" :
      action === "resume" ? "掃描準備繼續" : "掃描已停止",
  };
  await db.prepare("UPDATE scanner_status SET status_json = ?, updated_at = ? WHERE id = 1")
    .bind(JSON.stringify(status), Math.floor(now / 1000)).run();
  return noStoreJson({ ok: true, status: nextStatus });
}
