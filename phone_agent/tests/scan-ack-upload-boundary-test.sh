#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
SCAN_PENDING=$TMP/pending; CALLS=$TMP/calls
eval "$(sed -n '/^retry_scan_ack() {/,/^execute_scan_task() {/p' "$ROOT/agent.sh" | sed '$d')"
send_scan_ack() { printf 'sent\n' >>"$CALLS"; }
upload_new() { [ "$ACCEPT" = 1 ] || return 1; OFFSET=300; }
scan_control() { printf '%s' "$CONTROL"; }
write_pending() { printf '1\t2\tsynthetic-lease\t3\t200\t&evidence_version=1\t%s\n' "$1" >"$SCAN_PENDING"; }
OFFSET=100; ACCEPT=0; CONTROL=continue
write_pending 300
if retry_scan_ack; then exit 1; fi
test -s "$SCAN_PENDING"; test ! -f "$CALLS"
ACCEPT=1
retry_scan_ack
test ! -f "$SCAN_PENDING"; test "$(wc -l <"$CALLS")" -eq 1
# Existing six-column records remain compatible.
printf '1\t2\tsynthetic-lease\t3\t200\t&evidence_version=1\n' >"$SCAN_PENDING"
retry_scan_ack
test "$(wc -l <"$CALLS")" -eq 2
write_pending malformed
if retry_scan_ack; then exit 1; fi
test -s "$SCAN_PENDING"; test "$(wc -l <"$CALLS")" -eq 2
OFFSET=100; ACCEPT=0; CONTROL=stop
write_pending 300
retry_scan_ack
test ! -f "$SCAN_PENDING"; test "$(wc -l <"$CALLS")" -eq 2
printf 'PASS pending ACK waits for upload acceptance; old schema, invalid boundary, stopped job\n'
