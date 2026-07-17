import { ensureSchema, runtime } from "./cloud";
import type { ScanConfig, ScanTarget } from "./scan-plans";

export const ACTIVE_SCAN_STATUSES = ["queued", "running", "paused"] as const;

export type ScanJobRow = {
  id: number;
  status: string;
  config_json: string;
  plan_json: string;
  total_points: number;
  current_index: number;
  cycle: number;
  loop: number;
  captured_rows: number;
  captured_bytes: number;
  current_country: string;
  current_city: string;
  current_lat: number | null;
  current_lng: number | null;
  message: string;
  created_at: number;
  updated_at: number;
  started_at: number;
  finished_at: number;
};

export async function activeOrLatestJob() {
  await ensureSchema();
  const db = runtime().DB;
  const active = await db.prepare(`SELECT * FROM scan_jobs
    WHERE status IN ('queued','running','paused')
    ORDER BY id DESC LIMIT 1`).first<ScanJobRow>();
  return active ?? await db.prepare("SELECT * FROM scan_jobs ORDER BY id DESC LIMIT 1")
    .first<ScanJobRow>();
}

export async function activeJob() {
  await ensureSchema();
  return runtime().DB.prepare(`SELECT * FROM scan_jobs
    WHERE status IN ('queued','running','paused')
    ORDER BY id DESC LIMIT 1`).first<ScanJobRow>();
}

export function parseJobPlan(job: ScanJobRow) {
  const plan = JSON.parse(job.plan_json) as ScanTarget[];
  if (!Array.isArray(plan) || plan.length !== Number(job.total_points)) {
    throw new Error("scan plan corrupted");
  }
  return plan;
}

export function parseJobConfig(job: ScanJobRow) {
  return JSON.parse(job.config_json) as ScanConfig;
}

export function publicJob(job: ScanJobRow | null) {
  if (!job) return null;
  let config: ScanConfig | null = null;
  try {
    config = parseJobConfig(job);
  } catch {
    config = null;
  }
  return {
    id: Number(job.id),
    status: job.status,
    config,
    total_points: Number(job.total_points),
    current_index: Number(job.current_index),
    cycle: Number(job.cycle),
    loop: Boolean(job.loop),
    captured_rows: Number(job.captured_rows),
    captured_bytes: Number(job.captured_bytes),
    current_country: job.current_country,
    current_city: job.current_city,
    current_location: job.current_lat == null ? null :
      [Number(job.current_lat), Number(job.current_lng)],
    message: job.message,
    created_at: Number(job.created_at),
    updated_at: Number(job.updated_at),
    started_at: Number(job.started_at),
    finished_at: Number(job.finished_at),
  };
}

export async function appendScanLog(
  jobId: number,
  level: "info" | "warn" | "error",
  message: string,
) {
  const db = runtime().DB;
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT INTO scan_logs (job_id, at, level, message) VALUES (?, ?, ?, ?)")
      .bind(jobId, now, level, message.slice(0, 800)),
    db.prepare(`DELETE FROM scan_logs WHERE job_id = ? AND id NOT IN (
      SELECT id FROM scan_logs WHERE job_id = ? ORDER BY id DESC LIMIT 300
    )`).bind(jobId, jobId),
  ]);
}

export function cleanTsv(value: unknown) {
  return String(value ?? "").replace(/[\t\r\n]/g, " ").slice(0, 160);
}
