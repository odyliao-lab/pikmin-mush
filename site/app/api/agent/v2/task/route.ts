import { plain, runtime } from "../../../../../lib/cloud";
import {
  agentRequestVersions, authorizeFleetAgent, claimTask, touchAgent, type ScanAgentRow,
} from "../../../../../lib/fleet";
import { versionCompatibility } from "../../../../../lib/metrics";
import { cleanTsv } from "../../../../../lib/scans";

export async function GET(request: Request) {
  const agent = await authorizeFleetAgent(request);
  if (!agent) return plain("0\tunauthorized\n", 401);
  await touchAgent(agent.id, agentRequestVersions(request));
  const refreshed = await runtime().DB.prepare("SELECT * FROM scan_agents WHERE id=?")
    .bind(agent.id).first<ScanAgentRow>() ?? agent;
  const compatibility = versionCompatibility(refreshed);
  if (!compatibility.compatible) {
    return plain(`0\tversion-mismatch\t${compatibility.reasons.join("; ")}\n`);
  }
  const task = await claimTask(refreshed);
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
