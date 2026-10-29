#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
eval "$(sed -n '/^ensure_system_gps_provider() {/,/^}/p' "$ROOT/agent.sh")"
SYSTEM_GPS_OVERRIDE=1
GPS_DUMP='    network provider:'
TIMEOUT_FAIL=0
timeout() { [ "$TIMEOUT_FAIL" = 0 ] || return 124; shift 3; "$@"; }
dumpsys() { printf '%s\n' "$GPS_DUMP"; }
appops() { echo appops >>"$TMP/actions"; }
run_as_shell() { echo provider >>"$TMP/actions"; }
if ensure_system_gps_provider; then echo boot-race-not-blocked; exit 1; fi
[ ! -e "$TMP/actions" ]
for GPS_DUMP in '    gps provider:' '    gps provider [mock]:'; do
  ensure_system_gps_provider
done
[ "$(wc -l <"$TMP/actions")" -eq 6 ]
rm "$TMP/actions"
TIMEOUT_FAIL=1
if ensure_system_gps_provider; then echo timeout-ignored; exit 1; fi
[ ! -e "$TMP/actions" ]
SYSTEM_GPS_OVERRIDE=0
ensure_system_gps_provider
[ ! -e "$TMP/actions" ]
echo 'GPS boot readiness, mock/existing provider and timeout checks passed'
