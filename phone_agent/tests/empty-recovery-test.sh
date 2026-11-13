#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
eval "$(sed -n '/^empty_recovery_query() {/,/^execute_scan_task() {/p' "$ROOT/agent.sh" | sed '$d')"
APP_FILES=$TMP;SCAN_READY=$TMP/scan.ready;SCAN_PENDING=$TMP/pending
TASK_STARTED_AT=$(date +%s);REFRESH_TOKEN=${TASK_STARTED_AT}00000123
RECOVERY_BEFORE='456 77';RECOVERY_NATIVE_BEFORE=$(printf '456\t157.0')
BEFORE_SIZE=100;AFTER_SIZE=100;OFFSET=100;NEW_ROWS=0;NEW_BYTES=0;DIAG_SOURCE=object
PID_STATE='456 77';PENDING=0;SNAPSHOT='100 1'
game_process_identity() { printf '%s\n' "$PID_STATE"; }
pending_upload_bytes() { printf '%s\n' "$PENDING"; }
scan_snapshot() { printf '%s\n' "$SNAPSHOT"; }
printf '%s\n' "$RECOVERY_NATIVE_BEFORE" >"$APP_FILES/native.ready"
printf '%s\tobject\t1\t2\t%s\n' "$REFRESH_TOKEN" "$TASK_STARTED_AT" >"$SCAN_READY"
GOOD=$(empty_recovery_query)
case "$GOOD" in *'&recovery_version=1&game_pid=456&native_pid=456'*'&pending_bytes=0&pending_acks=0') ;; *) exit 1 ;; esac
reject() { if empty_recovery_query >"$TMP/result"; then exit 1; fi;test ! -s "$TMP/result"; }
DIAG_SOURCE=query;reject;DIAG_SOURCE=object
DIAG_SOURCE=timeout;reject;DIAG_SOURCE=object
PID_STATE='457 77';reject;PID_STATE='456 77'
PID_STATE='456 78';reject;PID_STATE='456 77'
PENDING=1;reject;PENDING=unknown;reject;PENDING=0
OFFSET=99;reject;OFFSET=100
SNAPSHOT='101 1';reject;SNAPSHOT='100 1'
touch "$SCAN_PENDING";reject;rm "$SCAN_PENDING"
printf '123\t157.0\n' >"$APP_FILES/native.ready";reject
printf '%s\n' "$RECOVERY_NATIVE_BEFORE" >"$APP_FILES/native.ready"
printf 'old\tobject\t1\t2\t%s\n' "$TASK_STARTED_AT" >"$SCAN_READY";reject
printf 'PASS empty recovery rejects query, PID reuse, pending/unknown, prefix race and old native/target\n'

# Real retry path must preserve frozen accounting while dropping stale process proof.
eval "$(sed -n '/^retry_scan_ack() {/,/^}/p' "$ROOT/agent.sh")"
BASE='&evidence_version=1&refresh_source=object&scan_ms=1000'
FROZEN="$BASE&recovery_version=1&game_pid=456&process_start=77"
printf '4\t123\tsynthetic-lease\t0\t0\t%s\t100\n' "$FROZEN" >"$SCAN_PENDING"
cp "$SCAN_PENDING" "$TMP/original"
PID_STATE='999 88';OFFSET=100;ACK_FAIL=1
upload_new() { return 0; }
scan_control() { printf run; }
send_scan_ack() {
  printf '%s\n' "$*" >"$TMP/resent"
  [ "${7:-}" = "$BASE" ] || exit 1
  [ "$ACK_FAIL" = 0 ]
}
if retry_scan_ack; then exit 1; fi
cmp "$SCAN_PENDING" "$TMP/original"
grep -q '^4 123 synthetic-lease 0 0 1 ' "$TMP/resent"
# Same-process retry also omits proof, rather than pretending revalidation occurred.
PID_STATE='456 77';ACK_FAIL=0
retry_scan_ack
test ! -e "$SCAN_PENDING"
printf 'PASS retry keeps accounting and never replays the frozen empty witness\n'
