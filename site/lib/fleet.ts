import { ensureSchema, runtime, safeEqual } from "./cloud";
import { activeJob, appendScanLog, parseJobConfig, parseJobPlan, type ScanJobRow } from "./scans";

export const PRIMARY_AGENT_ID = "primary";
export const AGENT_ONLINE_MS = 15_000;
const LEASE_MS = 6 * 60_000;

export type ScanAgentRow = {
  id: string;
  display_name: string;
  token_hash: string;
  enabled: number;
  paused: number;
  region_tags_json: string;
  capabilities_json: string;
  agent_version: string;
  last_seen: number;
  current_lat: number | null;
  current_lng: number | null;
  current_job_id: number | null;
  current_target_id: number | null;
  uploaded_rows: number;
  uploaded_bytes: number;
  partial_text: string;
  created_at: number;
  updated_at: number;
};

export type ScanTargetRow = {
  id: number;
  job_id: number;
  sequence: number;
  cycle: number;
  country: string;
  city: string;
  lat: number;
  lng: number;
  region_index: number;
  point_index: number;
  base_cooldown_s: number;
  status: string;
  lease_agent_id: string;
  lease_token: string;
  lease_expires_at: number;
  attempts: number;
  captured_rows: number;
  captured_bytes: number;
  error: string;
  created_at: number;
  updated_at: number;
  completed_at: number;
};

function bearer(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function normalizeAgentId(value: string | null) {
  const id = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) ? id : "";
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function hashAgentToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(digest));
}

function randomHex(bytes = 18) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToHex(value);
}

export function issueAgentCredential(name: string) {
  const slug = name.normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "agent";
  return {
    id: `${slug}-${randomHex(4)}`,
    token: randomHex(32),
  };
}

export async function authorizeFleetAgent(request: Request) {
  await ensureSchema();
  const id = normalizeAgentId(request.headers.get("x-agent-id")) || PRIMARY_AGENT_ID;
  const token = bearer(request);
  if (!token) return null;
  const legacy = runtime().AGENT_TOKEN ?? "";
  if (id === PRIMARY_AGENT_ID && legacy.length >= 32 &&
      safeEqual(token, legacy)) {
    return runtime().DB.prepare("SELECT * FROM scan_agents WHERE id=? AND enabled=1")
      .bind(id).first<ScanAgentRow>();
  }
  const row = await runtime().DB.prepare(
    "SELECT * FROM scan_agents WHERE id=? AND enabled=1",
  ).bind(id).first<ScanAgentRow>();
  if (!row?.token_hash) return null;
  const actual = await hashAgentToken(token);
  return safeEqual(actual, row.token_hash) ? row : null;
}

export async function touchAgent(
  agentId: string,
  values: {
    lat?: number | null;
    lng?: number | null;
    jobId?: number | null;
    targetId?: number | null;
    version?: string;
  } = {},
) {
  const db = runtime().DB;
  const now = Date.now();
  await db.prepare(`UPDATE scan_agents SET
      last_seen=?,
      current_lat=COALESCE(?, current_lat),
      current_lng=COALESCE(?, current_lng),
      current_job_id=CASE WHEN ?=1 THEN ? ELSE current_job_id END,
      current_target_id=CASE WHEN ?=1 THEN ? ELSE current_target_id END,
      agent_version=CASE WHEN ?='' THEN agent_version ELSE ? END,
      updated_at=?
    WHERE id=? AND (last_seen<? OR ?=1 OR ?=1 OR (?<>'' AND agent_version<>?))`)
    .bind(now, values.lat ?? null, values.lng ?? null,
      values.jobId !== undefined ? 1 : 0, values.jobId ?? null,
      values.targetId !== undefined ? 1 : 0, values.targetId ?? null,
      values.version ?? "", values.version ?? "", now, agentId,
      now - 5_000, values.jobId !== undefined ? 1 : 0,
      values.targetId !== undefined ? 1 : 0, values.version ?? "", values.version ?? "")
    .run();
}

function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const radius = 6371;
  const dlat = (b.lat - a.lat) * Math.PI / 180;
  const dlng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dlat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dlng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function parseTags(row: ScanAgentRow) {
  try {
    const tags = JSON.parse(row.region_tags_json);
    return Array.isArray(tags) ? tags.map(String).filter(Boolean).slice(0, 40) : [];
  } catch {
    return [];
  }
}

