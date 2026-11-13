import {emptyRecoveryEvidence} from './empty-recovery.mjs';
export function scanEvidence(params, pendingBytes) {
  if(params.get('evidence_version') !== '1')return null;
  const number = key => {
    const value=params.get(key);
    if(value===null || !/^\d{1,8}$/.test(value))return null;
    return Math.min(Number(value),86400000);
  };
  const source=params.get('refresh_source');
  return {version:1,refresh_source:['object','query','timeout','legacy','unknown'].includes(source)?source:'unknown',
    scan_ms:number('scan_ms'),refresh_ms:number('refresh_ms'),restarts:number('restarts'),
    upload_failures:number('upload_failures'),
    // auth_curl samples the existing pending header immediately before sending.
    // A late append or a retry with new pending data invalidates the earlier
    // frozen empty witness, even when its own query still says pending_bytes=0.
    ...(params.has('recovery_version')?{recovery:pendingBytes===0?emptyRecoveryEvidence(params):null}:{})};
}
