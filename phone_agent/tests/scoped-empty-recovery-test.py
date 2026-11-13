"""Offline scoped witness port rejects drift and preserves local policies."""
from pathlib import Path
import hashlib
import importlib.util
import re
import unittest

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('port', root / 'tools/scoped-empty-recovery.py')
port = importlib.util.module_from_spec(spec)
spec.loader.exec_module(port)
reference = (root / 'agent.sh').read_bytes().replace(b'\r\n', b'\n')

def fixture():
    retry = port.function(reference, 'retry_scan_ack')
    retry = re.sub(rb'  # Frozen ACK accounting.*?  RETRY_EVIDENCE=.*?\n', b'', retry, flags=re.S)
    retry = retry.replace(b'"$RETRY_EVIDENCE"', b'"${6:-}"')
    source = b'#!/system/bin/sh\nAGENT_VERSION="${AGENT_VERSION:-2.2.17}"\nLOCAL_GUARD=keep\n' + retry
    for name in ('auth_curl', 'scan_control', 'upload_new', 'send_scan_ack', 'scan_snapshot', 'pending_upload_bytes'):
        source += name.encode() + b'() {\n  preserve_local_implementation "$@"\n}\n'
    source += b'''execute_scan_task() {
  BEFORE_SIZE="$1"; BEFORE_LINES="$2"
    REFRESH_TOKEN="$(date +%s)$(printf '%05d' $((TASK_TARGET_ID % 100000)))"
  upload_new || true
  printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$LOCAL_PENDING"
}
UNRELATED_TAIL=keep
'''
    return source

class ScopedPort(unittest.TestCase):
    def test_preserves_scoped_functions_and_uses_merged_witness(self):
        old = fixture()
        new, proof = port.prepare(old, reference)
        self.assertIn(b'LOCAL_GUARD=keep', new)
        self.assertTrue(new.endswith(b'UNRELATED_TAIL=keep\n'))
        for name in proof['protected_function_hashes']:
            self.assertEqual(port.function(new, name), port.function(old, name))
        for name in ('retry_scan_ack', 'game_process_identity', 'empty_recovery_query'):
            self.assertEqual(port.function(new, name), port.function(reference, name))
        self.assertEqual(proof['candidate_sha256'], hashlib.sha256(new).hexdigest())
        self.assertTrue(proof['unchanged_outside_scoped_patch'])

    def test_refuses_drift_ambiguity_and_reapplication(self):
        old = fixture()
        patched, _ = port.prepare(old, reference)
        for bad in (patched, old.replace(b'2.2.17', b'2.2.16'), old.replace(b'\n', b'\r\n'),
                    old.replace(b'  BEFORE_SIZE="$1"; BEFORE_LINES="$2"', b'  BEFORE_SIZE=unknown'),
                    old + b'execute_scan_task() {\n}\n',
                    old.replace(b'retry_scan_ack() {', b'retry_scan_ack() {\n  local_custom_retry')):
            with self.subTest(source=hashlib.sha256(bad).hexdigest()):
                with self.assertRaises(ValueError):
                    port.prepare(bad, reference)

    def test_rejects_reference_without_full_target_guard(self):
        with self.assertRaises(ValueError):
            port.prepare(fixture(), reference.replace(b'"$TASK_TARGET_ID" -le 99999999', b'"$TASK_TARGET_ID" -le 99999'))

if __name__ == '__main__':
    unittest.main()
