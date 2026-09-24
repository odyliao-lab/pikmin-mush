import {
  ensureSchema, noStoreJson, readMushroomRetentionStatus, runtime,
} from "../../../lib/cloud";
import { publicAgent, type ScanAgentRow } from "../../../lib/fleet";
import { MIN_MUSHROOM_LEVEL } from "../../../lib/mushroom-policy.mjs";
import { COUNTRY_PACK_CATALOG } from "../../../lib/scan-plans";
import { QUERY_CONTRACT_VERSION, DISCOVERY_SQL, UNDER_FIVE_SQL, discoveryWindow } from "../../../lib/query-contract.mjs";
import { listOrder, cursorPredicate, searchPredicate } from "../../../lib/list-query.mjs";
import { createMemo, createPublicReader, createQueryTrace } from "../../../lib/public-read.mjs";

const MAX_PAGE_SIZE = 1_000;
const readPublic = createPublicReader();
const countMemo = createMemo();
const metadataMemo = createMemo({ maxEntries: 1 });
const EVENT_TYPE_IDS = [10, 14, 15, 16, 19, 20, 21, 22, 23, 24, 25];
const ICE_TYPE_IDS = [26, 27, 28, 29, 30, 31, 32, 33];
const LOCATION_MATCH_RADIUS_KM = 120;
const SCAN_LOCATION_CATALOG = COUNTRY_PACK_CATALOG.flatMap((pack) => pack.cities.map(
  ([city, lat, lng]) => ({
    country: pack.name.replace(/^美國(?:東部|中部|西部)$/, "美國"), city, lat, lng,
  }),
));
type PublicTarget = { id: number; lat: number; lng: number; country: string; city: string };
type PublicMetadata = {
  agentsResult: { results: ScanAgentRow[] };
  targetsResult: { results: PublicTarget[] };
  scanner: Record<string, unknown> | undefined;
  updatedAt: number;
};

type Cursor = { lastSeen?: number; id: string; low?: number; value?: number; scope?: string; window?: {from:number;to:number} | null; issuedAt?: number };

function encodeCursor(value: Cursor) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursor(value: string | null): Cursor | null {
  if (!value || value.length > 4000) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), c => c.charCodeAt(0))));
    if (parsed.scope && typeof parsed.scope === "string" && parsed.scope.length < 2500) return parsed as Cursor;
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

function parseLevels(value: string | null) {
  if (!value) return null;
  const levels = [...new Set(value.split(",").map((part) => /^[234]$/.test(part) ? Number(part) : NaN))].sort();
  return levels.length && levels.every((level) => [2, 3, 4].includes(level)) ? levels : "invalid" as const;
}

function parseTypes(value: string | null) {
  if (!value) return null;
  const types = [...new Set(value.split(",").map((part) => part.trim()))].sort();
  // Bound placeholder expansion even when the caller supplies arbitrary type IDs.
  return types.length && types.length <= 40 && types.every((type) => ["event", "ice"].includes(type) || /^\d{1,3}$/.test(type))
    ? types : "invalid" as const;
}

function parseUnderFive(value: string | null) {
  if (!value) return false;
  if (["1", "true"].includes(value)) return true;
  if (["0", "false"].includes(value)) return false;
  return "invalid" as const;
}

function resolveScanLocation(lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {};
  const nearest = SCAN_LOCATION_CATALOG.reduce<{ distance: number; country: string; city: string } | null>(
    (best, candidate) => {
      const distance = Math.hypot(
        (lat - candidate.lat) * 111,
        (lng - candidate.lng) * 111 * Math.cos(lat * Math.PI / 180),
      );
      return !best || distance < best.distance
        ? { distance, country: candidate.country, city: candidate.city } : best;
    }, null,
  );
  return nearest && nearest.distance <= LOCATION_MATCH_RADIUS_KM
    ? { location_country: nearest.country, location_city: nearest.city } : {};
}

export async function GET(request: Request) {
  return readPublic(request, (trace: ReturnType<typeof createQueryTrace>) => readMushrooms(request, trace));
}

