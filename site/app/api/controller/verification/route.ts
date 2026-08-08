import {
  controllerAuthorized, ensureSchema, noStoreJson, readBoundedUtf8, runtime,
} from "../../../../lib/cloud";
import { activeJob, type ScanJobRow } from "../../../../lib/scans";

type Candidate = {
  id: string;
  lat: number;
  lng: number;
};

type VerificationKind = "candidate" | "giant-recheck";

const GIANT_RECHECK_LOOKBACK_MS = 48 * 60 * 60 * 1000;

function finiteCoordinate(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function cleanBatch(value: unknown) {
  const batch = String(value ?? "").trim();
  return /^[a-zA-Z0-9._:-]{6,100}$/.test(batch) ? batch : "";
}

export async function POST(request: Request) {
  if (!controllerAuthorized(request)) {
    return noStoreJson({ error: "unauthorized" }, 401);
  }
  await ensureSchema();
  const body = await readBoundedUtf8(request, 64 * 1024);
  if ("error" in body) return noStoreJson({ error: body.error }, 413);
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(body.text);
  } catch {
    return noStoreJson({ error: "invalid json" }, 400);
  }

  const agentId = String(input.agentId ?? "").trim().toLowerCase();
  const batch = cleanBatch(input.batch);
  const replaceExisting = input.replaceExisting === true;
  const kind = String(input.kind ?? "candidate") as VerificationKind;
  const rawCandidates = Array.isArray(input.candidates) ? input.candidates : [];
  if (!agentId || !batch || !["candidate", "giant-recheck"].includes(kind)) {
    return noStoreJson({ error: "agentId, batch and a supported kind are required" }, 400);
  }
  if (kind === "candidate" && (!rawCandidates.length || rawCandidates.length > 30)) {
    return noStoreJson({ error: "candidate verification requires 1-30 candidates" }, 400);
  }
  if (kind === "giant-recheck" && rawCandidates.length) {
    return noStoreJson({ error: "giant recheck selects candidates on the server" }, 400);
  }
  const candidates: Candidate[] = [];
  for (const item of rawCandidates) {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const id = String(row.id ?? "").trim().slice(0, 180);
    const lat = finiteCoordinate(row.lat, -90, 90);
    const lng = finiteCoordinate(row.lng, -180, 180);
    if (!id || lat == null || lng == null) {
      return noStoreJson({ error: "invalid candidate" }, 400);
    }
    if (!candidates.some((candidate) => candidate.id === id)) {
      candidates.push({ id, lat, lng });
    }
  }

  const db = runtime().DB;
  if (kind === "giant-recheck") {
    const now = Date.now();
    const rows = await db.prepare(`SELECT id, lat, lng FROM mushrooms
      WHERE level=4 AND challenger_capacity>0 AND challenger_count>=0
        AND challenger_count<5 AND first_seen>=?
        AND giant_recheck_status<>'invalid'
        AND (finish_ms=0 OR finish_ms>?)
      ORDER BY first_seen ASC, id ASC`)
      .bind(Math.floor((now - GIANT_RECHECK_LOOKBACK_MS) / 1000), now)
      .all<Candidate>();
    candidates.push(...rows.results.map((row) => ({
      id: String(row.id), lat: Number(row.lat), lng: Number(row.lng),
    })));
    if (!candidates.length) {
      return noStoreJson({ ok: true, batch, kind, candidates: 0, empty: true });
    }
  }
  const existing = await db.prepare(
    "SELECT COUNT(*) AS count FROM scan_targets WHERE verification_batch=?",
  ).bind(batch).first<{ count: number }>();
  const existingCount = Number(existing?.count ?? 0);
  if (existingCount && !replaceExisting) {
    return noStoreJson({ ok: true, batch, existing: true });
  }
  const agent = await db.prepare(`SELECT id, region_tags_json, current_lat, current_lng
    FROM scan_agents WHERE id=? AND enabled=1`).bind(agentId).first<{
      id: string;
      region_tags_json: string;
      current_lat: number | null;
      current_lng: number | null;
    }>();
  if (!agent) return noStoreJson({ error: "agent not found" }, 404);
  const job = await activeJob();
  if (!job || !["queued", "running"].includes(job.status)) {
    return noStoreJson({ error: "no active scan job" }, 409);
  }
  let country = "";
  try {
    const tags = JSON.parse(agent.region_tags_json);
    if (Array.isArray(tags)) country = String(tags[0] ?? "");
  } catch {
    country = "";
  }
  if (!country) return noStoreJson({ error: "agent has no assigned region" }, 409);

  const now = Date.now();
  if (existingCount) {
    await db.prepare(
      "DELETE FROM scan_targets WHERE verification_batch=?",
    ).bind(batch).run();
  }
  const minimum = await db.prepare(
    "SELECT MIN(sequence) AS value FROM scan_targets WHERE job_id=?",
  ).bind(job.id).first<{ value: number | null }>();
  let sequence = Math.min(-1, Number(minimum?.value ?? 0) - candidates.length - 2);
  const inserts = candidates.map((candidate, index) =>
    db.prepare(`INSERT INTO scan_targets (
      job_id, sequence, cycle, country, city, lat, lng, region_index, point_index,
      base_cooldown_s, status, priority, required_agent_id, verification_batch,
      verification_mushroom_id, verification_kind, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, -1, ?, 0, 'queued', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(job.id, sequence++, Number(job.cycle), country,
        kind === "giant-recheck" ? "巨菇報後複查" : "通知前人數複核",
        candidate.lat, candidate.lng, index, kind === "giant-recheck" ? 80 : 100,
        agentId, batch, candidate.id, kind, now, now));
  if (agent.current_lat != null && agent.current_lng != null) {
    inserts.push(db.prepare(`INSERT INTO scan_targets (
      job_id, sequence, cycle, country, city, lat, lng, region_index, point_index,
      base_cooldown_s, status, priority, required_agent_id, verification_batch,
      verification_mushroom_id, verification_kind, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '返回原掃描位置', ?, ?, -1, ?, 0, 'queued', 90, ?, ?, '', 'return', ?, ?)`)
      .bind(job.id, sequence++, Number(job.cycle), country,
        Number(agent.current_lat), Number(agent.current_lng), candidates.length,
        agentId, batch, now, now));
  }
  await db.prepare(`UPDATE scan_targets SET status='cancelled', updated_at=?
    WHERE required_agent_id=? AND verification_kind=?
      AND verification_batch<>? AND status='queued'`)
    .bind(now, agentId, kind, batch).run();
  // A two-day giant recheck can contain far more rows than a notification
  // batch. Keep each D1 batch bounded so one busy report cannot exceed the
  // statement limit and silently leave Agent1 without its follow-up queue.
  for (let offset = 0; offset < inserts.length; offset += 50) {
    await db.batch(inserts.slice(offset, offset + 50));
  }
  return noStoreJson({
    ok: true,
    batch,
    kind,
    job_id: Number((job as ScanJobRow).id),
    candidates: candidates.length,
    replaced: Boolean(existingCount),
    return_scheduled: agent.current_lat != null && agent.current_lng != null,
  });
}

export async function GET(request: Request) {
  if (!controllerAuthorized(request)) {
    return noStoreJson({ error: "unauthorized" }, 401);
  }
  await ensureSchema();
  const batch = cleanBatch(new URL(request.url).searchParams.get("batch"));
  if (!batch) return noStoreJson({ error: "invalid batch" }, 400);
  const rows = await runtime().DB.prepare(`SELECT
      t.verification_mushroom_id AS id, t.status, t.leased_at, t.completed_at,
      t.verification_kind, t.verification_result,
      m.level,
      m.challenger_count, m.challenger_capacity, m.last_seen
    FROM scan_targets t
    LEFT JOIN mushrooms m ON m.id=t.verification_mushroom_id
    WHERE t.verification_batch=? AND t.verification_kind IN ('candidate','giant-recheck')
    ORDER BY t.id`).bind(batch).all<{
      id: string;
      status: string;
      leased_at: number;
      completed_at: number;
      verification_kind: string;
      verification_result: string;
      level: number | null;
      challenger_count: number | null;
      challenger_capacity: number | null;
      last_seen: number | null;
    }>();
  if (!rows.results.length) return noStoreJson({ error: "batch not found" }, 404);
  const candidates = rows.results.map((row) => {
    const refreshed = row.status === "completed" && row.last_seen != null &&
      Number(row.last_seen) * 1000 >= Number(row.leased_at);
    const count = Number(row.challenger_count ?? -1);
    const capacity = Number(row.challenger_capacity ?? 0);
    return {
      id: row.id,
      status: row.status,
      refreshed,
      challenger_count: count,
      challenger_capacity: capacity,
      level: Number(row.level ?? 0),
      result: row.verification_result || "pending",
      eligible: refreshed && capacity > 0 && count >= 0 && count < 5 &&
        (row.verification_kind !== "giant-recheck" || Number(row.level) === 4),
    };
  });
  return noStoreJson({
    ok: true,
    batch,
    complete: candidates.every((candidate) =>
      ["completed", "failed", "cancelled"].includes(candidate.status)),
    candidates,
  });
}
