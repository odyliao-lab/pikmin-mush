import {baselineWindow,buildFleetBaseline} from './fleet-baseline-core.mjs';

// Conservative candidate limits, not a validated production query budget.
// No pagination/retry: a partial retained snapshot must never become a zero.
export const BASELINE_READ_LIMITS = Object.freeze({rows:20000,bytes:4*1024*1024,
  responseBytes:128*1024,cycleGroups:256,reportedRowsRead:1000000});
const DAY = 86400000;
const EPOCH_SQL = "SELECT last_run_at FROM maintenance_state WHERE name='allocation-history-v2' LIMIT 1";
const OBS = `SELECT
  CASE WHEN length(CAST(key AS BLOB))<=512 THEN key END AS key,
  CASE WHEN length(CAST(challenge_key AS BLOB))<=512 THEN challenge_key END AS challenge_key,
  CASE WHEN length(CAST(agent_id AS BLOB))<=128 THEN agent_id END AS agent_id,
  target_id,received_at,level,
  challenger_count,challenger_capacity,finish_ms
  FROM mushroom_observations INDEXED BY mushroom_observations_received_idx
  WHERE received_at>=?1 AND received_at<?2 AND level IN (3,4) LIMIT ?5`;
const EVENTS = `SELECT id,
  CASE WHEN length(CAST(agent_id AS BLOB))<=128 THEN agent_id END AS agent_id,
  target_id,job_id,event_type,at,duration_ms,
  CASE WHEN length(CAST(detail AS BLOB))<=4096 AND json_valid(detail) THEN
    CASE WHEN json_extract(detail,'$.evidence.version')=1
      AND json_extract(detail,'$.evidence.refresh_source') IN ('object','query','timeout','legacy','unknown')
    THEN json_object('evidence',json_object('version',1,'refresh_source',
      json_extract(detail,'$.evidence.refresh_source'))) END END AS detail
  FROM scan_agent_events INDEXED BY scan_agent_events_type_at_idx
  WHERE event_type IN ('target_completed','target_failed') AND at>=?3 AND at<?4 LIMIT ?5`;
const IDS = `WITH observations AS MATERIALIZED (${OBS}), events AS MATERIALIZED (${EVENTS}),
  ids AS (SELECT target_id AS id FROM observations WHERE target_id IS NOT NULL
    UNION SELECT target_id FROM events WHERE target_id IS NOT NULL)`;

// Fixed SQL and bindings only. Indexed time ranges + sentinel LIMITs bound
// materialized rows. LIMIT is not a CPU/rows-scanned cancellation mechanism.
export function baselineReadStatements(w) {
  const args = [Math.ceil(w.historyFrom/1000),Math.ceil(w.to/1000),w.historyFrom,w.to,
    BASELINE_READ_LIMITS.rows+1];
  return [
    {name:'epoch',sql:EPOCH_SQL,args:[]},
    {name:'observations',sql:OBS,args},
    {name:'events',sql:EVENTS,args},
    {name:'challenges',sql:`WITH observations AS MATERIALIZED (${OBS})
      SELECT c.key,CASE WHEN c.identity_confidence='challenge_start' THEN 'challenge_start'
        ELSE 'unresolved' END AS identity_confidence FROM mushroom_challenges c
      WHERE c.key IN (SELECT challenge_key FROM observations) LIMIT ?5`,args},
    ...['scan_targets','scan_target_history'].map((table,i)=>({
      name:i?'archivedTargets':'targets',sql:`${IDS}
      SELECT t.id,t.job_id,t.cycle,CASE WHEN t.verification_kind='' THEN ''
        WHEN t.verification_kind IS NOT NULL THEN 'verification' END AS verification_kind FROM ${table} t
      WHERE t.id IN (SELECT id FROM ids) LIMIT ?5`,args})),
  ];
}

