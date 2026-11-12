#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export CAPTURE_DIR="$TMP"
printf '#!%s\n' "$(command -v sh)" >"$TMP/curl"
cat >>"$TMP/curl" <<'EOF'
printf '%s\n' "$@" >"$CAPTURE_DIR/argv"
cat >"$CAPTURE_DIR/stdin"
exit "${CURL_RESULT:-0}"
EOF
chmod 700 "$TMP/curl"
CURL_BIN="$TMP/curl" TOKEN='fixture-private-token' AGENT_ID='fixture'
AGENT_VERSION=2.2.10 GAME_VERSION=156.0 MODULE_VERSION=156.0
SERVER_URL=https://fixture.invalid SCAN_JOB_ID=1 SCAN_TARGET_ID=2 SCAN_LEASE=fixture-lease
TSV="$TMP/tsv" OFFSET=0
eval "$(sed -n '/^pending_upload_bytes() {/,/^}/p' "$ROOT/agent.sh")"
eval "$(sed -n '/^auth_curl() {/,/^}/p' "$ROOT/agent.sh")"
eval "$(sed -n '/^scan_control() {/,/^}/p' "$ROOT/agent.sh")"
printf 'payload\n' >"$TMP/body"
printf '123456789\n' >"$TSV"
[ "$(pending_upload_bytes)" = 10 ]
OFFSET=4; [ "$(pending_upload_bytes)" = 6 ]
OFFSET=100; [ -z "$(pending_upload_bytes)" ]
OFFSET=0
for CURL_DNS_SERVERS in '' '1.1.1.1'; do
  for fn in auth_curl scan_control; do
    "$fn" --data-binary "@$TMP/body" https://fixture.invalid
    [ "$(cat "$TMP/stdin")" = "Authorization: Bearer $TOKEN" ]
    if grep -F "$TOKEN" "$TMP/argv"; then echo token-in-argv; exit 1; fi
    grep -Fx '@-' "$TMP/argv" >/dev/null
    grep -Fx 'X-Agent-Pending-Bytes: 10' "$TMP/argv" >/dev/null
    if [ "$fn" = auth_curl ]; then
      grep -Fx "@$TMP/body" "$TMP/argv" >/dev/null
    fi
    CURL_RESULT=22; export CURL_RESULT
    if "$fn" https://fixture.invalid; then echo curl-error-lost; exit 1; else [ "$?" = 22 ]; fi
    unset CURL_RESULT
  done
done
echo 'private auth stdin, upload body file, DNS/control variants and curl failure propagation passed'
