import { ensureSchema, noStoreJson, runtime } from "../../../lib/cloud";
import { publicAgent, type ScanAgentRow } from "../../../lib/fleet";

export async function GET() {
  await ensureSchema();
  const now = Date.now();
  const db = runtime().DB;
  const [mushrooms, agentsResult, scanner] = await Promise.all([
    db.prepare(`SELECT id, lat, lng, level, type, cluster, cooldown,
      finish_ms, first_seen, last_seen, challenger_count,
      challenger_capacity, total_power, start_ms
      FROM mushrooms WHERE finish_ms = 0 OR finish_ms > ?`)
      .bind(now).all(),
    db.prepare("SELECT * FROM scan_agents WHERE enabled=1 ORDER BY last_seen DESC")
      .all<ScanAgentRow>(),
    db.prepare("SELECT status_json, updated_at FROM scanner_status WHERE id = 1").first(),
  ]);
  let status: Record<string, unknown> = {};
  try {
    status = JSON.parse(String(scanner?.status_json ?? "{}"));
  } catch {
    status = {};
  }
  const agents = agentsResult.results.map((agent) => publicAgent(agent, now));
  const primary = agents.find((agent) => agent.id === "primary") ?? agents[0];
  const totals = agents.reduce((value, agent) => ({
    rows: value.rows + agent.uploaded_rows,
    bytes: value.bytes + agent.uploaded_bytes,
  }), { rows: 0, bytes: 0 });
  return noStoreJson({
    updated: Math.floor(now / 1000),
    count: mushrooms.results.length,
    status: {
      ...status,
      cloud_updated_at: Number(scanner?.updated_at ?? 0),
    },
    agent: {
      backend: "agent-cloud-v2",
      online: agents.some((agent) => agent.online),
      online_count: agents.filter((agent) => agent.online).length,
      total_count: agents.length,
      last_seen: Math.floor(Number(primary?.last_seen ?? 0) / 1000),
      uploaded_rows: totals.rows,
      uploaded_bytes: totals.bytes,
      current_location: primary?.current_location ?? null,
    },
    agents,
    mushrooms: mushrooms.results,
  });
}
