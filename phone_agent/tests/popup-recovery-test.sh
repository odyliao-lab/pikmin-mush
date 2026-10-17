#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$ROOT/popup-recovery.sh"
AGENT_SOURCE="${PIKMIN_AGENT_TEST_SOURCE:-$ROOT/agent.sh}"
eval "$(sed -n '/^scan_can_run() {/,/^}/p' "$AGENT_SOURCE")"
eval "$(sed -n '/^game_tap() {/,/^}/p' "$AGENT_SOURCE")"
eval "$(sed -n '/^game_keyevent() {/,/^}/p' "$AGENT_SOURCE")"
eval "$(sed -n '/^game_swipe() {/,/^}/p' "$AGENT_SOURCE")"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
refresh_local_pause() { [ "$PAUSED" = 1 ]; }
power_guard_check() { [ "$THERMAL_BLOCK" = 0 ]; }
popup_foreground() { [ "$FOREGROUND" = 1 ]; }
popup_state() { echo "$STATE"; }
sleep() { :; }
game_display_id() { echo ''; }
run_as_shell() { printf '%s\n' "$*" >>"$TMP/input"; }
PAUSED=0 THERMAL_BLOCK=0 FOREGROUND=1 POWER_GUARD_ENABLED=1 LOCAL_DISPLAY=0
VISUAL_RECOVERY_ENABLED=0 POPUP_RECOVERY_ENABLED=1
STATE='driving 539 1260'
scan_can_run
[ "$(wc -l <"$TMP/input")" -eq 1 ]
grep -q '^input tap 539 1260$' "$TMP/input"
# Recursive safety checks inside game_tap must not trigger another capture/tap.
[ "${POPUP_RECOVERY_ACTIVE:-0}" = 0 ]
[ "${POPUP_INPUT_ALLOWED:-0}" = 0 ]
scan_can_run
[ "$(wc -l <"$TMP/input")" -eq 1 ] # Monotonic throttle, not one capture per poll.
game_tap 100 200
game_keyevent KEYCODE_ENTER
game_swipe 100 200 300 400
[ "$(wc -l <"$TMP/input")" -eq 1 ] # Legacy guesses cannot follow a verified tap.
for STATE in 'unknown' 'permission 539 1260' 'driving x 1260' 'driving 539 1260 extra'; do
  POPUP_LAST_AT=-120
  scan_can_run
done
[ "$(wc -l <"$TMP/input")" -eq 1 ]
PAUSED=1 POPUP_LAST_AT=-120 STATE='driving 539 1260'
if scan_can_run; then echo 'manual pause bypassed' >&2; exit 1; fi
PAUSED=0 THERMAL_BLOCK=1
if scan_can_run; then echo 'thermal guard bypassed' >&2; exit 1; fi
THERMAL_BLOCK=0 FOREGROUND=0
popup_state() { popup_foreground && echo "$STATE" || echo unknown; }
scan_can_run
[ "$(wc -l <"$TMP/input")" -eq 1 ]
FOREGROUND=1 POPUP_LAST_AT=-120
sleep() { STATE=unknown; }
scan_can_run
[ "$(wc -l <"$TMP/input")" -eq 1 ] # Second screenshot changed: no stale click.
sleep() { THERMAL_BLOCK=1; }
THERMAL_BLOCK=0 POPUP_LAST_AT=-120 STATE='driving 539 1260'
if scan_can_run; then echo 'thermal transition bypassed' >&2; exit 1; fi
[ "$(wc -l <"$TMP/input")" -eq 1 ]
THERMAL_BLOCK=0 POPUP_RECOVERY_ENABLED=0 STATE='driving 539 1260'
scan_can_run
[ "$(wc -l <"$TMP/input")" -eq 1 ] # Opt-out never starts recovery.
game_tap 100 200
[ "$(wc -l <"$TMP/input")" -eq 2 ] # Original coordinate input remains available when opted out.
echo 'popup recovery safety/throttle/legacy-input tests passed'
# An underlying resumed activity must never authorize input over another app.
eval "$(sed -n '/^popup_foreground() {/,/^}/p' "$ROOT/popup-recovery.sh")"
PKG=com.nianticlabs.pikmin
timeout() { printf '%s\n' "$WINDOW_DUMP"; }
WINDOW_DUMP='mCurrentFocus=Window{123 u0 com.nianticlabs.pikmin/UnityActivity}'
popup_foreground
for WINDOW_DUMP in 'mCurrentFocus=Window{123 u0 com.android.permissioncontroller/GrantPermissionsActivity}' \
  'mCurrentFocus=Window{123 u0 com.android.systemui/Keyguard}' \
  'mCurrentFocus=Window{123 u0 com.nianticlabs.pikmin.fake/Activity}' \
  'mCurrentFocus=null'; do
  if popup_foreground; then echo 'wrong focused window accepted' >&2; exit 1; fi
done
echo 'popup focused-window tests passed'
