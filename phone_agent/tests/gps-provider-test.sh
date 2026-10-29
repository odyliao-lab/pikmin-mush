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
SYSTEM_GPS_OVERRIDE=1 MUMU_CODE_CACHE_REFRESH=1 TIMEOUT_FAIL=0
scan_control() { echo run; }
GPS_DUMP='    passive provider:'
ensure_game_running() { echo launch >>"$TMP/actions"; GPS_DUMP='    gps provider:'; }
ensure_system_gps_provider
[ "$(head -n 1 "$TMP/actions")" = launch ]
[ "$(wc -l <"$TMP/actions")" -eq 4 ]
rm "$TMP/actions"
GPS_DUMP='    passive provider:'
ensure_game_running() { echo launch >>"$TMP/actions"; return 1; }
if ensure_system_gps_provider; then echo failed-bootstrap-accepted; exit 1; fi
[ "$(wc -l <"$TMP/actions")" -eq 1 ]
rm "$TMP/actions"
scan_control() { echo pause; }
if ensure_system_gps_provider; then echo remote-pause-ignored; exit 1; fi
[ ! -e "$TMP/actions" ]
scan_control() { echo run; }
ensure_game_running() { echo launch >>"$TMP/actions"; }
if ensure_system_gps_provider; then echo absent-provider-after-bootstrap-accepted; exit 1; fi
[ "$(wc -l <"$TMP/actions")" -eq 1 ]

echo 'GPS readiness, existing provider, emulator bootstrap and failure checks passed'
