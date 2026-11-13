#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for fn in number_or_zero scan_snapshot execute_scan_task retry_scan_ack; do
  eval "$(sed -n "/^$fn() {/,/^}/p" "$ROOT/agent.sh")"
done
MODDIR=$TMP TSV=$TMP/data SCAN_PENDING=$TMP/scan.pending APP_FILES=$TMP
game_process_identity() { return 1; }
empty_recovery_query() { return 1; } # This fixture exercises the nonzero path.
TELEPORT=$TMP/teleport SCAN_READY=$TMP/ready QUERY_READY=$TMP/query
MAP_REFRESH_EXPERIMENT=1 MAP_REFRESH_TIMEOUT_SECONDS=18 QUERY_ONLY_RESTART_STREAK=12
QUERY_ONLY_STREAK=0 VISUAL_RECOVERY_ENABLED=0 OFFSET=0 FAIL_UPLOAD=0
refresh_local_pause() { return 1; }
scan_can_run() { return 0; }
set_system_gps() { return 0; }
ensure_game_running() { return 0; }
write_game_teleport() { printf '%s\n' "$1" >"$TELEPORT"; }
game_keyevent() { return 0; }
sleep() { return 0; }
wait_for_map_refresh() { REFRESH_SOURCE=object; return 0; }
restart_game_for_scan() { echo 'unexpected cold start' >&2; exit 1; }
interruptible_wait() {
  # A valid object arrives after readiness/first upload, during existing dwell.
  printf '2\tlate\t0\t0\tx\t0\t3\t1\t0\t0\t0\t0\t0\n' >>"$TSV"
}
upload_new() {
  [ "$FAIL_UPLOAD" = 0 ] || return 1
  OFFSET=$(wc -c <"$TSV" | tr -d ' ')
}
send_scan_ack() { printf '%s\n' "$*" >>"$TMP/acks"; }
reset_case() {
  : >"$TSV"; rm -f "$TMP/acks" "$SCAN_PENDING"; OFFSET=0
}
reset_case
execute_scan_task 42 100 0 20 1.1 2.2 0 5 0 1 lease country city
SIZE=$(wc -c <"$TSV" | tr -d ' ')
grep -q "^42 100 lease 1 $SIZE 1 " "$TMP/acks"
test ! -e "$SCAN_PENDING"

# Failed upload keeps the newly counted range pending, without premature ACK.
reset_case; FAIL_UPLOAD=1
execute_scan_task 42 101 1 20 1.1 2.2 0 5 0 1 lease country city || exit 1
SIZE=$(wc -c <"$TSV" | tr -d ' ')
test ! -e "$TMP/acks"
test "$(cut -f4,5,7 "$SCAN_PENDING")" = "$(printf '1\t%s\t%s' "$SIZE" "$SIZE")"
FAIL_UPLOAD=0
retry_scan_ack
grep -q "^42 101 lease 1 $SIZE 1 " "$TMP/acks"
test ! -e "$SCAN_PENDING"
echo 'PASS late object is counted, uploaded and ACKed only after accepted range'
