#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$ROOT/scan-recovery.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
MODDIR=$TMP APP_FILES=$TMP PKG=test GAME_VERSION=155.0
cat() { if [ "$1" = /proc/sys/kernel/random/boot_id ]; then echo test-boot; else command cat "$@"; fi; }
# Fresh CI hosts can have less than the 300-second backoff in /proc/uptime.
# Model monotonic time explicitly, rather than assuming the host is old enough.
read() {
  if [ "$2" = RECOVERY_CLOCK ]; then
    RECOVERY_CLOCK="${TEST_UPTIME:-1000}" RECOVERY_UNUSED=0
  else
    command read "$@"
  fi
}
scan_can_run() { [ "${BLOCK:-0}" = 0 ]; }
pidof() { echo 123; }
guarded_startup_wait() { scan_can_run; }
printf '122\t155.0\n' >"$TMP/native.ready"
if scan_recovery_wait_native; then echo stale-pid-accepted;exit 1;fi
printf '123\t154.0\n' >"$TMP/native.ready"
if scan_recovery_wait_native; then echo wrong-version-accepted;exit 1;fi
printf '123\t155.0\textra\n' >"$TMP/native.ready"
if scan_recovery_wait_native; then echo extra-data-accepted;exit 1;fi
printf '123\t155.0\n' >"$TMP/native.ready"
scan_recovery_wait_native
BLOCK=1
if scan_recovery_wait_native; then exit 1; else [ "$?" = 2 ]; fi
BLOCK=0
guarded_startup_wait() { BLOCK=1; return 2; }
rm "$TMP/native.ready"
if scan_recovery_wait_native; then exit 1; else [ "$?" = 2 ]; fi
scan_recovery_restart_allowed
scan_recovery_started
if scan_recovery_restart_allowed; then echo immediate-restart-accepted;exit 1;fi
boot=$(cat /proc/sys/kernel/random/boot_id)
printf '%s 0\n' "$boot" >"$TMP/recovery.last-start"
TEST_UPTIME=105
if scan_recovery_restart_allowed; then echo young-boot-restart-accepted;exit 1;fi
TEST_UPTIME=1000
scan_recovery_restart_allowed
printf 'different-boot 999999999\n' >"$TMP/recovery.last-start"
scan_recovery_restart_allowed
printf '%s not-a-number\n' "$boot" >"$TMP/recovery.last-start"
if scan_recovery_restart_allowed; then exit 1;fi
echo 'native readiness PID/version/protection and persistent restart backoff passed'
