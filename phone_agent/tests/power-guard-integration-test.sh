#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
load_function() {
  eval "$(sed -n "/^$1() {/,/^}/p" "$ROOT/agent.sh")"
}
for fn in refresh_local_pause scan_can_run number_or_zero interruptible_wait execute_scan_task guarded_startup_wait launch_game; do
  load_function "$fn"
done
PAUSE_FILE="$TMP/pause.until"
POWER_GUARD_ENABLED=1
PG_STABLE_AT=55 PG_BLOCK=0
power_guard_check() { test "$PG_BLOCK" = 0; }
printf 'manual\n' >"$PAUSE_FILE"
if scan_can_run; then echo 'manual pause must win' >&2; exit 1; fi
test "$PG_STABLE_AT" = -1
printf 'requested\n' >"$TMP/power.hold"
PIKMIN_AGENT_CONTROL_DIR="$TMP" bash "$ROOT/control.sh" resume >/dev/null
test -s "$TMP/power.hold" # Resume must not erase the protective latch.
POWER_GUARD_ENABLED=0 PG_BLOCK=1
scan_can_run
POWER_GUARD_ENABLED=1
if interruptible_wait 0 1; then echo 'zero dwell bypassed guard' >&2; exit 1; fi
if launch_game; then echo 'launch bypassed guard' >&2; exit 1; fi
if guarded_startup_wait 25; then echo 'startup bypassed guard' >&2; exit 1; fi

# Real task function with only platform/cloud I/O stubbed out. A thermal stop in
# either startup or fallback must not count as a completed/failed scan attempt.
TELEPORT="$TMP/teleport" SCAN_READY="$TMP/scan.ready" QUERY_READY="$TMP/query.ready"
SCAN_PENDING="$TMP/scan.pending"
MAP_REFRESH_EXPERIMENT=1 MAP_REFRESH_TIMEOUT_SECONDS=18 QUERY_ONLY_RESTART_STREAK=12
QUERY_ONLY_STREAK=0 SPEED_WARNING_TAP_X=0 SPEED_WARNING_TAP_Y=0 MAP_VIEW_TAP_X=0 MAP_VIEW_TAP_Y=0
set_system_gps() { return 0; }
ensure_game_running() { return 0; }
file_size() { echo 100; }
useful_line_count() { echo 2; }
game_keyevent() { return 0; }
game_tap() { return 0; }
sleep() { return 0; }
scan_control() { echo run; }
upload_new() { return 0; }
send_scan_ack() { printf '%s\n' "$*" >>"$TMP/acks"; }
wait_for_map_refresh() { return 1; }
restart_game_for_scan() { PG_BLOCK=1; return 2; }
PG_BLOCK=0
execute_scan_task 42 100 0 20 1.1 2.2 0 0 0 1 lease country city || true
test ! -e "$TMP/acks"
test ! -e "$SCAN_PENDING"

PG_BLOCK=0
ensure_game_running() { PG_BLOCK=1; return 2; }
execute_scan_task 42 100 0 20 1.1 2.2 0 0 0 1 lease country city || true
test ! -e "$TMP/acks"

# Unblocked point still completes through the existing ACK/pending path.
PG_BLOCK=0
ensure_game_running() { return 0; }
wait_for_map_refresh() { REFRESH_SOURCE=object; return 0; }
execute_scan_task 42 100 0 20 1.1 2.2 0 0 0 1 lease country city
test "$(wc -l <"$TMP/acks")" -eq 1
grep -q '^42 100 lease 0 0 1 ' "$TMP/acks"
test ! -e "$SCAN_PENDING"
echo 'power guard task/manual-pause integration tests passed'