async function writeScannerStatus(
  job: ScanJobRow,
  target: ScanTargetRow,
  message: string,
  running: boolean,
  newRows = 0,
) {
  const now = Date.now();
  const status = {
    running,
    point: Number(job.current_index),
    total: Number(job.total_points),
    at: [Number(target.lat), Number(target.lng)],
    added_total: 0,
    captured_total: Number(job.captured_rows),
    new_at_point: newRows,
    empty_capture_streak: newRows ? 0 : 1,
    softban_warn: 0,
    last_msg: message,
    city: target.city,
    country: target.country,
    cycle: Number(job.cycle) + 1,
    source: "agent-fleet-v2",
  };
  await runtime().DB.prepare(
    "UPDATE scanner_status SET status_json=?, updated_at=? WHERE id=1",
  ).bind(JSON.stringify(status), Math.floor(now / 1000)).run();
}

export async function materializeTargets(
  jobId: number,
  plan = [] as ReturnType<typeof parseJobPlan>,
  options: { cycle?: number; completedBefore?: number } = {},
) {
  const db = runtime().DB;
  const job = await db.prepare("SELECT * FROM scan_jobs WHERE id=?")
    .bind(jobId).first<ScanJobRow>();
  if (!job) throw new Error("scan job missing");
  const targets = plan.length ? plan : parseJobPlan(job);
  const now = Date.now();
  const cycle = options.cycle ?? Number(job.cycle);
  const completedBefore = Math.max(0, options.completedBefore ?? 0);
  const rowsPerInsert = 7;
  const statementsPerBatch = 50;
  let statements = [] as ReturnType<typeof db.prepare>[];
  for (let offset = 0; offset < targets.length; offset += rowsPerInsert) {
    const chunk = targets.slice(offset, offset + rowsPerInsert);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
    const values = chunk.flatMap((target, index) => [
      jobId, offset + index, cycle, target.country, target.city,
      target.lat, target.lng, target.regionIndex, target.pointIndex,
      target.cooldownS, offset + index < completedBefore ? "completed" : "queued",
      now, now, offset + index < completedBefore ? now : 0,
    ]);
    statements.push(db.prepare(`INSERT OR IGNORE INTO scan_targets (
        job_id, sequence, cycle, country, city, lat, lng, region_index,
        point_index, base_cooldown_s, status, created_at, updated_at, completed_at
      ) VALUES ${placeholders}`).bind(...values));
    if (statements.length >= statementsPerBatch) {
      await db.batch(statements);
      statements = [];
    }
  }
  if (statements.length) await db.batch(statements);
}

async function ensureJobTargets(job: ScanJobRow) {
  const db = runtime().DB;
  const count = await db.prepare(
    "SELECT COUNT(*) AS count FROM scan_targets WHERE job_id=?",
  ).bind(job.id).first<{ count: number }>();
  if (Number(count?.count ?? 0) >= Number(job.total_points)) return;
  let completedBefore = Math.max(0, Number(job.current_index));
  if (!completedBefore) {
    const scanner = await db.prepare(
      "SELECT status_json FROM scanner_status WHERE id=1",
    ).first();
    try {
      const status = JSON.parse(String(scanner?.status_json ?? "{}"));
      const point = Number(status.point ?? 0);
      const total = Number(status.total ?? 0);
      if (total === Number(job.total_points) && point > 0 && point < total) {
        completedBefore = point;
      }
    } catch {
      completedBefore = 0;
    }
  }
  await materializeTargets(job.id, parseJobPlan(job), {
    cycle: Number(job.cycle),
    completedBefore,
  });
  if (completedBefore !== Number(job.current_index)) {
    await db.prepare("UPDATE scan_jobs SET current_index=?, updated_at=? WHERE id=?")
      .bind(completedBefore, Date.now(), job.id).run();
    job.current_index = completedBefore;
  }
  await appendScanLog(job.id, "info",
    `既有工作已轉換為多 Agent 佇列，從 ${completedBefore}/${job.total_points} 續跑`);
}

