const LOOKBACK_DAYS=7;

export function parseTargetAckEvidence(params) {
 const agentId=params.get('evidence_agent')||'';
 const value=params.get('evidence_targets')||'';
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(agentId)||value.length>200)throw Error('invalid evidence query');
 const parts=value.split(',');
 if(parts.length>10||parts.some(p=>!/^\d{1,16}$/.test(p)||!Number.isSafeInteger(Number(p))||Number(p)<1))throw Error('invalid evidence targets');
 return {agentId,targetIds:[...new Set(parts.map(Number))]};
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
 return {schema:1,generated_at:now,lookback_days:LOOKBACK_DAYS,agent_id:agentId,target_acknowledgements:result.results};
}
