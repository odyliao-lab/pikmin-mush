import { runtime } from "./cloud";
import { parseJobPlan, type ScanJobRow } from "./scans";

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
