import {controllerAuthorized,ensureSchema,noStoreJson,runtime} from '../../../../lib/cloud';
import {activeJob} from '../../../../lib/scans';
import {agentHealth} from '../../../../lib/metrics';
import {qualifiedForSlot} from '../../../../lib/fleet-policy.mjs';
import {rotationWindow} from '../../../../lib/rotation-plan.mjs';

// Safe discovery, not enrollment. The sole dispatcher still requires an
// operator-verified identity/backup approval before borrowing a worker.
export async function GET(request: Request) {
 if(!controllerAuthorized(request))return noStoreJson({error:'unauthorized'},401);
 await ensureSchema();
 const db=runtime().DB,now=Date.now(),job=await activeJob();
 const rows=await db.prepare(`SELECT a.id,a.display_name,a.enabled,a.paused,a.last_seen,
 a.last_data_at,a.last_target_at,a.no_data_streak,a.current_target_id,a.current_job_id,
 a.agent_version,a.game_version,a.module_version,a.capabilities_json,
 EXISTS(SELECT 1 FROM agent_power_pauses p WHERE p.agent_id=a.id AND p.resumed_at IS NULL) AS power_hold
 FROM scan_agents a ORDER BY a.id`).all();
 const timings=await db.prepare(`SELECT agent_id,AVG(duration_ms) AS average_ms
 FROM scan_agent_events WHERE at>=? AND event_type='target_completed' AND duration_ms>0 GROUP BY agent_id`)
 .bind(now-3600000).all();
 const slot=rotationWindow(now).slot;
 const workers=rows.results.map((row:any)=>{
  const health=agentHealth(row,now);
  return {id:row.id,name:row.display_name,health:health.status,
   eligible:!!job&&row.current_job_id===job.id&&health.status==='healthy'&&!row.power_hold&&
    now-row.last_data_at<10*60000&&qualifiedForSlot(row.capabilities_json,slot),
   average_target_ms:Number((timings.results as any[]).find(t=>t.agent_id===row.id)?.average_ms??20000)};
 });
 return noStoreJson({contract:2,parallel_contract:1,max_parallel:3,checked_at:now,workers});
}
