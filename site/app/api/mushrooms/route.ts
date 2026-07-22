import { ensureSchema, noStoreJson, runtime } from "../../../lib/cloud";
import { publicAgent, type ScanAgentRow } from "../../../lib/fleet";
import { MIN_MUSHROOM_LEVEL } from "../../../lib/mushroom-policy.mjs";

export async function GET() {
  await ensureSchema();
  const now = Date.now();
  const db = runtime().DB;
  const [mushrooms, agentsResult, scanner] = await Promise.all([
    db.prepare(`SELECT id, lat, lng, level, type, cluster, cooldown,
      finish_ms, first_seen, last_seen, challenger_count,
      challenger_capacity, total_power, start_ms
      FROM mushrooms
      WHERE level >= ? AND (finish_ms = 0 OR finish_ms > ?)`)
      .bind(MIN_MUSHROOM_LEVEL, now).all(),
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
  const publicStatus = {
    running: Boolean(status.running),
    point: Number(status.point ?? 0),
    total: Number(status.total ?? 0),
    captured_total: Number(status.captured_total ?? 0),
    new_at_point: Number(status.new_at_point ?? 0),
    city: String(status.city ?? "").slice(0, 96),
    country: String(status.country ?? "").slice(0, 96),
    city_index: Number(status.city_index ?? 0),
    city_total: Number(status.city_total ?? 0),
    cycle: Number(status.cycle ?? 0),
    source: String(status.source ?? "").slice(0, 48),
  };
  const agents = agentsResult.results.map((agent) => publicAgent(agent, now));
  const publicMushrooms = mushrooms.results.map((mushroom) => {
    const firstSeen = Number(mushroom.first_seen ?? 0);
    const challengeStarted = Math.floor(Number(mushroom.start_ms ?? 0) / 1000);
    return {
      ...mushroom,
      // Older rows kept the first time this POI was ever observed. A newer
      // challenge at the same POI must sort and notify as a new discovery.
      discovered_at: Math.max(firstSeen, challengeStarted),
    };
  });
  return noStoreJson({
    updated: Math.floor(now / 1000),
    count: publicMushrooms.length,
    status: {
      ...publicStatus,
      cloud_updated_at: Number(scanner?.updated_at ?? 0),
    },
    agent: {
      backend: "agent-cloud-v2",
      online: agents.some((agent) => agent.online),
      online_count: agents.filter((agent) => agent.online).length,
      total_count: agents.length,
    },
    mushrooms: publicMushrooms,
  });
}
