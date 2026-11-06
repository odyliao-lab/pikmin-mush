"""Read-only, identity-bound MuMu maintenance access. Never restarts adbd/Agent."""
import argparse
import base64
import json
import re
import subprocess
import sys
import time
from pathlib import Path

MOD = '/data/adb/modules/pikmin_scanner_agent'
FILES = '/data/data/com.nianticlabs.pikmin/files'
MARKER = 'FLEET_ACCESS_READ_COMPLETE'


class CheckError(Exception):
    pass


def run(argv, *, input=None, timeout=30):
    return subprocess.run(argv, input=input, capture_output=True, timeout=timeout)


def text(result):
    return result.stdout.decode('utf-8', 'replace').replace('\r', '')


def mains(ps, path):
    found = []
    for line in ps.splitlines():
        parts = line.split(None, 2)
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            words = parts[2].split()
            if path in words[:3] and '-c' not in words[:3]:
                found.append((parts[0], parts[1]))
    pids = {p for p, _ in found}
    return [p for p, parent in found if parent not in pids]


def listener_addresses(port):
    # port is validated numeric metadata, never shell text or credentials.
    command = (f'@(Get-NetTCPConnection -State Listen -LocalPort {port} '
               '-ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalAddress) '
               '| ConvertTo-Json -Compress')
    result = run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command])
    if result.returncode:
        raise CheckError('listener_check_unavailable')
    value = json.loads(text(result) or '[]')
    return [value] if isinstance(value, str) else value


def cloud_fleet(bot_root):
    # Use the installed production implementation; never copy a token into a manifest.
    sys.path.insert(0, bot_root)
    try:
        from app import pikmin_verification
        import requests
        headers = pikmin_verification._headers()
    except Exception:
        raise CheckError('credential_provider_unavailable') from None

    try:
        response = requests.get('https://mush.odyliao.cc/api/controller/maintenance',
                                headers=headers, timeout=25, allow_redirects=False)
        if response.status_code in (401, 403):
            raise CheckError('cloud_auth_denied')
        if response.status_code != 200:
            raise CheckError('cloud_read_failed')
        return {member['id'] for member in response.json()['fleet']}
    except CheckError:
        raise
    except Exception:
        raise CheckError('cloud_read_unavailable') from None


