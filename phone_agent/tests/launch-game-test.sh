#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
eval "$(sed -n '/^launch_game() {/,/^}/p' "$ROOT/agent.sh")"
TMP="$(mktemp -d)";trap 'rm -rf "$TMP"' EXIT
scan_can_run() { return 0; }
pidof() { return 1; }
prepare_mumu_code_cache() { return 0; }
game_display_id() { return 0; }
wait_for_game_display() { echo 7; }
run_as_shell() { printf '%s\n' "$1" >>"$TMP/calls";return "${FAIL:-0}"; }
PKG=test.game GAME_ACTIVITY=test.Activity LOCAL_DISPLAY=0
launch_game
test "$(cat "$TMP/calls")" = 'am start -n test.game/test.Activity'
FAIL=9
if launch_game;then exit 1;else test "$?" = 9;fi
FAIL=0 LOCAL_DISPLAY=1
launch_game
test "$(tail -1 "$TMP/calls")" = 'am start --display 7 -n test.game/test.Activity'
scan_can_run() { return 1; }
if launch_game;then exit 1;else test "$?" = 2;fi
test "$(wc -l <"$TMP/calls")" = 3
echo 'explicit activity launch, display routing, pause and failure propagation passed'
