import test from 'node:test';
import assert from 'node:assert/strict';
import {baselineWindow,buildFleetBaseline,MAX_BASELINE_INPUT_ROWS} from '../lib/fleet-baseline-core.mjs';

const HOUR=3600000,DAY=24*HOUR,NOW=10*DAY,FROM=NOW-2*HOUR,TO=NOW-HOUR;
const options={from:FROM,to:TO,now:NOW,historyFrom:NOW-7*DAY};
const challenge=(key='c')=>({key,identity_confidence:'challenge_start',first_recorded_at:1});
const target=(id=1,extra={})=>({id,job_id:10,cycle:2,verification_kind:'',...extra});
const event=(id=1,extra={})=>({id,agent_id:'alpha',target_id:1,job_id:10,
  event_type:'target_completed',at:FROM+10000,duration_ms:10000,
  detail:JSON.stringify({evidence:{version:1,refresh_source:'object'}}),...extra});
const observation=(key='o',extra={})=>({key,challenge_key:'c',agent_id:'alpha',target_id:1,
  received_at:(FROM+5000)/1000,level:3,challenger_count:2,challenger_capacity:35,finish_ms:0,...extra});
const snapshot=(extra={})=>({complete:true,challenges:[challenge()],targets:[target()],
  archivedTargets:[],events:[event()],observations:[observation()],...extra});
const build=(s=snapshot(),o=options)=>buildFleetBaseline(s,o);

test('absolute bounds require known history/clock and a retained1h–7d half-open window',()=>{
  assert.equal(baselineWindow(options).hours,1);
  for(const change of [{from:undefined},{to:undefined},{historyFrom:0},{now:NaN},
    {from:String(FROM)},{to:NOW+1},{to:FROM+HOUR-1},{from:NOW-8*DAY},
    {historyFrom:FROM+1},{from:1,to:9*DAY}])
    assert.throws(()=>baselineWindow({...options,...change}),RangeError);
});

test('stored3/4 receipt bounds respect second precision, both endpoints and excluded levels',()=>{
  const observations=[observation('start',{received_at:FROM/1000}),
    observation('end',{received_at:TO/1000}),observation('before',{received_at:FROM/1000-1}),
    observation('large'),observation('giant',{level:4}),observation('normal',{level:2}),
    observation('small',{level:1}),observation('unknown',{level:99})];
  assert.equal(build(snapshot({observations})).observations.stored_retained_rows,3);
  assert.equal(build(snapshot({observations}),{...options,from:FROM+1,to:TO+1})
    .observations.stored_retained_rows,3); // start excluded, end second now included
});

test('fleet union deduplicates Agents, targets and both levels instead of adding subtotals',()=>{
  const r=build(snapshot({targets:[target(),target(2)],observations:[observation(),
    observation('b',{agent_id:'beta',target_id:2,level:4}),observation('c',{target_id:2})]}));
  assert.equal(r.observations.stored_retained_rows,3);
  assert.equal(r.observations.resolved_challenges,1);
  assert.equal(r.observations.eligible_challenges,1);
  assert.equal(r.observations.eligible_large_challenges,1);
  assert.equal(r.observations.eligible_giant_challenges,1);
});

test('unresolved identities are rows, never invented distinct or first-ever discoveries',()=>{
  const r=build(snapshot({challenges:[{key:'c',identity_confidence:'unresolved'}]}));
  assert.equal(r.observations.unresolved_rows,1);
  assert.equal(r.observations.resolved_challenges,0);
  assert.equal(r.observations.first_in_retained_history,0);
  assert.equal(r.history_left_censored,true);
});

test('first retained3/4 ignores all-level challenge time and an earlier normal mushroom',()=>{
  let r=build(snapshot({observations:[observation('old',{level:2,received_at:(FROM-1000)/1000}),observation()]}));
  assert.equal(r.observations.first_in_retained_history,1);
  r=build(snapshot({observations:[observation('old',{level:4,received_at:(FROM-1000)/1000}),observation()]}));
  assert.equal(r.observations.first_in_retained_history,0);
  assert.equal(r.observations.repeat_in_retained_history,1);
  r=build(snapshot({observations:[observation('expired',{received_at:(options.historyFrom-1000)/1000}),observation()]}));
  assert.equal(r.observations.first_in_retained_history,1);
  assert.equal(r.history_left_censored,true);
});