async function readMushrooms(request: Request, trace: ReturnType<typeof createQueryTrace>) {
  const now = Date.now();
  const url = new URL(request.url);
  const bbox = parseBbox(url.searchParams.get("bbox"));
  if (bbox === "invalid") return noStoreJson({ error: "invalid bbox" }, 400);
  const levels = parseLevels(url.searchParams.get("levels"));
  if (levels === "invalid") return noStoreJson({ error: "invalid levels" }, 400);
  const types = parseTypes(url.searchParams.get("types"));
  if (types === "invalid") return noStoreJson({ error: "invalid types" }, 400);
  const underFive = parseUnderFive(url.searchParams.get("under_five"));
  if (underFive === "invalid") return noStoreJson({ error: "invalid under_five" }, 400);
  let window;
  try { window = discoveryWindow(url.searchParams, Math.floor(now / 1000)); }
  catch (error) { return noStoreJson({ error: String((error as Error).message) }, 400); }
  const cursorValue = url.searchParams.get("cursor");
  const cursor = decodeCursor(cursorValue);
  if (cursorValue && !cursor) return noStoreJson({ error: "invalid cursor" }, 400);
  if (cursor?.issuedAt !== undefined && (!Number.isSafeInteger(cursor.issuedAt) ||
      cursor.issuedAt > now || now - cursor.issuedAt > 60 * 60_000)) {
    return noStoreJson({ error: "cursor_expired", restart: true }, 410);
  }
  let order, search, continuation;
  const scope = JSON.stringify([levels,types,underFive,bbox,url.searchParams.get('sort')||'updated',
    url.searchParams.get('prioritize_low')||'0',url.searchParams.get('q')||'',
    url.searchParams.get('discovered_within_hours'),url.searchParams.get('discovered_from'),url.searchParams.get('discovered_to')]);
  try {
    order = listOrder(url.searchParams);
    search = searchPredicate(url.searchParams.get('q'), SCAN_LOCATION_CATALOG);
    if (cursor?.scope) {
      if (cursor.scope !== scope) throw new Error('cursor query mismatch');
      if (cursor.window) {
        const frozen = new URLSearchParams({discovered_from:String(cursor.window.from),discovered_to:String(cursor.window.to)});
        window = discoveryWindow(frozen, Math.floor(now/1000));
      }
      continuation = cursorPredicate(order, cursor);
    } else {
      if (cursor && (order.sort !== 'updated' || order.priority !== '0')) throw new Error('legacy cursor sort mismatch');
      continuation = cursorPredicate(order, cursor ? {low:0,value:cursor.lastSeen,id:cursor.id} : null);
    }
  } catch (error) { return noStoreJson({error:String((error as Error).message)},400); }
  const limitValue = url.searchParams.get("limit");
  if (limitValue !== null && !/^\d{1,8}$/.test(limitValue)) return noStoreJson({ error: "invalid limit" }, 400);
  const parsedLimit = Number.parseInt(limitValue ?? "500", 10);
  const limit = Math.max(1, Math.min(MAX_PAGE_SIZE,
    Number.isFinite(parsedLimit) ? parsedLimit : 500));
  const metaValue = url.searchParams.get('include_meta') ?? '1';
  if (!['0','1'].includes(metaValue)) return noStoreJson({ error: 'invalid include_meta' }, 400);
  const includeMeta = metaValue === '1';
  // Validate before touching D1; every public path is bounded, including requests
  // from old clients that omit limit/bbox/cursor. Complete results use next_cursor.
  await ensureSchema();
  const retention = includeMeta ? await readMushroomRetentionStatus() : null;
  const db = runtime().DB;

  const where = [
    "level >= ?",
    "mushroom_status='active'",
    "(finish_ms = 0 OR finish_ms > ?)",
  ];
  const bindings: unknown[] = [MIN_MUSHROOM_LEVEL, now];
  if (levels) {
    where.push(`level IN (${levels.map(() => "?").join(", ")})`);
    bindings.push(...levels);
  }
  if (types) {
    const numericTypes = types.filter((type) => !["event", "ice"].includes(type)).map(Number);
    const typeClauses: string[] = [];
    if (numericTypes.length) {
      typeClauses.push(`type IN (${numericTypes.map(() => "?").join(", ")})`);
      bindings.push(...numericTypes);
    }
    if (types.includes("event")) {
      typeClauses.push(`type IN (${EVENT_TYPE_IDS.map(() => "?").join(", ")})`);
      bindings.push(...EVENT_TYPE_IDS);
    }
    if (types.includes("ice")) {
      typeClauses.push(`type IN (${ICE_TYPE_IDS.map(() => "?").join(", ")})`);
      bindings.push(...ICE_TYPE_IDS);
    }
    where.push(`(${typeClauses.join(" OR ")})`);
  }
  if (underFive) where.push(UNDER_FIVE_SQL);
  if (window) {
    where.push(`${DISCOVERY_SQL} >= ?`, `${DISCOVERY_SQL} <= ?`);
    bindings.push(window.from, window.to);
  }
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
  if (search.sql) { where.push(search.sql); bindings.push(...search.bindings); }
  const countWhere = [...where], countBindings = [...bindings];
  if (continuation.sql) { where.push(continuation.sql); bindings.push(...continuation.bindings); }
  const select = `SELECT id, lat, lng, level, type, cluster, cooldown,
      finish_ms, first_seen, last_seen, challenger_count,
      challenger_capacity, total_power, start_ms, giant_recheck_status,
      giant_rechecked_at, participants_verified_at, discovered_by_agent_id, ${order.select}
    FROM mushrooms WHERE ${where.join(" AND ")}
    ORDER BY ${order.order} LIMIT ?`;
  const mushroomBindings = [...bindings, limit + 1];

  const [mushrooms, countResult, metadata] = await Promise.all([
    trace.query('mushrooms', () => db.prepare(select).bind(...mushroomBindings).all()),
    includeMeta ? countMemo(JSON.stringify([scope, window]), async () => {
      const result = await trace.query('count', () => db.prepare(`SELECT COUNT(*) AS count FROM mushrooms WHERE ${countWhere.join(" AND ")}`)
        .bind(...countBindings).all<{ count: number }>());
      return result.results[0];
    }) : Promise.resolve(null),
    metadataMemo('public-fleet', async () => {
      const [agentsResult, targetsResult, scannerResult] = await Promise.all([
        trace.query('agents', () => db.prepare("SELECT * FROM scan_agents ORDER BY enabled DESC, last_seen DESC").all<ScanAgentRow>()),
        trace.query('targets', () => db.prepare(`SELECT id, lat, lng, country, city FROM scan_targets WHERE id IN (
      SELECT current_target_id FROM scan_agents
      WHERE enabled=1 AND paused=0 AND current_target_id IS NOT NULL
    )`).all<{ id: number; lat: number; lng: number; country: string; city: string }>()),
        trace.query('scanner', () => db.prepare("SELECT status_json, updated_at FROM scanner_status WHERE id = 1").all()),
      ]);
      return { agentsResult, targetsResult, scanner: scannerResult.results[0], updatedAt: now };
    }),
  ]);
  const { agentsResult, targetsResult, scanner } = metadata as PublicMetadata;
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
  // Public map markers expose the assigned scan target, never the device's
  // reported location or any network/device metadata.
  const targetsById = new Map(targetsResult.results.map((target) => [
    Number(target.id), target,
  ]));
  const liveAgents = agents.flatMap((agent) => {
    const target = targetsById.get(Number(agent.current_target_id));
    const lat = Number(target?.lat);
    const lng = Number(target?.lng);
    if (!agent.online || agent.paused || !target ||
      !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    return [{
      id: String(agent.id).slice(0, 64),
      name: String(agent.name).slice(0, 96),
      current_location: [lat, lng],
      country: String(target.country ?? "").slice(0, 96),
      city: String(target.city ?? "").slice(0, 96),
      last_seen: Number(agent.last_seen),
    }];
  });
  const agentNames = new Map(agentsResult.results.map((agent) => [
    String(agent.id), String(agent.display_name),
  ]));
  const rawRows = (mushrooms.results as Record<string, unknown>[]).slice(0, limit);
  const publicMushrooms = rawRows.map((mushroom) => {
    const visible = {...mushroom};
    delete visible.query_low; delete visible.query_value;
    const firstSeen = Number(mushroom.first_seen ?? 0);
    const challengeStarted = Math.floor(Number(mushroom.start_ms ?? 0) / 1000);
    return {
      ...visible,
      ...resolveScanLocation(Number(mushroom.lat), Number(mushroom.lng)),
      discovered_at: Math.max(firstSeen, challengeStarted),
      last_observed_at: Number(mushroom.last_seen ?? 0),
      last_verified_at: Number(mushroom.participants_verified_at ?? 0),
      discovery_history_note: "legacy discovery timestamps may include earlier recheck refreshes",
      discovered_by: agentNames.get(String(mushroom.discovered_by_agent_id ?? "")) ?? "",
    };
  });
  const hasMore = mushrooms.results.length > limit;
  const last = hasMore ? rawRows.at(-1) : null;
  const response = noStoreJson({
    query_contract: {
      version: QUERY_CONTRACT_VERSION, time_field: "discovered_at", time_unit: "unix_seconds",
      boundaries: "inclusive", window, under_five: underFive,
      requires_valid_capacity: underFive, levels, types, scope: bbox ? "bbox" : "world",
      sort:order.sort, prioritize_low:order.priority === '1', search:search.q,
      search_location_rule:"catalog neighbourhood within approximately 120km",
    },
    updated: Math.floor(now / 1000),
    count: includeMeta ? Number(countResult?.count ?? publicMushrooms.length) : null,
    returned: publicMushrooms.length,
    pagination: {
      mode: "cursor",
      limit,
      has_more: hasMore,
      next_cursor: last ? encodeCursor({
        lastSeen: Number(last.last_seen ?? 0), id: String(last.id ?? ""),
        low:Number(last.query_low), value:Number(last.query_value), scope, window,
        issuedAt: cursor?.issuedAt ?? now,
      }) : null,
    },
    metadata_updated_at: Math.floor(metadata.updatedAt / 1000),
    ...(includeMeta ? {
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
    live_agents: liveAgents,
    retention: {
      policy_days: 7,
      level_2_3_inactive_after_days: 2,
      last_run_at: retention?.lastRunAt ?? 0,
      last_deleted: retention?.lastDeleted ?? 0,
      pending: retention?.pending ?? 0,
    },
    } : {}),
    mushrooms: publicMushrooms,
  });
  response.headers.set('X-Map-Returned', String(publicMushrooms.length));
  return response;
}
