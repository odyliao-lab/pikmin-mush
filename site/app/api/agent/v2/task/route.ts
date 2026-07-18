import { plain } from "../../../../../lib/cloud";
import { authorizeFleetAgent, claimTask, touchAgent } from "../../../../../lib/fleet";
import { cleanTsv } from "../../../../../lib/scans";

export async function GET(request: Request) {
  const agent = await authorizeFleetAgent(request);
  if (!agent) return plain("0\tunauthorized\n", 401);
  const version = (request.headers.get("x-agent-version") ?? "").slice(0, 40);
  await touchAgent(agent.id, { version });
  const task = await claimTask(agent);
  if (!task) return plain("0\twait\n");
  return plain([
    task.job.id,
    "target",
    task.target.id,
    task.target.sequence,
    task.job.total_points,
    task.target.lat,
    task.target.lng,
    task.dwellS,
    task.hopDelayS,
    task.cooldownS,
    Number(task.target.cycle),
    task.leaseToken,
    cleanTsv(task.target.country || "-"),
    cleanTsv(task.target.city),
  ].join("\t") + "\n");
}
