"""Scoped lifecycle checks for the two approved Zhubei scanner nodes.

No daemon, scheduler, resource gates, token rotation or game-data cleanup.
The existing heartbeat invokes this tool. Credential backups remain root-only
inside the guest; only a verification receipt is returned to the host.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import subprocess
import time

MOD = '/data/adb/modules/pikmin_scanner_agent'
APP = '/data/user/0/com.nianticlabs.pikmin/files'
ADB = str(Path(os.environ['LOCALAPPDATA']) / 'Android/sdk/platform-tools/adb.exe')
MANAGER = r'C:\Program Files\Netease\MuMu\nx_main\MuMuManager.exe'
NODES = {
    'capricorn': (0, 'Agent-Capricorn', 1793413959101200, '127.0.0.1:16384', 'agent-capricorn-48d6f24e'),
    'sagittarius': (2, 'Agent-Sagittarius', 1793334219818009, '127.0.0.1:16448', 'agent-sagittarius-5ee373c2'),
}


def script_processes(text, path):
    result = []
    for line in text.splitlines():
        parts = line.split(None, 2)
        if len(parts) != 3 or not parts[0].isdigit():
            continue
        words = parts[2].split()
        # Match an executable/script argument, never a sh -c command string.
        if path in words[:3] and '-c' not in words[:3]:
            result.append((parts[0], parts[1]))
    pids = {p[0] for p in result}
    return [p for p in result if p[1] not in pids]


class Node:
    def __init__(self, name):
        self.name = name
        self.index, self.vm_name, self.created, self.serial, self.agent_id = NODES[name]
        self.private = Path(os.environ['LOCALAPPDATA']) / 'PikminMaintenance' / ('scanner-' + name)
        if not self.private.is_dir():
            raise RuntimeError('Missing restricted node storage; refusing to provision implicitly')
        self.out = self.private / ('lifecycle-' + time.strftime('%Y%m%d-%H%M%S') + '-' + str(os.getpid()))
        self.out.mkdir()
        self.result = {'node': name, 'at': time.time(), 'recoveryAttempted': False}

    def adb(self, *args, timeout=30):
        r = subprocess.run([ADB, '-s', self.serial, *args], capture_output=True, timeout=timeout)
        if r.returncode:
            (self.out / 'adb-error.txt').write_bytes(r.stderr)
            raise RuntimeError('Scoped ADB operation failed; diagnostics retained privately')
        return r.stdout

    def sh(self, command):
        return self.adb('shell', command).decode(errors='replace').strip()

    def verify_vm(self):
        info = json.loads(subprocess.check_output([MANAGER, 'info', '-v', str(self.index)], timeout=20))
        if not (info['name'] == self.vm_name and info['created_timestamp'] == self.created
                and str(info['adb_port']) == self.serial.split(':')[1]):
            raise RuntimeError('VM identity mismatch; no action taken')
        if not info['is_android_started']:
            raise RuntimeError('Android is stopped; use the bounded VM runbook, not an Agent start')
        self.result.update(vmPid=info['pid'], serial=self.serial)

    def processes(self):
        ps = self.sh('ps -A -o PID,PPID,ARGS')
        agents = script_processes(ps, MOD + '/agent.sh')
        services = script_processes(ps, MOD + '/service.sh')
        return {
            'agentMainPids': [p[0] for p in agents],
            'agentParentPids': [p[1] for p in agents],
            'serviceMainPids': [p[0] for p in services],
            'cgroups': {p[0]: self.sh('cat /proc/' + p[0] + '/cgroup 2>/dev/null || true')
                        for p in agents + services},
            'gamePid': self.sh('pidof com.nianticlabs.pikmin || true'),
        }

    def root(self):
        self.original_root = self.sh('id').startswith('uid=0(root)')
        if not self.original_root:
            # Reparenting alone is insufficient. Never kill an unsafe live service
            # merely to inspect it; hand it to the bounded maintenance runbook.
            if any(g != '0::/' for g in self.processes()['cgroups'].values()):
                raise RuntimeError('Live scanner belongs to unsafe cgroup; preserve ADB state')
            self.adb('root')
            self.adb('wait-for-device')
        if not self.sh('id').startswith('uid=0(root)'):
            raise RuntimeError('Guest root unavailable; unreadable state is not health')

    def state(self):
        actual = self.sh(f'. {MOD}/config; printf "%s" "$AGENT_ID"')
        if actual != self.agent_id:
            raise RuntimeError('Agent identity mismatch; refusing action')
        state = self.processes()
        state.update(
            bootId=self.sh('cat /proc/sys/kernel/random/boot_id'),
            agentPidFile=self.sh(f'cat {MOD}/agent.pid 2>/dev/null || true'),
            disabled=self.sh(f'test -e {MOD}/disable; echo $?') == '0',
            localPause=self.sh(f'{MOD}/control.sh status'),
            pendingAck=self.sh(f'test -s {MOD}/scan.pending; echo $?') == '0',
            tsvBytes=int(self.sh(f'stat -c %s {APP}/mushrooms.tsv 2>/dev/null || echo 0')),
            uploadOffset=int(self.sh(f'cat {MOD}/upload.offset 2>/dev/null || echo 0')),
        )
        state['agentRunning'] = len(state['agentMainPids']) == 1
        state['agentPidFileAlive'] = state['agentPidFile'] in state['agentMainPids']
        return state

    def restore_adb(self):
        before = self.processes()
        if any(g != '0::/' for g in before['cgroups'].values()):
            self.result['adbRestoreBlocked'] = True
            raise RuntimeError('Unsafe Agent/service cgroup: retain root; do not restart adbd')
        if self.sh('id').startswith('uid=0(root)'):
            self.adb('unroot')
            self.adb('wait-for-device')
        time.sleep(2)
        after = self.processes()
        if after['agentMainPids'] != before['agentMainPids']:
            if before['agentMainPids'] or not after['agentMainPids']:
                raise RuntimeError('Agent changed during ADB teardown; preserve diagnostics and recover')
        if before['serviceMainPids'] and not after['serviceMainPids'] and not after['agentMainPids']:
            raise RuntimeError('Starting service disappeared during ADB teardown; recover within bounds')
        self.result.update(adbShellUid2000=self.sh('id').startswith('uid=2000(shell)'),
                           postAdb=after)

    def ensure(self, wait_seconds):
        state = self.state()
        self.result['before'] = state
        if len(state['agentMainPids']) > 1:
            raise RuntimeError('Multiple Agent mains; do not start another')
        if state['disabled'] or state['localPause'] != 'running':
            self.result['status'] = 'intentionally-paused-or-disabled'
            return
        if state['agentRunning']:
            if any(g != '0::/' for g in state['cgroups'].values()):
                raise RuntimeError('Live Agent still belongs to unsafe cgroup; drain before bounded migration')
            self.result['status'] = 'agent-running'
            return
        if state['serviceMainPids']:
            self.result['status'] = 'service-starting; no duplicate launch'
            return
        manifest = json.loads((self.private / 'provisioned-manifest.json').read_text())
        digest = self.sh(f'sha256sum {MOD}/service.sh').split()[0]
        flag = self.sh(f'. {MOD}/config; printf "%s" "$SERVICE_DETACH_ADB_CGROUP"')
        if digest != manifest['service.sh'] or flag != '1':
            raise RuntimeError('Verified detached service/config not deployed; refusing unsafe recovery')
        ledger_path = self.private / 'lifecycle-recovery-attempts.json'
        ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else []
        now = time.time()
        recent = [t for t in ledger if now - t < 3 * 3600]
        if len(recent) >= 2 or (recent and now - recent[-1] < 180):
            raise RuntimeError('Bounded recovery limit/cooldown reached; report instead of restarting')
        backup = self.backup_for_recovery()
        ledger.append(now)
        ledger_path.write_text(json.dumps(ledger))
        self.result.update(recoveryAttempted=True, **backup)
        self.sh(f'nohup setsid {MOD}/service.sh >>{MOD}/local-display-boot.log 2>&1 </dev/null &')
        deadline = time.monotonic() + wait_seconds
        while time.monotonic() < deadline:
            time.sleep(3)
            after = self.state()
            self.result['after'] = after
            if any(g != '0::/' for g in after['cgroups'].values()):
                raise RuntimeError('Recovery did not detach service; keep root for bounded diagnosis')
            if len(after['agentMainPids']) > 1:
                raise RuntimeError('Duplicate main after recovery; no further automatic start')
            if after['agentRunning']:
                self.result['status'] = 'agent-recovered; fresh-scan-acceptance-required'
                return
            if not after['serviceMainPids']:
                raise RuntimeError('Recovery service exited without an Agent; no restart loop')
        self.result['status'] = 'service-starting; wait before any further intervention'

    def backup_for_recovery(self):
        """Keep credential-bearing recovery material in verified guest-only storage."""
        dest = ('/data/adb/scanner-heartbeat-backups/' + self.name + '-recovery-'
                + time.strftime('%Y%m%d-%H%M%S') + '-' + str(os.getpid()))
        script = f'''set -eu
umask 077
D={dest}
[ ! -e "$D" ]
mkdir -p "$D/snapshot" "$D/verify"
chmod 700 /data/adb/scanner-heartbeat-backups "$D" "$D/snapshot" "$D/verify"
[ -z "$(find {MOD} -type l -print)" ]
cp -a {MOD} "$D/snapshot/module"
cp -a {APP}/mushrooms.tsv "$D/snapshot/mushrooms.tsv"
cmp {MOD}/config "$D/snapshot/module/config"
cd "$D"
find snapshot -type f -exec sha256sum {{}} \\; > snapshot.sha256
find snapshot -exec stat -c '%a %u %g %n' {{}} \\; > original-permissions.txt
tar -cf archive.tar snapshot snapshot.sha256 original-permissions.txt
chmod 600 archive.tar snapshot.sha256 original-permissions.txt
chown 0:0 archive.tar
[ "$(stat -c '%a %u %g' archive.tar)" = '600 0 0' ]
[ "$(stat -c '%a %u %g' "$D")" = '700 0 0' ]
tar -tf archive.tar >/dev/null
tar -xf archive.tar -C verify
(cd verify && sha256sum -c snapshot.sha256 >/dev/null)
printf '__RECOVERY_BACKUP__ %s %s\\n' "$(stat -c %s archive.tar)" "$(sha256sum archive.tar | cut -d ' ' -f1)"
'''
        receipt = self.sh(script)
        match = re.fullmatch(r'__RECOVERY_BACKUP__ ([1-9][0-9]*) ([0-9a-f]{64})', receipt)
        if not match:
            raise RuntimeError('Guest root-only recovery backup not verified; no service started')
        return dict(guestBackup=dest, backupBytes=int(match[1]), backupSha256=match[2],
                    backupRootOnly=True, backupVerified=True, credentialsExported=False,
                    backupConsistency='copied snapshot; native TSV writer may remain active')

    def save(self):
        self.result['finishedAt'] = time.time()
        (self.out / 'result.json').write_text(json.dumps(self.result, indent=2), encoding='utf-8')
        (self.private / 'lifecycle-latest.json').write_text(json.dumps(self.result, indent=2), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('node', choices=NODES)
    parser.add_argument('action', choices=['status', 'ensure', 'restore-adb'])
    parser.add_argument('--keep-root', action='store_true')
    parser.add_argument('--wait-seconds', type=int, default=165, choices=range(3, 331))
    args = parser.parse_args()
    node = Node(args.node)
    node.verify_vm()
    # An OS-released file lock prevents concurrent repair/ADB transitions. No
    # persistent lock PID can remain after the host process exits.
    import msvcrt
    with (node.private / 'lifecycle-operation.lock').open('a+b') as lock:
        if lock.tell() == 0:
            lock.write(b'0'); lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise RuntimeError('Another lifecycle operation owns this node; no action taken')
        failed = False
        entered = False
        try:
            if args.action == 'restore-adb':
                node.restore_adb()
                node.result['status'] = 'adb-restored; verify-fresh-server-progress'
            else:
                node.root(); entered = True
                if args.action == 'status':
                    node.result.update(status='observed', state=node.state())
                else:
                    node.ensure(args.wait_seconds)
        except Exception as exc:
            failed = True
            node.result.update(status='needs-diagnosis', error=str(exc))
        finally:
            if entered and not node.original_root and not args.keep_root:
                try:
                    node.restore_adb()
                except Exception as exc:
                    failed = True
                    node.result.update(adbRestoreError=str(exc))
            node.save()
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        print(json.dumps(node.result))
        return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
