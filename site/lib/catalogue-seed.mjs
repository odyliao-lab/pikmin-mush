// Increment when the canonical source catalogue changes (YYYYMMDD + sequence).
export const CATALOGUE_REVISION = 2026100202;
export const CATALOGUE_STATE = "event-spots-catalogue";

export function catalogueStatements(db, spots, revision, now) {
  if (!spots.length || new Set(spots.map(s=>s.id)).size!==spots.length)
    throw new Error("Catalogue must be nonempty with unique IDs");
  const guard="(SELECT last_run_at FROM maintenance_state WHERE name=?) < ?";
  return [
    db.prepare(`DELETE FROM event_spots WHERE ${guard}`).bind(CATALOGUE_STATE,revision),
    ...spots.map(spot=>db.prepare(`INSERT INTO event_spots (
      id,country,city,name,lat,lng,spot_kind,reward_kind,reward_summary,
      start_at,end_at,cooldown_note,eligibility_note,coordinate_note,
      verification_status,source_title,source_url,last_verified_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`)
      .bind(spot.id,spot.country,spot.city,spot.name,spot.lat,spot.lng,spot.spotKind,
        spot.rewardKind,spot.rewardSummary,spot.startAt,spot.endAt,spot.cooldownNote,
        spot.eligibilityNote,spot.coordinateNote,spot.verificationStatus,spot.sourceTitle,
        spot.sourceUrl,spot.lastVerifiedAt,now,CATALOGUE_STATE,revision)),
    db.prepare("UPDATE maintenance_state SET last_run_at=? WHERE name=? AND last_run_at<?")
      .bind(revision,CATALOGUE_STATE,revision),
  ];
}