class Access:
    def __init__(self, spec, adb, manager, cloud_ids, runner=run, bindings=listener_addresses):
        self.spec, self.adb_path, self.manager = spec, adb, manager
        self.cloud_ids, self.run, self.bindings = cloud_ids, runner, bindings
        self.endpoint = self.root_mode = None
        if not re.fullmatch(r'[a-zA-Z0-9_-]+', spec['agent_id']):
            raise CheckError('invalid_manifest')
        if not re.fullmatch(r'[a-fA-F0-9]+', spec['android_id']):
            raise CheckError('invalid_manifest')
        if not isinstance(spec['index'], int) or isinstance(spec['index'], bool) or spec['index'] < 0:
            raise CheckError('invalid_manifest')

    def adb(self, *args, input=None):
        return self.run([self.adb_path, '-s', self.endpoint, *args], input=input)

    def identify(self):
        if self.spec['agent_id'] not in self.cloud_ids:
            raise CheckError('cloud_node_unconfirmed')
        result = self.run([self.manager, 'info', '-v', str(self.spec['index'])])
        try:
            info = json.loads(text(result))
            valid = (result.returncode == 0 and info.get('error_code', 0) == 0
                     and info['name'] == self.spec['vm_name']
                     and int(info['created_timestamp']) == int(self.spec['created_timestamp']))
        except (ValueError, KeyError, TypeError):
            raise CheckError('instance_metadata_unavailable') from None
        if not valid:
            raise CheckError('instance_identity_mismatch')
        if not info.get('is_android_started'):
            raise CheckError('instance_stopped')
        if info.get('adb_host_ip') != '127.0.0.1':
            raise CheckError('endpoint_not_loopback')
        try:
            port = int(info['adb_port'])
            if not 1 <= port <= 65535:
                raise ValueError
        except (ValueError, KeyError, TypeError):
            raise CheckError('endpoint_invalid') from None
        addresses = self.bindings(port)
        if not addresses:
            raise CheckError('endpoint_not_listening')
        if any(address not in ('127.0.0.1', '::1') for address in addresses):
            raise CheckError('endpoint_exposed')
        self.endpoint = f'127.0.0.1:{port}'
        result = self.adb('get-state')
        # Classify internally; do not retain raw stderr, which can contain command text.
        diagnostic = text(result) + result.stderr.decode('utf-8', 'replace')
        if 'unauthorized' in diagnostic.lower():
            raise CheckError('adb_unauthorized')
        if result.returncode or text(result).strip() != 'device':
            raise CheckError('adb_offline_or_unreachable')
        result = self.adb('shell', 'settings', 'get', 'secure', 'android_id')
        if result.returncode or text(result).strip() != self.spec['android_id']:
            raise CheckError('android_identity_mismatch')

    def root_read(self, script):
        """Internal fixed read scripts only; deliberately no CLI arbitrary command action."""
        guard = (f'if [ "$(settings get secure android_id)" != {self.spec["android_id"]} ];'
                 'then echo FLEET_ANDROID_ID_MISMATCH;exit 42;fi\n')
        wrapped = 'set -eu\n' + guard + script + "\nprintf '" + MARKER + "\\n'\n"
        if self.root_mode == 'manager':
            # MuMu's Windows -c parser can alter nested shell quoting. The payload
            # is a fixed read script/identifiers, never credential values.
            encoded = base64.b64encode(wrapped.encode()).decode()
            command = f'printf %s {encoded} | base64 -d | sh'
            result = self.run([self.manager, 'sh', '-v', str(self.spec['index']), '-c', command])
        else:
            mode = ['sh'] if self.root_mode == 'shell' else ['su', '-c', 'sh']
            result = self.adb('shell', *mode, input=wrapped.encode())
        output = text(result)
        if 'FLEET_ANDROID_ID_MISMATCH' in output:
            raise CheckError('android_identity_mismatch')
        if 'FLEET_AGENT_ID_MISMATCH' in output:
            raise CheckError('agent_identity_mismatch')
        if result.returncode or MARKER not in output.splitlines():
            raise CheckError('root_read_failed')
        return output

    def choose_root(self):
        result = self.adb('shell', 'id', '-u')
        if result.returncode == 0 and text(result).strip() == '0':
            self.root_mode = 'shell'
        else:
            result = self.adb('shell', 'su', '-c', 'id')
            self.root_mode = 'su' if result.returncode == 0 and 'uid=0' in text(result) else 'manager'
        # A manager host exit0 is insufficient: require a guest completion marker and UID0.
        output = self.root_read("printf 'UID '; id -u")
        if not re.search(r'^UID 0$', output, re.M):
            raise CheckError('root_unavailable')

    def inspect(self):
        self.identify()
        self.choose_root()
        aid = self.spec['agent_id']
        script = f'''M={MOD}
unset AGENT_ID
. "$M/config"
if [ "${{AGENT_ID:-}}" != {aid} ];then echo FLEET_AGENT_ID_MISMATCH;exit 41;fi
printf 'DISABLED ';if [ -f "$M/disable" ];then echo 1;else echo 0;fi
printf 'PROTECTION ';if [ -f "$M/power.hold" ];then echo 1;else echo 0;fi
printf 'PAUSE_UNTIL ';cat "$M/pause.until" 2>/dev/null || echo 0;printf '\\n'
printf 'DETACH %s\\n' "${{SERVICE_DETACH_ADB_CGROUP:-0}}"
printf 'BOOT_DELAY %s\\n' "${{AGENT_BOOT_DELAY_SECONDS:-0}}"
printf 'TIMEOUT ';settings get global adb_allowed_connection_time
printf 'SECURE ';getprop ro.adb.secure
printf 'GAME_PID ';pidof com.nianticlabs.pikmin || true
printf '\\nREADY ';cat {FILES}/native.ready 2>/dev/null || true
printf '\\nGAME_VERSION ';dumpsys package com.nianticlabs.pikmin | sed -n 's/.*versionName=//p' | head -n1
printf 'AGENT_PIDFILE ';cat "$M/agent.pid" 2>/dev/null || echo absent
printf '\\nPS_BEGIN\\n';ps -A -o PID,PPID,ARGS;printf 'PS_END\\n'
'''
        output = self.root_read(script)
        try:
            before, rest = output.split('PS_BEGIN\n', 1)
            ps = rest.split('PS_END\n', 1)[0]
        except ValueError:
            raise CheckError('process_snapshot_unavailable') from None
        # Full process args and config stay in memory; only whitelist fields are emitted.
        fields = dict(re.findall(r'^([A-Z_]+) ?([^\n]*)$', before, re.M))
        agents, services = mains(ps, MOD + '/agent.sh'), mains(ps, MOD + '/service.sh')
        groups = {}
        for pid in agents + services:
            cg = self.root_read(f'cat /proc/{pid}/cgroup')
            groups[pid] = [line for line in cg.splitlines() if re.match(r'^\d+:', line)]
        attention = []
        pause = fields.get('PAUSE_UNTIL', '0').strip()
        paused = pause == 'manual' or pause.isdigit() and int(pause) > time.time()
        if fields.get('DISABLED') == '1' or paused:
            state = 'intentionally_paused_or_disabled'
        elif fields.get('PROTECTION') == '1':
            state = 'protection_wait'
        elif len(agents) > 1:
            state = 'duplicate_agents'; attention.append(state)
        elif not agents:
            state = 'service_starting' if services else 'agent_missing'
            if not services:
                attention.append(state)
        else:
            state = 'agent_running'
        if any(value != ['0::/'] for value in groups.values()):
            attention.append('cgroup_not_confirmed_independent')
        if agents and fields.get('AGENT_PIDFILE') not in agents:
            attention.append('pidfile_mismatch')
        game = fields.get('GAME_PID', '').strip()
        ready = fields.get('READY', '').split()
        native = bool(game and len(ready) == 2 and ready[0] == game
                      and ready[1] == fields.get('GAME_VERSION'))
        return {'name': self.spec['name'], 'agent_id': aid, 'instance': self.spec['index'],
                'endpoint': self.endpoint, 'channel_status': 'ready', 'root_mode': self.root_mode,
                'agent_state': state, 'agent_pids': agents, 'service_pids': services,
                'pidfile_matches_main': fields.get('AGENT_PIDFILE') in agents,
                'cgroups': groups, 'detach_setting': fields.get('DETACH'),
                'boot_delay': fields.get('BOOT_DELAY'), 'adb_auth_secure': fields.get('SECURE'),
                'adb_timeout': fields.get('TIMEOUT'), 'native_pid_version_matches': native,
                'attention': attention, 'scan_health': 'requires_existing_target_upload_ack_checks'}


def audit_node(spec, config, cloud_ids, **kwargs):
    try:
        return Access(spec, config['adb'], config['manager'], cloud_ids, **kwargs).inspect()
    except CheckError as exc:
        return {'name': spec['name'], 'agent_id': spec['agent_id'], 'channel_status': str(exc),
                'scan_health': 'cannot_confirm'}
    except Exception:
        return {'name': spec.get('name'), 'channel_status': 'inspection_unavailable',
                'scan_health': 'cannot_confirm'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(args.manifest.read_text(encoding='utf-8-sig'))
    try:
        ids = cloud_fleet(config['bot_root'])
        results = [audit_node(spec, config, ids) for spec in config['nodes']]
    except CheckError as exc:
        results = [{'channel_status': str(exc), 'scan_health': 'cannot_confirm'}]
    report = {'at': int(time.time()), 'read_only': True, 'members': results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True))
    return int(any(member['channel_status'] != 'ready' or member.get('attention') for member in results))


if __name__ == '__main__':
    raise SystemExit(main())
