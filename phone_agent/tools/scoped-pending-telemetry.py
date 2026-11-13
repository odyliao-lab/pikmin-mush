"""Prepare a minimal2.2.16 scoped patch. No device access; private inputs stay private."""
from pathlib import Path
import argparse,hashlib,json,re

VERSION_BEFORE=b'AGENT_VERSION="${AGENT_VERSION:-2.2.16}"'
VERSION_AFTER=b'AGENT_VERSION="${AGENT_VERSION:-2.2.17}"'
HEADER_BEFORE=b'-H "X-Agent-Id: $AGENT_ID" \\\n'
HEADER_AFTER=b'-H "X-Agent-Id: $AGENT_ID" -H "X-Agent-Pending-Bytes: $TELEMETRY_PENDING" \\\n'
ASSIGN=b'  TELEMETRY_PENDING="$(pending_upload_bytes)"\n'

def function(source,name):
    match=re.search(rb'^'+name.encode()+rb'\(\) \{\n.*?^\}\n',source,re.M|re.S)
    if not match:raise ValueError('missing function: '+name)
    return match.group()

def prepare(original,reference):
    if b'\r' in original or original.count(VERSION_BEFORE)!=1 or b'pending_upload_bytes() {' in original:
        raise ValueError('unexpected scoped source; review it instead of forcing a patch')
    candidate=original.replace(VERSION_BEFORE,VERSION_AFTER)
    for name in ('auth_curl','scan_control'):
        old=function(original,name)
        if old.count(HEADER_BEFORE)!=2:raise ValueError('unexpected header variants: '+name)
        first=old.index(b'\n')+1
        new=old[:first]+ASSIGN+old[first:]
        new=new.replace(HEADER_BEFORE,HEADER_AFTER)
        candidate=candidate.replace(old,new,1)
    pending=function(reference,'pending_upload_bytes')+b'\n'
    candidate=candidate.replace(b'auth_curl() {',pending+b'auth_curl() {',1)
    restored=candidate.replace(pending,b'',1).replace(VERSION_AFTER,VERSION_BEFORE)
    for name in ('auth_curl','scan_control'):
        new=function(restored,name)
        restored=restored.replace(new,new.replace(ASSIGN,b'',1).replace(HEADER_AFTER,HEADER_BEFORE),1)
    if restored!=original:raise ValueError('unexpected bytes changed outside allowed patch')
    protected=('upload_new','send_scan_ack','retry_scan_ack','scan_snapshot','execute_scan_task')
    hashes={name:hashlib.sha256(function(original,name)).hexdigest() for name in protected}
    if any(function(candidate,name)!=function(original,name) for name in protected):
        raise ValueError('protected function changed')
    return candidate,{'originalSha256':hashlib.sha256(original).hexdigest(),'candidateSha256':hashlib.sha256(candidate).hexdigest(),'unchangedBytesOutsidePatch':True,'protectedFunctionHashes':hashes,'allowedChanges':['default version','pending_upload_bytes','pending header/assignment inside auth_curl and scan_control']}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--original',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--receipt',type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists() or args.receipt.exists():raise SystemExit('Output exists; do not overwrite evidence')
    reference=Path(__file__).resolve().parents[1]/'agent.sh'
    candidate,receipt=prepare(args.original.read_bytes(),reference.read_bytes())
    args.output.write_bytes(candidate)
    args.receipt.write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(receipt))
