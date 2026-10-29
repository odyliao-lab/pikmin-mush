#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
eval "$(sed -n '/^restart_game_for_scan() {/,/^}/p' "$ROOT/agent.sh")"
scan_can_run() { return 0; }
scan_recovery_restart_allowed() { return 0; }
run_as_shell() { STOP_REQUESTED=1; }
sleep() { [ "$1" = 1 ] && [ "$STOP_TICKS" -gt 0 ] && [ "$NEVER_STOPS" = 0 ] && STOP_TICKS=$((STOP_TICKS - 1)); return 0; }
pidof() {
  if [ "$RUNNING" = 1 ] || [ "$STOP_TICKS" -gt 0 ]; then echo 123; else return 1; fi
}
prepare_mumu_code_cache() { PREPARED=1; [ "$PREP_FAIL" = 0 ]; }
launch_game() { [ "$PREPARED" = 1 ]; LAUNCHED=1; RUNNING=1; }
scan_recovery_started() { return 0; }
scan_recovery_wait_native() { return 0; }
wait_for_map_refresh() { return 0; }
number_or_zero() { echo 0; }
rm() { :; }
PKG=test SCAN_RECOVERY_ENABLED=1 MAP_REFRESH_EXPERIMENT=1
MAP_HOOK_WARMUP_SECONDS=0 MAP_REFRESH_FALLBACK_TIMEOUT_SECONDS=90
SCAN_READY=/nonexistent/taurus-test-ready QUERY_READY=/nonexistent/taurus-test-query
STOP_TICKS=3 NEVER_STOPS=0 RUNNING=0 PREP_FAIL=0 PREPARED=0 LAUNCHED=0 STOP_REQUESTED=0
restart_game_for_scan 42 123
[ "$STOP_REQUESTED" = 1 ] && [ "$PREPARED" = 1 ] && [ "$LAUNCHED" = 1 ]
STOP_TICKS=3 NEVER_STOPS=1 RUNNING=0 PREPARED=0 LAUNCHED=0
if restart_game_for_scan 42 123; then echo lingering-process-accepted; exit 1; fi
[ "$PREPARED" = 0 ] && [ "$LAUNCHED" = 0 ]
STOP_TICKS=0 NEVER_STOPS=0 PREP_FAIL=1 RUNNING=0 PREPARED=0 LAUNCHED=0
if restart_game_for_scan 42 123; then echo cache-failure-ignored; exit 1; fi
[ "$PREPARED" = 1 ] && [ "$LAUNCHED" = 0 ]
echo 'cold restart waits for process exit, prepares cache and refuses failures passed'
