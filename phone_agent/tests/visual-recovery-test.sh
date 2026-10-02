#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$ROOT/visual-recovery.sh"
scan_can_run() { [ "$PAUSED" = 0 ]; }
visual_foreground() { [ "$FOREGROUND" = 1 ]; }
sleep() { :; }
visual_state() { echo "$STATE"; }
game_tap() { echo "tap $*"; }
enter_map_view() { echo swipe; }
PAUSED=0; FOREGROUND=1
STATE=unknown; [ -z "$(visual_recover)" ]
STATE='warning 720 1730'; result=$(visual_recover)
case "$result" in 'tap 720 1730'*) ;; *) exit 1;; esac
STATE='activity 140 2895'; result=$(visual_recover)
case "$result" in 'tap 140 2895'*) ;; *) exit 1;; esac
STATE='dashboard 0 0'; result=$(visual_recover)
case "$result" in swipe*) ;; *) exit 1;; esac
STATE='activity 120 2450'; result=$(visual_recover)
case "$result" in 'tap 120 2450'*) ;; *) exit 1;; esac
STATE='menu 120 2450'; result=$(visual_recover)
case "$result" in 'tap 120 2450'*) ;; *) exit 1;; esac
STATE='warning 610 1415'; [ -z "$(visual_recover)" ]
STATE='warning 610 1448'; result=$(visual_recover)
case "$result" in 'tap 610 1448'*) ;; *) exit 1;; esac
STATE='warning 1 2'; [ -z "$(visual_recover)" ]
PAUSED=1; if visual_recover; then exit 1; else [ "$?" = 2 ]; fi
PAUSED=0; FOREGROUND=0; [ -z "$(visual_recover)" ]
FOREGROUND=1; STATE='warning 720 1730'
sleep() { STATE=unknown; }
[ -z "$(visual_recover)" ]
eval "$(sed -n '/^game_keyevent() {/,/^}/p' "$ROOT/agent.sh")"
VISUAL_RECOVERY_ENABLED=1
game_display_id() { echo 'must not be called' >&2; exit 1; }
run_as_shell() { echo 'must not be called' >&2; exit 1; }
game_keyevent KEYCODE_ENTER
game_keyevent KEYCODE_DPAD_CENTER
echo 'visual recovery tests passed'
