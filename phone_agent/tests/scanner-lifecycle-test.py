"""Operational safeguards; live failure/recovery tests are recorded separately."""
from pathlib import Path
import importlib.util
import os
import json
import tempfile
import unittest

os.environ.setdefault('LOCALAPPDATA', '/tmp/scanner-lifecycle-tests')
spec = importlib.util.spec_from_file_location('lifecycle', Path(__file__).resolve().parents[1] / 'tools/scanner-lifecycle.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
PATH = module.MOD + '/agent.sh'


class Safeguards(unittest.TestCase):
    def test_child_shells_are_not_duplicate_mains(self):
        self.assertEqual(module.script_processes(f'111 1 sh {PATH}\n112 111 sh {PATH}', PATH), [('111', '1')])

    def test_command_strings_and_similar_names_are_not_agents(self):
        for command in [f'sh -c echo {PATH}', f'sh {PATH}.old', 'com.nianticlabs.pikmin']:
            self.assertEqual(module.script_processes('111 1 ' + command, PATH), [])

    def node(self, **changes):
        state = dict(agentMainPids=[], serviceMainPids=[], disabled=False, localPause='running',
                     agentRunning=False, cgroups={})
        state.update(changes)
        node = object.__new__(module.Node)
        node.result = {}
        node.state = lambda: state
        # These branches must never reach deployment/backup/start operations.
        node.sh = lambda _: self.fail('Unexpected guest mutation/read on no-recovery branch')
        return node

    def test_stale_pid_file_does_not_qualify_as_a_running_process(self):
        self.assertEqual(module.script_processes('PID PPID ARGS\n123 1 sleep 1', PATH), [])

    def test_intentional_pause_and_disable_are_preserved(self):
        for changes in [dict(disabled=True), dict(localPause='manual')]:
            node = self.node(**changes)
            node.ensure(3)
            self.assertEqual(node.result['status'], 'intentionally-paused-or-disabled')

    def test_existing_startup_prevents_duplicate_launch(self):
        node = self.node(serviceMainPids=['222'])
        node.ensure(3)
        self.assertIn('no duplicate launch', node.result['status'])

    def test_duplicate_agents_are_not_amplified(self):
        with self.assertRaisesRegex(RuntimeError, 'Multiple Agent mains'):
            self.node(agentMainPids=['222', '333']).ensure(3)

    def test_unsafe_live_agent_is_not_declared_safe(self):
        with self.assertRaisesRegex(RuntimeError, 'unsafe cgroup'):
            self.node(agentMainPids=['222'], agentRunning=True, cgroups={'222': '0::/uid_0/pid_12'}).ensure(3)

    def test_recovery_backup_returns_only_verified_guest_receipt(self):
        node = object.__new__(module.Node)
        node.name = 'sagittarius'
        commands = []
        def shell(command):
            commands.append(command)
            return '__RECOVERY_BACKUP__ 40960 ' + 'a' * 64
        node.sh = shell
        node.adb = lambda *a, **k: self.fail('Credential archive must not leave the guest')
        receipt = node.backup_for_recovery()
        self.assertFalse(receipt['credentialsExported'])
        self.assertTrue(receipt['backupRootOnly'] and receipt['backupVerified'])
        self.assertEqual(receipt['backupBytes'], 40960)
        self.assertIn('sha256sum -c snapshot.sha256', commands[0])
        self.assertIn("'600 0 0'", commands[0])
        self.assertIn('tar -xf archive.tar -C verify', commands[0])

    def test_missing_or_malformed_backup_receipt_refuses_recovery(self):
        node = object.__new__(module.Node)
        node.name = 'capricorn'
        for receipt in ['', '__RECOVERY_BACKUP__ 0 ' + 'a' * 64,
                        '__RECOVERY_BACKUP__ 40960 bad', 'warning\n__RECOVERY_BACKUP__ 40960 ' + 'a' * 64]:
            node.sh = lambda _, value=receipt: value
            with self.assertRaisesRegex(RuntimeError, 'no service started'):
                node.backup_for_recovery()

    def test_backup_command_failure_propagates(self):
        node = object.__new__(module.Node)
        node.name = 'capricorn'
        def fail(_):
            raise RuntimeError('Scoped ADB operation failed')
        node.sh = fail
        with self.assertRaisesRegex(RuntimeError, 'Scoped ADB operation failed'):
            node.backup_for_recovery()

    def test_failed_backup_neither_starts_service_nor_consumes_recovery_attempt(self):
        node = self.node()
        with tempfile.TemporaryDirectory() as directory:
            node.private = Path(directory)
            (node.private / 'provisioned-manifest.json').write_text(json.dumps({'service.sh': 'a' * 64}))
            def shell(command):
                if command.startswith('sha256sum '):
                    return 'a' * 64 + '  service.sh'
                if 'SERVICE_DETACH_ADB_CGROUP' in command:
                    return '1'
                self.fail('Service must not start after a failed backup')
            node.sh = shell
            def failed_backup():
                raise RuntimeError('Backup verification failed')
            node.backup_for_recovery = failed_backup
            with self.assertRaisesRegex(RuntimeError, 'Backup verification failed'):
                node.ensure(3)
            self.assertFalse((node.private / 'lifecycle-recovery-attempts.json').exists())
            self.assertFalse(node.result.get('recoveryAttempted', False))


if __name__ == '__main__':
    unittest.main()
