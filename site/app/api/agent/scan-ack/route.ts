import { authorized, ensureSchema, plain, runtime } from "../../../../lib/cloud";
import { appendScanLog, parseJobPlan, type ScanJobRow } from "../../../../lib/scans";

function countValue(value: string | null) {
  const number = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(number) ? Math.max(0, Math.min(number, 1_000_000)) : 0;
}

export async function POST(request: Request) {
  if (!authorized(request)) return plain("unauthorized\n", 401);
  await ensureSchema();
  const url = new URL(request.url);
  const jobId = countValue(url.searchParams.get("job_id"));
  const index = countValue(url.searchParams.get("index"));
  const cycle = countValue(url.searchParams.get("cycle"));
  const ok = url.searchParams.get("ok") === "1";
  const rows = countValue(url.searchParams.get("rows"));
  const bytes = countValue(url.searchParams.get("bytes"));
  const message = (url.searchParams.get("message") ?? "").slice(0, 400);
  const db = runtime().DB;
  const job = await db.prepare("SELECT * FROM scan_jobs WHERE id=?")
    .bind(jobId).first<ScanJobRow>();
  if (!job) return plain("missing\n", 404);
  if (cycle < Number(job.cycle) ||
      (cycle === Number(job.cycle) && index < Number(job.current_index))) {
    return plain("duplicate\n");
  }
  if (job.status !== "running" || cycle !== Number(job.cycle) ||
      index !== Number(job.current_index)) {
    return plain(job.status === "paused" ? "pause\n" : "stop\n", 409);
  }
  const plan = parseJobPlan(job);
  const target = plan[index];
  const now = Date.now();
  if (!ok) {
    await db.prepare(`UPDATE scan_jobs SET status='error', message=?,
      updated_at=?, finished_at=? WHERE id=?`)
      .bind(message || "手機執行座標失敗", now, now, jobId).run();
    await appendScanLog(jobId, "error",
      `${target.city} ${index + 1}/${plan.length} 執行失敗：${message || "未知錯誤"}`);
    return plain("error\n");
  }

  let nextIndex = index + 1;
  let nextCycle = cycle;
  let nextStatus = "running";
  let finishedAt = 0;
  let jobMessage = `${target.city} ${index + 1}/${plan.length} 完成，新增 ${rows} 行`;
  if (nextIndex >= plan.length) {
    if (job.loop) {
      nextIndex = 0;
      nextCycle += 1;
      jobMessage = `第 ${nextCycle} 輪完成，準備重新巡迴`;
    } else {
      nextStatus = "completed";
      finishedAt = now;
      jobMessage = "所有選取城市單輪掃描完成";
    }
  }
  await db.prepare(`UPDATE scan_jobs SET
      status=?, current_index=?, cycle=?, captured_rows=captured_rows+?,
      captured_bytes=captured_bytes+?, current_country=?, current_city=?,
      current_lat=?, current_lng=?, message=?, updated_at=?, finished_at=?
    WHERE id=?`)
    .bind(nextStatus, nextIndex, nextCycle, rows, bytes,
      target.country, target.city, target.lat, target.lng,
      jobMessage, now, finishedAt, jobId)
    .run();
  await appendScanLog(jobId, rows ? "info" : "warn",
    `${target.country ? `${target.country}-` : ""}${target.city} ` +
    `${index + 1}/${plan.length}・擷取 +${rows} 行・${target.lat},${target.lng}`);
  const regionCount = new Set(plan.map((point) => point.regionIndex)).size;
  const status = {
    running: nextStatus === "running",
    point: index + 1,
    total: plan.length,
    at: [target.lat, target.lng],
    added_total: 0,
    captured_total: Number(job.captured_rows) + rows,
    new_at_point: rows,
    empty_capture_streak: rows ? 0 : 1,
    softban_warn: 0,
    last_msg: jobMessage,
    city: target.city,
    country: target.country,
    city_index: target.regionIndex + 1,
    city_total: regionCount,
    cycle: nextCycle + 1,
    source: "web-admin",
  };
  await db.prepare("UPDATE scanner_status SET status_json=?, updated_at=? WHERE id=1")
    .bind(JSON.stringify(status), Math.floor(now / 1000)).run();
  return plain(nextStatus === "completed" ? "completed\n" : "ok\n");
}
