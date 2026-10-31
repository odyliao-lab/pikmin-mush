// Map presence is not fleet health. Keep brief ACK/cooldown gaps visible without
// using the phone's reported coordinates or changing scheduler online rules.
export const MAP_RECENT_MS = 5 * 60_000;
export const MAP_FRESH_MS = 90_000;
export const RECENT_MAP_TARGETS_SQL = `SELECT COALESCE(t.id,h.id) AS id, a.id AS agent_id, e.at AS position_at,
  COALESCE(t.lat,h.lat) AS lat, COALESCE(t.lng,h.lng) AS lng,
  COALESCE(t.country,h.country) AS country, COALESCE(t.city,h.city) AS city
  FROM scan_agents a
  JOIN scan_agent_events e ON e.id=(
    SELECT id FROM scan_agent_events WHERE agent_id=a.id AND at>=?
      AND event_type IN ('target_claimed','target_completed')
    ORDER BY at DESC,id DESC LIMIT 1)
  LEFT JOIN scan_targets t ON t.id=e.target_id
  LEFT JOIN scan_target_history h ON h.id=e.target_id AND t.id IS NULL
  WHERE a.enabled=1 AND a.paused=0`;
export const MAP_TARGETS_SQL = `SELECT id, NULL AS agent_id, NULL AS position_at, lat, lng, country, city
  FROM scan_targets WHERE id IN (SELECT current_target_id FROM scan_agents
    WHERE enabled=1 AND paused=0 AND current_target_id IS NOT NULL)
  UNION ALL ${RECENT_MAP_TARGETS_SQL}`;

function point(target) {
  if (target?.lat == null || target?.lng == null) return null;
  const lat=Number(target.lat),lng=Number(target.lng);
  return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180 ? [lat,lng] : null;
}

export function mapAgents(agents, targets, recentTargets, now=Date.now()) {
  const current=new Map(targets.map(t=>[Number(t.id),t]));
  const recent=new Map(recentTargets.map(t=>[String(t.agent_id),t]));
  return agents.filter(a=>a.enabled).map(a=>{
    const age=Math.max(0,now-Number(a.last_seen)), seen=Number(a.last_seen)>0&&age<MAP_RECENT_MS;
    const assigned=a.current_target_id==null?null:current.get(Number(a.current_target_id));
    const last=recent.get(String(a.id));
    const fallback=last&&Number(last.position_at)>=now-MAP_RECENT_MS&&Number(last.position_at)<=now+1_000?last:null;
    const target=point(assigned)?assigned:fallback;
    const location=seen&&!a.paused?point(target):null;
    const state=a.paused?'paused':!seen?'offline':age>=MAP_FRESH_MS?'delayed':assigned&&point(assigned)?'assigned':'waiting';
    return {
      id:String(a.id).slice(0,64), name:String(a.name).slice(0,96), state,
      current_location:location, location_source:location?(target===assigned?'assigned_target':'recent_target'):null,
      country:location?String(target.country??'').slice(0,96):'',
      city:location?String(target.city??'').slice(0,96):'', last_seen:Number(a.last_seen),
    };
  });
}