test('full/expired/unknown capacity or count stays outside eligible-at-receipt opportunities',()=>{
  const observations=[{challenger_count:5},{challenger_count:-1},{challenger_capacity:0},
    {challenger_count:3,challenger_capacity:2},{finish_ms:FROM+5000},{finish_ms:null}]
    .map((extra,i)=>observation('o'+i,extra));
  const r=build(snapshot({observations}));
  assert.equal(r.observations.stored_retained_rows,6);
  assert.equal(r.observations.eligible_challenges,0);
  assert.equal(r.observations.resolved_eligibility_unknown_rows,4);
  assert.equal(r.observations.eligible_counts_complete_for_resolved_rows,false);
});

test('late, verification, return, absent and orphan targets stay in reconciled row accounting',()=>{
  const r=build(snapshot({targets:[target(),target(2,{verification_kind:'candidate'}),
    target(3,{verification_kind:'return'}),{id:4,job_id:10}],observations:[
    observation(),observation('late',{received_at:(FROM+20000)/1000}),
    observation('verify',{target_id:2}),observation('return',{target_id:3}),
    observation('background',{target_id:null}),observation('orphan',{target_id:999}),
    observation('unknown-kind',{target_id:4})]}));
  assert.equal(r.observations.stored_retained_rows,7);
  assert.deepEqual(r.observations.attribution,{ordinary_attempt_aligned_rows:1,
    ordinary_unaligned_rows:1,verification_or_return_rows:2,without_target_rows:1,
    orphan_target_rows:1,unknown_target_kind_rows:1});
});

test('current target wins over archived duplicate without double effort or wrong verification kind',()=>{
  const r=build(snapshot({archivedTargets:[target(1,{verification_kind:'return',cycle:1})]}));
  assert.equal(r.effort.ordinary_agent_targets,1);
  assert.equal(r.cycles.groups.length,1);
  assert.equal(r.cycles.groups[0].cycle,2);
  assert.equal(r.observations.attribution.ordinary_attempt_aligned_rows,1);
});

test('ACK terminal retries are counted once; failed event evidence remains separately visible',()=>{
  const r=build(snapshot({events:[event(1,{event_type:'target_failed'}),event(2,{at:FROM+11000}),
    event(3,{at:FROM+12000})]}));
  assert.equal(r.effort.terminal_event_rows,3);
  assert.equal(r.effort.failed_event_rows,1);
  assert.equal(r.effort.ordinary_agent_targets,1);
  assert.equal(r.effort.completed_agent_targets,1);
});

test('cross-window completed retries cannot become new points or absorb late rows',()=>{
  const r=build(snapshot({events:[event(1,{at:FROM-1000}),event(2)],observations:[observation()]}));
  assert.equal(r.effort.completed_event_rows,1);
  assert.equal(r.effort.ordinary_agent_targets,0);
  assert.equal(r.effort.cross_window_completed_retry_targets,1);
  assert.equal(r.observations.attribution.ordinary_unaligned_rows,1);
});

test('wrong Agent/job or unknown duration does not establish an aligned attempt',()=>{
  for(const change of [{agent_id:'beta'},{job_id:99},{duration_ms:null},{duration_ms:-1}]){
    const r=build(snapshot({events:[event(1,change)]}));
    assert.equal(r.observations.attribution.ordinary_attempt_aligned_rows,0);
    assert.equal(r.observations.attribution.ordinary_unaligned_rows,1);
  }
});

