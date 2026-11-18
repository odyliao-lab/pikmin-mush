export const OPERATOR_CANCELLED = 'operator-cancelled';

export async function dispatchCancellation(db, batch) {
  const row = await db.prepare(`SELECT batch,agent_id,job_id,cancelled_at,pending_targets_json
    FROM controller_dispatch_cancellations WHERE batch=?`).bind(batch).first();
  if (!row) return null;
  const {pending_targets_json, ...receipt} = row;
  return {...receipt, state: OPERATOR_CANCELLED, cancelled_targets: JSON.parse(pending_targets_json)};
}

// Only the authenticated route calls this operation. One atomic D1 batch
// captures the exact pending targets and applies the same scope to the writes.
export async function cancelStoppedDispatch(db, {batch, owner, agentId, jobId}, now) {
  const claim = await db.prepare(`SELECT owner,agent_id,job_id,state
    FROM controller_dispatches WHERE batch=?`).bind(batch).first();
  if (!claim || claim.owner !== owner || claim.agent_id !== agentId || claim.job_id !== jobId) {
    return {http:409, error:'dispatch_identity_mismatch'};
  }
  if (claim.state === 'closed') return {http:409, error:'dispatch_already_closed'};
  if (claim.state === OPERATOR_CANCELLED) {
    const cancellation = await dispatchCancellation(db,batch);
    return cancellation ? {http:200, ok:true, cancellation} : {http:409, error:'cancellation_receipt_missing'};
  }
  if (claim.state !== 'active') return {http:409, error:'dispatch_not_active'};

  // Forward-only additive audit table. Existing read paths need no migration
  // until the first authorized cancellation creates this table and transition.
  await db.prepare(`CREATE TABLE IF NOT EXISTS controller_dispatch_cancellations (
    batch TEXT PRIMARY KEY, owner TEXT NOT NULL, agent_id TEXT NOT NULL,
    job_id INTEGER NOT NULL, cancelled_at INTEGER NOT NULL,
    pending_targets_json TEXT NOT NULL, operation TEXT NOT NULL
  )`).run();
  const operation = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO controller_dispatch_cancellations
      (batch,owner,agent_id,job_id,cancelled_at,pending_targets_json,operation)
      SELECT d.batch,d.owner,d.agent_id,d.job_id,?,
        (SELECT json_group_array(json_object('target_id',t.id,'kind',t.verification_kind,'previous_status',t.status))
         FROM scan_targets t WHERE t.verification_batch=d.batch AND t.status IN ('queued','leased')),?
      FROM controller_dispatches d JOIN scan_jobs j ON j.id=d.job_id
      WHERE d.batch=? AND d.owner=? AND d.agent_id=? AND d.job_id=? AND d.state='active'
        AND j.status='cancelled'
        AND NOT EXISTS (
          SELECT 1 FROM scan_targets t
          WHERE t.verification_batch=d.batch AND t.status IN ('queued','leased')
            AND (t.job_id IS NOT d.job_id OR t.required_agent_id IS NOT d.agent_id
              OR t.verification_kind NOT IN ('candidate','candidate-giant','return')
              OR (t.status='leased' AND t.lease_expires_at>?)
              OR EXISTS (SELECT 1 FROM scan_agents a WHERE a.current_target_id=t.id))
        )
        AND NOT EXISTS (SELECT 1 FROM controller_return_recoveries r WHERE r.batch=d.batch)
      ON CONFLICT(batch) DO NOTHING`).bind(now,operation,batch,owner,agentId,jobId,now),
    db.prepare(`UPDATE scan_targets SET status='cancelled',updated_at=?
      WHERE verification_batch=? AND job_id=? AND required_agent_id=?
        AND status IN ('queued','leased')
        AND EXISTS (SELECT 1 FROM controller_dispatch_cancellations WHERE batch=? AND operation=?)`)
      .bind(now,batch,jobId,agentId,batch,operation),
    db.prepare(`UPDATE controller_dispatches SET state=?
      WHERE batch=? AND owner=? AND state='active'
        AND EXISTS (SELECT 1 FROM controller_dispatch_cancellations WHERE batch=? AND operation=?)`)
      .bind(OPERATOR_CANCELLED,batch,owner,batch,operation),
  ]);
  const cancellation = await dispatchCancellation(db,batch);
  if (!cancellation) return {http:409, error:'stopped_dispatch_preconditions_changed'};
  return {http:200, ok:true, cancellation};
}
