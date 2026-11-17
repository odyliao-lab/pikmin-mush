import {comparisonWindow} from './allocation-comparison.mjs';

// Offline reference model for a future bounded SELECT adapter. No route or DB
// access is wired here; production query/memory profiling remains a release gate.
export const MAX_BASELINE_INPUT_ROWS = 100000;
const collections = ['observations','challenges','targets','archivedTargets','events'];
const safe = value => Number.isSafeInteger(value);
const id = value => safe(value) && value > 0;
const agent = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const key = value => typeof value === 'string' && value.length > 0 && value.length <= 8192;
const terminal = value => ['target_completed','target_failed'].includes(value);
const pair = (who,target) => JSON.stringify([who,target]);
const requireValue = value => { if (!value) throw Error('invalid_snapshot'); };

export function baselineWindow({from,to,now,historyFrom} = {}) {
  if (![from,to,now,historyFrom].every(safe) || historyFrom <= 0 || now <= 0)
    throw RangeError('Explicit absolute bounds and retained history are required');
  return {...comparisonWindow(new URLSearchParams({from:String(from),to:String(to)}),now,historyFrom),
    historyFrom,now};
}

const envelope = w => ({measurement_version:1,mode:'offline_reference',
  window_start:w.from,window_end:w.to,window_hours:w.hours,history_from:w.historyFrom,
  history_left_censored:true,active_qualified_agent_hours:null,spare_budget:null,
  qualification_complete:false,activation_ready:false});
const unavailable = (w,reason) => ({...envelope(w),snapshot_complete:false,reason,
  observations:null,effort:null,cycles:null});

function insert(map,k,value) {
  if (map.has(k)) requireValue(JSON.stringify(map.get(k)) === JSON.stringify(value));
  else map.set(k,value);
}

function targets(rows) {
  const result = new Map();
  for (const r of rows) {
    requireValue(r && id(r.id));
    insert(result,r.id,{id:r.id,job_id:id(r.job_id)?r.job_id:null,
      cycle:safe(r.cycle)&&r.cycle>=0?r.cycle:null,
      kind:typeof r.verification_kind==='string'?r.verification_kind:null});
  }
  return result;
}

function diagnostic(detail) {
  try {
    const e = JSON.parse(detail)?.evidence;
    return e?.version===1 && ['object','query','timeout','legacy','unknown'].includes(e.refresh_source)
      ? e.refresh_source : 'unknown';
  } catch { return 'unknown'; }
}

export function buildFleetBaseline(snapshot,options) {
  const w = baselineWindow(options);
  if (snapshot?.complete !== true || collections.some(c=>!Array.isArray(snapshot[c])))
    return unavailable(w,'incomplete_snapshot');
  if (collections.reduce((n,c)=>n+snapshot[c].length,0)>MAX_BASELINE_INPUT_ROWS)
    return unavailable(w,'input_limit');
  try { return calculate(snapshot,w); }
  catch { return unavailable(w,'invalid_snapshot'); }
}