async function releaseExpiredLeases(jobId: number, now: number) {
  const db = runtime().DB;
  const expired = await db.prepare(`SELECT id, lease_agent_id FROM scan_targets
    WHERE job_id=? AND status='leased' AND lease_expires_at<? LIMIT 100`)
    .bind(jobId, now).all<{ id: number; lease_agent_id: string }>();
  if (!expired.results.length) return;
  await db.batch(expired.results.map((target) =>
    db.prepare(`UPDATE scan_targets SET status='queued', lease_agent_id='',
      lease_token='', lease_expires_at=0, updated_at=?
      WHERE id=? AND status='leased' AND lease_expires_at<?`)
      .bind(now, target.id, now)));
  for (const target of expired.results.slice(0, 8)) {
    await appendScanLog(jobId, "warn",
      `Agent ${target.lease_agent_id || "unknown"} 租約逾時，掃描點已重新排隊`);
  }
}

async function resetLoop(job: ScanJobRow) {
  const db = runtime().DB;
  const now = Date.now();
  const nextCycle = Number(job.cycle) + 1;
  const won = await db.prepare(`UPDATE scan_jobs SET cycle=?, current_index=0,
      updated_at=?, message=? WHERE id=? AND cycle=? AND loop=1
      AND EXISTS (SELECT 1 FROM scan_targets WHERE job_id=?)
      AND NOT EXISTS (
        SELECT 1 FROM scan_targets WHERE job_id=? AND status IN ('queued','leased')
      )`)
    .bind(nextCycle, now, `第 ${nextCycle} 輪完成，重新分派掃描點`,
      job.id, job.cycle, job.id, job.id).run();
  if (!won.meta.changes) return false;
  await db.prepare(`UPDATE scan_targets SET cycle=?, status='queued',
      lease_agent_id='', lease_token='', lease_expires_at=0, captured_rows=0,
      captured_bytes=0, error='', completed_at=0, updated_at=?
    WHERE job_id=?`).bind(nextCycle, now, job.id).run();
  await appendScanLog(job.id, "info", `第 ${nextCycle} 輪開始，多 Agent 重新分派`);
  return true;
}

async function finishJobIfDone(job: ScanJobRow) {
  const db = runtime().DB;
  const now = Date.now();
  if (job.loop) return resetLoop(job);
  const result = await db.prepare(`UPDATE scan_jobs SET status='completed',
      finished_at=?, updated_at=?, message='所有掃描點已由 Agent 叢集完成'
    WHERE id=? AND status IN ('queued','running')
      AND EXISTS (SELECT 1 FROM scan_targets WHERE job_id=?)
      AND NOT EXISTS (
        SELECT 1 FROM scan_targets WHERE job_id=? AND status IN ('queued','leased')
      )`).bind(now, now, job.id, job.id, job.id).run();
  if (result.meta.changes) {
    await appendScanLog(job.id, "info", "所有掃描點已完成");
    return true;
  }
  return false;
}

async function candidateTarget(job: ScanJobRow, agent: ScanAgentRow) {
  const db = runtime().DB;
  const tags = parseTags(agent);
  const location = agent.current_lat == null ? null :
    { lat: Number(agent.current_lat), lng: Number(agent.current_lng) };
  const tagFilter = tags.length
    ? `AND country IN (${tags.map(() => "?").join(",")})`
    : "";
  const whereTags = tags.length
    ? `CASE country ${tags.map((_, index) => `WHEN ? THEN ${index}`).join(" ")} ELSE ${tags.length} END,`
    : "";
  const distanceOrder = location
    ? `((lat-?)*(lat-?) + (lng-?)*(lng-?)),`
    : "";
  const params: unknown[] = [job.id, Number(job.cycle), ...tags, ...tags];
  if (location) params.push(location.lat, location.lat, location.lng, location.lng);
  return db.prepare(`SELECT * FROM scan_targets
    WHERE job_id=? AND cycle=? AND status='queued' ${tagFilter}
    ORDER BY ${whereTags} ${distanceOrder} sequence ASC LIMIT 1`)
    .bind(...params).first<ScanTargetRow>();
}

export type ClaimedTask = {
  job: ScanJobRow;
  target: ScanTargetRow;
  leaseToken: string;
  dwellS: number;
  hopDelayS: number;
  cooldownS: number;
};

