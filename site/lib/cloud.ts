import { env, waitUntil } from "cloudflare:workers";
import { isUsefulMushroomLevel } from "./mushroom-policy.mjs";
import { EVENT_SPOT_SEED } from "./event-spots";
import { observationStatements } from "./observations.mjs";
import { catalogueStatements, CATALOGUE_STATE, CATALOGUE_REVISION } from "./catalogue-seed.mjs";

export type MushroomRow = {
  id: string;
  lat: number;
  lng: number;
  cluster: string;
  cooldown: number;
  level: number;
  type: number;
  finish_ms: number;
  challenger_count: number;
  challenger_capacity: number;
  total_power: number;
  start_ms: number;
};

const MUSHROOM_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const LEVEL_TWO_THREE_INVALID_AFTER_SECONDS = 2 * 24 * 60 * 60;
const MUSHROOM_RETENTION_INTERVAL_SECONDS = 5 * 60;
const MUSHROOM_RETENTION_BATCH_SIZE = 1_000;
const MUSHROOM_INVALIDATION_BATCH_SIZE = 250;
const MUSHROOM_HISTORY_BATCH_SIZE = 500;

export type MushroomRetentionStatus = {
  lastRunAt: number;
  lastDeleted: number;
  pending: number;
  lastSucceededAt: number;
  lastFailedAt: number;
  lastFailureStage: string;
  consecutiveFailures: number;
  lastDurationMs: number;
  lastInvalidated: number;
  lastObservationsDeleted: number;
  lastTargetsDeleted: number;
  lastBatchSaturated: boolean;
};

type RuntimeEnv = {
  DB: D1Database;
  AGENT_TOKEN?: string;
  CONTROLLER_TOKEN?: string;
  MAINTENANCE_TOKEN?: string;
  ADMIN_EMAILS?: string;
  COPY_AUDIT_HASH_KEY?: string;
};

