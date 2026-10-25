import {
  controllerAuthorized, ensureSchema, maintenanceAuthorized,
  noStoreJson, readMushroomRetentionStatus, runMushroomRetention, runtime,
  checkMaintenanceHealth,
} from "../../../../lib/cloud";
import {readHistoryRetention,runHistoryRetention} from '../../../../lib/history-retention.mjs';

const UPLOAD_STALE_MS = 2 * 60 * 60 * 1000;
const MAINTENANCE_STALE_SECONDS = 30 * 60;

async function snapshot() {
  const now = Date.now();
  const retention = await readMushroomRetentionStatus();
  const agents = await runtime().DB.prepare(`SELECT id, display_name, enabled, paused,
      last_seen, last_data_at, current_job_id, current_target_id, created_at
    FROM scan_agents ORDER BY id`).all<{
    id: string; display_name: string; enabled: number; paused: number;
    last_seen: number; last_data_at: number; created_at: number; current_job_id: number | null;
    current_target_id: number | null;
  }>();
  const uploads = await runtime().DB.prepare(`SELECT agent_id, MAX(at) AS last_upload_at
    FROM scan_agent_events WHERE event_type='upload' AND at>=? GROUP BY agent_id`)
    .bind(now - 24 * 60 * 60 * 1000).all<{ agent_id: string; last_upload_at: number }>();
  const uploadedAt = new Map((uploads.results ?? []).map(row => [row.agent_id, row.last_upload_at]));
  const fleet = (agents.results ?? []).map(agent => ({
    id: agent.id, name: agent.display_name, enabled: !!agent.enabled,
    paused: !!agent.paused, lastSeen: agent.last_seen, lastAcceptedDataAt: agent.last_data_at,
    lastAcceptedUploadAt: uploadedAt.get(agent.id) ?? 0,
    currentJobId: agent.current_job_id, currentTargetId: agent.current_target_id,
    uploadSilent: !!agent.enabled && !agent.paused && !!agent.current_job_id &&
      now - agent.created_at > UPLOAD_STALE_MS &&
      now - (uploadedAt.get(agent.id) ?? 0) > UPLOAD_STALE_MS,
  }));
  const history = await readHistoryRetention(runtime().DB);
  return {
    now, retention, history, fleet,
    alerts: {
      maintenanceStale: !retention.lastSucceededAt ||
        now / 1000 - retention.lastSucceededAt > MAINTENANCE_STALE_SECONDS,
      maintenanceFailing: retention.consecutiveFailures >= 2,
      retentionBacklog: retention.pending > 0 || retention.lastBatchSaturated,
      historyRetentionFailing: history.tables.some(table => Boolean(table.last_error)),
      uploadSilentAgents: fleet.filter(agent => agent.uploadSilent).map(agent => agent.id),
    },
  };
}

export async function GET(request: Request) {
  if (!maintenanceAuthorized(request) && !controllerAuthorized(request)) {
    return noStoreJson({ error: "unauthorized" }, 401);
  }
  await ensureSchema();
  return noStoreJson(await snapshot());
}

export async function POST(request: Request) {
  if (!maintenanceAuthorized(request)) return noStoreJson({ error: "unauthorized" }, 401);
  await ensureSchema();
  try {
    const completed = await runMushroomRetention();
    if (!completed.lastSucceededAt ||
      Date.now() / 1_000 - completed.lastSucceededAt > 5 * 60) {
      throw new Error("maintenance did not complete recently");
    }
    const history = await runHistoryRetention(runtime().DB);
    const now = Date.now();
    if (!Number.isFinite(history.lastSucceededAt) || !history.lastSucceededAt ||
      history.lastSucceededAt > now + 60_000 || now - history.lastSucceededAt > 300_000 ||
      history.lastSucceededAt < history.lastRunAt || history.consecutiveFailures > 0 ||
      history.tables.some(table => Boolean(table.last_error))) {
      throw new Error('history maintenance incomplete');
    }
    const source = request.headers.get("x-maintenance-event");
    if (source === "schedule" || source === "cloudflare-cron") {
      const name = source === "schedule" ? 'mushroom-retention-scheduled' : 'mushroom-retention-independent';
      const db = runtime().DB;
      await db.prepare(`INSERT OR IGNORE INTO maintenance_state (name)
        VALUES (?)`).bind(name).run();
      await db.prepare(`UPDATE maintenance_state SET last_run_at=?
        WHERE name=?`).bind(Math.floor(Date.now() / 1_000), name).run();
    }
    const health = await checkMaintenanceHealth();
    return noStoreJson({ ...await snapshot(), maintenanceHealth: health });
  } catch {
    try { await checkMaintenanceHealth(); } catch { /* caller records failed request */ }
    return noStoreJson({ error: "maintenance failed" }, 503);
  }
}
