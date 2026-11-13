import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyRecoveryEvidence,validEmptyRecovery} from '../lib/empty-recovery.mjs';
import {scanEvidence} from '../lib/scan-evidence.mjs';

const values={recovery_version:1,evidence_version:1,refresh_source:'object',ok:1,rows:0,bytes:0,
 job_id:4,target_id:123,game_pid:456,native_pid:456,pid_before:456,process_start:77,start_before:77,
 scan_started_s:1794500000,object_at_s:1794500010,sampled_at_s:1794500020,
 object_token:'179450000100000123',prefix_start:100,prefix_end:100,accepted_offset:100,pending_bytes:0,pending_acks:0};
const params=(patch={})=>new URLSearchParams({...values,...patch});
test('fresh authenticated lease ACK can attest an actual object-empty prefix',()=>{
 const e=emptyRecoveryEvidence(params());assert.ok(e);
 assert.equal(scanEvidence(params()).recovery.object_token,values.object_token);
 const target={id:123,job_id:4,completed_agent_id:'a',leased_at:1794500000000,completed_at:1794500021000};
 const event={agent_id:'a',target_id:123,job_id:4,at:target.completed_at,rows:0,bytes:0};
 assert.equal(validEmptyRecovery(e,target,event,event.at+1000),true);
 for(const patch of [{id:124},{job_id:5},{completed_agent_id:'b'},{leased_at:event.at+1},{completed_at:event.at-1}])
  assert.equal(validEmptyRecovery(e,{...target,...patch},event,event.at+1000),false);
 assert.equal(validEmptyRecovery(e,target,event,event.at+120001),false);
 assert.equal(validEmptyRecovery({...e,sampled_at_s:e.sampled_at_s-200},target,event,event.at),false);
});
test('query/timeout/old PID/job token, pending/unknown/partial or unaccepted prefix cannot attest emptiness',()=>{
 for(const patch of [{refresh_source:'query'},{refresh_source:'timeout'},{native_pid:457},{pid_before:1},
  {start_before:78},{object_token:'179450000100000124'},{object_token:'179449999900000123'},
  {prefix_end:101},{accepted_offset:99},{pending_bytes:1},{pending_bytes:''},{pending_acks:1},
  {sampled_at_s:1794500601},{object_at_s:1794499999},{rows:1},{bytes:1},{game_pid:0},
  {recovery_version:2},{ok:0}])assert.equal(emptyRecoveryEvidence(params(patch)),null,JSON.stringify(patch));
 for(const key of Object.keys(values)){
  if(key==='evidence_version')continue;
  const p=params();p.delete(key);assert.equal(emptyRecoveryEvidence(p),null,key);
 }
});