export async function claimTask(agent: ScanAgentRow): Promise<ClaimedTask | null> {
  await ensureSchema();
  const db = runtime().DB;
  if (agent.paused) {
    // 此 Agent 被後台暫停：保持在線（touch）但不派工。
    await touchAgent(agent.id);
    return null;
  }
  const job = await activeJob();
  if (!job || job.status === "paused") {
    await touchAgent(agent.id);
    return null;
  }
  await ensureJobTargets(job);
  const now = Date.now();
  await releaseExpiredLeases(job.id, now);
  const existing = await db.prepare(`SELECT * FROM scan_targets
    WHERE job_id=? AND status='leased' AND lease_agent_id=?
      AND lease_expires_at>? ORDER BY id LIMIT 1`)
    .bind(job.id, agent.id, now).first<ScanTargetRow>();
  let target = existing ?? null;
  let leaseToken = target?.lease_token ?? "";
  if (!target) {
    for (let attempt = 0; attempt < 4 && !target; attempt += 1) {
      const candidate = await candidateTarget(job, agent);
      if (!candidate) break;
      leaseToken = randomHex(18);
      const claimed = await db.prepare(`UPDATE scan_targets SET
          status='leased', lease_agent_id=?, lease_token=?, lease_expires_at=?,
          attempts=attempts+1, updated_at=?
        WHERE id=? AND status='queued'`)
        .bind(agent.id, leaseToken, now + LEASE_MS, now, candidate.id).run();
      if (claimed.meta.changes) {
        target = { ...candidate, status: "leased", lease_agent_id: agent.id,
          lease_token: leaseToken, lease_expires_at: now + LEASE_MS };
      }
    }
  }
  if (!target) {
    await finishJobIfDone(job);
    await touchAgent(agent.id);
    return null;
  }

  const config = parseJobConfig(job);
  const location = agent.current_lat == null ? null :
    { lat: Number(agent.current_lat), lng: Number(agent.current_lng) };
  const distanceCooldown = location
    ? Math.min(120, Math.round(distanceKm(location, { lat: target.lat, lng: target.lng }) / 10))
    : 0;
  const cooldownS = Math.max(Number(target.base_cooldown_s), distanceCooldown);
  await db.batch([
    db.prepare(`UPDATE scan_jobs SET status='running',
      started_at=CASE WHEN started_at=0 THEN ? ELSE started_at END,
      current_country=?, current_city=?, current_lat=?, current_lng=?,
      message=?, updated_at=? WHERE id=?`)
      .bind(now, target.country, target.city, target.lat, target.lng,
        `${agent.display_name} 前往 ${target.country ? `${target.country}-` : ""}${target.city}`,
        now, job.id),
    db.prepare(`UPDATE scan_agents SET last_seen=?, current_job_id=?,
      current_target_id=?, updated_at=? WHERE id=?`)
      .bind(now, job.id, target.id, now, agent.id),
  ]);
  await writeScannerStatus(job, target,
    `${agent.display_name} 前往 ${target.country ? `${target.country}-` : ""}${target.city}`,
    true);
  return {
    job,
    target,
    leaseToken,
    dwellS: Math.round(config.dwellS),
    hopDelayS: Math.round(config.hopDelayS),
    cooldownS,
  };
}

export async function renewLease(
  agentId: string,
  jobId: number,
  targetId: number,
  leaseToken: string,
) {
  const db = runtime().DB;
  const now = Date.now();
  const result = await db.prepare(`UPDATE scan_targets SET lease_expires_at=?, updated_at=?
    WHERE id=? AND job_id=? AND status='leased' AND lease_agent_id=? AND lease_token=?`)
    .bind(now + LEASE_MS, now, targetId, jobId, agentId, leaseToken).run();
  await touchAgent(agentId, { jobId, targetId });
  return Boolean(result.meta.changes);
}

