import { authorized, ensureSchema, plain, runtime } from "../../../../lib/cloud";
import { activeJob, cleanTsv, parseJobConfig, parseJobPlan } from "../../../../lib/scans";

export async function GET(request: Request) {
  if (!authorized(request)) return plain("unauthorized\n", 401);
  await ensureSchema();
  const db = runtime().DB;
  const job = await activeJob();
  if (!job) return plain("0\twait\n");
  if (job.status === "paused") return plain(`${job.id}\tpause\n`);

  let plan;
  try {
    plan = parseJobPlan(job);
  } catch {
    await db.prepare(`UPDATE scan_jobs SET status='error', message=?,
      updated_at=?, finished_at=? WHERE id=?`)
      .bind("掃描計畫損毀", Date.now(), Date.now(), job.id).run();
    return plain(`${job.id}\terror\n`);
  }
  let index = Number(job.current_index);
  if (index >= plan.length) {
    if (job.loop) {
      index = 0;
      await db.prepare("UPDATE scan_jobs SET current_index=0, cycle=cycle+1, updated_at=? WHERE id=?")
        .bind(Date.now(), job.id).run();
      job.current_index = 0;
      job.cycle = Number(job.cycle) + 1;
    } else {
      await db.prepare(`UPDATE scan_jobs SET status='completed', finished_at=?,
        updated_at=?, message='單輪掃描完成' WHERE id=?`)
        .bind(Date.now(), Date.now(), job.id).run();
      return plain("0\twait\n");
    }
  }
  const target = plan[index];
  const config = parseJobConfig(job);
  const now = Date.now();
  await db.prepare(`UPDATE scan_jobs SET
      status='running', started_at=CASE WHEN started_at=0 THEN ? ELSE started_at END,
      updated_at=?, current_country=?, current_city=?, current_lat=?, current_lng=?,
      message=?
    WHERE id=?`)
    .bind(now, now, target.country, target.city, target.lat, target.lng,
      `前往 ${target.country ? `${target.country}-` : ""}${target.city} ${index + 1}/${plan.length}`,
      job.id)
    .run();
  const regionCount = new Set(plan.map((point) => point.regionIndex)).size;
  const status = {
    running: true,
    point: index + 1,
    total: plan.length,
    at: [target.lat, target.lng],
    added_total: 0,
    captured_total: Number(job.captured_rows),
    new_at_point: 0,
    empty_capture_streak: 0,
    softban_warn: 0,
    last_msg: `手機前往 ${target.city}`,
    city: target.city,
    country: target.country,
    city_index: target.regionIndex + 1,
    city_total: regionCount,
    cycle: Number(job.cycle) + 1,
    source: "web-admin",
  };
  await db.prepare("UPDATE scanner_status SET status_json=?, updated_at=? WHERE id=1")
    .bind(JSON.stringify(status), Math.floor(now / 1000)).run();
  return plain([
    job.id,
    "target",
    index,
    plan.length,
    target.lat,
    target.lng,
    Math.round(config.dwellS),
    Math.round(config.hopDelayS),
    Math.round(target.cooldownS),
    Number(job.cycle),
    cleanTsv(target.country || "-"),
    cleanTsv(target.city),
  ].join("\t") + "\n");
}
