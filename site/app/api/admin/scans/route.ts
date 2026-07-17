import { adminAuthorized, ensureSchema, noStoreJson, runtime } from "../../../../lib/cloud";
import { activeOrLatestJob, publicJob } from "../../../../lib/scans";

export async function GET(request: Request) {
  if (!adminAuthorized(request)) return noStoreJson({ error: "forbidden" }, 403);
  await ensureSchema();
  const db = runtime().DB;
  const job = await activeOrLatestJob();
  const [agent, logs] = await Promise.all([
    db.prepare(`SELECT last_seen, current_lat, current_lng, uploaded_rows,
      uploaded_bytes FROM agent_state WHERE id = 1`).first(),
    job ? db.prepare(`SELECT id, job_id, at, level, message FROM scan_logs
      WHERE job_id = ? ORDER BY id DESC LIMIT 120`).bind(job.id).all() :
      Promise.resolve({ results: [] }),
  ]);
  const lastSeen = Number(agent?.last_seen ?? 0);
  return noStoreJson({
    now: Date.now(),
    agent: {
      online: Date.now() - lastSeen < 12_000,
      last_seen: lastSeen,
      current_location: agent?.current_lat == null ? null :
        [Number(agent.current_lat), Number(agent.current_lng)],
      uploaded_rows: Number(agent?.uploaded_rows ?? 0),
      uploaded_bytes: Number(agent?.uploaded_bytes ?? 0),
    },
    job: publicJob(job ?? null),
    logs: logs.results,
  });
}
