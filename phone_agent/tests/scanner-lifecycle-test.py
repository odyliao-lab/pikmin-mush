"""Operational safeguards; live failure/recovery tests are recorded separately."""
from pathlib import Path
import importlib.util
import os
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


if __name__ == '__main__':
    unittest.main()
