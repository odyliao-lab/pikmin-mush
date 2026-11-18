// The queue is disposable; historical attribution must survive a loop reset.
export const TARGET_HISTORY_CTE = `WITH durable_targets AS (
  SELECT id,country,verification_kind FROM scan_targets
  UNION ALL
  SELECT h.id,h.country,h.verification_kind FROM scan_target_history h
  WHERE NOT EXISTS (SELECT 1 FROM scan_targets t WHERE t.id=h.id)
)`;

export function prepareTargetArchive(db, jobId, now, guard = { sql: '', params: [] }) {
  return [
    db.prepare(`INSERT OR IGNORE INTO scan_target_history
      (id,job_id,cycle,country,verification_kind,archived_at,
       verification_batch,verification_mushroom_id,status,leased_at,completed_at,completed_agent_id,lat,lng,city)
      SELECT id,job_id,cycle,country,verification_kind,?,
       verification_batch,verification_mushroom_id,
       CASE WHEN status IN ('completed','failed') THEN status ELSE 'cancelled' END,
       leased_at,completed_at,completed_agent_id,lat,lng,city FROM scan_targets WHERE job_id=? ${guard.sql}`)
      .bind(now,jobId,...guard.params),
    db.prepare(`DELETE FROM scan_targets WHERE job_id=? ${guard.sql}`).bind(jobId,...guard.params),
  ];
}

export function archiveAndDeleteTargets(db, jobId, now) {
  return db.batch(prepareTargetArchive(db, jobId, now));
}

// A returned batch still needs an ordinary scan in this job to close. Allow
// one rollover only when every active batch has its full terminal inventory
// and verified same-agent return in the live queue. The atomic archive makes
// the next rollover wait for closure. The cross-job rotation guard stays intact.
const COMPLETED_CYCLE = `id=? AND cycle=? AND loop=1 AND status IN ('queued','running')
  AND NOT EXISTS (
    SELECT 1 FROM controller_dispatches d
    WHERE d.state='active' AND d.job_id=scan_jobs.id
      AND (
        d.candidate_count<=0
        OR EXISTS (SELECT 1 FROM controller_return_recoveries r WHERE r.batch=d.batch)
        OR NOT EXISTS (
          SELECT 1 FROM scan_targets t
          WHERE t.verification_batch=d.batch
          GROUP BY t.verification_batch
          HAVING COUNT(*)=d.candidate_count+1
            AND SUM(CASE WHEN t.job_id=d.job_id AND t.required_agent_id=d.agent_id
              AND t.verification_kind IN ('candidate','candidate-giant')
              AND t.status IN ('completed','failed','cancelled') THEN 1 ELSE 0 END)=d.candidate_count
            AND SUM(CASE WHEN t.job_id=d.job_id AND t.required_agent_id=d.agent_id
              AND t.verification_kind='return' AND t.status='completed'
              AND t.completed_agent_id=d.agent_id AND t.leased_at>0
              AND t.completed_at>=t.leased_at THEN 1 ELSE 0 END)=1
        )
      )
  )
  AND EXISTS (SELECT 1 FROM scan_targets WHERE job_id=scan_jobs.id)
  AND NOT EXISTS (SELECT 1 FROM scan_targets WHERE job_id=scan_jobs.id AND
    (status='leased' OR (status='queued' AND (cycle>=scan_jobs.cycle OR verification_kind<>''))))`;

export function canRollScanCycle(db, jobId, cycle) {
  // Old releases could leave ordinary queued rows under a stale cycle. Those
  // rows cannot be claimed, but leases and verification work still block a reset.
  return db.prepare(`SELECT id FROM scan_jobs WHERE ${COMPLETED_CYCLE}`)
    .bind(jobId, cycle).first();
}

function prepareNextCycleTargets(db, jobId, cycle, planJson, now, marker) {
  return db.prepare(`INSERT INTO scan_targets (
    job_id, sequence, cycle, country, city, lat, lng, region_index,
    point_index, base_cooldown_s, status, created_at, updated_at, completed_at
  ) SELECT j.id, p.key, j.cycle, p.value->>'$.country', p.value->>'$.city',
    p.value->>'$.lat', p.value->>'$.lng', p.value->>'$.regionIndex',
    p.value->>'$.pointIndex', p.value->>'$.cooldownS',
    'queued', ?, ?, 0
  FROM scan_jobs j, json_each(?) p
  WHERE j.id=? AND j.cycle=? AND j.message=? ORDER BY p.key`)
    .bind(now, now, planJson, jobId, cycle, marker);
}

export async function rollScanCycle(db, jobId, cycle, targets, now) {
  if (!targets.length) throw new Error('Cannot start an empty scan cycle');
  const next = cycle + 1;
  const planJson = JSON.stringify(targets);
  // The uncommitted marker ties every statement to the winner of the CAS.
  // It is replaced in the same transaction, including when polls race an ACK.
  const marker = crypto.randomUUID();
  const archiveGuard = {
    sql: 'AND EXISTS (SELECT 1 FROM scan_jobs WHERE id=? AND cycle=? AND message=?)',
    params: [jobId, next, marker],
  };
  const [claim] = await db.batch([
    db.prepare(`UPDATE scan_jobs SET cycle=?, current_index=0, total_points=?,
      plan_json=?, updated_at=?, message=? WHERE ${COMPLETED_CYCLE}`)
      .bind(next, targets.length, planJson, now, marker, jobId, cycle),
    ...prepareTargetArchive(db, jobId, now, archiveGuard),
    prepareNextCycleTargets(db, jobId, next, planJson, now, marker),
    db.prepare(`UPDATE scan_jobs SET message=? WHERE id=? AND cycle=? AND message=?`)
      .bind(`第 ${next} 輪完成，重新分派掃描點`, jobId, next, marker),
  ]);
  return Boolean(claim.meta.changes);
}
