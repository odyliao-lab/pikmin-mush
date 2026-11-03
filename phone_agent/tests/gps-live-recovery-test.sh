#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
eval "$(sed -n '/^set_system_gps() {/,/^}/p' "$ROOT/agent.sh")"
SYSTEM_GPS_OVERRIDE=1 GPS_BRIDGE_PACKAGE='' MUMU_CODE_CACHE_REFRESH=1
READY=0 RESTORE_OK=1 WRITE_OK=1
run_as_shell() {
  echo "$1" >>"$TMP/writes"
  [ "$READY" = 1 ] && [ "$WRITE_OK" = 1 ]
}
ensure_system_gps_provider() {
  echo bootstrap >>"$TMP/bootstrap"
  [ "$RESTORE_OK" = 1 ] || return 1
  READY=1
}
reset() { rm -f "$TMP/writes" "$TMP/bootstrap"; }
# A lost provider used to return failure before the game could be started.
set_system_gps 30.1 31.2
[ "$(wc -l <"$TMP/writes")" -eq 2 ]
[ "$(wc -l <"$TMP/bootstrap")" -eq 1 ]
[ "$(sort -u "$TMP/writes" | wc -l)" -eq 1 ]
reset
set_system_gps 30.1 31.2
[ "$(wc -l <"$TMP/writes")" -eq 1 ]; [ ! -e "$TMP/bootstrap" ]
reset
# Failed/paused guarded bootstrap must not retry or report success.
READY=0 RESTORE_OK=0
if set_system_gps 30.1 31.2; then echo bootstrap-failure-accepted; exit 1; fi
[ "$(wc -l <"$TMP/writes")" -eq 1 ]
[ "$(wc -l <"$TMP/bootstrap")" -eq 1 ]
reset
RESTORE_OK=1 WRITE_OK=0
if set_system_gps 30.1 31.2; then echo second-write-failure-accepted; exit 1; fi
[ "$(wc -l <"$TMP/writes")" -eq 2 ]
[ "$(wc -l <"$TMP/bootstrap")" -eq 1 ]
reset
MUMU_CODE_CACHE_REFRESH=0
if set_system_gps 30.1 31.2; then echo non-mumu-failure-accepted; exit 1; fi
[ "$(wc -l <"$TMP/writes")" -eq 1 ]; [ ! -e "$TMP/bootstrap" ]
reset
SYSTEM_GPS_OVERRIDE=0
set_system_gps 30.1 31.2
[ ! -e "$TMP/writes" ]; [ ! -e "$TMP/bootstrap" ]
if set_system_gps '30;exit' 31.2; then echo invalid-input-accepted; exit 1; fi
[ ! -e "$TMP/writes" ]; [ ! -e "$TMP/bootstrap" ]
echo 'Live GPS loss: bounded same-target retry, bootstrap failure and non-MuMu isolation passed'
