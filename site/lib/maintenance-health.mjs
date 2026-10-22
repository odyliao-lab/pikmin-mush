// All timestamps here are epoch seconds. Batch saturation alone is not backlog.
export function maintenanceHealth(now, retention, githubAt, independentAt, backlogSince = 0) {
  const cleanupAge = retention.lastSucceededAt ? Math.max(0, now - retention.lastSucceededAt) : null;
  const schedulerAt = Math.max(githubAt || 0, independentAt || 0);
  const schedulerDelayed = !schedulerAt || now - schedulerAt > 3 * 3600;
  const cleanupFailing = retention.consecutiveFailures >= 2 || cleanupAge === null || cleanupAge > 3600;
  const backlogPersistent = retention.pending > 0 && backlogSince > 0 && now - backlogSince >= 3600;
  const severity = cleanupFailing || backlogPersistent ? 'critical' : schedulerDelayed ? 'degraded' : 'healthy';
  return { severity, cleanupAge, schedulerDelayed, cleanupFailing, backlogPersistent,
    githubLastSucceededAt: githubAt || 0, independentLastSucceededAt: independentAt || 0,
    pending: retention.pending,historyPending:0,historyFailing:false,historyBacklogPersistent:false };
}

export function maintenanceMessage(health, retention) {
  if (health.severity === 'critical') {
    return `【蘑菇清理異常】清理逾一小時未成功、連續失敗或過期資料持續積壓。\n` +
      `蘑菇待清理 ${health.pending} 筆；歷史待清理 ${health.historyPending||0} 筆；` +
      `歷史清理失敗 ${health.historyFailing?'是':'否'}；蘑菇連續失敗 ${retention.consecutiveFailures} 次。請檢查清理服務，不能視為備援正常。`;
  }
  return '【蘑菇排程延遲・清理正常】獨立排程與 GitHub 均超過三小時沒有成功回報，但最近一小時內清理成功。' +
    '\n目前由備援維持，無需重啟手機；請檢查排程。相同等級一天內最多提醒一次。';
}