function unavailable(reason,w) {
  return {measurement_version:1,mode:'bounded_read_candidate',reason,
    window_start:w?.from??null,window_end:w?.to??null,history_from:w?.historyFrom??null,
    snapshot_complete:false,history_left_censored:true,observations:null,effort:null,cycles:null,
    active_qualified_agent_hours:null,spare_budget:null,qualification_complete:false,
    activation_ready:false};
}
const reply = (status,body) => ({status,body});

// The actual route authorizes and checks the default-off flag BEFORE calling
// this function. It never calls ensureSchema or a rotation/cleanup helper.
export async function readFleetBaseline(db,params,now) {
  let w;
  // Reject absent/duplicate/blank/noninteger bounds before touching the DB.
  const value = name => {
    const values=params.getAll(name);
    if(values.length!==1 || !/^\d+$/.test(values[0]))throw RangeError('bounds');
    return Number(values[0]);
  };
  try { w=baselineWindow({from:value('from'),to:value('to'),now,historyFrom:Math.max(1,now-7*DAY)}); }
  catch { return reply(400,unavailable('invalid_window')); }
  try {
    const epoch=await db.prepare(EPOCH_SQL).first();
    if(!Number.isSafeInteger(epoch?.last_run_at) || epoch.last_run_at<=0 || epoch.last_run_at>now)
      return reply(503,unavailable('history_unavailable',w));
    // Physical observation retention is seven days; do not imply earlier
    // history survives just because the corrected-history epoch is older.
    const historyFrom=Math.max(epoch.last_run_at,now-7*DAY);
    try { w=baselineWindow({...w,now,historyFrom}); }
    catch { return reply(400,unavailable('outside_corrected_history',w)); }
    const plan=baselineReadStatements(w);
    // D1 batch executes this fixed SELECT sequence as a SQL transaction.
    // No fallback to independent queries, which could mix an archive reset.
    const results=await db.batch(plan.map(p=>db.prepare(p.sql).bind(...p.args)));
    if(!Array.isArray(results) || results.length!==plan.length || results.some(r=>
      r?.success!==true || !Array.isArray(r.results)))
      return reply(503,unavailable('incomplete_read',w));
    if(results[0].results.length!==1 || results[0].results[0].last_run_at!==epoch.last_run_at)
      return reply(503,unavailable('history_changed',w));
    let reportedRows=0;
    for(const r of results) {
      if(r.meta?.rows_written>0 || r.meta?.changed_db===true)
        return reply(503,unavailable('unexpected_write_metadata',w));
      if(r.meta?.rows_read!=null) {
        if(!Number.isSafeInteger(r.meta.rows_read) || r.meta.rows_read<0)
          return reply(503,unavailable('invalid_read_metadata',w));
        reportedRows+=r.meta.rows_read;
      }
    }
    if(reportedRows>BASELINE_READ_LIMITS.reportedRowsRead)
      return reply(503,unavailable('reported_read_limit',w));
    if(results.slice(1).some(r=>r.results.length>BASELINE_READ_LIMITS.rows))
      return reply(503,unavailable('row_limit',w));
    if(new TextEncoder().encode(JSON.stringify(results.map(r=>r.results))).byteLength>BASELINE_READ_LIMITS.bytes)
      return reply(503,unavailable('snapshot_byte_limit',w));
    const snapshot={complete:true};
    for(let i=1;i<plan.length;i++)snapshot[plan[i].name]=results[i].results;
    const body={...buildFleetBaseline(snapshot,w),mode:'bounded_read_candidate'};
    if(!body.snapshot_complete)return reply(503,body);
    if(body.cycles.groups.length>BASELINE_READ_LIMITS.cycleGroups ||
      new TextEncoder().encode(JSON.stringify(body)).byteLength>BASELINE_READ_LIMITS.responseBytes)
      return reply(503,unavailable('response_limit',w));
    return reply(200,body);
  } catch {
    // No raw SQL, device detail or credential-bearing exception is returned.
    // Do not retry/initialize a missing schema or turn a timeout into zero.
    return reply(503,unavailable('read_unavailable',w));
  }
}