export async function completeTask(
  agent: ScanAgentRow,
  input: {
    jobId: number;
    targetId: number;
    leaseToken: string;
    ok: boolean;
    rows: number;
    bytes: number;
    message: string;
  },
) {
  const db = runtime().DB;
  const target = await db.prepare(`SELECT * FROM scan_targets WHERE
    id=? AND job_id=?`).bind(input.targetId, input.jobId).first<ScanTargetRow>();
  if (!target) return "missing" as const;
  if (target.status === "completed") return "duplicate" as const;
  if (target.status !== "leased" || target.lease_agent_id !== agent.id ||
      !safeEqual(target.lease_token, input.leaseToken)) return "stale" as const;
  const job = await db.prepare("SELECT * FROM scan_jobs WHERE id=?")
    .bind(input.jobId).first<ScanJobRow>();
  if (!job || !["queued", "running"].includes(job.status)) return "stop" as const;
  const now = Date.now();
  const status = input.ok ? "completed" : target.attempts >= 3 ? "failed" : "queued";
  const completedDelta = status === "completed" || status === "failed" ? 1 : 0;
  const message = input.ok
    ? `${agent.display_name} 完成 ${target.city}，新增 ${input.rows} 行`
    : status === "failed"
      ? `${agent.display_name} 執行 ${target.city} 失敗，已達重試上限`
      : `${agent.display_name} 執行 ${target.city} 失敗，重新排隊`;
  const targetUpdate = await db.prepare(`UPDATE scan_targets SET status=?,
      lease_agent_id='', lease_token='', lease_expires_at=0,
      captured_rows=captured_rows+?, captured_bytes=captured_bytes+?,
      error=?, updated_at=?, completed_at=CASE WHEN ? IN ('completed','failed') THEN ? ELSE 0 END
    WHERE id=? AND status='leased' AND lease_agent_id=? AND lease_token=?`)
    .bind(status, input.rows, input.bytes, input.message, now, status, now,
      target.id, agent.id, input.leaseToken).run();
  if (!targetUpdate.meta.changes) return "stale" as const;
  await db.batch([
    db.prepare(`UPDATE scan_jobs SET current_index=current_index+?,
      captured_rows=captured_rows+?, captured_bytes=captured_bytes+?,
      current_country=?, current_city=?, current_lat=?, current_lng=?,
      message=?, updated_at=? WHERE id=?`)
      .bind(completedDelta, input.rows, input.bytes, target.country, target.city,
        target.lat, target.lng, message, now, job.id),
    db.prepare(`UPDATE scan_agents SET last_seen=?, current_lat=?, current_lng=?,
      current_job_id=NULL, current_target_id=NULL, updated_at=? WHERE id=?`)
      .bind(now, target.lat, target.lng, now, agent.id),
  ]);
  await appendScanLog(job.id, input.ok && input.rows ? "info" : input.ok ? "warn" : "error",
    `${agent.display_name}・${target.country ? `${target.country}-` : ""}${target.city} ` +
    `${target.sequence + 1}/${job.total_points}・擷取 +${input.rows} 行`);
  const refreshed = await db.prepare("SELECT * FROM scan_jobs WHERE id=?")
    .bind(job.id).first<ScanJobRow>();
  if (refreshed) {
    await finishJobIfDone(refreshed);
    const latest = await db.prepare("SELECT * FROM scan_jobs WHERE id=?")
      .bind(job.id).first<ScanJobRow>() ?? refreshed;
    await writeScannerStatus(latest, target, message,
      ["queued", "running"].includes(latest.status), input.rows);
  }
  return status === "queued" ? "retry" as const : "ok" as const;
}

export function publicAgent(row: ScanAgentRow, now = Date.now()) {
  let regionTags: string[] = [];
  try {
    const parsed = JSON.parse(row.region_tags_json);
    if (Array.isArray(parsed)) regionTags = parsed.map(String);
  } catch {
    regionTags = [];
  }
  return {
    id: row.id,
    name: row.display_name,
    enabled: Boolean(row.enabled),
    paused: Boolean(row.paused),
    online: Boolean(row.enabled) && now - Number(row.last_seen) < AGENT_ONLINE_MS,
    last_seen: Number(row.last_seen),
    current_location: row.current_lat == null ? null :
      [Number(row.current_lat), Number(row.current_lng)],
    current_job_id: row.current_job_id == null ? null : Number(row.current_job_id),
    current_target_id: row.current_target_id == null ? null : Number(row.current_target_id),
    uploaded_rows: Number(row.uploaded_rows),
    uploaded_bytes: Number(row.uploaded_bytes),
    region_tags: regionTags,
    version: row.agent_version,
  };
}
