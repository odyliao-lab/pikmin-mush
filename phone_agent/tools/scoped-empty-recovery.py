"""Prepare a byte-preserving scoped 2.2.17 -> 2.2.18 port; no device access."""
import argparse, hashlib, json, re
from pathlib import Path

def function(source, name):
    m = re.search(rb'^'+name.encode()+rb'\(\) \{\n.*?^\}\n', source, re.M|re.S)
    if not m: raise ValueError('missing function: '+name)
    return m.group()

def prepare(original, reference):
    if b'\r' in original or b'empty_recovery_query() {' in original:
        raise ValueError('unexpected source; inspect rather than force')
    before=b'AGENT_VERSION="${AGENT_VERSION:-2.2.17}"'
    after=b'AGENT_VERSION="${AGENT_VERSION:-2.2.18}"'
    if original.count(before)!=1 or reference.count(after)!=1:
        raise ValueError('unexpected version')
    candidate=original.replace(before,after)
    changes=[]
    def replace(old,new):
        nonlocal candidate
        if candidate.count(old)!=1: raise ValueError('ambiguous or missing scoped anchor')
        candidate=candidate.replace(old,new,1);changes.append((old,new))
    # The merged implementation is the only source for witness and retry semantics.
    retry=function(original,'retry_scan_ack')
    refretry=function(reference,'retry_scan_ack')
    restoredretry=re.sub(rb'  # Frozen ACK accounting.*?  RETRY_EVIDENCE=.*?\n',b'',refretry,flags=re.S)
    restoredretry=restoredretry.replace(b'"$RETRY_EVIDENCE"',b'"${6:-}"')
    if retry!=restoredretry: raise ValueError('scoped retry differs; manual review required')
    replace(retry,refretry)
    functions=b''.join(function(reference,n)+b'\n' for n in ('game_process_identity','empty_recovery_query'))
    replace(b'execute_scan_task() {',functions+b'execute_scan_task() {')
    old=b'  BEFORE_SIZE="$1"; BEFORE_LINES="$2"\n'
    new=old+b'  RECOVERY_BEFORE="$(game_process_identity)" || RECOVERY_BEFORE=""\n  RECOVERY_NATIVE_BEFORE="$(cat "$APP_FILES/native.ready" 2>/dev/null)" || RECOVERY_NATIVE_BEFORE=""\n'
    replace(old,new)
    old=b'    REFRESH_TOKEN="$(date +%s)$(printf \'%05d\' $((TASK_TARGET_ID % 100000)))"\n'
    refexecute=function(reference,'execute_scan_task')
    token_block=re.search(rb'    if \[ "\$TASK_TARGET_ID" -le 99999999 \]; then\n.*?    fi\n',refexecute,re.S)
    if not token_block: raise ValueError('reference missing full target token guard')
    new=token_block.group()
    replace(old,new)
    old=b'  upload_new || true\n  printf \'%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n\''
    new=b'  upload_new || true\n  RECOVERY_QUERY="$(empty_recovery_query)" || RECOVERY_QUERY=""\n  DIAG_QUERY="$DIAG_QUERY$RECOVERY_QUERY"\n  printf \'%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n\''
    replace(old,new)
    restored=candidate
    for old,new in reversed(changes):
        if restored.count(new)!=1: raise ValueError('reverse proof ambiguous')
        restored=restored.replace(new,old,1)
    restored=restored.replace(after,before,1)
    if restored!=original: raise ValueError('changed bytes outside allowed patch')
    protected=('auth_curl','scan_control','upload_new','send_scan_ack','scan_snapshot','pending_upload_bytes')
    for name in protected:
        if function(candidate,name)!=function(original,name): raise ValueError('protected function changed: '+name)
    return candidate,{'original_sha256':hashlib.sha256(original).hexdigest(),'candidate_sha256':hashlib.sha256(candidate).hexdigest(),'unchanged_outside_scoped_patch':True,'protected_function_hashes':{n:hashlib.sha256(function(original,n)).hexdigest() for n in protected}}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('original','reference','output','proof'): p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args()
    if a.output.exists() or a.proof.exists(): raise SystemExit('do not overwrite evidence')
    candidate,proof=prepare(a.original.read_bytes(),a.reference.read_bytes().replace(b'\r\n',b'\n'))
    a.output.write_bytes(candidate);a.proof.write_text(json.dumps(proof,indent=2)+'\n')
    print(json.dumps(proof))
