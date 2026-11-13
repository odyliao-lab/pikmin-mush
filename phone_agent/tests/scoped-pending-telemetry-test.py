"""Offline ports preserve local recovery/uploader bytes and reject source drift."""
from pathlib import Path
import importlib.util,unittest,hashlib
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('port',root/'tools/scoped-pending-telemetry.py')
port=importlib.util.module_from_spec(spec);spec.loader.exec_module(port)
reference=(root/'agent.sh').read_bytes()
def fixture():
    source=b'#!/system/bin/sh\n'+port.VERSION_BEFORE+b'\nLOCAL_WARM_RETRIES=7\n'
    for name in ('auth_curl','scan_control'):
        source+=name.encode()+b'() {\n  if [ -n "$DNS" ]; then\n    '+port.HEADER_BEFORE+b'      caller_specific_command\n  else\n    '+port.HEADER_BEFORE+b'      preserve_timeout_and_stdin\n  fi\n}\n'
    for name in ('upload_new','send_scan_ack','retry_scan_ack','scan_snapshot','execute_scan_task'):
        source+=name.encode()+b'() {\n  preserve_unique_scoped_policy "$@"\n}\n'
    return source+b'UNRELATED_TAIL=keep\n'
class ScopedPort(unittest.TestCase):
    def test_preserves_local_recovery_and_uploaders_and_adds_both_paths(self):
        old=fixture();new,receipt=port.prepare(old,reference)
        self.assertIn(b'LOCAL_WARM_RETRIES=7\n',new)
        self.assertTrue(new.endswith(b'UNRELATED_TAIL=keep\n'))
        for name in receipt['protectedFunctionHashes']:
            self.assertEqual(port.function(old,name),port.function(new,name))
        for name in ('auth_curl','scan_control'):
            self.assertEqual(port.function(new,name).count(b'X-Agent-Pending-Bytes:'),2)
        self.assertEqual(receipt['originalSha256'],hashlib.sha256(old).hexdigest())
        self.assertEqual(receipt['candidateSha256'],hashlib.sha256(new).hexdigest())
        self.assertTrue(receipt['unchangedBytesOutsidePatch'])
    def test_rejects_unknown_version_crlf_or_missing_header_variant(self):
        old=fixture()
        for broken in (old.replace(b'2.2.16',b'2.2.15'),old.replace(b'\n',b'\r\n'),old.replace(port.HEADER_BEFORE,b'unknown_header\n',1)):
            with self.assertRaises(ValueError):port.prepare(broken,reference)
    def test_does_not_reapply_or_relabel_an_existing_patch(self):
        patched,_=port.prepare(fixture(),reference)
        with self.assertRaises(ValueError):port.prepare(patched,reference)
if __name__=='__main__':unittest.main()
