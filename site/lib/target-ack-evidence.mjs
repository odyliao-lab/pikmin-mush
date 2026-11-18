const LOOKBACK_DAYS=7;
const MAX_OBSERVATION_WINDOW_MS=15*60_000;

// The target tables are joined by primary key. The server's seconds-resolution
// receipt time is bounded to the interval after leasing and through the ACK.
const OBSERVATION_EVIDENCE_SQL=`WITH requested AS (
  SELECT json_extract(value,'$.target_id') AS target_id,
   json_extract(value,'$.job_id') AS job_id,
   json_extract(value,'$.at') AS ack_at FROM json_each(?)
), evidence_targets AS (
  SELECT t.id,t.job_id,t.verification_kind,t.status,t.completed_agent_id,t.leased_at,t.completed_at,q.ack_at
   FROM requested q JOIN scan_targets t ON t.id=q.target_id AND t.job_id=q.job_id
  UNION ALL
  SELECT h.id,h.job_id,h.verification_kind,h.status,h.completed_agent_id,h.leased_at,h.completed_at,q.ack_at
   FROM requested q JOIN scan_target_history h ON h.id=q.target_id AND h.job_id=q.job_id
   WHERE NOT EXISTS(SELECT 1 FROM scan_targets t WHERE t.id=h.id)
)
SELECT t.id AS target_id,t.job_id,t.ack_at,
 (SELECT json_object('received_at',o.received_at,'level',o.level)
  FROM mushroom_observations o INDEXED BY mushroom_observations_received_idx
  WHERE o.received_at BETWEEN CAST((t.leased_at+999)/1000 AS INTEGER) AND CAST(t.ack_at/1000 AS INTEGER)
   AND o.target_id=t.id AND o.agent_id=t.completed_agent_id AND o.level IN (3,4)
  ORDER BY o.received_at LIMIT 1) AS accepted
FROM evidence_targets t
WHERE t.status='completed' AND t.verification_kind='' AND t.completed_agent_id=?
 AND t.completed_at=t.ack_at AND t.leased_at>0 AND t.ack_at-t.leased_at BETWEEN 0 AND ?`;

async function readObservationEvidence(db,agentId,acks,now) {
 const matches=new Map();
 for (const ack of acks) {
  if (ack.at<=now && ack.rows>0 && ack.bytes>0 && !matches.has(ack.target_id)) {
   matches.set(ack.target_id,{target_id:ack.target_id,job_id:ack.job_id,at:ack.at});
  }
 }
 if (!matches.size) return [];
 const result=await db.prepare(OBSERVATION_EVIDENCE_SQL)
  .bind(JSON.stringify([...matches.values()]),agentId,MAX_OBSERVATION_WINDOW_MS).all();
 return result.results.filter(row=>row.accepted!==null).map(row=>({
  target_id:row.target_id,job_id:row.job_id,ack_at:row.ack_at,...JSON.parse(row.accepted),
 }));
}


export function parseTargetAckEvidence(params) {
 const agentId=params.get('evidence_agent')||'';
 const value=params.get('evidence_targets')||'';
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(agentId)||value.length>200)throw Error('invalid evidence query');
 const parts=value.split(',');
 if(parts.length>10||parts.some(p=>!/^\d{1,16}$/.test(p)||!Number.isSafeInteger(Number(p))||Number(p)<1))throw Error('invalid evidence targets');
 const observationFlags=params.getAll('evidence_observations');
 if(observationFlags.length && (observationFlags.length!==1 || observationFlags[0]!=='1'))throw Error('invalid observation evidence flag');
 const targetIds=[...new Set(parts.map(Number))];
 return observationFlags.length?{agentId,targetIds,includeObservations:true}:{agentId,targetIds};
}

// Persisted ACK events survive queue-cycle replacement and the latest120 UI
// logs. Only fixed numeric metadata is returned, never detail/lease/locations.
export async function readTargetAckEvidence(db,query,now=Date.now()) {
 const {agentId,targetIds}=parseTargetAckEvidence(new URLSearchParams({
  evidence_agent:query.agentId,evidence_targets:query.targetIds.join(',')}));
 const result=await db.prepare(`SELECT id,agent_id,event_type,at,job_id,target_id,rows,bytes,duration_ms
  FROM scan_agent_events WHERE agent_id=? AND event_type='target_completed'
    AND at>=? AND target_id IN (${targetIds.map(()=>'?').join(',')})
  ORDER BY at DESC,id DESC LIMIT 50`).bind(agentId,now-LOOKBACK_DAYS*86400000,...targetIds).all();
 const response={schema:1,generated_at:now,lookback_days:LOOKBACK_DAYS,agent_id:agentId,target_acknowledgements:result.results};
 if(query.includeObservations===true) {
  return {...response,accepted_observations:await readObservationEvidence(db,agentId,result.results,now)};
 }
 return response;
}
