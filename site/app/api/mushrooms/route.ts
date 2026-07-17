import { ensureSchema, noStoreJson, runtime } from "../../../lib/cloud";

export async function GET() {
  await ensureSchema();
  const now = Date.now();
  const db = runtime().DB;
  const [mushrooms, agent, scanner] = await Promise.all([
    db.prepare(`SELECT id, lat, lng, level, type, cluster, cooldown,
      finish_ms, first_seen, last_seen, challenger_count,
      challenger_capacity, total_power, start_ms
      FROM mushrooms WHERE finish_ms = 0 OR finish_ms > ?`)
      .bind(now).all(),
    db.prepare(`SELECT last_seen, current_lat, current_lng,
      uploaded_rows, uploaded_bytes FROM agent_state WHERE id = 1`).first(),
    db.prepare("SELECT status_json, updated_at FROM scanner_status WHERE id = 1").first(),
  ]);
  let status: Record<string, unknown> = {};
  try {
    status = JSON.parse(String(scanner?.status_json ?? "{}"));
  } catch {
    status = {};
  }
  const lastSeen = Number(agent?.last_seen ?? 0);
  return noStoreJson({
    updated: Math.floor(now / 1000),
    count: mushrooms.results.length,
    status: {
      ...status,
      cloud_updated_at: Number(scanner?.updated_at ?? 0),
    },
    agent: {
      backend: "agent-cloud",
      online: now - lastSeen < 12_000,
      last_seen: Math.floor(lastSeen / 1000),
      uploaded_rows: Number(agent?.uploaded_rows ?? 0),
      uploaded_bytes: Number(agent?.uploaded_bytes ?? 0),
      current_location: agent?.current_lat == null ? null :
        [Number(agent.current_lat), Number(agent.current_lng)],
    },
    mushrooms: mushrooms.results,
  });
}
