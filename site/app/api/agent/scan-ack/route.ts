import { plain, runtime } from "../../../../lib/cloud";
import {
  authorizeFleetAgent, completeTask, type ScanTargetRow,
} from "../../../../lib/fleet";

function count(value: string | null) {
  const number = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(number) ? Math.max(0, Math.min(number, 1_000_000)) : 0;
}

// v1 rolling-deployment compatibility. Resolve the hidden v2 lease from the
// sequence/cycle fields sent by older agents.
export async function POST(request: Request) {
  const agent = await authorizeFleetAgent(request);
  if (!agent) return plain("unauthorized\n", 401);
  const url = new URL(request.url);
  const jobId = count(url.searchParams.get("job_id"));
  const sequence = count(url.searchParams.get("index"));
  const cycle = count(url.searchParams.get("cycle"));
  const target = await runtime().DB.prepare(`SELECT * FROM scan_targets
    WHERE job_id=? AND sequence=? AND cycle=? AND status='leased'
      AND lease_agent_id=? ORDER BY id LIMIT 1`)
    .bind(jobId, sequence, cycle, agent.id).first<ScanTargetRow>();
  if (!target) return plain("duplicate\n");
  const result = await completeTask(agent, {
    jobId,
    targetId: target.id,
    leaseToken: target.lease_token,
    ok: url.searchParams.get("ok") === "1",
    rows: count(url.searchParams.get("rows")),
    bytes: count(url.searchParams.get("bytes")),
    message: (url.searchParams.get("message") ?? "").slice(0, 400),
  });
  return plain(result === "ok" ? "ok\n" : `${result}\n`,
    result === "missing" ? 404 : result === "stale" || result === "stop" ? 409 : 200);
}
