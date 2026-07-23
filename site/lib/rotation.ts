import { ensureSchema, runtime } from "./cloud";
import {
  buildScanPlan, COUNTRY_PACK_CATALOG, normalizeScanConfig, type ScanConfig,
} from "./scan-plans";
import { appendScanLog } from "./scans";
import { materializeTargets } from "./targets";
import { planDailyRotation, rotationWindow } from "./rotation-plan.mjs";

const LOCK_STALE_MS = 5 * 60_000;
// A cross-country target can include a 120-second cooldown plus a cold game
// restart. Do not rebuild thousands of targets merely because an otherwise
// healthy phone spends more than five minutes between polls.
const AGENT_ACTIVE_MS = 30 * 60_000;

type RotationSettingRow = {
  enabled: number;
  timezone: string;
  switch_minute: number;
  config_json: string;
};

type RotationRunRow = {
  schedule_date: string;
  status: string;
  job_id: number | null;
  assignments_json: string;
  message: string;
  created_at: number;
  updated_at: number;
};

function packNames(packIds: string[]) {
  return packIds.map((id) => {
    const pack = COUNTRY_PACK_CATALOG.find((item) => item.id === id);
    if (!pack) throw new Error(`輪替區域不存在：${id}`);
    return pack.name;
  });
}

function scanConfig(base: unknown, packs: string[]): ScanConfig {
  const previous = base && typeof base === "object" ? base as Record<string, unknown> : {};
  return normalizeScanConfig({
    ...previous,
    mode: "auto",
    countryPacks: packs,
    loop: true,
  });
}

async function stopActiveJobs(now: number) {
  const db = runtime().DB;
  await db.batch([
    db.prepare(`UPDATE scan_targets SET status='cancelled', lease_agent_id='',
      lease_token='', lease_expires_at=0, updated_at=?
      WHERE status IN ('queued','leased') AND job_id IN (
        SELECT id FROM scan_jobs WHERE status IN ('queued','running','paused')
      )`).bind(now),
    db.prepare(`UPDATE scan_jobs SET status='cancelled', finished_at=?, updated_at=?,
      message='每日 07:30 自動換區，舊工作已結束'
      WHERE status IN ('queued','running','paused')`).bind(now, now),
    db.prepare(`UPDATE scan_agents SET current_job_id=NULL, current_target_id=NULL,
      updated_at=? WHERE current_job_id IS NOT NULL`).bind(now),
  ]);
}

