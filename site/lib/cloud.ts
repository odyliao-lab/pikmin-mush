import { env } from "cloudflare:workers";

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

type RuntimeEnv = {
  DB: D1Database;
  AGENT_TOKEN?: string;
  ADMIN_EMAILS?: string;
};

export function runtime(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

// 對既有表補上後來新增的欄位（CREATE TABLE IF NOT EXISTS 不會改動既有表）。
// 每個 worker isolate 只需嘗試一次；欄位已存在時 ALTER 會丟錯，忽略即可。
let columnsPatched = false;
async function patchColumns(db: RuntimeEnv["DB"]) {
  if (columnsPatched) return;
  const additions = [
    "ALTER TABLE scan_agents ADD COLUMN paused INTEGER NOT NULL DEFAULT 0",
  ];
  for (const sql of additions) {
    try {
      await db.prepare(sql).run();
    } catch {
      // 欄位已存在（duplicate column name）—— 正常，略過。
    }
  }
  columnsPatched = true;
}

export async function ensureSchema() {
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
      last_seen INTEGER NOT NULL,
      challenger_count INTEGER NOT NULL DEFAULT 0,
      challenger_capacity INTEGER NOT NULL DEFAULT 0,
      total_power REAL NOT NULL DEFAULT 0,
      start_ms INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS mushrooms_finish_ms_idx
      ON mushrooms (finish_ms)`),
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
      last_seen INTEGER NOT NULL DEFAULT 0,
      current_lat REAL,
      current_lng REAL,
      current_job_id INTEGER,
      current_target_id INTEGER,
      uploaded_rows INTEGER NOT NULL DEFAULT 0,
      uploaded_bytes INTEGER NOT NULL DEFAULT 0,
      partial_text TEXT NOT NULL DEFAULT '',
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
      lease_expires_at INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      captured_rows INTEGER NOT NULL DEFAULT 0,
      captured_bytes INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scan_targets_claim_idx
      ON scan_targets (job_id, status, cycle)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scan_targets_lease_idx
      ON scan_targets (lease_expires_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scan_targets_agent_idx
      ON scan_targets (lease_agent_id, status)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS scan_targets_job_sequence_uidx
      ON scan_targets (job_id, sequence)`),
  ]);
  await patchColumns(db);
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO agent_state (id) VALUES (1)"),
    db.prepare("INSERT OR IGNORE INTO scanner_status (id) VALUES (1)"),
    db.prepare(`INSERT OR IGNORE INTO scan_agents (
      id, display_name, region_tags_json, last_seen, current_lat, current_lng,
      uploaded_rows, uploaded_bytes, partial_text, created_at, updated_at
    ) SELECT 'primary', '主要 Agent', '[]', last_seen, current_lat, current_lng,
      uploaded_rows, uploaded_bytes, partial_text, ?, ?
      FROM agent_state WHERE id=1`).bind(now, now),
  ]);
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

function integer(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseTsv(text: string): MushroomRow[] {
  const rows: MushroomRow[] = [];
  for (const line of text.split("\n")) {
    const fields = line.replace(/\r$/, "").split("\t");
    if (fields.length < 4 || !fields[1]) continue;
    const lat = Number(fields[2]);
    const lng = Number(fields[3]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const power = Number(fields[11] ?? 0);
    rows.push({
      id: fields[1],
      lat,
      lng,
      cluster: fields[4] ?? "",
      cooldown: integer(fields[5]),
      level: integer(fields[6]),
      type: integer(fields[7]),
      finish_ms: integer(fields[8]),
      challenger_count: integer(fields[9]),
      challenger_capacity: integer(fields[10]),
      total_power: Number.isFinite(power) ? power : 0,
      start_ms: integer(fields[12]),
    });
  }
  return rows;
}

export async function upsertMushrooms(rows: MushroomRow[]) {
  const db = runtime().DB;
  const now = Math.floor(Date.now() / 1000);
  const sql = `INSERT INTO mushrooms (
      id, lat, lng, level, type, cluster, cooldown, finish_ms,
      first_seen, last_seen, challenger_count, challenger_capacity,
      total_power, start_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      lat=excluded.lat,
      lng=excluded.lng,
      level=excluded.level,
      type=excluded.type,
      cluster=excluded.cluster,
      cooldown=excluded.cooldown,
      finish_ms=excluded.finish_ms,
      last_seen=excluded.last_seen,
      challenger_count=excluded.challenger_count,
      challenger_capacity=excluded.challenger_capacity,
      total_power=excluded.total_power,
      start_ms=excluded.start_ms`;
  for (let offset = 0; offset < rows.length; offset += 50) {
    const statements = rows.slice(offset, offset + 50).map((row) =>
      db.prepare(sql).bind(
        row.id, row.lat, row.lng, row.level, row.type, row.cluster,
        row.cooldown, row.finish_ms, now, now, row.challenger_count,
        row.challenger_capacity, row.total_power, row.start_ms,
      ));
    if (statements.length) await db.batch(statements);
  }
}
