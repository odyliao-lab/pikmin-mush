import { plain } from "../../../../../lib/cloud";
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
  await touchAgent(agent.id, agentRequestVersions(request));
  const url = new URL(request.url);
  const result = await completeTask(agent, {
    jobId: count(url.searchParams.get("job_id")),
    targetId: count(url.searchParams.get("target_id")),
    leaseToken: url.searchParams.get("lease") ?? "",
    ok: url.searchParams.get("ok") === "1",
    rows: count(url.searchParams.get("rows")),
    bytes: count(url.searchParams.get("bytes")),
    message: (url.searchParams.get("message") ?? "").slice(0, 400),
  });
  const status = result === "missing" ? 404 :
    result === "stale" || result === "stop" ? 409 : 200;
  return plain(`${result}\n`, status);
}
