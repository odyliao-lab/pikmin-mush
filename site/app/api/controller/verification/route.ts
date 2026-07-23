import {
  controllerAuthorized, ensureSchema, noStoreJson, readBoundedUtf8, runtime,
} from "../../../../lib/cloud";
import { activeJob, type ScanJobRow } from "../../../../lib/scans";

type Candidate = {
  id: string;
  lat: number;
  lng: number;
};

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
  const rawCandidates = Array.isArray(input.candidates) ? input.candidates : [];
  if (!agentId || !batch || !rawCandidates.length || rawCandidates.length > 30) {
    return noStoreJson({ error: "agentId, batch and 1-30 candidates are required" }, 400);
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
  const existing = await db.prepare(
    "SELECT COUNT(*) AS count FROM scan_targets WHERE verification_batch=?",
  ).bind(batch).first<{ count: number }>();
  if (Number(existing?.count ?? 0)) {
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
  const minimum = await db.prepare(
    "SELECT MIN(sequence) AS value FROM scan_targets WHERE job_id=?",
  ).bind(job.id).first<{ value: number | null }>();
  let sequence = Math.min(-1, Number(minimum?.value ?? 0) - candidates.length - 2);
  const inserts = candidates.map((candidate, index) =>
    db.prepare(`INSERT INTO scan_targets (
      job_id, sequence, cycle, country, city, lat, lng, region_index, point_index,
      base_cooldown_s, status, priority, required_agent_id, verification_batch,
      verification_mushroom_id, verification_kind, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '通知前人數複核', ?, ?, -1, ?, 0, 'queued', 100, ?, ?, ?, 'candidate', ?, ?)`)
      .bind(job.id, sequence++, Number(job.cycle), country,
        candidate.lat, candidate.lng, index, agentId, batch, candidate.id, now, now));
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
    WHERE required_agent_id=? AND verification_kind<>''
      AND verification_batch<>? AND status='queued'`)
    .bind(now, agentId, batch).run();
  await db.batch(inserts);
  return noStoreJson({
    ok: true,
    batch,
    job_id: Number((job as ScanJobRow).id),
    candidates: candidates.length,
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
      m.challenger_count, m.challenger_capacity, m.last_seen
    FROM scan_targets t
    LEFT JOIN mushrooms m ON m.id=t.verification_mushroom_id
    WHERE t.verification_batch=? AND t.verification_kind='candidate'
    ORDER BY t.id`).bind(batch).all<{
      id: string;
      status: string;
      leased_at: number;
      completed_at: number;
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
      eligible: refreshed && capacity > 0 && count >= 0 && count < 5,
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
