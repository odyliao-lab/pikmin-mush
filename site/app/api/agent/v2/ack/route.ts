import { plain } from "../../../../../lib/cloud";
import { scanEvidence } from "../../../../../lib/scan-evidence.mjs";
import { scanInteger } from "../../../../../lib/scan-identifiers.mjs";
import {
  agentRequestVersions, authorizeFleetAgent, completeTask, touchAgent,
} from "../../../../../lib/fleet";

function count(value: string | null) {
  const number = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(number) ? Math.max(0, Math.min(number, 1_000_000)) : 0;
}

export async function POST(request: Request) {
  const agent = await authorizeFleetAgent(request);
  if (!agent) return plain("unauthorized\n", 401);
  const versions = agentRequestVersions(request);
  await touchAgent(agent.id, versions);
  const url = new URL(request.url);
  const jobId = scanInteger(url.searchParams.get("job_id"));
  const targetId = scanInteger(url.searchParams.get("target_id"));
  if (jobId === null || targetId === null) return plain("invalid_id\n", 400);
  const result = await completeTask(agent, {
    jobId,
    targetId,
    leaseToken: url.searchParams.get("lease") ?? "",
    ok: url.searchParams.get("ok") === "1",
    rows: count(url.searchParams.get("rows")),
    bytes: count(url.searchParams.get("bytes")),
    message: (url.searchParams.get("message") ?? "").slice(0, 400),
    outcome: (url.searchParams.get("outcome") ?? "").slice(0, 32),
    evidence: scanEvidence(url.searchParams, versions.pendingBytes),
  });
  const status = result === "missing" ? 404 :
    result === "stale" || result === "stop" ? 409 : 200;
  return plain(`${result}\n`, status);
}
