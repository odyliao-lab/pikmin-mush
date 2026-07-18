import { plain } from "../../../../lib/cloud";
import { authorizeFleetAgent, claimTask, touchAgent } from "../../../../lib/fleet";
import { activeJob, cleanTsv } from "../../../../lib/scans";

// v1 rolling-deployment compatibility. It uses the same v2 lease queue but
// omits the lease fields that older phone agents do not understand.
export async function GET(request: Request) {
  const agent = await authorizeFleetAgent(request);
  if (!agent) return plain("unauthorized\n", 401);
  await touchAgent(agent.id);
  const job = await activeJob();
  if (!job) return plain("0\twait\n");
  if (job.status === "paused") return plain(`${job.id}\tpause\n`);
  const task = await claimTask(agent);
  if (!task) return plain("0\twait\n");
  return plain([
    task.job.id,
    "target",
    task.target.sequence,
    task.job.total_points,
    task.target.lat,
    task.target.lng,
    task.dwellS,
    task.hopDelayS,
    task.cooldownS,
    task.target.cycle,
    cleanTsv(task.target.country || "-"),
    cleanTsv(task.target.city),
  ].join("\t") + "\n");
}
