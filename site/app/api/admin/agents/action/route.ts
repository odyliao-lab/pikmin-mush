import {
  adminAuthorized, ensureSchema, noStoreJson, runtime, sameOrigin,
} from "../../../../../lib/cloud";
import { hashAgentToken, issueAgentToken } from "../../../../../lib/fleet";
import { MAX_ENABLED_AGENTS, ROTATION_SLOTS, rotationSlots } from "../../../../../lib/fleet-policy.mjs";

export async function POST(request: Request) {
  if (!adminAuthorized(request)) return noStoreJson({ error: "forbidden" }, 403);
  if (!sameOrigin(request)) return noStoreJson({ error: "invalid origin" }, 403);
  await ensureSchema();
  let body: {
    agentId?: unknown;
    action?: unknown;
    regionTags?: unknown;
    displayName?: unknown;
    rotationSlots?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: "invalid json" }, 400);
  }
  const agentId = String(body.agentId ?? "");
  const action = String(body.action ?? "");
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(agentId) ||
      !["enable", "disable", "pause", "resume", "update-regions",
        "rotate-token", "revoke-old-token", "rename", "delete", "update-qualification"].includes(action)) {
    return noStoreJson({ error: "invalid action" }, 400);
  }
  const db = runtime().DB;
  const now = Date.now();

  if (action === "update-qualification") {
    if (!Array.isArray(body.rotationSlots) ||
        body.rotationSlots.some(slot => !ROTATION_SLOTS.includes(slot))) {
      return noStoreJson({ error: "請選擇已實測的掃描時段" }, 400);
    }
    // Require a disabled device so changing eligibility cannot invalidate an
    // in-flight target. Preserve unrelated capability fields in the JSON.
    const result = await db.prepare(`UPDATE scan_agents SET
        capabilities_json=json_set(CASE WHEN json_valid(capabilities_json)
          THEN capabilities_json ELSE '{}' END, '$.rotation_slots', json(?)), updated_at=?
      WHERE id=? AND enabled=0`)
      .bind(JSON.stringify([...new Set(body.rotationSlots)]), now, agentId).run();
    if (!result.meta.changes) return noStoreJson({ error: "請先停用節點再設定實測資格" }, 409);
    return noStoreJson({ ok: true, rotation_slots: [...new Set(body.rotationSlots)] });
  }

  if (action === "rename") {
    const displayName = String(body.displayName ?? "").trim();
    if (!displayName || displayName.length > 48 || /[\u0000-\u001f\u007f]/.test(displayName)) {
      return noStoreJson({ error: "Agent 名稱需為 1 至 48 個可顯示字元" }, 400);
    }
    const result = await db.prepare(
      "UPDATE scan_agents SET display_name=?, updated_at=? WHERE id=?",
    ).bind(displayName, now, agentId).run();
    if (!result.meta.changes) return noStoreJson({ error: "Agent 不存在" }, 404);
    return noStoreJson({ ok: true, display_name: displayName });
  }

  // 永久除役只允許已停用的非 primary 節點；避免誤刪正在派工的憑證。
  // 目標紀錄保留其 completed_agent_id 以維持掃描資料的來源追溯，
  // 但移除該裝置專屬的事件統計與所有可用 Token 雜湊。
  if (action === "delete") {
    if (agentId === "primary") {
      return noStoreJson({ error: "主要 Agent 不可永久刪除" }, 409);
    }
    const agent = await db.prepare("SELECT enabled FROM scan_agents WHERE id=?")
      .bind(agentId).first<{ enabled: number }>();
    if (!agent) return noStoreJson({ error: "Agent 不存在" }, 404);
    if (agent.enabled) {
      return noStoreJson({ error: "請先停用節點後再永久刪除" }, 409);
    }
    await db.batch([
      db.prepare("DELETE FROM scan_agent_events WHERE agent_id=?").bind(agentId),
      db.prepare("DELETE FROM scan_agents WHERE id=? AND enabled=0").bind(agentId),
    ]);
    return noStoreJson({ ok: true, deleted: true });
  }

  if (action === "rotate-token") {
    const agent = await db.prepare(
      "SELECT id, token_hash FROM scan_agents WHERE id=?",
    ).bind(agentId).first<{ id: string; token_hash: string }>();
    if (!agent) return noStoreJson({ error: "Agent 不存在" }, 404);
    const token = issueAgentToken();
    const tokenHash = await hashAgentToken(token);
    const legacy = agentId === "primary" ? runtime().AGENT_TOKEN ?? "" : "";
    const previousHash = agent.token_hash ||
      (legacy.length >= 32 ? await hashAgentToken(legacy) : "");
    const graceExpiresAt = previousHash ? now + 24 * 60 * 60_000 : 0;
    await db.prepare(`UPDATE scan_agents SET token_hash=?, previous_token_hash=?,
        previous_token_expires_at=?, token_rotated_at=?, updated_at=? WHERE id=?`)
      .bind(tokenHash, previousHash, graceExpiresAt, now, now, agentId).run();
    return noStoreJson({
      ok: true, agent_id: agentId, token,
      previous_token_expires_at: graceExpiresAt,
      warning: "新 Token 只顯示這一次；舊 Token 最多保留 24 小時供裝置換發。",
    });
  }

  if (action === "revoke-old-token") {
    const result = await db.prepare(`UPDATE scan_agents SET previous_token_hash='',
        previous_token_expires_at=0, updated_at=? WHERE id=?`)
      .bind(now, agentId).run();
    if (!result.meta.changes) return noStoreJson({ error: "Agent 不存在" }, 404);
    return noStoreJson({ ok: true, previous_token_expires_at: 0 });
  }

  if (action === "update-regions") {
    const rotation = await db.prepare(
      "SELECT enabled FROM scan_rotation_settings WHERE id=1",
    ).first<{ enabled: number }>();
    if (rotation?.enabled) {
      return noStoreJson({ error: "每日自動換區已啟用，區域由中央排程管理" }, 409);
    }
    if (!Array.isArray(body.regionTags)) {
      return noStoreJson({ error: "區域偏好格式不正確" }, 400);
    }
    const regionTags = [...new Set(body.regionTags
      .map(String).map((value) => value.trim()).filter(Boolean))]
      .slice(0, 40);
    if (regionTags.some((value) => value.length > 48)) {
      return noStoreJson({ error: "單一國家名稱不可超過 48 個字元" }, 400);
    }
    const result = await db.prepare(
      "UPDATE scan_agents SET region_tags_json=?, updated_at=? WHERE id=?",
    ).bind(JSON.stringify(regionTags), now, agentId).run();
    if (!result.meta.changes) return noStoreJson({ error: "Agent 不存在" }, 404);
    return noStoreJson({ ok: true, region_tags: regionTags });
  }

  // 暫停／繼續掃描：只切換 paused 旗標，保留憑證與 lease；Agent 仍在線但停止派工，
  // 進行中的掃描會在下一次 control polling 收到 pause 而停下（見 v2/control）。
  if (action === "pause" || action === "resume") {
    const paused = action === "pause" ? 1 : 0;
    const result = await db.prepare(
      "UPDATE scan_agents SET paused=?, updated_at=? WHERE id=?",
    ).bind(paused, now, agentId).run();
    if (!result.meta.changes) return noStoreJson({ error: "Agent 不存在" }, 404);
    return noStoreJson({ ok: true, paused: Boolean(paused) });
  }

  // 啟用／停用節點：停用等同除役，會立即釋放其 lease。
  const enabled = action === "enable" ? 1 : 0;
  if (enabled) {
    const agent = await db.prepare("SELECT capabilities_json FROM scan_agents WHERE id=?")
      .bind(agentId).first<{ capabilities_json: string }>();
    if (!agent) return noStoreJson({ error: "Agent 不存在" }, 404);
    if (rotationSlots(agent.capabilities_json)?.length === 0)
      return noStoreJson({ error: "請先設定已實測的掃描時段資格" }, 409);
  }
  // A single conditional write also protects simultaneous enable requests.
  const result = await db.prepare(`UPDATE scan_agents SET enabled=?, updated_at=? WHERE id=?
    AND (?=0 OR (SELECT COUNT(*) FROM scan_agents WHERE enabled=1 AND id<>?) < ?)`)
    .bind(enabled, now, agentId, enabled, agentId, MAX_ENABLED_AGENTS).run();
  if (enabled && !result.meta.changes)
    return noStoreJson({ error: `最多可啟用 ${MAX_ENABLED_AGENTS} 個 Agent，請先停用其他節點` }, 409);
  if (!result.meta.changes) return noStoreJson({ error: "Agent 不存在" }, 404);
  if (!enabled) {
    await db.batch([
      db.prepare(`UPDATE scan_targets SET status='queued', lease_agent_id='',
        lease_token='', lease_expires_at=0, updated_at=?
        WHERE status='leased' AND lease_agent_id=?`).bind(now, agentId),
      db.prepare(`UPDATE scan_agents SET current_job_id=NULL, current_target_id=NULL
        WHERE id=?`).bind(agentId),
    ]);
  }
  return noStoreJson({ ok: true, enabled: Boolean(enabled) });
}
