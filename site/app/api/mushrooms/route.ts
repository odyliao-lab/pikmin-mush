import { ensureSchema, noStoreJson, runtime } from "../../../lib/cloud";
import { publicAgent, type ScanAgentRow } from "../../../lib/fleet";
import { MIN_MUSHROOM_LEVEL } from "../../../lib/mushroom-policy.mjs";

const MAX_PAGE_SIZE = 1_000;

type Cursor = { lastSeen: number; id: string };

function encodeCursor(value: Cursor) {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursor(value: string | null): Cursor | null {
  if (!value || value.length > 300) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    const lastSeen = Number(parsed.lastSeen);
    const id = String(parsed.id ?? "");
    return Number.isInteger(lastSeen) && lastSeen >= 0 && id.length <= 200
      ? { lastSeen, id } : null;
  } catch {
    return null;
  }
}

function parseBbox(value: string | null) {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return "invalid" as const;
  const [west, south, east, north] = parts;
  if (west < -180 || west > 180 || east < -180 || east > 180 ||
      south < -90 || south > 90 || north < -90 || north > 90 || south >= north) {
    return "invalid" as const;
  }
  return { west, south, east, north };
}

export async function GET(request: Request) {
  await ensureSchema();
  const now = Date.now();
  const db = runtime().DB;
  const url = new URL(request.url);
  const bbox = parseBbox(url.searchParams.get("bbox"));
  if (bbox === "invalid") return noStoreJson({ error: "invalid bbox" }, 400);
  const cursorValue = url.searchParams.get("cursor");
  const cursor = decodeCursor(cursorValue);
  if (cursorValue && !cursor) return noStoreJson({ error: "invalid cursor" }, 400);
  const limitValue = url.searchParams.get("limit");
  const paginated = Boolean(bbox || cursorValue || limitValue);
  const parsedLimit = Number.parseInt(limitValue ?? "500", 10);
  const limit = Math.max(1, Math.min(MAX_PAGE_SIZE,
    Number.isFinite(parsedLimit) ? parsedLimit : 500));

  const where = ["level >= ?", "(finish_ms = 0 OR finish_ms > ?)"];
  const bindings: unknown[] = [MIN_MUSHROOM_LEVEL, now];
  if (bbox) {
    where.push("lat >= ?", "lat <= ?");
    bindings.push(bbox.south, bbox.north);
    if (bbox.west <= bbox.east) {
      where.push("lng >= ?", "lng <= ?");
      bindings.push(bbox.west, bbox.east);
    } else {
      where.push("(lng >= ? OR lng <= ?)");
      bindings.push(bbox.west, bbox.east);
    }
  }
  if (cursor) {
    where.push("(last_seen < ? OR (last_seen = ? AND id < ?))");
    bindings.push(cursor.lastSeen, cursor.lastSeen, cursor.id);
  }
  const select = `SELECT id, lat, lng, level, type, cluster, cooldown,
      finish_ms, first_seen, last_seen, challenger_count,
      challenger_capacity, total_power, start_ms
    FROM mushrooms WHERE ${where.join(" AND ")}
    ORDER BY last_seen DESC, id DESC${paginated ? " LIMIT ?" : ""}`;
  const mushroomBindings = paginated ? [...bindings, limit + 1] : bindings;
  const countWhere = where.filter((_, index) => !cursor || index !== where.length - 1);
  const countBindings = cursor ? bindings.slice(0, -3) : bindings;

  const [mushrooms, countResult, agentsResult, scanner] = await Promise.all([
    db.prepare(select).bind(...mushroomBindings).all(),
    paginated
      ? db.prepare(`SELECT COUNT(*) AS count FROM mushrooms WHERE ${countWhere.join(" AND ")}`)
        .bind(...countBindings).first<{ count: number }>()
      : Promise.resolve(null),
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
  const rawRows = paginated ? mushrooms.results.slice(0, limit) : mushrooms.results;
  const publicMushrooms = rawRows.map((mushroom) => {
    const firstSeen = Number(mushroom.first_seen ?? 0);
    const challengeStarted = Math.floor(Number(mushroom.start_ms ?? 0) / 1000);
    return {
      ...mushroom,
      discovered_at: Math.max(firstSeen, challengeStarted),
    };
  });
  const hasMore = paginated && mushrooms.results.length > limit;
  const last = hasMore ? rawRows.at(-1) : null;
  return noStoreJson({
    updated: Math.floor(now / 1000),
    count: Number(countResult?.count ?? publicMushrooms.length),
    returned: publicMushrooms.length,
    pagination: {
      mode: paginated ? "cursor" : "legacy-full",
      limit: paginated ? limit : null,
      has_more: hasMore,
      next_cursor: last ? encodeCursor({
        lastSeen: Number(last.last_seen ?? 0), id: String(last.id ?? ""),
      }) : null,
    },
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
