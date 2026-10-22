import { runtime } from "./cloud";

const COPY_AUDIT_RETENTION_SECONDS = 30 * 24 * 60 * 60;

export type CopyAuditInput = {
  eventType: "copy_gps" | "copy_info";
  mushroomId: string;
  lat: number;
  lng: number;
  level: number;
  type: number;
};

type RequestCf = { asn?: unknown; country?: unknown };

function validIp(value: string) {
  // CF-Connecting-IP is set by Cloudflare. This validation intentionally
  // accepts both IPv4 and IPv6 without persisting the original address.
  return /^[0-9a-f:.]{3,64}$/i.test(value);
}

function deviceClass(userAgent: string) {
  if (/ipad|tablet/i.test(userAgent)) return "tablet";
  if (/mobi|android|iphone|ipod/i.test(userAgent)) return "mobile";
  if (userAgent) return "desktop";
  return "unknown";
}

async function sourceHash(request: Request) {
  const key = runtime().COPY_AUDIT_HASH_KEY ?? "";
  const ip = (request.headers.get("cf-connecting-ip") ?? "").trim();
  if (key.length < 32 || !validIp(ip)) return null;
  const digest = await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(`${key}\u0000${ip}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("").slice(0, 16);
}

function requestContext(request: Request) {
  const cf = (request as Request & { cf?: RequestCf }).cf;
  const asn = Number(cf?.asn);
  const country = String(cf?.country ?? request.headers.get("cf-ipcountry") ?? "")
    .toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  return {
    country,
    asn: Number.isSafeInteger(asn) && asn > 0 ? asn : 0,
    deviceClass: deviceClass(request.headers.get("user-agent") ?? ""),
  };
}

export async function recordCopyAuditEvent(request: Request, input: CopyAuditInput) {
  const fingerprint = await sourceHash(request);
  if (!fingerprint) return false;
  const now = Math.floor(Date.now() / 1000);
  const context = requestContext(request);
  await runtime().DB.prepare(`INSERT INTO copy_audit_events (
      at, bucket_minute, event_type, mushroom_id, mushroom_lat, mushroom_lng,
      mushroom_level, mushroom_type, source_hash, country, asn, device_class
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bucket_minute, event_type, mushroom_id, source_hash) DO UPDATE SET
      at=excluded.at, event_count=copy_audit_events.event_count+1`)
    .bind(now, Math.floor(now / 60), input.eventType, input.mushroomId,
      input.lat, input.lng, input.level, input.type, fingerprint, context.country,
      context.asn, context.deviceClass)
    .run();
  return true;
}

export type UsageEventInput = {
  eventType: "page_view" | "filter_apply" | "search" | "map_focus" | "api_error";
  dimension?: string;
  mushroomId?: string;
};

export async function recordPublicUsageEvent(request: Request, input: UsageEventInput) {
  const fingerprint = await sourceHash(request);
  if (!fingerprint) return false;
  const now = Math.floor(Date.now() / 1000);
  const context = requestContext(request);
  await runtime().DB.prepare(`INSERT INTO public_usage_events (
      at, bucket_minute, event_type, dimension, mushroom_id, source_hash,
      country, asn, device_class
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bucket_minute, event_type, dimension, mushroom_id, source_hash) DO UPDATE SET
      at=excluded.at, event_count=public_usage_events.event_count+1`)
    .bind(now, Math.floor(now / 60), input.eventType, input.dimension ?? "",
      input.mushroomId ?? "", fingerprint, context.country, context.asn, context.deviceClass)
    .run();
  return true;
}

export async function readCopyAuditEvents(hours: number, limit: number) {
  const db = runtime().DB;
  const since = Math.floor(Date.now() / 1000) - hours * 60 * 60;
  const taipeiDayStart = Math.floor((Math.floor(Date.now() / 1000) + 8 * 3600) / 86400) * 86400 - 8 * 3600;
  const [events, totals, activeSources, popularMushrooms, filterStats, focusStats, apiErrors, anomalousCopies] = await Promise.all([
    db.prepare(`SELECT id, at, event_type, mushroom_id, mushroom_lat, mushroom_lng,
        mushroom_level, mushroom_type, source_hash, country, asn, device_class,
        event_count FROM copy_audit_events WHERE at>=? ORDER BY at DESC, id DESC LIMIT ?`)
      .bind(since, limit).all(),
    db.prepare(`SELECT COUNT(*) AS rows, COALESCE(SUM(event_count), 0) AS copies,
        COUNT(DISTINCT source_hash) AS sources, COUNT(DISTINCT mushroom_id) AS mushrooms
      FROM copy_audit_events WHERE at>=?`).bind(since).first(),
    db.prepare("SELECT COUNT(DISTINCT source_hash) AS count FROM public_usage_events WHERE at>=?")
      .bind(taipeiDayStart).first<{ count: number }>(),
    db.prepare(`SELECT mushroom_id, mushroom_lat, mushroom_lng, mushroom_level, mushroom_type,
        SUM(event_count) AS copies, COUNT(DISTINCT source_hash) AS sources
      FROM copy_audit_events WHERE at>=? GROUP BY mushroom_id
      ORDER BY copies DESC, sources DESC, MAX(at) DESC LIMIT 10`).bind(since).all(),
    db.prepare(`SELECT dimension, SUM(event_count) AS uses, COUNT(DISTINCT source_hash) AS sources
      FROM public_usage_events WHERE at>=? AND event_type IN ('filter_apply','search')
      GROUP BY dimension ORDER BY uses DESC, sources DESC LIMIT 10`).bind(since).all(),
    db.prepare(`SELECT mushroom_id, SUM(event_count) AS opens, COUNT(DISTINCT source_hash) AS sources
      FROM public_usage_events WHERE at>=? AND event_type='map_focus' AND mushroom_id<>''
      GROUP BY mushroom_id ORDER BY opens DESC, sources DESC LIMIT 10`).bind(since).all(),
    db.prepare(`SELECT dimension, SUM(event_count) AS errors, COUNT(DISTINCT source_hash) AS sources
      FROM public_usage_events WHERE at>=? AND event_type='api_error'
      GROUP BY dimension ORDER BY errors DESC, sources DESC LIMIT 20`).bind(since).all(),
    db.prepare(`SELECT source_hash, country, asn, SUM(event_count) AS copies,
        COUNT(DISTINCT mushroom_id) AS mushrooms FROM copy_audit_events WHERE at>=?
      GROUP BY source_hash, country, asn HAVING SUM(event_count)>=20
      ORDER BY copies DESC LIMIT 20`).bind(Math.floor(Date.now() / 1000) - 15 * 60).all(),
  ]);
  return {
    retention_days: COPY_AUDIT_RETENTION_SECONDS / 86400,
    summary: {
      rows: Number(totals?.rows ?? 0), copies: Number(totals?.copies ?? 0),
      sources: Number(totals?.sources ?? 0), mushrooms: Number(totals?.mushrooms ?? 0),
    },
    analytics: {
      daily_active_sources: Number(activeSources?.count ?? 0),
      popular_mushrooms: popularMushrooms.results,
      filter_stats: filterStats.results,
      map_focus_stats: focusStats.results,
      api_errors: apiErrors.results,
      anomalous_copy_sources: anomalousCopies.results,
    },
    events: events.results,
  };
}
