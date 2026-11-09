#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$ROOT/popup-recovery.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
MODDIR=$TMP
POPUP_ANNOUNCEMENT_EXPECTED='announcement 105 1923'
STATE=$POPUP_ANNOUNCEMENT_EXPECTED
NOW=1000 BOOT=testboot BACKUP_OK=1 CONTROL=run FOREGROUND=1 CAN_RUN=1
popup_network_clock() { printf '%s %s\n' "$BOOT" "$NOW"; }
popup_daily_backup() { [ "$BACKUP_OK" = 1 ]; }
popup_state() { printf '%s\n' "$STATE"; }
popup_foreground() { [ "$FOREGROUND" = 1 ]; }
scan_can_run() { [ "$CAN_RUN" = 1 ]; }
scan_control() { printf '%s\n' "$CONTROL"; }
reject() { if popup_announcement_prepare; then echo 'unsafe announcement close accepted' >&2; exit 1; fi; }
POPUP_ANNOUNCEMENT_CLOSE_ENABLED=0;reject
if popup_actionable announcement 105 1923; then exit 1; fi
POPUP_ANNOUNCEMENT_CLOSE_ENABLED=1
popup_actionable announcement 105 1923
BACKUP_OK=0;reject
[ ! -e "$MODDIR/popup.announcement.attempt" ]
BACKUP_OK=1 CONTROL=pause;reject
CONTROL=stop;reject
CONTROL='';reject
CONTROL=run FOREGROUND=0;reject
FOREGROUND=1 CAN_RUN=0;reject
CAN_RUN=1 STATE=unknown;reject
STATE=$POPUP_ANNOUNCEMENT_EXPECTED
popup_announcement_prepare
[ "$(cat "$MODDIR/popup.announcement.attempt")" = 'testboot 1000' ]
NOW=2799;reject
NOW=2800;popup_announcement_prepare
NOW=2799;reject
BOOT=newboot NOW=1;popup_announcement_prepare
printf 'corrupt\n' >"$MODDIR/popup.announcement.attempt";reject
rm "$MODDIR/popup.announcement.attempt"
if ln -s "$TMP/missing" "$MODDIR/popup.announcement.attempt" 2>/dev/null; then reject; fi
rm -f "$MODDIR/popup.announcement.attempt"
BOOT=testboot NOW=1000 STATE=$POPUP_ANNOUNCEMENT_EXPECTED
sleep() { :; }
# A failed tap still consumes the only attempt. No repeated input loop.
game_tap() { printf 'tap\n' >>"$TMP/taps"; return 1; }
if popup_recover; then exit 1; fi
[ "$(wc -l <"$TMP/taps")" -eq 1 ]
if popup_recover; then exit 1; fi
[ "$(wc -l <"$TMP/taps")" -eq 1 ]
echo 'announcement close opt-in/backup/control/focus/budget/failure tests passed'
