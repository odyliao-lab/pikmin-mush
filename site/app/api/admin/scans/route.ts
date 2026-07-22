import { adminAuthorized, ensureSchema, noStoreJson, runtime } from "../../../../lib/cloud";
import { activeOrLatestJob, publicJob } from "../../../../lib/scans";
import { publicAgent, type ScanAgentRow } from "../../../../lib/fleet";
import { rotationStatus } from "../../../../lib/rotation";

export async function GET(request: Request) {
  if (!adminAuthorized(request)) return noStoreJson({ error: "forbidden" }, 403);
  await ensureSchema();
  const db = runtime().DB;
  const rotation = await rotationStatus();
  const job = await activeOrLatestJob();
  const [agentsResult, logs, targetCounts] = await Promise.all([
    db.prepare(`SELECT * FROM scan_agents ORDER BY enabled DESC, last_seen DESC, id`)
      .all<ScanAgentRow>(),
    job ? db.prepare(`SELECT id, job_id, at, level, message FROM scan_logs
      WHERE job_id = ? ORDER BY id DESC LIMIT 120`).bind(job.id).all() :
      Promise.resolve({ results: [] }),
    job ? db.prepare(`SELECT status, COUNT(*) AS count FROM scan_targets
      WHERE job_id=? GROUP BY status`).bind(job.id).all<{ status: string; count: number }>() :
      Promise.resolve({ results: [] }),
  ]);
  const now = Date.now();
  const agents = agentsResult.results.map((agent) => publicAgent(agent, now));
  const aggregate = agents.reduce((result, agent) => ({
    online: result.online + (agent.online ? 1 : 0),
    uploaded_rows: result.uploaded_rows + agent.uploaded_rows,
    uploaded_bytes: result.uploaded_bytes + agent.uploaded_bytes,
  }), { online: 0, uploaded_rows: 0, uploaded_bytes: 0 });
  return noStoreJson({
    now,
    fleet: { total: agents.length, ...aggregate },
    agents,
    // Kept for older admin clients during rolling deployments.
    agent: agents[0] ?? {
      online: false, last_seen: 0, current_location: null,
      uploaded_rows: 0, uploaded_bytes: 0,
    },
    job: publicJob(job ?? null),
    target_counts: Object.fromEntries(targetCounts.results.map((row) =>
      [String(row.status), Number(row.count)])),
    logs: logs.results,
    rotation,
  });
}
