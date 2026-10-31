import {controllerAuthorized,ensureSchema,noStoreJson,runtime} from '../../../../lib/cloud';
import {activeJob} from '../../../../lib/scans';
import {agentHealth} from '../../../../lib/metrics';
import {qualifiedForSlot} from '../../../../lib/fleet-policy.mjs';
import {rotationWindow} from '../../../../lib/rotation-plan.mjs';

type WorkerRow=Parameters<typeof agentHealth>[0]&{
 id:string;display_name:string;current_job_id:number|null;capabilities_json:string;region_tags_json:string;power_hold:number;
};

// Safe discovery, not enrollment. The sole dispatcher still requires an
// operator-verified identity/backup approval before borrowing a worker.
export async function GET(request: Request) {
 if(!controllerAuthorized(request))return noStoreJson({error:'unauthorized'},401);
 await ensureSchema();
 const db=runtime().DB,now=Date.now(),job=await activeJob();
 const rows=await db.prepare(`SELECT a.id,a.display_name,a.enabled,a.paused,a.last_seen,
 a.last_data_at,a.last_target_at,a.no_data_streak,a.current_target_id,a.current_job_id,
 a.agent_version,a.game_version,a.module_version,a.capabilities_json,a.region_tags_json,
 EXISTS(SELECT 1 FROM agent_power_pauses p WHERE p.agent_id=a.id AND p.resumed_at IS NULL) AS power_hold
 FROM scan_agents a ORDER BY a.id`).all<WorkerRow>();
 const timings=await db.prepare(`SELECT agent_id,AVG(duration_ms) AS average_ms
 FROM scan_agent_events WHERE at>=? AND event_type='target_completed' AND duration_ms>0 GROUP BY agent_id`)
 .bind(now-3600000).all<{agent_id:string;average_ms:number}>();
 const slot=rotationWindow(now).slot;
 const workers=rows.results.map(row=>{
  const health=agentHealth(row,now);
  let tags:unknown=[];try{tags=JSON.parse(row.region_tags_json);}catch{}
  const assigned=Array.isArray(tags)&&tags.length>0&&tags.every(t=>typeof t==='string'&&t.length>0);
  // ACK clears current_job_id while the Agent waits for its next point.
  // An idle Agent still needs recent accepted data and an assigned route.
  const reasons=[
   !job||!['queued','running'].includes(job.status)?'job_not_active':null,
   job&&row.current_job_id!==null&&row.current_job_id!==job.id?'other_job':null,
   health.status!=='healthy'?'health':null,row.power_hold?'power_guard':null,
   now-row.last_data_at>=10*60000?'stale_data':null,
   !qualifiedForSlot(row.capabilities_json,slot)?'unqualified_slot':null,
   !assigned?'unassigned_route':null,
  ].filter((reason):reason is string=>reason!==null);
  return {id:row.id,name:row.display_name,health:health.status,
   eligible:reasons.length===0,reasons,
   average_target_ms:Number(timings.results.find(t=>t.agent_id===row.id)?.average_ms??20000)};
 });
 return noStoreJson({contract:2,parallel_contract:1,max_parallel:3,checked_at:now,workers});
}
