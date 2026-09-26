// Controller-only report contract. Membership uses immutable server discovery,
// not the mutable public-map first_seen or game challenge start timestamp.
export const REPORT_CANDIDATES_SQL = `SELECT c.key AS challenge_key,c.location_id AS id,
  c.start_ms,c.identity_confidence,c.first_recorded_at AS discovered_at,
  c.first_recorded_at AS first_seen,m.lat,m.lng,m.level,m.type,
  m.challenger_count,m.challenger_capacity,m.finish_ms
 FROM mushroom_challenges c JOIN mushrooms m ON m.id=c.location_id AND m.start_ms=c.start_ms
 WHERE c.first_recorded_at>=? AND c.first_recorded_at<? AND c.key>?
   AND m.level=? AND m.challenger_capacity>0 AND m.challenger_count>=0
   AND m.challenger_count<5 AND m.challenger_count<=m.challenger_capacity
   AND m.invalidated_at=0 AND m.giant_recheck_status<>'invalid'
   AND (m.finish_ms=0 OR m.finish_ms>?)
 ORDER BY c.key LIMIT 501`;

// A loop/region rotation can delete live targets. Archived leases and exact
// target-attributed observations still prove what was actually rechecked.
export const REPORT_EVIDENCE_SQL = `WITH targets AS (
 SELECT id,verification_mushroom_id,verification_kind,status,leased_at,completed_at,
        completed_agent_id,lat,lng FROM scan_targets WHERE verification_batch=?
 UNION ALL
 SELECT h.id,h.verification_mushroom_id,h.verification_kind,h.status,h.leased_at,
        h.completed_at,h.completed_agent_id,h.lat,h.lng FROM scan_target_history h
 WHERE h.verification_batch=? AND NOT EXISTS(SELECT 1 FROM scan_targets t WHERE t.id=h.id)
 ) SELECT t.id AS target_id,t.verification_mushroom_id AS id,t.status,t.lat,t.lng,
 t.verification_kind,t.leased_at,t.completed_at,
 c.key AS challenge_key,c.start_ms,c.first_recorded_at AS discovered_at,
 o.level,o.type,o.challenger_count,o.challenger_capacity,o.finish_ms,o.received_at,
 m.start_ms AS current_start_ms,m.level AS current_level,m.type AS current_type,
 m.challenger_count AS current_count,m.challenger_capacity AS current_capacity,m.invalidated_at,m.giant_recheck_status,
 m.finish_ms AS current_finish_ms
 FROM targets t LEFT JOIN mushroom_observations o ON o.key=(
   SELECT x.key FROM mushroom_observations x JOIN mushroom_challenges xc ON xc.key=x.challenge_key
   WHERE x.target_id=t.id AND x.agent_id=t.completed_agent_id
     AND xc.location_id=t.verification_mushroom_id
     AND x.received_at>=CAST((t.leased_at+999)/1000 AS INTEGER)
     AND x.received_at<=CAST(t.completed_at/1000 AS INTEGER)
   ORDER BY x.received_at DESC,x.key DESC LIMIT 1)
 LEFT JOIN mushroom_challenges c ON c.key=o.challenge_key
 LEFT JOIN mushrooms m ON m.id=t.verification_mushroom_id
 WHERE t.verification_kind IN ('candidate','candidate-giant') ORDER BY t.id`;

export function reportEvidence(row, now = Date.now()) {
  const refreshed = row.status === 'completed' && row.received_at != null &&
    row.leased_at > 0 && row.completed_at >= row.leased_at;
  const count = Number(row.challenger_count ?? -1);
  const capacity = Number(row.challenger_capacity ?? 0);
  const changed = row.current_start_ms !== row.start_ms || row.current_type !== row.type ||
    row.current_level !== row.level;
  const expired = (row.finish_ms > 0 && row.finish_ms <= now) ||
    (row.current_finish_ms > 0 && row.current_finish_ms <= now) || row.invalidated_at > 0 ||
    row.giant_recheck_status === 'invalid';
  const participantsChanged = row.current_count !== count || row.current_capacity !== capacity;
  return {...row, refreshed, challenger_count: count, challenger_capacity: capacity,
    verified_at: refreshed ? Number(row.received_at) * 1000 : null,
    reason: !refreshed ? 'unconfirmed' : changed ? 'challenge_changed' : expired ? 'expired' :
      count >= 5 || row.current_count >= 5 ? 'participants_full' :
      participantsChanged ? 'updated_since_verification' : 'observed',
    eligible: refreshed && !changed && !expired && !participantsChanged && capacity > 0 && count >= 0 && count < 5 &&
      count <= capacity && row.current_count >= 0 && row.current_count < 5 &&
      row.level === (row.verification_kind === 'candidate' ? 3 : 4)};
}
