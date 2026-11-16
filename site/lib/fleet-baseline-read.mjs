import {baselineWindow,buildFleetBaseline} from './fleet-baseline-core.mjs';

// Conservative candidate limits, not a validated production query budget.
// No pagination/retry: a partial retained snapshot must never become a zero.
export const BASELINE_READ_LIMITS = Object.freeze({rows:20000,bytes:4*1024*1024,
  responseBytes:128*1024,cycleGroups:256,reportedRowsRead:1000000});
const DAY = 86400000;
const EPOCH_SQL = "SELECT last_run_at FROM maintenance_state WHERE name='allocation-history-v2' LIMIT 1";
const OBS_COLUMNS = alias => `
  CASE WHEN length(CAST(${alias}.key AS BLOB))<=512 THEN ${alias}.key END AS key,
  CASE WHEN length(CAST(${alias}.challenge_key AS BLOB))<=512 THEN ${alias}.challenge_key END AS challenge_key,
  CASE WHEN length(CAST(${alias}.agent_id AS BLOB))<=128 THEN ${alias}.agent_id END AS agent_id,
  ${alias}.target_id,${alias}.received_at,${alias}.level,
  ${alias}.challenger_count,${alias}.challenger_capacity,${alias}.finish_ms`;
const EVENT_COLUMNS = alias => `${alias}.id,
  CASE WHEN length(CAST(${alias}.agent_id AS BLOB))<=128 THEN ${alias}.agent_id END AS agent_id,
  ${alias}.target_id,${alias}.job_id,${alias}.event_type,${alias}.at,${alias}.duration_ms,
  CASE WHEN length(CAST(${alias}.detail AS BLOB))<=4096 AND json_valid(${alias}.detail) THEN
    CASE WHEN json_extract(${alias}.detail,'$.evidence.version')=1
      AND json_extract(${alias}.detail,'$.evidence.refresh_source') IN ('object','query','timeout','legacy','unknown')
    THEN json_object('evidence',json_object('version',1,'refresh_source',
      json_extract(${alias}.detail,'$.evidence.refresh_source'))) END END AS detail`;
const OBS_NAMES='key,challenge_key,agent_id,target_id,received_at,level,challenger_count,challenger_capacity,finish_ms';
const EVENT_NAMES='id,agent_id,target_id,job_id,event_type,at,duration_ms,detail';
// Window receipts plus one actual earliest retained3/4 receipt per challenge.
// Unrelated old challenges must not consume the result budget.
const OBS_CTE = `WITH window_observations AS MATERIALIZED (
  SELECT ${OBS_COLUMNS('o')} FROM mushroom_observations o INDEXED BY mushroom_observations_received_idx
  WHERE o.received_at>=?6 AND o.received_at<?2 AND o.level IN (3,4) LIMIT ?5
), observations AS MATERIALIZED (
  SELECT ${OBS_NAMES} FROM window_observations
  UNION
  SELECT ${OBS_COLUMNS('p')} FROM mushroom_observations p WHERE p.key IN (
    SELECT (SELECT h.key FROM mushroom_observations h INDEXED BY mushroom_observations_challenge_idx
      WHERE h.challenge_key=w.challenge_key AND h.received_at>=?1 AND h.received_at<?6
        AND h.level IN (3,4) ORDER BY h.received_at LIMIT 1)
    FROM (SELECT DISTINCT challenge_key FROM window_observations) w)
  LIMIT ?5
)`;
// Prior failed events cannot establish completion or receipt alignment. Keep
// one actual earliest completed event for each relevant Agent/target, not a
// fabricated marker, and preserve all terminal events inside the window.
const EVENTS_CTE = `${OBS_CTE}, window_events AS MATERIALIZED (
  SELECT ${EVENT_COLUMNS('e')} FROM scan_agent_events e INDEXED BY scan_agent_events_type_at_idx
  WHERE e.event_type IN ('target_completed','target_failed') AND e.at>=?7 AND e.at<?4 LIMIT ?5
), pairs AS MATERIALIZED (
  SELECT agent_id,target_id FROM window_events WHERE target_id IS NOT NULL
  UNION SELECT agent_id,target_id FROM window_observations WHERE target_id IS NOT NULL
), earlier_completions AS MATERIALIZED (
  SELECT ${EVENT_COLUMNS('e')},ROW_NUMBER() OVER (
    PARTITION BY e.agent_id,e.target_id ORDER BY e.at,e.id) AS rn
  FROM scan_agent_events e INDEXED BY scan_agent_events_type_at_idx
  JOIN pairs p ON p.target_id=e.target_id AND p.agent_id=e.agent_id
  WHERE e.event_type='target_completed' AND e.at>=?3 AND e.at<?7
), events AS MATERIALIZED (
  SELECT ${EVENT_NAMES} FROM window_events
  UNION ALL SELECT ${EVENT_NAMES} FROM earlier_completions WHERE rn=1 LIMIT ?5
)`;
const jsonProjection = names => `json_object(${names.split(',').map(n=>`'${n}',${n}`).join(',')})`;
const PREFLIGHT_SQL = `WITH obs_probe AS MATERIALIZED (
    SELECT ${OBS_COLUMNS('o')} FROM mushroom_observations o INDEXED BY mushroom_observations_received_idx
    WHERE received_at>=?6 AND received_at<?2 AND level IN (3,4) LIMIT ?5),
  event_probe AS MATERIALIZED (
    SELECT ${EVENT_COLUMNS('e')} FROM scan_agent_events e INDEXED BY scan_agent_events_type_at_idx
    WHERE event_type IN ('target_completed','target_failed') AND at>=?7 AND at<?4 LIMIT ?5)
  SELECT (SELECT COUNT(*) FROM obs_probe) AS observations,
    (SELECT COUNT(*) FROM event_probe) AS events,
    (SELECT COALESCE(SUM(length(CAST(${jsonProjection(OBS_NAMES)} AS BLOB))),0) FROM obs_probe)+
    (SELECT COALESCE(SUM(length(CAST(${jsonProjection(EVENT_NAMES)} AS BLOB))),0) FROM event_probe) AS window_json_bytes`;


