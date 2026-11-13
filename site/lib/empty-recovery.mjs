// Attested by the existing authenticated Agent at the original lease ACK.
// Old ACKs, heartbeats and v1 object labels do not satisfy this contract.
export function emptyRecoveryEvidence(params) {
 if(params.get('recovery_version')!=='1')return null;
 const keys=['job_id','target_id','game_pid','native_pid','process_start','pid_before','start_before',
  'scan_started_s','object_at_s','sampled_at_s','prefix_start','prefix_end','accepted_offset',
  'pending_bytes','pending_acks'];
 const e={version:1};
 for(const key of keys){
  const value=params.get(key);
  if(value===null||!/^\d{1,15}$/.test(value)||!Number.isSafeInteger(Number(value)))return null;
  e[key]=Number(value);
 }
 const token=params.get('object_token')||'';
 if(!/^\d{18}$/.test(token)||e.target_id>99999999||
  token.slice(-8)!==String(e.target_id).padStart(8,'0')||
  Number(token.slice(0,-8))<e.scan_started_s||Number(token.slice(0,-8))>e.object_at_s)return null;
 if(params.get('refresh_source')!=='object'||params.get('ok')!=='1'||params.get('rows')!=='0'||
  params.get('bytes')!=='0'||e.game_pid<=0||e.native_pid!==e.game_pid||e.pid_before!==e.game_pid||
  e.process_start<=0||e.start_before!==e.process_start||e.scan_started_s<=0||
  e.object_at_s<e.scan_started_s||e.sampled_at_s<e.object_at_s||e.sampled_at_s-e.scan_started_s>600||
  e.prefix_start!==e.prefix_end||e.accepted_offset!==e.prefix_end||e.pending_bytes!==0||e.pending_acks!==0)return null;
 return {...e,object_token:token};
}

export function validEmptyRecovery(e,target,event,now) {
 if(!e||event.rows!==0||event.bytes!==0)return false;
 // Re-parse the stored allowlisted contract, not arbitrary event detail.
 const params=new URLSearchParams(Object.fromEntries(Object.entries(e).map(([k,v])=>[k,String(v)])));
 params.set('recovery_version','1');params.set('refresh_source','object');
 params.set('ok','1');params.set('rows','0');params.set('bytes','0');
 return !!emptyRecoveryEvidence(params)&&e.job_id===target.job_id&&e.target_id===target.id&&
  event.job_id===target.job_id&&event.target_id===target.id&&event.agent_id===target.completed_agent_id&&
  event.at===target.completed_at&&event.at>=target.leased_at&&now>=event.at&&now-event.at<=120000&&
  Math.abs(event.at-e.sampled_at_s*1000)<=120000;
}

export async function findEmptyRecovery(db,targets,agentId,jobId,after,now) {
 const rows=await db.prepare(targets+`SELECT t.*,e.agent_id,e.at,e.rows,e.bytes,e.detail,
  e.job_id AS event_job_id,e.target_id AS event_target_id FROM targets t
  JOIN scan_agent_events e ON e.target_id=t.id AND e.agent_id=t.completed_agent_id
  WHERE t.job_id=? AND t.verification_kind='' AND t.status='completed'
  AND t.completed_agent_id=? AND t.leased_at>=? AND t.leased_at>0
  AND t.completed_at>=t.leased_at AND e.event_type='target_completed'
  AND e.job_id=t.job_id AND e.at=t.completed_at AND e.rows=0 AND e.bytes=0
  AND e.at>=? AND e.at<=? ORDER BY e.at DESC LIMIT 50`)
  .bind(jobId,agentId,after,now-600000,now).all();
 for(const row of rows.results){
  let e;try{const parent=JSON.parse(row.detail).evidence;
   if(parent?.refresh_source!=='object'||parent?.version!==1)continue;
   e=parent.recovery;}catch{continue;}
  if(validEmptyRecovery(e,row,{...row,job_id:row.event_job_id,target_id:row.event_target_id},now))return row;
 }
 return null;
}
