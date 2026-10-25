// Dedicated scheduler only: no routes, database access, or public maintenance API.
const ENDPOINT = 'https://mush.odyliao.cc/api/controller/maintenance';
const DAY = 86400;

export async function runMaintenance(env, deps = {}) {
  const request = deps.fetch ?? fetch;
  const now = Math.floor((deps.now ?? Date.now()) / 1000);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (!env.MAINTENANCE_TOKEN || env.MAINTENANCE_TOKEN.length < 32) throw Error('missing maintenance credential');
      const response = await request(ENDPOINT, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(25000),
        headers: { authorization: `Bearer ${env.MAINTENANCE_TOKEN}`, 'x-maintenance-event': 'cloudflare-cron' },
      });
      if (!response.ok) throw Error(`maintenance HTTP ${response.status}`);
      const data = await response.json();
      const success = data.retention?.lastSucceededAt;
      if (!Number.isFinite(success) || success > now + 60 || now - success > 300 ||
          data.maintenanceHealth?.independentLastSucceededAt < now - 300 ||
          data.maintenanceHealth?.independentLastSucceededAt > now + 60 ||
          !Number.isFinite(data.maintenanceHealth?.independentLastSucceededAt)) {
        throw Error('maintenance acknowledgement missing or stale');
      }
      console.info(JSON.stringify({event:'independent_maintenance_accepted',
        succeededAt:success,pending:data.retention.pending,severity:data.maintenanceHealth.severity}));
      return;
    } catch { /* retry without logging remote bodies or credentials */ }
  }
  // Only transport/contract failures alert here. Site handles cleanup/backlog alerts.
  // KV survives deploys/restarts; no in-memory-only notification throttling.
  try {
    const last = Number(await env.ALERT_STATE.get('last-failure-alert') ?? 0);
    if (now - last >= DAY && /^https:\/\/discord\.com\/api\/webhooks\//.test(env.DISCORD_WEBHOOK ?? '')) {
      const response = await request(env.DISCORD_WEBHOOK, {
        method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),
        headers:{'content-type':'application/json'},
        body:JSON.stringify({content:'【蘑菇獨立清理連線異常】定時工作無法取得站台清理成功回報。請檢查站台、清理憑證或網路；目前無法確認備援是否正常。同一問題一天內最多提醒一次。',allowed_mentions:{parse:[]}}),
      });
      if (response.ok) await env.ALERT_STATE.put('last-failure-alert',String(now),{expirationTtl:2*DAY});
    }
  } catch { /* Notification/KV failures must never escape with credentials or remote details. */ }
  // Never log request headers, tokens, webhook URLs, or remote response bodies.
  console.error(JSON.stringify({event:'independent_maintenance_failed'}));
  throw Error('Independent maintenance did not receive a valid acknowledgement', {cause: undefined});
}

export default {
  fetch() { return new Response('Not found', {status:404}); },
  async scheduled(_controller, env, ctx) { ctx.waitUntil(runMaintenance(env)); },
};