// Fixed SQL and bindings only. Indexed time ranges + sentinel LIMITs bound
// materialized rows. LIMIT is not a CPU/rows-scanned cancellation mechanism.
export function baselineReadStatements(w) {
  const args = [Math.ceil(w.historyFrom/1000),Math.ceil(w.to/1000),w.historyFrom,w.to,
    BASELINE_READ_LIMITS.rows+1,Math.ceil(w.from/1000),w.from];
  return [
    {name:'epoch',sql:EPOCH_SQL,args:[]},
    {name:'observations',sql:`${OBS_CTE} SELECT * FROM observations`,args:args.slice(0,6)},
    {name:'events',sql:`${EVENTS_CTE} SELECT * FROM events`,args},
    {name:'challenges',sql:`${OBS_CTE}
      SELECT c.key,CASE WHEN c.identity_confidence='challenge_start' THEN 'challenge_start'
        ELSE 'unresolved' END AS identity_confidence FROM mushroom_challenges c
      WHERE c.key IN (SELECT challenge_key FROM observations) LIMIT ?5`,args:args.slice(0,6)},
    ...['scan_targets','scan_target_history'].map((table,i)=>({
      name:i?'archivedTargets':'targets',sql:`${EVENTS_CTE}, ids AS (
        SELECT target_id AS id FROM observations WHERE target_id IS NOT NULL
        UNION SELECT target_id FROM events WHERE target_id IS NOT NULL)
      SELECT t.id,t.job_id,t.cycle,CASE WHEN t.verification_kind='' THEN ''
        WHEN t.verification_kind IS NOT NULL THEN 'verification' END AS verification_kind FROM ${table} t
      WHERE t.id IN (SELECT id FROM ids) LIMIT ?5`,args})),
  ];
}

function snapshotBytesWithinLimit(results) {
  const encoder=new TextEncoder();
  let bytes=2; // outer []
  for(let i=0;i<results.length;i++) {
    bytes+=2+(i?1:0);
    for(let j=0;j<results[i].results.length;j++) {
      bytes+=(j?1:0)+encoder.encode(JSON.stringify(results[i].results[j])).byteLength;
      if(bytes>BASELINE_READ_LIMITS.bytes)return false;
    }
  }
  return true;
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
    // This advisory preflight can only reject. Its counts never become report
    // denominators. The actual snapshot is still one separately checked batch.
    const counts=await db.prepare(PREFLIGHT_SQL).bind(...plan[2].args).first();
    if(!counts || ![counts.observations,counts.events,counts.window_json_bytes]
      .every(n=>Number.isSafeInteger(n)&&n>=0))
      return reply(503,unavailable('incomplete_read',w));
    if(counts.observations>BASELINE_READ_LIMITS.rows || counts.events>BASELINE_READ_LIMITS.rows)
      return reply(503,unavailable('row_limit',w));
    if(counts.window_json_bytes>BASELINE_READ_LIMITS.bytes)
      return reply(503,unavailable('snapshot_byte_limit',w));
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
    if(!snapshotBytesWithinLimit(results))
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
