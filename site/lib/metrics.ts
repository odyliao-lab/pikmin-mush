import { runtime } from "./cloud";

export const REQUIRED_GAME_VERSION = "149.0";
export const MIN_AGENT_VERSION = "2.0.0";
export const EXPECTED_MODULE_VERSION = "149.0";
export const HEARTBEAT_SAMPLE_MS = 5 * 60_000;
export const NO_DATA_WARN_STREAK = 12;
export const NO_DATA_CRITICAL_STREAK = 30;

type AgentHealthRow = {
  enabled: number;
  paused: number;
  last_seen: number;
  last_data_at: number;
  last_target_at: number;
  no_data_streak: number;
  agent_version: string;
  game_version: string;
  module_version: string;
};

export type AgentEventType =
  | "heartbeat"
  | "target_claimed"
  | "target_completed"
  | "target_no_data"
  | "target_failed"
  | "lease_expired"
  | "upload";

function versionParts(value: string) {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return match ? match.slice(1, 4).map((part) => Number(part ?? 0)) : null;
}

function versionAtLeast(actual: string, minimum: string) {
  const left = versionParts(actual);
  const right = versionParts(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

export function versionCompatibility(row: AgentHealthRow) {
  const reasons: string[] = [];
  const agentVersion = String(row.agent_version ?? "");
  const gameVersion = String(row.game_version ?? "");
  const moduleVersion = String(row.module_version ?? "");
  if (!agentVersion || !gameVersion || !moduleVersion) {
    return {
      status: "unknown" as const,
      compatible: true,
      reasons: ["等待 Agent 回報完整版本"],
      required: {
        agent: `>=${MIN_AGENT_VERSION}`,
        game: REQUIRED_GAME_VERSION,
        module: EXPECTED_MODULE_VERSION,
      },
    };
  }
  if (!versionAtLeast(agentVersion, MIN_AGENT_VERSION)) {
    reasons.push(`Agent ${agentVersion} 低於 ${MIN_AGENT_VERSION}`);
  }
  if (gameVersion !== REQUIRED_GAME_VERSION) {
    reasons.push(`遊戲 ${gameVersion}，需要 ${REQUIRED_GAME_VERSION}`);
  }
  if (moduleVersion !== EXPECTED_MODULE_VERSION) {
    reasons.push(`模組 ${moduleVersion}，需要 ${EXPECTED_MODULE_VERSION}`);
  }
  return {
    status: reasons.length ? "incompatible" as const : "compatible" as const,
    compatible: reasons.length === 0,
    reasons,
    required: {
      agent: `>=${MIN_AGENT_VERSION}`,
      game: REQUIRED_GAME_VERSION,
      module: EXPECTED_MODULE_VERSION,
    },
  };
}

export function agentHealth(row: AgentHealthRow, now = Date.now()) {
  const compatibility = versionCompatibility(row);
  const online = Boolean(row.enabled) && now - Number(row.last_seen) < 15_000;
  const streak = Number(row.no_data_streak ?? 0);
  const lastTargetAt = Number(row.last_target_at ?? 0);
  const lastDataAt = Number(row.last_data_at ?? 0);
  const dataAgeMs = lastDataAt ? now - lastDataAt : null;
  let status: "healthy" | "warning" | "critical" | "offline" | "paused" |
    "version_mismatch" | "collecting" = "healthy";
  let message = "掃描與資料流正常";
  if (!row.enabled || !online) {
    status = "offline";
    message = row.enabled ? "Agent 未在預期時間內回報" : "Agent 已停用";
  } else if (row.paused) {
    status = "paused";
    message = "Agent 已由後台暫停";
  } else if (!compatibility.compatible) {
    status = "version_mismatch";
    message = compatibility.reasons.join("；");
  } else if (!lastTargetAt) {
    status = "collecting";
    message = "等待第一個掃描點完成";
  } else if (streak >= NO_DATA_CRITICAL_STREAK) {
    status = "critical";
    message = `連續 ${streak} 個掃描點沒有新資料`;
  } else if (streak >= NO_DATA_WARN_STREAK) {
    status = "warning";
    message = `連續 ${streak} 個掃描點沒有新資料`;
  } else if (compatibility.status === "unknown") {
    status = "collecting";
    message = compatibility.reasons[0];
  }
  return {
    status,
    message,
    no_data_streak: streak,
    last_data_at: lastDataAt,
    last_target_at: lastTargetAt,
    data_age_ms: dataAgeMs,
    compatibility,
  };
}

export async function recordAgentEvent(input: {
  agentId: string;
  type: AgentEventType;
  at?: number;
  jobId?: number | null;
  targetId?: number | null;
  rows?: number;
  bytes?: number;
  durationMs?: number;
  detail?: string;
  throttleMs?: number;
}) {
  const db = runtime().DB;
  const at = input.at ?? Date.now();
  const detail = String(input.detail ?? "").slice(0, 300);
  if (input.throttleMs) {
    return db.prepare(`INSERT INTO scan_agent_events (
        agent_id, event_type, at, job_id, target_id, rows, bytes, duration_ms, detail
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM scan_agent_events
        WHERE agent_id=? AND event_type=? AND at>=?
      )`)
      .bind(input.agentId, input.type, at, input.jobId ?? null, input.targetId ?? null,
        input.rows ?? 0, input.bytes ?? 0, input.durationMs ?? 0, detail,
        input.agentId, input.type, at - input.throttleMs).run();
  }
  return db.prepare(`INSERT INTO scan_agent_events (
      agent_id, event_type, at, job_id, target_id, rows, bytes, duration_ms, detail
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(input.agentId, input.type, at, input.jobId ?? null, input.targetId ?? null,
      input.rows ?? 0, input.bytes ?? 0, input.durationMs ?? 0, detail).run();
}

type SoakEventRow = {
  agent_id: string;
  heartbeat_samples: number;
  completed_targets: number;
  failed_targets: number;
  no_data_targets: number;
  expired_leases: number;
  captured_rows: number;
  captured_bytes: number;
  average_target_ms: number;
  first_event_at: number;
  last_event_at: number;
};

export async function buildSoakReport(hours = 24) {
  const boundedHours = Math.max(1, Math.min(168, Math.round(hours)));
  const now = Date.now();
  const start = now - boundedHours * 60 * 60_000;
  const db = runtime().DB;
  const [agents, events, queue, activeJob] = await Promise.all([
    db.prepare("SELECT * FROM scan_agents ORDER BY enabled DESC, id").all<AgentHealthRow & {
      id: string; display_name: string;
    }>(),
    db.prepare(`SELECT agent_id,
        SUM(CASE WHEN event_type='heartbeat' THEN 1 ELSE 0 END) AS heartbeat_samples,
        SUM(CASE WHEN event_type='target_completed' THEN 1 ELSE 0 END) AS completed_targets,
        SUM(CASE WHEN event_type='target_failed' THEN 1 ELSE 0 END) AS failed_targets,
        SUM(CASE WHEN event_type='target_no_data' THEN 1 ELSE 0 END) AS no_data_targets,
        SUM(CASE WHEN event_type='lease_expired' THEN 1 ELSE 0 END) AS expired_leases,
        SUM(CASE WHEN event_type='target_completed' THEN rows ELSE 0 END) AS captured_rows,
        SUM(CASE WHEN event_type='target_completed' THEN bytes ELSE 0 END) AS captured_bytes,
        AVG(CASE WHEN event_type='target_completed' THEN duration_ms END) AS average_target_ms,
        MIN(at) AS first_event_at, MAX(at) AS last_event_at
      FROM scan_agent_events WHERE at>=? GROUP BY agent_id`)
      .bind(start).all<SoakEventRow>(),
    db.prepare(`SELECT status, COUNT(*) AS count FROM scan_targets
      GROUP BY status`).all<{ status: string; count: number }>(),
    db.prepare(`SELECT id, status, updated_at FROM scan_jobs
      WHERE status IN ('queued','running','paused') ORDER BY id DESC LIMIT 1`).first(),
  ]);
  const byAgent = new Map(events.results.map((row) => [row.agent_id, row]));
  const reports = agents.results.map((agent) => {
    const event = byAgent.get(agent.id);
    const observedStart = Number(event?.first_event_at ?? now);
    const observedHours = Math.max(0, (now - Math.max(start, observedStart)) / 3_600_000);
    const expectedSamples = Math.max(1, Math.floor(observedHours * 12));
    const heartbeatSamples = Number(event?.heartbeat_samples ?? 0);
    return {
      id: agent.id,
      name: agent.display_name,
      health: agentHealth(agent, now),
      heartbeat_samples: heartbeatSamples,
      continuity_percent: Math.min(100, Math.round(heartbeatSamples / expectedSamples * 100)),
      completed_targets: Number(event?.completed_targets ?? 0),
      failed_targets: Number(event?.failed_targets ?? 0),
      no_data_targets: Number(event?.no_data_targets ?? 0),
      expired_leases: Number(event?.expired_leases ?? 0),
      captured_rows: Number(event?.captured_rows ?? 0),
      captured_bytes: Number(event?.captured_bytes ?? 0),
      average_target_ms: Math.round(Number(event?.average_target_ms ?? 0)),
      first_event_at: Number(event?.first_event_at ?? 0),
      last_event_at: Number(event?.last_event_at ?? 0),
    };
  });
  const earliest = reports.reduce((value, row) => row.first_event_at &&
    (!value || row.first_event_at < value) ? row.first_event_at : value, 0);
  const observedHours = earliest ? Math.min(boundedHours, (now - earliest) / 3_600_000) : 0;
  const queueCounts = Object.fromEntries(queue.results.map((row) =>
    [row.status, Number(row.count)]));
  const critical = reports.filter((row) =>
    ["critical", "version_mismatch"].includes(row.health.status)).length;
  const warning = reports.filter((row) =>
    ["warning", "offline"].includes(row.health.status)).length;
  const completeWindow = observedHours >= boundedHours - 0.1;
  return {
    generated_at: now,
    window_start: start,
    requested_hours: boundedHours,
    observed_hours: Math.round(observedHours * 10) / 10,
    complete_window: completeWindow,
    verdict: !completeWindow ? "collecting" : critical ? "fail" : warning ? "warn" : "pass",
    fleet: {
      agents: reports.length,
      online: reports.filter((row) => row.health.status !== "offline").length,
      critical,
      warning,
      completed_targets: reports.reduce((sum, row) => sum + row.completed_targets, 0),
      failed_targets: reports.reduce((sum, row) => sum + row.failed_targets, 0),
      no_data_targets: reports.reduce((sum, row) => sum + row.no_data_targets, 0),
      expired_leases: reports.reduce((sum, row) => sum + row.expired_leases, 0),
      captured_rows: reports.reduce((sum, row) => sum + row.captured_rows, 0),
      average_target_ms: reports.length ? Math.round(reports.reduce(
        (sum, row) => sum + row.average_target_ms, 0) / reports.length) : 0,
    },
    queue: queueCounts,
    active_job: activeJob ?? null,
    agents: reports,
  };
}