function calculate(s,w) {
  const targetMap = targets(s.archivedTargets);
  for (const [k,v] of targets(s.targets)) targetMap.set(k,v);
  const challenges = new Map();
  for (const r of s.challenges) {
    requireValue(r && key(r.key) && typeof r.identity_confidence==='string');
    insert(challenges,r.key,r.identity_confidence);
  }
  const events = new Map();
  for (const r of s.events) {
    requireValue(r && typeof r==='object');
    if (!terminal(r.event_type)) continue;
    requireValue(id(r.id) && safe(r.at) && r.at>=0);
    if (r.at<w.historyFrom || r.at>=w.to) continue;
    requireValue(agent(r.agent_id) && (r.target_id==null || id(r.target_id)));
    insert(events,r.id,{id:r.id,at:r.at,agent:r.agent_id,target:r.target_id??null,
      job:id(r.job_id)?r.job_id:null,type:r.event_type,
      duration:safe(r.duration_ms)&&r.duration_ms>=0&&r.duration_ms<=r.at?r.duration_ms:null,
      diagnostic:diagnostic(r.detail)});
  }
  const attempts = new Map();
  for (const e of events.values()) {
    if (e.target===null) continue;
    const k = pair(e.agent,e.target);
    if (!attempts.has(k)) attempts.set(k,[]);
    attempts.get(k).push(e);
  }
  for (const list of attempts.values()) list.sort((a,b)=>a.at-b.at || a.id-b.id);

  const effort = {terminal_event_rows:0,completed_event_rows:0,failed_event_rows:0,
    ordinary_agent_targets:0,completed_agent_targets:0,failed_agent_targets:0,
    cross_window_completed_retry_targets:0,orphan_terminal_rows:0,
    verification_terminal_rows:0,unknown_kind_terminal_rows:0,
    recorded_attempt_ms:0,attempt_duration_unknown_targets:0,
    refresh_source_targets:{object:0,query:0,timeout:0,legacy:0,unknown:0},
    verified_empty_targets:null};
  for (const e of events.values()) {
    if (e.at<w.from) continue;
    effort.terminal_event_rows++;
    effort[e.type==='target_completed'?'completed_event_rows':'failed_event_rows']++;
    const t = targetMap.get(e.target);
    if (!t) effort.orphan_terminal_rows++;
    else if (t.kind===null) effort.unknown_kind_terminal_rows++;
    else if (t.kind!=='') effort.verification_terminal_rows++;
  }
  const cycleMap = new Map();
  let cycleUnknown = 0;
  for (const list of attempts.values()) {
    const inWindow = list.filter(e=>e.at>=w.from);
    if (!inWindow.length) continue;
    const e = inWindow.at(-1), t = targetMap.get(e.target);
    if (!t || t.kind!=='') continue;
    if (list.some(e=>e.type==='target_completed' && e.at<w.from)) {
      effort.cross_window_completed_retry_targets++;
      continue;
    }
    effort.ordinary_agent_targets++;
    effort[e.type==='target_completed'?'completed_agent_targets':'failed_agent_targets']++;
    if (e.duration===null) effort.attempt_duration_unknown_targets++;
    else { effort.recorded_attempt_ms+=e.duration; requireValue(safe(effort.recorded_attempt_ms)); }
    effort.refresh_source_targets[e.diagnostic]++;
    if (t.job_id===null || t.cycle===null || e.job!==t.job_id) { cycleUnknown++; continue; }
    const k = JSON.stringify([t.job_id,t.cycle]);
    if (!cycleMap.has(k)) cycleMap.set(k,{job_id:t.job_id,cycle:t.cycle,targets:0,
      completed_targets:0,failed_targets:0,first_event_at:e.at,last_event_at:e.at});
    const c = cycleMap.get(k);
    c.targets++; c[e.type==='target_completed'?'completed_targets':'failed_targets']++;
    c.first_event_at=Math.min(c.first_event_at,e.at); c.last_event_at=Math.max(c.last_event_at,e.at);
  }

  const observations = new Map();
  for (const r of s.observations) {
    requireValue(r && typeof r==='object' && safe(r.level));
    if (![3,4].includes(r.level)) continue;
    requireValue(safe(r.received_at) && r.received_at>=0 && safe(r.received_at*1000));
    const at = r.received_at*1000;
    if (at<w.historyFrom || at>=w.to) continue;
    requireValue(key(r.key) && key(r.challenge_key) && agent(r.agent_id)
      && (r.target_id==null || id(r.target_id)) && challenges.has(r.challenge_key));
    insert(observations,r.key,{challenge:r.challenge_key,agent:r.agent_id,target:r.target_id??null,
      at,level:r.level,count:r.challenger_count,capacity:r.challenger_capacity,finish:r.finish_ms});
  }
  const first = new Map();
  for (const r of observations.values())
    first.set(r.challenge,Math.min(first.get(r.challenge)??Infinity,r.at));
  const resolved = new Set(), eligible = new Set(), large = new Set(), giant = new Set();
  const partitions = {ordinary_attempt_aligned_rows:0,ordinary_unaligned_rows:0,
    verification_or_return_rows:0,without_target_rows:0,orphan_target_rows:0,unknown_target_kind_rows:0};
  let stored = 0, unresolved = 0, eligibilityUnknown = 0;
  for (const r of observations.values()) {
    if (r.at<w.from) continue;
    stored++;
    const t = targetMap.get(r.target);
    if (r.target===null) partitions.without_target_rows++;
    else if (!t) partitions.orphan_target_rows++;
    else if (t.kind===null) partitions.unknown_target_kind_rows++;
    else if (t.kind!=='') partitions.verification_or_return_rows++;
    else {
      // An ACK retry cannot shift the original attempt interval to absorb a late row.
      const e = attempts.get(pair(r.agent,r.target))?.find(e=>e.type==='target_completed');
      const aligned = e && e.duration!==null && t.job_id!==null && e.job===t.job_id
        && r.at>=e.at-e.duration && r.at<=e.at;
      partitions[aligned?'ordinary_attempt_aligned_rows':'ordinary_unaligned_rows']++;
    }
    if (challenges.get(r.challenge)!=='challenge_start') { unresolved++; continue; }
    resolved.add(r.challenge);
    const known = safe(r.count) && safe(r.capacity) && r.capacity>0 && r.count>=0
      && r.count<=r.capacity && safe(r.finish) && r.finish>=0;
    if (!known) { eligibilityUnknown++; continue; }
    if (r.count<5 && (r.finish===0 || r.finish>r.at)) {
      eligible.add(r.challenge); (r.level===3?large:giant).add(r.challenge);
    }
  }
  requireValue(Object.values(partitions).reduce((a,b)=>a+b,0)===stored);
  const firstInHistory = [...resolved].filter(k=>first.get(k)>=w.from).length;
  return {...envelope(w),snapshot_complete:true,
    observations:{stored_retained_rows:stored,resolved_challenges:resolved.size,
      eligible_challenges:eligible.size,eligible_large_challenges:large.size,
      eligible_giant_challenges:giant.size,unresolved_rows:unresolved,
      resolved_eligibility_unknown_rows:eligibilityUnknown,
      eligible_counts_complete_for_resolved_rows:eligibilityUnknown===0,
      first_in_retained_history:firstInHistory,repeat_in_retained_history:resolved.size-firstInHistory,
      attribution:partitions},effort,
    cycles:{groups:[...cycleMap.values()].sort((a,b)=>a.job_id-b.job_id || a.cycle-b.cycle)
      .map(c=>({...c,observed_event_span_ms:c.last_event_at-c.first_event_at,complete_cycle_hours:null})),
      unattributed_targets:cycleUnknown,complete_first_round_hours:null}};
}