test('missing cycles do not inherit a current job cycle or establish full-cycle hours',()=>{
  const r=build(snapshot({targets:[{id:1,job_id:10,verification_kind:''}],jobs:[{id:10,cycle:99}]}));
  assert.equal(r.cycles.unattributed_targets,1);
  assert.deepEqual(r.cycles.groups,[]);
  assert.equal(r.cycles.complete_first_round_hours,null);
  const known=build();assert.equal(known.cycles.groups[0].observed_event_span_ms,0);
  assert.equal(known.cycles.groups[0].complete_cycle_hours,null);
});

test('object/query/timeout remain separate diagnostic labels, never verified empty witnesses',()=>{
  for(const source of ['object','query','timeout','legacy','unknown']){
    const r=build(snapshot({events:[event(1,{detail:JSON.stringify({evidence:{version:1,refresh_source:source}})})]}));
    assert.equal(r.effort.refresh_source_targets[source],1);
    assert.equal(r.effort.verified_empty_targets,null);
  }
  assert.equal(build(snapshot({events:[event(1,{detail:'broken'})]})).effort.refresh_source_targets.unknown,1);
});

test('missing, truncated, oversized or inconsistent snapshots are unknown rather than a fake zero',()=>{
  for(const s of [undefined,snapshot({complete:false}),snapshot({events:undefined}),
    snapshot({observations:Array(MAX_BASELINE_INPUT_ROWS+1)}),snapshot({challenges:[]}),
    snapshot({observations:[observation('same'),observation('same',{level:4})]}),
    snapshot({observations:[observation('bad',{received_at:'bad'})]}),
    snapshot({observations:[null]}),snapshot({events:[null]}),
    snapshot({observations:[observation('bad',{level:'3'})]})]){
    const r=buildFleetBaseline(s,options);assert.equal(r.snapshot_complete,false);
    assert.equal(r.observations,null);assert.equal(r.effort,null);assert.equal(r.activation_ready,false);
  }
});

test('identical stored-key duplicates count once; truly complete empty inputs are known zero',()=>{
  assert.equal(build(snapshot({observations:[observation(),observation()]})).observations.stored_retained_rows,1);
  const empty=build({complete:true,observations:[],challenges:[],targets:[],archivedTargets:[],events:[]});
  assert.equal(empty.snapshot_complete,true);assert.equal(empty.observations.stored_retained_rows,0);
  assert.equal(empty.effort.ordinary_agent_targets,0);
});

test('whitelisted numeric aggregates omit raw evidence and never imply active wall time or rollout',()=>{
  const secret='fixture-lease-private-credential-coordinate';
  const r=build(snapshot({token:secret,targets:[{...target(),lat:secret,lng:secret}],
    observations:[{...observation(),lat:secret}],events:[event(1,{detail:JSON.stringify({lease:secret})})]}));
  assert.equal(JSON.stringify(r).includes(secret),false);
  assert.equal(JSON.stringify(r).includes('alpha'),false);
  assert.equal(r.active_qualified_agent_hours,null);assert.equal(r.spare_budget,null);
  assert.equal(r.qualification_complete,false);assert.equal(r.activation_ready,false);
});

test('reference calculation leaves caller receipt/cursor/pending and all snapshot objects unchanged',()=>{
  const s=snapshot({uploadOffset:123,pending:{end:456,body:'frozen-fixture'},lease:'fixture-only'});
  const before=structuredClone(s);
  const freeze=value=>{if(value && typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}};
  freeze(s);assert.equal(build(s).snapshot_complete,true);assert.deepEqual(s,before);
});

test('numeric target/job identifiers retain values beyond32 bits',()=>{
  const targetId=2**40+9,jobId=2**40+11;
  const r=build(snapshot({targets:[target(targetId,{job_id:jobId})],
    events:[event(2**40+13,{target_id:targetId,job_id:jobId})],
    observations:[observation('wide',{target_id:targetId})]}));
  assert.equal(r.observations.attribution.ordinary_attempt_aligned_rows,1);
  assert.equal(r.cycles.groups[0].job_id,jobId);assert.equal(r.effort.ordinary_agent_targets,1);
});
