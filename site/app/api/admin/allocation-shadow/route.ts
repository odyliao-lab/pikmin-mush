import { adminAuthorized, controllerAuthorized, ensureSchema, noStoreJson, runtime } from "../../../../lib/cloud";
import { planDailyRotation } from "../../../../lib/rotation-plan.mjs";
import { COUNTRY_PACK_CATALOG } from "../../../../lib/scan-plans";
import { scoreRegions } from "../../../../lib/allocation-shadow.mjs";
import { TARGET_HISTORY_CTE } from "../../../../lib/target-history.mjs";
import { comparisonWindow, buildAllocationComparison } from "../../../../lib/allocation-comparison.mjs";

export async function GET(request: Request) {
  if (!adminAuthorized(request) && !controllerAuthorized(request)) return noStoreJson({error:"forbidden"},403);
  await ensureSchema();
  const db=runtime().DB, now=Date.now();
  await db.prepare(`INSERT OR IGNORE INTO maintenance_state (name,last_run_at)
    VALUES ('allocation-history-v2',?)`).bind(now).run();
  const epoch=await db.prepare("SELECT last_run_at FROM maintenance_state WHERE name='allocation-history-v2'").first<{last_run_at:number}>();
  const params=new URL(request.url).searchParams;
  if (params.get('view')==='comparison') {
    let window;
    try { window=comparisonWindow(params,now,Number(epoch?.last_run_at??now)); }
    catch { return noStoreJson({error:'Invalid comparison window: provide from/to milliseconds, 1h–7d, within corrected history and not in the future'},400); }
    return noStoreJson(await buildAllocationComparison(db,window));
  }
  const since=Math.max(now-7*86400000,Number(epoch?.last_run_at ?? now));
  const [effort,opportunities,integrity,agents]=await Promise.all([
    db.prepare(`${TARGET_HISTORY_CTE} SELECT t.country, COUNT(*) AS targets, SUM(e.duration_ms) AS scan_ms
      FROM scan_agent_events e JOIN durable_targets t ON e.target_id=t.id
      WHERE e.at>=? AND e.event_type IN ('target_completed','target_failed')
      AND t.verification_kind='' GROUP BY t.country`).bind(since).all(),
    db.prepare(`${TARGET_HISTORY_CTE} SELECT t.country,COUNT(DISTINCT o.challenge_key) AS eligible_unique
      FROM mushroom_observations o JOIN durable_targets t ON o.target_id=t.id
      WHERE o.received_at>=? AND o.level IN (3,4) AND o.challenger_count>=0
      AND o.challenger_count<5 AND o.challenger_capacity>0
      AND o.challenger_count<=o.challenger_capacity AND t.verification_kind=''
      GROUP BY t.country`).bind(Math.ceil(since/1000)).all(),
    db.prepare(`${TARGET_HISTORY_CTE} SELECT
      (SELECT COUNT(*) FROM mushroom_observations o LEFT JOIN durable_targets t ON o.target_id=t.id
        WHERE o.received_at>=? AND o.target_id IS NOT NULL AND t.id IS NULL) AS orphan_observations,
      (SELECT COUNT(*) FROM scan_agent_events e LEFT JOIN durable_targets t ON e.target_id=t.id
        WHERE e.at>=? AND e.event_type IN ('target_completed','target_failed') AND t.id IS NULL) AS orphan_events`)
      .bind(Math.ceil(since/1000),since).first<{orphan_observations:number;orphan_events:number}>(),
    db.prepare("SELECT id FROM scan_agents WHERE enabled=1 ORDER BY id").all<{id:string}>(),
  ]);
  const counts=new Map(opportunities.results.map(r=>[r.country,Number(r.eligible_unique)]));
  const hours=Math.max(0,(now-since)/3600000);
  const planned=planDailyRotation(agents.results.map(a=>a.id),now);
  const allowedPacks=new Set(planned.assignments.flatMap(r=>r.packs));
  const countries=new Set(COUNTRY_PACK_CATALOG.filter(p=>allowedPacks.has(p.id)).map(p=>p.name));
  const regions=scoreRegions(effort.results.filter(r=>countries.has(String(r.country)))
      .map(r=>({...r,eligible_unique:counts.get(r.country)??0})),hours);
  return noStoreJson({mode:"shadow",live_routes_changed:false,observed_hours:hours,
    measurement_version:2,window_start:since,window_end:now,integrity,
    exploration_floor:0.2, canary_ready:!integrity?.orphan_observations && !integrity?.orphan_events && regions.filter(r=>r.enough_evidence).length>=2,
    policy_window_verified:false,
    note:"大／巨菇口徑須至少48小時，且逐台切換時間需驗證涵蓋整段窗口；目前站端尚無完整切換證據，保持未達資料門檻。舊資料不混比，未自動改區。",
    regions});
}
