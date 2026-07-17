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
};

export function runtime(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
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
    db.prepare(`CREATE TABLE IF NOT EXISTS scanner_status (
      id INTEGER PRIMARY KEY,
      status_json TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL DEFAULT 0
    )`),
  ]);
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO agent_state (id) VALUES (1)"),
    db.prepare("INSERT OR IGNORE INTO scanner_status (id) VALUES (1)"),
  ]);
}

function safeEqual(a: string, b: string) {
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