export function runtime(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

// 對既有表補上後來新增的欄位（CREATE TABLE IF NOT EXISTS 不會改動既有表）。
// 每個 worker isolate 只需嘗試一次；若 ALTER 失敗，只有在確認欄位確實
// 已存在時才可忽略，避免把連線或權限等真正的錯誤靜默吞掉。
let columnsPatched = false;
async function patchColumns(db: RuntimeEnv["DB"]) {
  if (columnsPatched) return;
  const additions = [
    {
      sql: "ALTER TABLE scan_agents ADD COLUMN paused INTEGER NOT NULL DEFAULT 0",
      verify: "SELECT paused FROM scan_agents LIMIT 1",
    },
    { sql: "ALTER TABLE scan_agents ADD COLUMN game_version TEXT NOT NULL DEFAULT ''", verify: "SELECT game_version FROM scan_agents LIMIT 1" },
    { sql: "ALTER TABLE scan_agents ADD COLUMN module_version TEXT NOT NULL DEFAULT ''", verify: "SELECT module_version FROM scan_agents LIMIT 1" },
    { sql: "ALTER TABLE scan_agents ADD COLUMN last_data_at INTEGER NOT NULL DEFAULT 0", verify: "SELECT last_data_at FROM scan_agents LIMIT 1" },
    { sql: "ALTER TABLE scan_agents ADD COLUMN last_target_at INTEGER NOT NULL DEFAULT 0", verify: "SELECT last_target_at FROM scan_agents LIMIT 1" },
    { sql: "ALTER TABLE scan_agents ADD COLUMN no_data_streak INTEGER NOT NULL DEFAULT 0", verify: "SELECT no_data_streak FROM scan_agents LIMIT 1" },
    { sql: "ALTER TABLE scan_agents ADD COLUMN previous_token_hash TEXT NOT NULL DEFAULT ''", verify: "SELECT previous_token_hash FROM scan_agents LIMIT 1" },
    { sql: "ALTER TABLE scan_agents ADD COLUMN previous_token_expires_at INTEGER NOT NULL DEFAULT 0", verify: "SELECT previous_token_expires_at FROM scan_agents LIMIT 1" },
    { sql: "ALTER TABLE scan_agents ADD COLUMN token_rotated_at INTEGER NOT NULL DEFAULT 0", verify: "SELECT token_rotated_at FROM scan_agents LIMIT 1" },
    { sql: "ALTER TABLE scan_targets ADD COLUMN leased_at INTEGER NOT NULL DEFAULT 0", verify: "SELECT leased_at FROM scan_targets LIMIT 1" },
    { sql: "ALTER TABLE scan_targets ADD COLUMN completed_agent_id TEXT NOT NULL DEFAULT ''", verify: "SELECT completed_agent_id FROM scan_targets LIMIT 1" },
    { sql: "ALTER TABLE scan_targets ADD COLUMN priority INTEGER NOT NULL DEFAULT 0", verify: "SELECT priority FROM scan_targets LIMIT 1" },
    { sql: "ALTER TABLE scan_targets ADD COLUMN required_agent_id TEXT NOT NULL DEFAULT ''", verify: "SELECT required_agent_id FROM scan_targets LIMIT 1" },
    { sql: "ALTER TABLE scan_targets ADD COLUMN verification_batch TEXT NOT NULL DEFAULT ''", verify: "SELECT verification_batch FROM scan_targets LIMIT 1" },
    { sql: "ALTER TABLE scan_targets ADD COLUMN verification_mushroom_id TEXT NOT NULL DEFAULT ''", verify: "SELECT verification_mushroom_id FROM scan_targets LIMIT 1" },
    { sql: "ALTER TABLE scan_targets ADD COLUMN verification_kind TEXT NOT NULL DEFAULT ''", verify: "SELECT verification_kind FROM scan_targets LIMIT 1" },
    { sql: "ALTER TABLE scan_targets ADD COLUMN verification_result TEXT NOT NULL DEFAULT ''", verify: "SELECT verification_result FROM scan_targets LIMIT 1" },
    { sql: "ALTER TABLE mushrooms ADD COLUMN giant_recheck_status TEXT NOT NULL DEFAULT ''", verify: "SELECT giant_recheck_status FROM mushrooms LIMIT 1" },
    { sql: "ALTER TABLE mushrooms ADD COLUMN giant_rechecked_at INTEGER NOT NULL DEFAULT 0", verify: "SELECT giant_rechecked_at FROM mushrooms LIMIT 1" },
    { sql: "ALTER TABLE mushrooms ADD COLUMN discovered_by_agent_id TEXT NOT NULL DEFAULT ''", verify: "SELECT discovered_by_agent_id FROM mushrooms LIMIT 1" },
    { sql: "ALTER TABLE mushrooms ADD COLUMN mushroom_status TEXT NOT NULL DEFAULT 'active'", verify: "SELECT mushroom_status FROM mushrooms LIMIT 1" },
    { sql: "ALTER TABLE mushrooms ADD COLUMN invalidated_at INTEGER NOT NULL DEFAULT 0", verify: "SELECT invalidated_at FROM mushrooms LIMIT 1" },
  ];
  for (const addition of additions) {
    try {
      await db.prepare(addition.sql).run();
    } catch (error) {
      try {
        await db.prepare(addition.verify).first();
      } catch {
        throw error;
      }
    }
  }
  await db.prepare(`CREATE INDEX IF NOT EXISTS mushrooms_status_level_first_seen_idx
    ON mushrooms (mushroom_status, level, first_seen)`).run();
  columnsPatched = true;
}

type SchemaProbeRow = {
  agent_state_ready: number;
  scanner_status_ready: number;
  rotation_ready: number;
  primary_ready: number;
  event_spots_shape?: string;
};

function missingSchema(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /no such (?:table|column)|has no column named/i.test(message);
}

async function probeSchema(db: RuntimeEnv["DB"]) {
  try {
    // Keep the normal production path read-only and cheap. The scalar column
    // references make SQLite validate every runtime-patched column even when a
    // table currently has no rows. Full DDL initialization is only needed for
    // a genuinely new or incomplete database, not for every Worker isolate.
    const row = await db.prepare(`SELECT
        EXISTS(SELECT 1 FROM agent_state WHERE id=1) AS agent_state_ready,
        EXISTS(SELECT 1 FROM scanner_status WHERE id=1) AS scanner_status_ready,
        EXISTS(SELECT 1 FROM scan_rotation_settings WHERE id=1) AS rotation_ready,
        EXISTS(SELECT 1 FROM scan_agents WHERE id='primary') AS primary_ready,
        (SELECT paused || game_version || module_version || last_data_at ||
          last_target_at || no_data_streak || previous_token_hash ||
          previous_token_expires_at || token_rotated_at
          FROM scan_agents LIMIT 1) AS agent_shape,
        (SELECT leased_at || completed_agent_id || priority || required_agent_id ||
          verification_batch || verification_mushroom_id || verification_kind ||
          verification_result
          FROM scan_targets LIMIT 1) AS target_shape,
        (SELECT id || giant_recheck_status || giant_rechecked_at || mushroom_status || invalidated_at
          FROM mushrooms LIMIT 1) AS mushroom_shape,
        (SELECT id FROM event_spots LIMIT 1) AS event_spots_shape,
        (SELECT id FROM scan_jobs LIMIT 1) AS job_shape,
        (SELECT id FROM scan_logs LIMIT 1) AS log_shape,
        (SELECT id FROM scan_agent_events LIMIT 1) AS event_shape,
        (SELECT schedule_date FROM scan_rotation_runs LIMIT 1) AS rotation_run_shape`)
      .first<SchemaProbeRow>();
    return Boolean(row?.agent_state_ready && row.scanner_status_ready &&
      row.rotation_ready && row.primary_ready && row.event_spots_shape !== undefined);
  } catch (error) {
    if (missingSchema(error)) return false;
    // A transient D1 failure must fail this request rather than trigger dozens
    // of DDL statements and amplify an already overloaded database.
    throw error;
  }
}

async function initializeSchema() {
  const db = runtime().DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS mushrooms (
      id TEXT PRIMARY KEY,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      level INTEGER NOT NULL DEFAULT 0,
      type INTEGER NOT NULL DEFAULT 0,
      cluster TEXT NOT NULL DEFAULT '',
      cooldown INTEGER NOT NULL DEFAULT 0,
      finish_ms INTEGER NOT NULL DEFAULT 0,
      first_seen INTEGER NOT NULL,
      discovered_by_agent_id TEXT NOT NULL DEFAULT '',
      last_seen INTEGER NOT NULL,
      challenger_count INTEGER NOT NULL DEFAULT 0,
      challenger_capacity INTEGER NOT NULL DEFAULT 0,
      total_power REAL NOT NULL DEFAULT 0,
      start_ms INTEGER NOT NULL DEFAULT 0,
      giant_recheck_status TEXT NOT NULL DEFAULT '',
      giant_rechecked_at INTEGER NOT NULL DEFAULT 0,
      mushroom_status TEXT NOT NULL DEFAULT 'active',
      invalidated_at INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS mushrooms_finish_ms_idx
      ON mushrooms (finish_ms)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS mushrooms_last_seen_id_idx
      ON mushrooms (last_seen, id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS event_spots (
      id TEXT PRIMARY KEY,
      country TEXT NOT NULL,
      city TEXT NOT NULL,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      spot_kind TEXT NOT NULL,
      reward_kind TEXT NOT NULL,
      reward_summary TEXT NOT NULL,
      start_at INTEGER NOT NULL DEFAULT 0,
      end_at INTEGER NOT NULL DEFAULT 0,
      cooldown_note TEXT NOT NULL DEFAULT '',
      eligibility_note TEXT NOT NULL DEFAULT '',
      coordinate_note TEXT NOT NULL DEFAULT '',
      verification_status TEXT NOT NULL,
      source_title TEXT NOT NULL,
      source_url TEXT NOT NULL,
      last_verified_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS event_spots_active_idx
      ON event_spots (end_at, country)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS maintenance_state (
      name TEXT PRIMARY KEY,
      last_run_at INTEGER NOT NULL DEFAULT 0,
      last_deleted INTEGER NOT NULL DEFAULT 0,
      pending INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_state (
      id INTEGER PRIMARY KEY,
      seq INTEGER NOT NULL DEFAULT 0,
      command_op TEXT NOT NULL DEFAULT 'wait',
      command_arg1 TEXT NOT NULL DEFAULT '',
      command_arg2 TEXT NOT NULL DEFAULT '',
      ack_seq INTEGER NOT NULL DEFAULT 0,
      ack_ok INTEGER NOT NULL DEFAULT 0,
      ack_message TEXT NOT NULL DEFAULT '',
      last_seen INTEGER NOT NULL DEFAULT 0,
      current_lat REAL,
      current_lng REAL,
      uploaded_rows INTEGER NOT NULL DEFAULT 0,
      uploaded_bytes INTEGER NOT NULL DEFAULT 0,
      partial_text TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS scan_agents (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      token_hash TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      paused INTEGER NOT NULL DEFAULT 0,
      region_tags_json TEXT NOT NULL DEFAULT '[]',
      capabilities_json TEXT NOT NULL DEFAULT '{}',
      agent_version TEXT NOT NULL DEFAULT '',
      game_version TEXT NOT NULL DEFAULT '',
      module_version TEXT NOT NULL DEFAULT '',
      last_seen INTEGER NOT NULL DEFAULT 0,
      last_data_at INTEGER NOT NULL DEFAULT 0,
      last_target_at INTEGER NOT NULL DEFAULT 0,
      no_data_streak INTEGER NOT NULL DEFAULT 0,
      current_lat REAL,
      current_lng REAL,
      current_job_id INTEGER,
      current_target_id INTEGER,
      uploaded_rows INTEGER NOT NULL DEFAULT 0,
      uploaded_bytes INTEGER NOT NULL DEFAULT 0,
      partial_text TEXT NOT NULL DEFAULT '',
      previous_token_hash TEXT NOT NULL DEFAULT '',
      previous_token_expires_at INTEGER NOT NULL DEFAULT 0,
      token_rotated_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scan_agents_last_seen_idx
      ON scan_agents (last_seen)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS scanner_status (
      id INTEGER PRIMARY KEY,
      status_json TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS scan_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'queued',
      config_json TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      total_points INTEGER NOT NULL,
      current_index INTEGER NOT NULL DEFAULT 0,
      cycle INTEGER NOT NULL DEFAULT 0,
      loop INTEGER NOT NULL DEFAULT 0,
      captured_rows INTEGER NOT NULL DEFAULT 0,
      captured_bytes INTEGER NOT NULL DEFAULT 0,
      current_country TEXT NOT NULL DEFAULT '',
      current_city TEXT NOT NULL DEFAULT '',
      current_lat REAL,
      current_lng REAL,
      message TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER NOT NULL DEFAULT 0,
      finished_at INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scan_jobs_status_idx
      ON scan_jobs (status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scan_jobs_updated_at_idx
      ON scan_jobs (updated_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS scan_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      at INTEGER NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scan_logs_job_at_idx
      ON scan_logs (job_id, at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS scan_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      cycle INTEGER NOT NULL DEFAULT 0,
      country TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      region_index INTEGER NOT NULL DEFAULT 0,
      point_index INTEGER NOT NULL DEFAULT 0,
      base_cooldown_s INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      lease_agent_id TEXT NOT NULL DEFAULT '',
      lease_token TEXT NOT NULL DEFAULT '',
      leased_at INTEGER NOT NULL DEFAULT 0,
      lease_expires_at INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      captured_rows INTEGER NOT NULL DEFAULT 0,
      captured_bytes INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL DEFAULT 0,
      completed_agent_id TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 0,
      required_agent_id TEXT NOT NULL DEFAULT '',
      verification_batch TEXT NOT NULL DEFAULT '',
      verification_mushroom_id TEXT NOT NULL DEFAULT '',
      verification_kind TEXT NOT NULL DEFAULT '',
      verification_result TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scan_targets_claim_idx
      ON scan_targets (job_id, status, cycle)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scan_targets_lease_idx
      ON scan_targets (lease_expires_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scan_targets_agent_idx
      ON scan_targets (lease_agent_id, status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scan_targets_verification_idx
      ON scan_targets (verification_batch, verification_kind, status)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS scan_targets_job_sequence_uidx
      ON scan_targets (job_id, sequence)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS scan_agent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      at INTEGER NOT NULL,
      job_id INTEGER,
      target_id INTEGER,
      rows INTEGER NOT NULL DEFAULT 0,
      bytes INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      detail TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scan_agent_events_agent_at_idx
      ON scan_agent_events (agent_id, at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scan_agent_events_type_at_idx
      ON scan_agent_events (event_type, at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS scan_rotation_settings (
      id INTEGER PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
      switch_minute INTEGER NOT NULL DEFAULT 450,
      config_json TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS scan_rotation_runs (
      schedule_date TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'running',
      job_id INTEGER,
      assignments_json TEXT NOT NULL DEFAULT '[]',
      message TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scan_rotation_runs_updated_at_idx
      ON scan_rotation_runs (updated_at)`),
  ]);
  await patchColumns(db);
  await ensureCopyAuditSchema(db);
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO agent_state (id) VALUES (1)"),
    db.prepare("INSERT OR IGNORE INTO scanner_status (id) VALUES (1)"),
    db.prepare(`INSERT OR IGNORE INTO scan_rotation_settings (
      id, enabled, timezone, switch_minute, config_json, updated_at
    ) VALUES (1, 1, 'Asia/Taipei', 450, '{}', ?)` ).bind(now),
    db.prepare(`INSERT OR IGNORE INTO scan_agents (
      id, display_name, region_tags_json, last_seen, current_lat, current_lng,
      uploaded_rows, uploaded_bytes, partial_text, created_at, updated_at
    ) SELECT 'primary', '主要 Agent', '[]', last_seen, current_lat, current_lng,
      uploaded_rows, uploaded_bytes, partial_text, ?, ?
      FROM agent_state WHERE id=1`).bind(now, now),
  ]);
}

async function ensureCopyAuditSchema(db: RuntimeEnv["DB"]) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS copy_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      bucket_minute INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      mushroom_id TEXT NOT NULL,
      mushroom_lat REAL NOT NULL,
      mushroom_lng REAL NOT NULL,
      mushroom_level INTEGER NOT NULL,
      mushroom_type INTEGER NOT NULL,
      source_hash TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT '',
      asn INTEGER NOT NULL DEFAULT 0,
      device_class TEXT NOT NULL DEFAULT '',
      event_count INTEGER NOT NULL DEFAULT 1,
      UNIQUE(bucket_minute, event_type, mushroom_id, source_hash)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS copy_audit_events_at_idx
      ON copy_audit_events (at DESC, id DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS copy_audit_events_mushroom_at_idx
      ON copy_audit_events (mushroom_id, at DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS copy_audit_events_source_at_idx
      ON copy_audit_events (source_hash, at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS public_usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      bucket_minute INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      dimension TEXT NOT NULL DEFAULT '',
      mushroom_id TEXT NOT NULL DEFAULT '',
      source_hash TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT '',
      asn INTEGER NOT NULL DEFAULT 0,
      device_class TEXT NOT NULL DEFAULT '',
      event_count INTEGER NOT NULL DEFAULT 1,
      UNIQUE(bucket_minute, event_type, dimension, mushroom_id, source_hash)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS public_usage_events_at_idx
      ON public_usage_events (at DESC, id DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS public_usage_events_type_at_idx
      ON public_usage_events (event_type, at DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS public_usage_events_source_at_idx
      ON public_usage_events (source_hash, at DESC)`),
  ]);
}

export async function ensureEventSpotCatalogue() {
  const db=runtime().DB;
  await db.prepare("INSERT OR IGNORE INTO maintenance_state (name) VALUES (?)").bind(CATALOGUE_STATE).run();
  const state=await db.prepare("SELECT last_run_at FROM maintenance_state WHERE name=?").bind(CATALOGUE_STATE).first<{last_run_at:number}>();
  if (Number(state?.last_run_at ?? 0)>=CATALOGUE_REVISION) return;
  // One atomic transaction: same/older Workers cannot overwrite a newer seed.
  await db.batch(catalogueStatements(db,EVENT_SPOT_SEED,CATALOGUE_REVISION,Date.now()));
}

let schemaReady: Promise<void> | null = null;

export async function ensureSchema() {
  if (schemaReady) return schemaReady;
  const attempt = (async () => {
    const db = runtime().DB;
    if (await probeSchema(db)) {
      columnsPatched = true;
    } else {
      await initializeSchema();
    }
    // This table was added after the original schema probe. Keep it as a
    // separate idempotent migration so healthy production databases receive it
    // without forcing a broad schema reinitialization.
    await ensureCopyAuditSchema(db);
    // Catalogue seeding belongs only to the event-spots route, not scan uploads.
  })();
  schemaReady = attempt;
  try {
    await attempt;
  } catch (error) {
    if (schemaReady === attempt) schemaReady = null;
    throw error;
  }
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

export function authorized(request: Request) {
  const token = runtime().AGENT_TOKEN ?? "";
  return token.length >= 32 &&
    safeEqual(request.headers.get("authorization") ?? "", `Bearer ${token}`);
}

export function controllerAuthorized(request: Request) {
  const token = runtime().CONTROLLER_TOKEN ?? "";
  return token.length >= 32 &&
    safeEqual(request.headers.get("authorization") ?? "", `Bearer ${token}`);
}

export function maintenanceAuthorized(request: Request) {
  const token = runtime().MAINTENANCE_TOKEN ?? "";
  return token.length >= 32 &&
    safeEqual(request.headers.get("authorization") ?? "", `Bearer ${token}`);
}

export function adminEmails() {
  return new Set((runtime().ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean));
}

export function isAdminEmail(email: string | null | undefined) {
  return Boolean(email) && adminEmails().has(String(email).trim().toLowerCase());
}

export function adminAuthorized(request: Request) {
  return isAdminEmail(request.headers.get("oai-authenticated-user-email"));
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export function noStoreJson(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function plain(value: string, status = 200) {
  return new Response(value, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function readBoundedUtf8(request: Request, maxBytes: number) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    return { error: "payload too large" as const };
  }
  if (!request.body) return { text: "", bytes: 0 };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return { error: "payload too large" as const };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { text, bytes };
  } catch {
    return { error: "invalid utf-8" as const };
  } finally {
    reader.releaseLock();
  }
}

function integer(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseTsv(text: string): MushroomRow[] {
  const rows: MushroomRow[] = [];
  for (const line of text.split("\n")) {
    const fields = line.replace(/\r$/, "").split("\t");
    if (fields.length < 4 || !fields[1] || fields[1].length > 256) continue;
    const lat = Number(fields[2]);
    const lng = Number(fields[3]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const level = integer(fields[6]);
    if (!isUsefulMushroomLevel(level)) continue;
    const power = Number(fields[11] ?? 0);
    rows.push({
      id: fields[1],
      lat,
      lng,
      cluster: (fields[4] ?? "").slice(0, 256),
      cooldown: Math.max(0, integer(fields[5])),
      level,
      type: Math.max(0, Math.min(10_000, integer(fields[7]))),
      finish_ms: Math.max(0, integer(fields[8])),
      challenger_count: Math.max(0, Math.min(10_000, integer(fields[9]))),
      challenger_capacity: Math.max(0, Math.min(10_000, integer(fields[10]))),
      total_power: Number.isFinite(power) ? Math.max(0, Math.min(1e15, power)) : 0,
      start_ms: Math.max(0, integer(fields[12])),
    });
  }
  return rows;
}

export async function upsertMushrooms(rows: MushroomRow[], discoveredByAgentId = "", targetId: number | null = null) {
  const db = runtime().DB;
  const now = Math.floor(Date.now() / 1000);
  const usefulRows = rows.filter((row) => isUsefulMushroomLevel(row.level));
  const sql = `INSERT INTO mushrooms (
      id, lat, lng, level, type, cluster, cooldown, finish_ms,
      first_seen, discovered_by_agent_id, last_seen, challenger_count, challenger_capacity,
      total_power, start_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      lat=excluded.lat,
      lng=excluded.lng,
      level=excluded.level,
      type=excluded.type,
      cluster=excluded.cluster,
      cooldown=excluded.cooldown,
      finish_ms=excluded.finish_ms,
      last_seen=excluded.last_seen,
      participants_verified_at=CASE WHEN mushrooms.start_ms<>excluded.start_ms OR mushrooms.level<>excluded.level THEN 0 ELSE mushrooms.participants_verified_at END,
      challenger_count=excluded.challenger_count,
      challenger_capacity=excluded.challenger_capacity,
      total_power=excluded.total_power,
      first_seen=CASE
        WHEN excluded.start_ms > 0 AND mushrooms.start_ms <> excluded.start_ms
          THEN excluded.first_seen
        ELSE mushrooms.first_seen
      END,
      discovered_by_agent_id=CASE
        WHEN excluded.start_ms > 0 AND mushrooms.start_ms <> excluded.start_ms
          THEN excluded.discovered_by_agent_id
        ELSE mushrooms.discovered_by_agent_id
      END,
      giant_recheck_status=CASE
        WHEN excluded.start_ms > 0 AND mushrooms.start_ms <> excluded.start_ms
          THEN ''
        ELSE mushrooms.giant_recheck_status
      END,
      giant_rechecked_at=CASE
        WHEN excluded.start_ms > 0 AND mushrooms.start_ms <> excluded.start_ms
          THEN 0
        ELSE mushrooms.giant_rechecked_at
      END,
      mushroom_status=CASE
        WHEN excluded.start_ms > 0 AND mushrooms.start_ms <> excluded.start_ms
          THEN 'active'
        ELSE mushrooms.mushroom_status
      END,
      invalidated_at=CASE
        WHEN excluded.start_ms > 0 AND mushrooms.start_ms <> excluded.start_ms
          THEN 0
        ELSE mushrooms.invalidated_at
      END,
      start_ms=excluded.start_ms`;
  // Six rows per statement keep the 15-column snapshot below 100 bindings.
  // Flush 48 statements per batch: history must not quadruple network calls.
  let statements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < usefulRows.length; offset += 6) {
    const chunk = usefulRows.slice(offset, offset + 6);
    const bulkSql = sql.replace(/VALUES \([^)]*\)/,
      `VALUES ${chunk.map(() => `(${Array(15).fill("?").join(",")})`).join(",")}`);
    statements.push(db.prepare(bulkSql).bind(...chunk.flatMap(row => [
        row.id, row.lat, row.lng, row.level, row.type, row.cluster,
        row.cooldown, row.finish_ms, now, discoveredByAgentId, now, row.challenger_count,
        row.challenger_capacity, row.total_power, row.start_ms,
      ])), ...observationStatements(db, chunk, discoveredByAgentId, now, targetId));
    if (statements.length >= 48) { await db.batch(statements); statements = []; }
  }
  if (statements.length) await db.batch(statements);
}

function retentionStatus(row: Record<string, unknown> | null | undefined): MushroomRetentionStatus {
  return {
    lastRunAt: Number(row?.last_run_at ?? 0),
    lastDeleted: Number(row?.last_deleted ?? 0),
    pending: Number(row?.pending ?? 0),
    lastSucceededAt: Number(row?.last_succeeded_at ?? 0),
    lastFailedAt: Number(row?.last_failed_at ?? 0),
    lastFailureStage: String(row?.last_failure_stage ?? ""),
    consecutiveFailures: Number(row?.consecutive_failures ?? 0),
    lastDurationMs: Number(row?.last_duration_ms ?? 0),
    lastInvalidated: Number(row?.last_invalidated ?? 0),
    lastObservationsDeleted: Number(row?.last_observations_deleted ?? 0),
    lastTargetsDeleted: Number(row?.last_targets_deleted ?? 0),
    lastBatchSaturated: Number(row?.last_batch_saturated ?? 0) !== 0,
  };
}

/** Read-only status for the public map; cleanup must not hold a response open. */
export async function readMushroomRetentionStatus(): Promise<MushroomRetentionStatus> {
  if (retentionCached && Date.now() - retentionCheckedAt < 30_000) return retentionCached;
  const row = await runtime().DB.prepare(`SELECT *
    FROM maintenance_state WHERE name='mushroom-retention'`).first();
  return retentionStatus(row);
}

/** Run bounded cleanup after the response, retaining the D1 lease across isolates. */
export function scheduleMushroomRetention(): void {
  waitUntil(runMushroomRetention().catch(() => {
    console.warn(JSON.stringify({ event: "mushroom_retention_failed" }));
  }));
}

export async function runMushroomRetention(): Promise<MushroomRetentionStatus> {
  const now = Date.now();
  if (retentionCached && now - retentionCheckedAt < 30_000) return retentionCached;
  if (retentionInFlight) return retentionInFlight;
  retentionInFlight = performMushroomRetention();
  try {
    retentionCached = await retentionInFlight;
    retentionCheckedAt = Date.now();
    return retentionCached;
  } finally { retentionInFlight = null; }
}

// D1's five-minute lease remains authoritative across isolates. This local,
// bounded memo only avoids repeated lock probes for each public page/upload.
let retentionCached: MushroomRetentionStatus | null = null;
let retentionCheckedAt = 0;
let retentionInFlight: Promise<MushroomRetentionStatus> | null = null;
async function retentionStep<T>(stage: string, action: () => Promise<T>): Promise<T> {
  const began = Date.now();
  try { return await action(); }
  finally {
    const duration = Date.now() - began;
    if (duration >= 1_000) console.info(JSON.stringify({
      event: "mushroom_retention_stage", stage, duration_ms: duration,
    }));
  }
}

async function performMushroomRetention(): Promise<MushroomRetentionStatus> {
  const db = runtime().DB;
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - MUSHROOM_RETENTION_SECONDS;
  const invalidCutoff = now - LEVEL_TWO_THREE_INVALID_AFTER_SECONDS;
  const lockBefore = now - MUSHROOM_RETENTION_INTERVAL_SECONDS;

  const state = await retentionStep("status", () => db.prepare(`SELECT *
    FROM maintenance_state WHERE name='mushroom-retention'`).first());
  if (state && Number(state.last_run_at) >= lockBefore) return retentionStatus(state);
  if (!state) await retentionStep("initialize", () => db.prepare(`INSERT OR IGNORE INTO maintenance_state (name)
    VALUES ('mushroom-retention')`).run());
  const claim = await retentionStep("claim", () => db.prepare(`UPDATE maintenance_state
      SET last_run_at=?
      WHERE name='mushroom-retention' AND last_run_at<?`)
    .bind(now, lockBefore).run());
  if (Number(claim.meta.changes ?? 0) === 0) {
    return retentionStatus(await db.prepare(`SELECT *
      FROM maintenance_state WHERE name='mushroom-retention'`).first());
  }
  const began = Date.now();
  let stage = "invalidate";
  try {
  const invalidated = await retentionStep("invalidate", () => db.prepare(`UPDATE mushrooms
      SET mushroom_status='invalid', invalidated_at=?
      WHERE id IN (SELECT id FROM mushrooms
        WHERE mushroom_status='active' AND level IN (2, 3) AND first_seen < ?
        LIMIT ?)`)
    .bind(now, invalidCutoff, MUSHROOM_INVALIDATION_BATCH_SIZE).run());
  stage = "count";
  const candidates = await retentionStep("count", () => db.prepare(`SELECT COUNT(*) AS count FROM mushrooms
    WHERE last_seen < ?`).bind(cutoff).first<{ count: number }>());
  const eligible = Number(candidates?.count ?? 0);
  stage = "delete_mushrooms";
  const deleted = await retentionStep("delete_mushrooms", () => db.prepare(`DELETE FROM mushrooms WHERE id IN (
      SELECT id FROM mushrooms WHERE last_seen < ?
      ORDER BY last_seen ASC, id ASC LIMIT ?
    )`).bind(cutoff, MUSHROOM_RETENTION_BATCH_SIZE).run());
  const lastDeleted = Number(deleted.meta.changes ?? 0);
  // Bounded history retention shares the existing five-minute maintenance lease.
  stage = "delete_observations";
  const observations = await retentionStep("delete_observations", () => db.prepare(`DELETE FROM mushroom_observations WHERE key IN (
      SELECT key FROM mushroom_observations WHERE received_at < ?
      ORDER BY received_at LIMIT ?
    )`).bind(cutoff, MUSHROOM_HISTORY_BATCH_SIZE).run());
  const pending = Math.max(0, eligible - lastDeleted);
  // Archives are kept beyond the seven-day evidence window and pruned in bounds.
  stage = "delete_targets";
  const targets = await retentionStep("delete_targets", () => db.prepare(`DELETE FROM scan_target_history WHERE id IN (
    SELECT id FROM scan_target_history WHERE archived_at < ? ORDER BY archived_at LIMIT ?
  )`).bind((cutoff-86400)*1000, MUSHROOM_HISTORY_BATCH_SIZE).run());
  stage = "record_success";
  const lastInvalidated = Number(invalidated.meta.changes ?? 0);
  const lastObservationsDeleted = Number(observations.meta.changes ?? 0);
  const lastTargetsDeleted = Number(targets.meta.changes ?? 0);
  const lastBatchSaturated = Number(lastInvalidated >= MUSHROOM_INVALIDATION_BATCH_SIZE ||
    lastDeleted >= MUSHROOM_RETENTION_BATCH_SIZE ||
    lastObservationsDeleted >= MUSHROOM_HISTORY_BATCH_SIZE ||
    lastTargetsDeleted >= MUSHROOM_HISTORY_BATCH_SIZE);
  await db.prepare(`UPDATE maintenance_state
      SET last_deleted=?, pending=?, last_succeeded_at=?, consecutive_failures=0,
        last_failure_stage='', last_duration_ms=?, last_invalidated=?,
        last_observations_deleted=?, last_targets_deleted=?, last_batch_saturated=?
      WHERE name='mushroom-retention'`)
    .bind(lastDeleted, pending, now, Date.now() - began, lastInvalidated,
      lastObservationsDeleted, lastTargetsDeleted, lastBatchSaturated).run();
  return retentionStatus(await db.prepare(`SELECT * FROM maintenance_state
    WHERE name='mushroom-retention'`).first());
  } catch (error) {
    console.warn(JSON.stringify({ event: "mushroom_retention_failed", stage }));
    try {
      await db.prepare(`UPDATE maintenance_state SET last_failed_at=?, last_failure_stage=?,
        consecutive_failures=consecutive_failures+1 WHERE name='mushroom-retention'`)
        .bind(Math.floor(Date.now() / 1000), stage).run();
    } catch {
      console.warn(JSON.stringify({ event: "mushroom_retention_failure_record_failed" }));
    }
    throw error;
  }
}