export async function ensureDailyRotation(now = Date.now()) {
  await ensureSchema();
  const db = runtime().DB;
  const setting = await db.prepare("SELECT * FROM scan_rotation_settings WHERE id=1")
    .first<RotationSettingRow>();
  if (!setting?.enabled) return null;

  const agents = await db.prepare(`SELECT id FROM scan_agents
    WHERE enabled=1 AND paused=0 AND last_seen>? ORDER BY id`)
    .bind(now - AGENT_ACTIVE_MS).all<{ id: string }>();
  if (!agents.results.length) return null;

  const planned = planDailyRotation(agents.results.map((agent) => agent.id), now);
  const existing = await db.prepare(
    "SELECT * FROM scan_rotation_runs WHERE schedule_date=?",
  ).bind(planned.scheduleDate).first<RotationRunRow>();
  let lockAcquired = false;
  if (existing?.status === "completed") {
    let existingPlan: Array<{ agentId: string; id: string; packs: string[] }> = [];
    try {
      const parsed = JSON.parse(existing.assignments_json);
      if (Array.isArray(parsed)) {
        existingPlan = parsed.map((item) => ({
          agentId: String(item?.agentId ?? ""),
          id: String(item?.id ?? ""),
          packs: Array.isArray(item?.packs) ? item.packs.map(String) : [],
        })).sort((left, right) => left.agentId.localeCompare(right.agentId));
      }
    } catch {
      existingPlan = [];
    }
    const expectedPlan = planned.assignments.map((item) => ({
      agentId: item.agentId,
      id: item.id,
      packs: item.packs,
    })).sort((left, right) => left.agentId.localeCompare(right.agentId));
    if (JSON.stringify(existingPlan) === JSON.stringify(expectedPlan)) return existing;
    const reacquired = await db.prepare(`UPDATE scan_rotation_runs SET
        status='running', message='Agent 或輪替方案變更，重新平衡今日區域', updated_at=?
      WHERE schedule_date=? AND status='completed' AND assignments_json=?`)
      .bind(now, planned.scheduleDate, existing.assignments_json).run();
    lockAcquired = Boolean(reacquired.meta.changes);
    if (!lockAcquired) {
      return db.prepare("SELECT * FROM scan_rotation_runs WHERE schedule_date=?")
        .bind(planned.scheduleDate).first<RotationRunRow>();
    }
  }

  if (!lockAcquired) {
    const inserted = await db.prepare(`INSERT OR IGNORE INTO scan_rotation_runs (
        schedule_date, status, assignments_json, message, created_at, updated_at
      ) VALUES (?, 'running', '[]', '準備每日自動換區', ?, ?)`)
      .bind(planned.scheduleDate, now, now).run();
    lockAcquired = Boolean(inserted.meta.changes);
  }
  if (!lockAcquired) {
    const acquired = await db.prepare(`UPDATE scan_rotation_runs SET
        status='running', message='重新執行未完成的每日換區', updated_at=?
      WHERE schedule_date=? AND status<>'completed'
        AND (status='failed' OR updated_at<?)`)
      .bind(now, planned.scheduleDate, now - LOCK_STALE_MS).run();
    if (!acquired.meta.changes) {
      return db.prepare("SELECT * FROM scan_rotation_runs WHERE schedule_date=?")
        .bind(planned.scheduleDate).first<RotationRunRow>();
    }
  }

  try {
    const latest = await db.prepare("SELECT config_json FROM scan_jobs ORDER BY id DESC LIMIT 1")
      .first<{ config_json: string }>();
    let previousConfig: unknown = {};
    try {
      previousConfig = JSON.parse(latest?.config_json ?? "{}");
    } catch {
      previousConfig = {};
    }
    const assignments = planned.assignments.map((assignment) => ({
      ...assignment,
      countries: packNames(assignment.packs),
    }));
    const selectedPacks = [...new Set(assignments.flatMap((item) => item.packs))];
    const config = scanConfig(previousConfig, selectedPacks);
    const { regions, targets } = buildScanPlan(config, null);

    await stopActiveJobs(now);
    const created = await db.prepare(`INSERT INTO scan_jobs (
        status, config_json, plan_json, total_points, loop, message,
        created_at, updated_at
      ) VALUES ('queued', ?, ?, ?, 1, ?, ?, ?) RETURNING id`)
      .bind(JSON.stringify(config), JSON.stringify(targets), targets.length,
        `每日輪替 ${planned.scheduleDate}：等待 Agent 接手`, now, now)
      .first<{ id: number }>();
    const jobId = Number(created?.id ?? 0);
    if (!jobId) throw new Error("無法建立每日輪替工作");
    await materializeTargets(jobId, targets);

    const updates = assignments.map((assignment) =>
      db.prepare(`UPDATE scan_agents SET region_tags_json=?, current_job_id=NULL,
        current_target_id=NULL, updated_at=? WHERE id=? AND enabled=1`)
        .bind(JSON.stringify(assignment.countries), now, assignment.agentId));
    if (updates.length) await db.batch(updates);
    const summary = assignments.map((item) =>
      `${item.agentId}=${item.label}(${item.cityCount} 城)`).join("；");
    await db.prepare(`UPDATE scan_rotation_runs SET status='completed', job_id=?,
        assignments_json=?, message=?, updated_at=? WHERE schedule_date=?`)
      .bind(jobId, JSON.stringify(assignments), summary, Date.now(), planned.scheduleDate).run();
    await appendScanLog(jobId, "info",
      `每日 07:30 自動換區：${summary}；共 ${regions.length} 城、${targets.length} 點`);
    return db.prepare("SELECT * FROM scan_rotation_runs WHERE schedule_date=?")
      .bind(planned.scheduleDate).first<RotationRunRow>();
  } catch (error) {
    const message = error instanceof Error ? error.message : "每日換區失敗";
    await db.prepare(`UPDATE scan_rotation_runs SET status='failed', message=?, updated_at=?
      WHERE schedule_date=?`).bind(message.slice(0, 800), Date.now(), planned.scheduleDate).run();
    throw error;
  }
}

export async function rotationStatus(now = Date.now()) {
  await ensureDailyRotation(now);
  const db = runtime().DB;
  const window = rotationWindow(now);
  const [setting, run] = await Promise.all([
    db.prepare("SELECT * FROM scan_rotation_settings WHERE id=1").first<RotationSettingRow>(),
    db.prepare("SELECT * FROM scan_rotation_runs WHERE schedule_date=?")
      .bind(window.scheduleDate).first<RotationRunRow>(),
  ]);
  let assignments: unknown[] = [];
  try {
    const parsed = JSON.parse(run?.assignments_json ?? "[]");
    if (Array.isArray(parsed)) assignments = parsed;
  } catch {
    assignments = [];
  }
  return {
    enabled: Boolean(setting?.enabled),
    timezone: setting?.timezone ?? "Asia/Taipei",
    switch_minute: Number(setting?.switch_minute ?? 450),
    schedule_date: window.scheduleDate,
    next_switch_at: window.nextSwitchAt,
    status: run?.status ?? "pending",
    job_id: run?.job_id == null ? null : Number(run.job_id),
    assignments,
    message: run?.message ?? "等待每日換區",
  };
}
