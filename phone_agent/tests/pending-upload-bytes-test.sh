#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
eval "$(sed -n '/^pending_upload_bytes() {/,/^}/p' "$ROOT/agent.sh")"
TSV=$TMP/data OFFSET_FILE=$TMP/offset OFFSET=0
cursor() { OFFSET=$1; printf '%s\n' "$1" >"$OFFSET_FILE"; }
unknown() { test -z "$(pending_upload_bytes)"; }
: >"$TSV"; cursor 0; test "$(pending_upload_bytes)" = 0
printf 'one\ntwo\n' >"$TSV"
cursor 8; test "$(pending_upload_bytes)" = 0
cursor 4; test "$(pending_upload_bytes)" = 4
cursor 0; test "$(pending_upload_bytes)" = 8
printf 'partial' >>"$TSV"; unknown
cursor 15; unknown # regression: incomplete EOF is not a known zero
printf '\n' >>"$TSV"; test "$(pending_upload_bytes)" = 1
cursor 16; test "$(pending_upload_bytes)" = 0
for invalid in '' -1 x 01 999 9999999999999999; do cursor "$invalid"; unknown; done
# An invalid/missing durable cursor must stay unknown even if startup used0.
cursor 0; printf 'broken\n' >"$OFFSET_FILE"; unknown
printf '4\n' >"$OFFSET_FILE"; unknown
rm "$OFFSET_FILE"; unknown
cursor 0; rm "$TSV"; unknown
mkdir "$TSV"; unknown
echo 'PASS pending bytes: zero, positive, partial EOF, missing files, invalid/durable cursor'
