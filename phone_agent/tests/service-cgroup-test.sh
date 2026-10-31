#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
eval "$(sed -n '/^detach_adb_service_cgroup() {/,/^}/p' "$ROOT/service.sh")"
log_service() { :; }
service_cgroup() { printf '%s\n' "$GROUP"; }
move_service_to_boot_cgroup() {
  MOVES=$((MOVES + 1))
  [ "$FAIL_MOVE" = 0 ] || return 1
  [ "$NO_MOVE" = 1 ] || GROUP=/
}
id() { printf '%s\n' "$TEST_UID"; }
reset() { GROUP=$1 MOVES=0 FAIL_MOVE=0 NO_MOVE=0 TEST_UID=0; }

SERVICE_DETACH_ADB_CGROUP=1
reset /uid_0/pid_123
detach_adb_service_cgroup
[ "$GROUP" = / ] && [ "$MOVES" = 1 ]
reset /
detach_adb_service_cgroup
[ "$MOVES" = 0 ]

for GROUP in '' /uid_2000/pid_123 /uid_0/pid_abc /uid_0/pid_123/child; do
  MOVES=0
  if detach_adb_service_cgroup; then echo unexpected-cgroup-accepted; exit 1; fi
  [ "$MOVES" = 0 ]
done
reset /uid_0/pid_123
FAIL_MOVE=1
if detach_adb_service_cgroup; then echo move-error-ignored; exit 1; fi
reset /uid_0/pid_123
NO_MOVE=1
if detach_adb_service_cgroup; then echo verification-ignored; exit 1; fi
reset /uid_0/pid_123
TEST_UID=2000
if detach_adb_service_cgroup; then echo unprivileged-start-accepted; exit 1; fi
[ "$MOVES" = 0 ]
reset /uid_0/pid_123
SERVICE_DETACH_ADB_CGROUP=0
detach_adb_service_cgroup
[ "$MOVES" = 0 ]
SERVICE_DETACH_ADB_CGROUP=invalid
if detach_adb_service_cgroup; then echo invalid-option-accepted; exit 1; fi
echo 'service cgroup detach, verification, bounds and opt-in passed'
