#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
control="$repo_root/phone_agent/control.sh"

test "$(PIKMIN_AGENT_CONTROL_DIR="$tmp_dir" bash "$control" status)" = "running"
cat >"$tmp_dir/agent.log" <<'EOF'
[scan] 日本-東京 12/300 GPS=35.6812,139.7671
[scan] completed point=12 rows=+4 bytes=+512 mode=direct elapsed=8s
EOF
snapshot="$(PIKMIN_AGENT_CONTROL_DIR="$tmp_dir" bash "$control" snapshot)"
case "$snapshot" in
  $'snapshot\trunning\t日本-東京\t35.6812\t139.7671\t12/300\t4\t8\t'*) ;;
  *) echo "unexpected snapshot: $snapshot" >&2; exit 1 ;;
esac
timed="$(PIKMIN_AGENT_CONTROL_DIR="$tmp_dir" bash "$control" pause 60)"
case "$timed" in paused\ until\ * ) ;; *) echo "unexpected timed status: $timed" >&2; exit 1 ;; esac
test "$(PIKMIN_AGENT_CONTROL_DIR="$tmp_dir" bash "$control" pause-manual)" = "paused manual"
test "$(PIKMIN_AGENT_CONTROL_DIR="$tmp_dir" bash "$control" resume)" = "running"
test "$(PIKMIN_AGENT_CONTROL_DIR="$tmp_dir" bash "$control" power-status)" = "unknown guard-not-observed"
if PIKMIN_AGENT_CONTROL_DIR="$tmp_dir" bash "$control" cool-now >/dev/null 2>&1; then
  echo "cool-now without an enabled guard should fail" >&2; exit 1
fi
touch "$tmp_dir/power-guard.sh"
printf "POWER_GUARD_ENABLED='1'\n" >"$tmp_dir/config"
test "$(PIKMIN_AGENT_CONTROL_DIR="$tmp_dir" bash "$control" cool-now)" = "cooldown requested"
test -s "$tmp_dir/power.cool-request"
printf 'requested\n' >"$tmp_dir/power.hold"
PIKMIN_AGENT_CONTROL_DIR="$tmp_dir" bash "$control" resume >/dev/null
test -s "$tmp_dir/power.hold"
if PIKMIN_AGENT_CONTROL_DIR="$tmp_dir" bash "$control" pause 0 >/dev/null 2>&1; then
  echo "pause 0 should fail" >&2
  exit 1
fi
echo "control.sh tests passed"
