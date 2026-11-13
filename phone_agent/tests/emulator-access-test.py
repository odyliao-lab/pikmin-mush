"""Failure-path tests; no ADB, Android, credentials or network calls."""
import importlib.util
import base64
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('access', Path(__file__).resolve().parents[1] / 'tools/emulator-access.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
NODE = {'name': 'test', 'index': 2, 'vm_name': 'Approved', 'created_timestamp': 123,
        'android_id': 'abcdef1234', 'agent_id': 'agent-approved'}
CONFIG = {'adb': 'adb', 'manager': 'manager'}


class Fake:
    def __init__(self, **changes):
        self.info = {'name': 'Approved', 'created_timestamp': 123, 'adb_port': 17000,
                     'adb_host_ip': '127.0.0.1', 'is_android_started': True}
        self.calls = []
        self.state = 'device'
        self.android_id = NODE['android_id']
        self.su = True
        self.marker = True
        self.cg = '0::/'
        self.ps = f'100 1 sh {m.MOD}/agent.sh\n101 100 sh {m.MOD}/agent.sh\n202 1 python --token DUMMY_SECRET'
        self.disabled = '0'
        self.pause = '0'
        self.protection = '0'
        self.root_android_mismatch = False
        self.agent_id_mismatch = False
        self.root_id = '0'
        self.metadata_exit_code = 0
        self.__dict__.update(changes)

    def __call__(self, argv, *, input=None, **kwargs):
        self.calls.append((argv, input))
        code, out, err = 0, '', ''
        if argv[0] == 'manager' and argv[1] == 'info':
            out = json.dumps(self.info)
            code = self.metadata_exit_code
        elif 'get-state' in argv:
            out = self.state
            if self.state != 'device': code, err = 1, self.state
        elif argv[-5:] == ['shell', 'settings', 'get', 'secure', 'android_id']:
            out = self.android_id
        elif argv[-3:] == ['shell', 'id', '-u']:
            out = '2000'
        elif argv[-4:] == ['shell', 'su', '-c', 'id']:
            code, out = (0, 'uid=0(root)') if self.su else (127, '')
        else:
            script = argv[-1] if argv[0] == 'manager' else (input or b'').decode()
            if argv[0] == 'manager':
                script = base64.b64decode(script.split()[2]).decode()
            if self.root_android_mismatch:
                out = 'FLEET_ANDROID_ID_MISMATCH\n'
            elif "printf 'UID '" in script:
                out = 'UID ' + self.root_id + '\n'
            elif 'PS_BEGIN' in script:
                if self.agent_id_mismatch:
                    out = 'FLEET_AGENT_ID_MISMATCH\n'
                else:
                    out = (f'DISABLED {self.disabled}\nPROTECTION {self.protection}\nPAUSE_UNTIL {self.pause}\nDETACH 0\nBOOT_DELAY 120\n'
                           'TIMEOUT null\nSECURE 1\nGAME_PID 555\nREADY 555\t156.1\n'
                           f'GAME_VERSION 156.1\nAGENT_PIDFILE 100\nPS_BEGIN\n{self.ps}\nPS_END\n')
            elif '/cgroup' in script:
                out = self.cg + '\n'
            else:
                raise AssertionError('Unexpected command')
            if self.marker: out += m.MARKER + '\n'
        return subprocess.CompletedProcess(argv, code, out.encode(), err.encode())


class Safeguards(unittest.TestCase):
    def audit(self, fake, **kwargs):
        return m.audit_node(NODE, CONFIG, {'agent-approved'}, runner=fake,
                            bindings=kwargs.get('bindings', lambda port: ['127.0.0.1']))

    def test_success_finds_live_main_without_exporting_process_secrets(self):
        fake = Fake(); result = self.audit(fake)
        self.assertEqual(result['channel_status'], 'ready')
        self.assertEqual(result['agent_pids'], ['100'])
        self.assertEqual(result['root_mode'], 'su')
        self.assertTrue(result['native_pid_version_matches'])
        self.assertNotIn('DUMMY_SECRET', json.dumps(result))
        self.assertEqual(result['scan_health'], 'requires_existing_target_upload_ack_checks')

    def test_dynamic_port_is_discovered_not_copied_from_other_host(self):
        fake = Fake(); self.audit(fake)
        self.assertTrue(all(argv[2] == '127.0.0.1:17000' for argv, _ in fake.calls if argv[0] == 'adb'))

    def test_instance_identity_mismatch_stops_before_adb(self):
        fake = Fake(); fake.info['created_timestamp'] = 999
        self.assertEqual(self.audit(fake)['channel_status'], 'instance_identity_mismatch')
        self.assertEqual(len(fake.calls), 1)

    def test_stopped_instance_does_not_start_implicitly(self):
        fake = Fake(); fake.info['is_android_started'] = False
        self.assertEqual(self.audit(fake)['channel_status'], 'instance_stopped')
        self.assertEqual(len(fake.calls), 1)

    def metadata902(self, **changes):
        fake = Fake(**changes)
        fake.info.update(error_code=902, is_android_started=True, is_process_started=True)
        return fake

    def test_running_902_metadata_still_requires_full_guest_identity(self):
        result = self.audit(self.metadata902(su=False))
        self.assertEqual(result['channel_status'], 'ready')
        self.assertEqual(result['manager_metadata_code'], 902)
        self.assertEqual(result['root_mode'], 'manager')
        self.assertEqual(result['scan_health'], 'requires_existing_target_upload_ack_checks')

    def test_902_incomplete_or_false_running_flags_stop_before_adb(self):
        for field in ('is_android_started', 'is_process_started'):
            for value in (None, False, 1, 'true'):
                with self.subTest(field=field, value=value):
                    fake = self.metadata902(); fake.info[field] = value
                    self.assertEqual(self.audit(fake)['channel_status'], 'instance_metadata_unavailable')
                    self.assertEqual(len(fake.calls), 1)
            fake = self.metadata902(); del fake.info[field]
            self.assertEqual(self.audit(fake)['channel_status'], 'instance_metadata_unavailable')
            self.assertEqual(len(fake.calls), 1)

    def test_unknown_metadata_status_or_host_failure_is_not_identity_mismatch(self):
        for code in (901, 903, '902', True, None):
            fake = self.metadata902(); fake.info['error_code'] = code
            self.assertEqual(self.audit(fake)['channel_status'], 'instance_metadata_unavailable')
            self.assertEqual(len(fake.calls), 1)
        fake = self.metadata902(metadata_exit_code=1)
        self.assertEqual(self.audit(fake)['channel_status'], 'instance_metadata_unavailable')
        self.assertEqual(len(fake.calls), 1)

    def test_902_wrong_creation_or_name_still_stops_before_adb(self):
        for field, value in [('name', 'Other'), ('created_timestamp', 999)]:
            fake = self.metadata902(); fake.info[field] = value
            self.assertEqual(self.audit(fake)['channel_status'], 'instance_identity_mismatch')
            self.assertEqual(len(fake.calls), 1)

    def test_902_does_not_bypass_endpoint_or_guest_guards(self):
        fake = self.metadata902(); fake.info['adb_host_ip'] = '192.0.2.1'
        self.assertEqual(self.audit(fake)['channel_status'], 'endpoint_not_loopback')
        self.assertEqual(len(fake.calls), 1)
        fake = self.metadata902()
        self.assertEqual(self.audit(fake, bindings=lambda port: ['0.0.0.0'])['channel_status'], 'endpoint_exposed')
        self.assertEqual(len(fake.calls), 1)
        for changes, expected in [({'android_id':'bad'}, 'android_identity_mismatch'),
                                  ({'state':'unauthorized'}, 'adb_unauthorized'),
                                  ({'agent_id_mismatch':True}, 'agent_identity_mismatch'),
                                  ({'su':False,'root_android_mismatch':True}, 'android_identity_mismatch'),
                                  ({'su':False,'marker':False}, 'root_read_failed')]:
            fake = self.metadata902(**changes)
            self.assertEqual(self.audit(fake)['channel_status'], expected)
            for argv, _ in fake.calls:
                self.assertFalse(set(argv) & {'root', 'unroot', 'reboot', 'kill-server', 'disconnect', 'tcpip'})

    def test_non_loopback_metadata_or_binding_stops_before_adb(self):
        fake = Fake(); fake.info['adb_host_ip'] = '192.0.2.1'
        self.assertEqual(self.audit(fake)['channel_status'], 'endpoint_not_loopback')
        self.assertEqual(len(fake.calls), 1)
        fake = Fake()
        self.assertEqual(self.audit(fake, bindings=lambda port: ['127.0.0.1', '0.0.0.0'])['channel_status'], 'endpoint_exposed')
        self.assertEqual(len(fake.calls), 1)

    def test_unauthorized_and_offline_are_different(self):
        for value, expected in [('unauthorized', 'adb_unauthorized'), ('offline', 'adb_offline_or_unreachable')]:
            fake = Fake(state=value)
            self.assertEqual(self.audit(fake)['channel_status'], expected)
            self.assertEqual(len(fake.calls), 2)

    def test_android_id_mismatch_never_attempts_root(self):
        fake = Fake(android_id='bad')
        self.assertEqual(self.audit(fake)['channel_status'], 'android_identity_mismatch')
        self.assertEqual(len(fake.calls), 3)

    def test_root_fallback_uses_manager_without_adbd_restart(self):
        fake = Fake(su=False); result = self.audit(fake)
        self.assertEqual(result['root_mode'], 'manager')
        self.assertEqual(result['channel_status'], 'ready')
        for argv, _ in fake.calls:
            self.assertFalse(set(argv) & {'root', 'unroot', 'reboot', 'kill-server', 'disconnect', 'tcpip'})

    def test_manager_host_exit_zero_without_guest_completion_fails(self):
        self.assertEqual(self.audit(Fake(su=False, marker=False))['channel_status'], 'root_read_failed')

    def test_manager_nonroot_is_not_accepted(self):
        self.assertEqual(self.audit(Fake(su=False, root_id='2000'))['channel_status'], 'root_unavailable')

    def test_effective_agent_id_mismatch_is_distinct(self):
        self.assertEqual(self.audit(Fake(agent_id_mismatch=True))['channel_status'], 'agent_identity_mismatch')

    def test_android_identity_rechecked_in_root_channel(self):
        self.assertEqual(self.audit(Fake(su=False, root_android_mismatch=True))['channel_status'], 'android_identity_mismatch')

    def test_duplicate_and_missing_agents_and_adbd_cgroup_are_attention(self):
        fake = Fake(ps=f'100 1 sh {m.MOD}/agent.sh\n102 1 sh {m.MOD}/agent.sh')
        self.assertIn('duplicate_agents', self.audit(fake)['attention'])
        self.assertIn('agent_missing', self.audit(Fake(ps=''))['attention'])
        result = self.audit(Fake(cg='0::/uid_0/pid_678'))
        self.assertIn('cgroup_not_confirmed_independent', result['attention'])

    def test_pause_and_service_starting_are_not_repaired(self):
        self.assertEqual(self.audit(Fake(disabled='1', ps=''))['agent_state'], 'intentionally_paused_or_disabled')
        result = self.audit(Fake(ps=f'90 1 sh {m.MOD}/service.sh'))
        self.assertEqual(result['agent_state'], 'service_starting')
        self.assertEqual(result['attention'], [])
        for changes, expected in [(dict(pause='manual'), 'intentionally_paused_or_disabled'),
                                  (dict(protection='1'), 'protection_wait')]:
            result = self.audit(Fake(ps='', **changes))
            self.assertEqual(result['agent_state'], expected)
            self.assertNotIn('agent_missing', result['attention'])

    def test_unknown_cloud_node_stops_all_local_operations(self):
        fake = Fake()
        result = m.audit_node(NODE, CONFIG, set(), runner=fake, bindings=lambda port: [])
        self.assertEqual(result['channel_status'], 'cloud_node_unconfirmed')
        self.assertEqual(fake.calls, [])

    def test_cloud_denial_and_redirect_never_retry_or_change_credentials(self):
        for status, error in [(401, 'cloud_auth_denied'), (403, 'cloud_auth_denied'), (302, 'cloud_read_failed')]:
            calls = []
            def get(url, **kwargs):
                calls.append((url, kwargs))
                return SimpleNamespace(status_code=status)
            modules = {'requests': SimpleNamespace(get=get),
                       'app': SimpleNamespace(pikmin_verification=SimpleNamespace(_headers=lambda: {'Authorization': 'Bearer DUMMY'}))}
            with patch.dict(sys.modules, modules), self.assertRaisesRegex(m.CheckError, error):
                m.cloud_fleet('/unused/test-provider')
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][0], 'https://mush.odyliao.cc/api/controller/maintenance')
            self.assertFalse(calls[0][1]['allow_redirects'])


if __name__ == '__main__':
    unittest.main()
