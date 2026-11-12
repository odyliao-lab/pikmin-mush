import { adminAuthorized, ensureSchema, noStoreJson, runtime } from "../../../../lib/cloud";
import { activeOrLatestJob, publicJob } from "../../../../lib/scans";
import { publicAgent, type ScanAgentRow } from "../../../../lib/fleet";
import { rotationStatus } from "../../../../lib/rotation";
import { parseTargetAckEvidence, readTargetAckEvidence } from "../../../../lib/target-ack-evidence.mjs";

export async function GET(request: Request) {
  if (!adminAuthorized(request)) return noStoreJson({ error: "forbidden" }, 403);
  await ensureSchema();
  const db = runtime().DB;
  const params=new URL(request.url).searchParams;
  if(params.has('evidence_targets')) {
    let query;
    try {query=parseTargetAckEvidence(params);}
    catch {return noStoreJson({error:'invalid target evidence query'},400);}
    try {return noStoreJson(await readTargetAckEvidence(db,query));}
    catch {return noStoreJson({error:'target evidence temporarily unavailable'},503);}
  }
  // Legacy callers still receive logs; the compact UI opts out until expanded.
  const includeLogs=new URL(request.url).searchParams.get('logs')!=='0';
  // A rotation rebuild may temporarily fail while a large target queue is being
  // materialized. Keep fleet health and recovery controls available instead of
  // turning the entire admin dashboard into an empty state.
  let rotation;
  try {
    rotation = await rotationStatus();
  } catch (error) {
    rotation = {
      enabled: true,
      timezone: "Asia/Taipei",
      switch_minute: 450,
      schedule_date: "",
      next_switch_at: 0,
      status: "failed",
      job_id: null,
      assignments: [],
      message: error instanceof Error ? error.message : "每日換區狀態讀取失敗",
    };
  }
  const job = await activeOrLatestJob();
  const [agentsResult, logs, targetCounts] = await Promise.all([
    db.prepare(`SELECT a.*, t.country AS target_country, t.city AS target_city
      FROM scan_agents a LEFT JOIN scan_targets t ON t.id=a.current_target_id
        AND t.job_id=a.current_job_id AND t.lease_agent_id=a.id
        AND t.status='leased' AND t.lease_expires_at>?
      ORDER BY a.enabled DESC, a.last_seen DESC, a.id`).bind(Date.now())
      .all<ScanAgentRow & {target_country:string|null;target_city:string|null}>(),
    job && includeLogs ? db.prepare(`SELECT id, job_id, at, level, message FROM scan_logs
      WHERE job_id = ? ORDER BY id DESC LIMIT 120`).bind(job.id).all() :
      Promise.resolve({ results: [] }),
    job ? db.prepare(`SELECT status, COUNT(*) AS count FROM scan_targets
      WHERE job_id=? GROUP BY status`).bind(job.id).all<{ status: string; count: number }>() :
      Promise.resolve({ results: [] }),
  ]);
  const now = Date.now();
  const agents = agentsResult.results.map((agent) => ({...publicAgent(agent, now),
    current_country:agent.target_country??'',current_city:agent.target_city??''}));
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
