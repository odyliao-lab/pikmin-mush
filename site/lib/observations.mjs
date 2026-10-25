/** No inferred historical scan time: received_at is the server ingestion time. */
export function observationIdentity(row, agentId, receivedAt, receiptId = null) {
  const start = Number(row.start_ms) > 0 ? Number(row.start_ms) : 0;
  const challenge = JSON.stringify([row.id, start || "unresolved"]);
  return {
    challenge,
    confidence: start ? "challenge_start" : "unresolved",
    // Receipt identity separates distinct envelopes even in the same second.
    // Legacy callers keep their original time-based deduplication.
    key: JSON.stringify([challenge, agentId, receiptId === null ? receivedAt : ["receipt-v1", receiptId], row.level, row.type,
      row.challenger_count, row.challenger_capacity, row.total_power, row.finish_ms]),
  };
}

export function observationStatements(db, row, agentId, now, targetId = null, receiptId = null) {
  const rows = Array.isArray(row) ? row : [row];
  const identities = rows.map(row => observationIdentity(row, agentId, now, receiptId));
  const placeholders = count => rows.map(() => `(${Array(count).fill("?").join(",")})`).join(",");
  return [
    db.prepare(`INSERT INTO mushroom_locations (id,lat,lng,first_recorded_at,last_recorded_at)
      VALUES ${placeholders(5)} ON CONFLICT(id) DO UPDATE SET
      lat=excluded.lat,lng=excluded.lng,last_recorded_at=excluded.last_recorded_at`)
      .bind(...rows.flatMap(row => [row.id,row.lat,row.lng,now,now])),
    db.prepare(`INSERT INTO mushroom_challenges
      (key,location_id,start_ms,identity_confidence,first_recorded_at,last_observed_at)
      VALUES ${placeholders(6)} ON CONFLICT(key) DO UPDATE SET last_observed_at=excluded.last_observed_at`)
      .bind(...rows.flatMap((row,i) => [identities[i].challenge,row.id,Math.max(0,row.start_ms),identities[i].confidence,now,now])),
    db.prepare(`INSERT OR IGNORE INTO mushroom_observations
      (key,challenge_key,agent_id,received_at,level,type,challenger_count,challenger_capacity,total_power,finish_ms,target_id)
      VALUES ${placeholders(11)}`)
      .bind(...rows.flatMap((row,i) => [identities[i].key,identities[i].challenge,agentId,now,row.level,row.type,
        row.challenger_count,row.challenger_capacity,row.total_power,row.finish_ms,targetId])),
  ];
}
