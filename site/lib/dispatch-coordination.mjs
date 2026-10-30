// Sticky, durable admission. No expiry-based stealing of an unknown batch.
export const DISPATCH_SCHEMA = [
 `CREATE TABLE IF NOT EXISTS controller_dispatches (
 batch TEXT PRIMARY KEY, owner TEXT NOT NULL, payload_sha TEXT NOT NULL,
 admission TEXT NOT NULL UNIQUE, agent_id TEXT NOT NULL, job_id INTEGER NOT NULL,
 candidate_count INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'active',
 created_at INTEGER NOT NULL, closed_at INTEGER NOT NULL DEFAULT 0)`,
 `CREATE UNIQUE INDEX IF NOT EXISTS controller_one_active_dispatch
 ON controller_dispatches(state) WHERE state='active'`,
 `CREATE TABLE IF NOT EXISTS controller_return_recoveries (
 batch TEXT PRIMARY KEY, recovery_id TEXT NOT NULL UNIQUE, agent_id TEXT NOT NULL,
 original_job_id INTEGER NOT NULL, job_id INTEGER NOT NULL,
 original_return_target_id INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
];
export async function ensureDispatchSchema(db) {
 await db.batch(DISPATCH_SCHEMA.map(sql=>db.prepare(sql)));
}
const TARGETS = `WITH targets AS (
 SELECT id,job_id,verification_batch,verification_kind,status,leased_at,completed_at,
 completed_agent_id FROM scan_targets
 UNION ALL SELECT h.id,h.job_id,h.verification_batch,h.verification_kind,h.status,
 h.leased_at,h.completed_at,h.completed_agent_id FROM scan_target_history h
 WHERE NOT EXISTS(SELECT 1 FROM scan_targets t WHERE t.id=h.id)) `;

export async function dispatchProof(db,batch) {
 const claim=await db.prepare('SELECT * FROM controller_dispatches WHERE batch=?').bind(batch).first();
 if(!claim)return null;
 const rows=await db.prepare(TARGETS+`SELECT * FROM targets WHERE verification_batch=?`).bind(batch).all();
 const recovery=await db.prepare('SELECT * FROM controller_return_recoveries WHERE batch=?').bind(batch).first();
 const candidates=rows.results.filter(r=>!['return','return-recovery'].includes(r.verification_kind));
 const returns=rows.results.filter(r=>['return','return-recovery'].includes(r.verification_kind));
 const effectiveReturns=returns.filter(r=>recovery?r.verification_kind==='return-recovery':r.verification_kind==='return');
 const r=effectiveReturns.length===1?effectiveReturns[0]:null;
 const returnJob=recovery?.job_id??claim.job_id;
 const returnAck=!!r&&r.status==='completed'&&r.completed_agent_id===claim.agent_id&&
  r.job_id===returnJob&&r.leased_at>0&&r.completed_at>=r.leased_at;
 let resumed=null;
 if(returnAck)resumed=await db.prepare(TARGETS+`SELECT t.id,t.completed_at,o.received_at
 FROM targets t JOIN mushroom_observations o ON o.target_id=t.id
 WHERE t.job_id=? AND t.verification_kind='' AND t.status='completed'
 AND t.completed_agent_id=? AND o.agent_id=? AND t.leased_at>=?
 AND t.leased_at>0 AND t.completed_at>=t.leased_at
 AND o.received_at>=CAST((t.leased_at+999)/1000 AS INTEGER)
 AND o.received_at<=CAST(t.completed_at/1000 AS INTEGER)
 ORDER BY t.completed_at DESC,t.id DESC LIMIT 1`)
 .bind(returnJob,claim.agent_id,claim.agent_id,r.completed_at).first();
 const candidatesTerminal=candidates.length===claim.candidate_count&&candidates.length>0&&
  candidates.every(t=>['completed','failed','cancelled'].includes(t.status));
 return {batch,owner:claim.owner,state:claim.state,agent_id:claim.agent_id,original_job_id:claim.job_id,
  return_scheduled:effectiveReturns.length===1,
  return_recovery:recovery?{id:recovery.recovery_id,original_job_id:recovery.original_job_id,
   job_id:recovery.job_id,created_at:recovery.created_at,original_return_cancelled:true}:null,
  return_targets:returns.map(t=>({target_id:t.id,status:t.status,leased_at:t.leased_at,
   completed_at:t.completed_at,ack:!!r&&t.id===r.id&&returnAck})),
  return_ack:returnAck,resumed_object_accepted:!!resumed,
  resumed_target_id:resumed?.id??null,resumed_received_at:resumed?.received_at??null,
  candidates_terminal:candidatesTerminal,
  can_close:candidatesTerminal&&returnAck&&!!resumed};
}

// Operator-authorized continuation, never an admission replay or a fabricated ACK.
// The cancelled original target and immutable claim remain unchanged. A fresh
// return in the current job AND a subsequent accepted ordinary observation are
// still required before closeDispatch can release the admission.
export async function recoverCancelledReturn(db,batch,owner,recoveryId,agent,job,now) {
 if(!/^[a-zA-Z0-9._:-]{6,100}$/.test(recoveryId))return {http:400,error:'invalid_recovery_id'};
 const claim=await db.prepare('SELECT * FROM controller_dispatches WHERE batch=?').bind(batch).first();
 if(!claim||claim.owner!==owner)return {http:409,error:'ownership_mismatch'};
 const old=await db.prepare('SELECT * FROM controller_return_recoveries WHERE batch=?').bind(batch).first();
 if(old)return old.recovery_id===recoveryId?{http:200,ok:true,existing:true,coordination:await dispatchProof(db,batch)}:
  {http:409,error:'recovery_identity_conflict'};
 const proof=await dispatchProof(db,batch);
 if(claim.state!=='active'||!proof.candidates_terminal||proof.return_targets.length!==1||
   proof.return_targets[0].status!=='cancelled')return {http:409,error:'cancelled_return_not_proven'};
 if(!agent||agent.id!==claim.agent_id||!agent.enabled||agent.paused||now-agent.last_seen>15000||
   agent.last_seen>now+1000||!Number.isFinite(agent.current_lat)||!Number.isFinite(agent.current_lng))
  return {http:409,error:'agent_not_fresh_or_return_location_unknown'};
 if(!job||job.id===claim.job_id||!['queued','running'].includes(job.status))return {http:409,error:'job_not_superseded'};
 const originalReturn=proof.return_targets[0].target_id;
 const minimum=await db.prepare('SELECT MIN(sequence) AS n FROM scan_targets WHERE job_id=?').bind(job.id).first();
 const seq=Math.min(-1,Number(minimum?.n??0)-2);
 const reserve=db.prepare(TARGETS+`INSERT INTO controller_return_recoveries
 (batch,recovery_id,agent_id,original_job_id,job_id,original_return_target_id,created_at)
 SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM controller_dispatches WHERE batch=? AND owner=? AND state='active')
 AND NOT EXISTS(SELECT 1 FROM controller_return_recoveries WHERE batch=?)
 AND NOT EXISTS(SELECT 1 FROM scan_targets WHERE verification_batch<>'' AND status IN ('queued','leased'))
 AND NOT EXISTS(SELECT 1 FROM scan_jobs WHERE id=? AND status IN ('queued','running','paused'))
 AND EXISTS(SELECT 1 FROM scan_jobs WHERE id=? AND cycle=? AND status IN ('queued','running'))
 AND EXISTS(SELECT 1 FROM scan_agents WHERE id=? AND enabled=1 AND paused=0
  AND last_seen>=? AND last_seen<=? AND current_lat=? AND current_lng=?)
 AND EXISTS(SELECT 1 FROM targets WHERE id=? AND verification_batch=? AND verification_kind='return' AND status='cancelled')
 AND (SELECT COUNT(*) FROM targets WHERE verification_batch=? AND verification_kind NOT IN ('return','return-recovery'))=?
 AND NOT EXISTS(SELECT 1 FROM targets WHERE verification_batch=? AND verification_kind NOT IN ('return','return-recovery')
  AND status NOT IN ('completed','failed','cancelled'))`)
 .bind(batch,recoveryId,claim.agent_id,claim.job_id,job.id,originalReturn,now,batch,owner,batch,
  claim.job_id,job.id,job.cycle,agent.id,now-15000,now+1000,agent.current_lat,agent.current_lng,
  originalReturn,batch,batch,claim.candidate_count,batch);
 const target=db.prepare(`INSERT INTO scan_targets
 (job_id,sequence,cycle,country,city,lat,lng,region_index,point_index,base_cooldown_s,
 status,priority,required_agent_id,verification_batch,verification_mushroom_id,verification_kind,created_at,updated_at)
 SELECT ?,?, ?,?,'operator return recovery',?,?,-1,?,0,'queued',90,?,?,'','return-recovery',?,?
 WHERE EXISTS(SELECT 1 FROM controller_return_recoveries WHERE batch=? AND recovery_id=?)
 AND NOT EXISTS(SELECT 1 FROM scan_targets WHERE verification_batch=? AND verification_kind='return-recovery')
 AND NOT EXISTS(SELECT 1 FROM scan_target_history WHERE verification_batch=? AND verification_kind='return-recovery')`)
 .bind(job.id,seq,job.cycle,agent.country,agent.current_lat,agent.current_lng,claim.candidate_count,agent.id,batch,now,now,
  batch,recoveryId,batch,batch);
 await db.batch([reserve,target]);
 const accepted=await db.prepare('SELECT recovery_id FROM controller_return_recoveries WHERE batch=?').bind(batch).first();
 if(accepted?.recovery_id!==recoveryId)return {http:409,error:'recovery_preconditions_changed'};
 return {http:200,ok:true,coordination:await dispatchProof(db,batch)};
}

export async function dispatchInventory(db,cursor='',limit=100) {
 if(typeof cursor!=='string'||cursor.length>100||!Number.isInteger(limit)||limit<1||limit>100)
  throw new Error('invalid inventory cursor or limit');
 const found=await db.prepare(`SELECT batch FROM (
 SELECT verification_batch AS batch FROM scan_targets
 WHERE verification_batch<>'' AND status IN ('queued','leased')
 UNION SELECT batch FROM controller_dispatches WHERE state='active')
 WHERE batch>? ORDER BY batch LIMIT ?`).bind(cursor,limit+1).all();
 const keys=found.results.slice(0,limit).map(r=>r.batch);
 const batches=[];
 for(const batch of keys){
  const pending=await db.prepare(`SELECT verification_kind AS kind,status,COUNT(*) AS count
   FROM scan_targets WHERE verification_batch=? AND status IN ('queued','leased')
   GROUP BY verification_kind,status`).bind(batch).all();
  batches.push({batch,pending:pending.results,coordination:await dispatchProof(db,batch)});
 }
 return {contract:2,batches,next_cursor:found.results.length>limit?keys.at(-1):null,
  scope:'all live verification queues plus all unresolved durable admissions',
  historical_unregistered_batches:'not certified; archived/cancelled legacy transactions remain historical unknowns'};
}

export async function canonicalPayload(input) {
 const encoded=JSON.stringify({agentId:input.agentId,kind:input.kind,
  candidates:input.candidates.map(c=>({id:c.id,lat:c.lat,lng:c.lng}))});
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(encoded));
 return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}

export async function admitDispatch(db,input,agent,job,now,admission=crypto.randomUUID()) {
 const payloadSha=await canonicalPayload(input);
 const old=await db.prepare('SELECT * FROM controller_dispatches WHERE batch=?').bind(input.batch).first();
 if(old){
  if(old.owner!==input.owner||old.payload_sha!==payloadSha)
   return {http:409,error:'batch_identity_conflict'};
  return {http:200,ok:true,contract:2,batch:input.batch,existing:true,return_scheduled:true,
   coordination:await dispatchProof(db,input.batch)};
 }
 if(agent.paused||!agent.enabled||now-agent.last_seen>15000||agent.last_seen>now+1000||
  !Number.isFinite(agent.current_lat)||!Number.isFinite(agent.current_lng))
  return {http:409,error:'agent_not_fresh_or_return_location_unknown'};
 if(!['queued','running'].includes(job.status))return {http:409,error:'job_not_active'};
 const minimum=await db.prepare('SELECT MIN(sequence) AS n FROM scan_targets WHERE job_id=?').bind(job.id).first();
 let seq=Math.min(-1,Number(minimum?.n??0)-input.candidates.length-2);
 const guard=`EXISTS(SELECT 1 FROM controller_dispatches WHERE batch=? AND admission=? AND state='active')`;
 const statements=[db.prepare(`INSERT INTO controller_dispatches
 (batch,owner,payload_sha,admission,agent_id,job_id,candidate_count,created_at)
 SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM controller_dispatches WHERE state='active')
 AND NOT EXISTS(SELECT 1 FROM scan_targets WHERE verification_batch<>'' AND status IN ('queued','leased'))
 AND NOT EXISTS(SELECT 1 FROM scan_targets WHERE verification_batch=?)
 AND NOT EXISTS(SELECT 1 FROM scan_target_history WHERE verification_batch=?)
 AND EXISTS(SELECT 1 FROM scan_jobs WHERE id=? AND cycle=? AND status IN ('queued','running'))
 AND EXISTS(SELECT 1 FROM scan_agents WHERE id=? AND enabled=1 AND paused=0
 AND last_seen>=? AND last_seen<=? AND current_lat=? AND current_lng=?)`)
 .bind(input.batch,input.owner,payloadSha,admission,input.agentId,job.id,input.candidates.length,now,input.batch,input.batch,
  job.id,job.cycle,input.agentId,now-15000,now+1000,agent.current_lat,agent.current_lng)];
 const add=(c,index,kind,priority)=>db.prepare(`INSERT INTO scan_targets
 (job_id,sequence,cycle,country,city,lat,lng,region_index,point_index,base_cooldown_s,
 status,priority,required_agent_id,verification_batch,verification_mushroom_id,verification_kind,created_at,updated_at)
 SELECT ?,?,?,?,'coordinated verification',?,?,-1,?,0,'queued',?,?,?,?,?,?,? WHERE ${guard}`)
 .bind(job.id,seq++,job.cycle,agent.country,c.lat,c.lng,index,priority,input.agentId,input.batch,
 kind==='return'?'':c.id,kind,now,now,input.batch,admission);
 input.candidates.forEach((c,i)=>statements.push(add(c,i,input.kind,100)));
 statements.push(add({lat:agent.current_lat,lng:agent.current_lng},input.candidates.length,'return',90));
 await db.batch(statements); // reservation and every target commit or roll back together
 const accepted=await db.prepare('SELECT admission FROM controller_dispatches WHERE batch=?').bind(input.batch).first();
 if(accepted?.admission!==admission)return {http:409,error:'global_dispatch_busy'};
 return {http:200,ok:true,contract:2,batch:input.batch,return_scheduled:true,
  candidates:input.candidates.length,job_id:job.id};
}

export async function closeDispatch(db,batch,owner,now) {
 const proof=await dispatchProof(db,batch);
 if(!proof||proof.owner!==owner)return {http:409,error:'ownership_mismatch'};
 if(proof.state==='closed')return {http:200,ok:true,already_closed:true};
 if(!proof.can_close)return {http:409,error:'return_or_resumed_object_unconfirmed',coordination:proof};
 await db.prepare(`UPDATE controller_dispatches SET state='closed',closed_at=?
 WHERE batch=? AND owner=? AND state='active'`).bind(now,batch,owner).run();
 return {http:200,ok:true,coordination:proof};
}
