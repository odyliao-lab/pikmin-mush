#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$ROOT/popup-recovery.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
MODDIR=$TMP
POPUP_NETWORK_EXPECTED='network 540 1386'
STATE=$POPUP_NETWORK_EXPECTED
NOW=1000 BOOT=testboot BACKUP_OK=1 CONTROL=run FOREGROUND=1 CAN_RUN=1
popup_network_clock() { printf '%s %s\n' "$BOOT" "$NOW"; }
popup_daily_backup() { [ "$BACKUP_OK" = 1 ]; }
popup_state() { printf '%s\n' "$STATE"; }
popup_foreground() { [ "$FOREGROUND" = 1 ]; }
scan_can_run() { [ "$CAN_RUN" = 1 ]; }
scan_control() { printf '%s\n' "$CONTROL"; }
reject() { if popup_network_prepare; then echo 'unsafe retry accepted' >&2; exit 1; fi; }
POPUP_NETWORK_RETRY_ENABLED=0;reject
POPUP_NETWORK_RETRY_ENABLED=1 BACKUP_OK=0;reject
[ ! -e "$MODDIR/popup.network.retry" ]
BACKUP_OK=1 CONTROL=pause;reject
CONTROL=run FOREGROUND=0;reject
FOREGROUND=1 CAN_RUN=0;reject
CAN_RUN=1 STATE=unknown;reject
STATE=$POPUP_NETWORK_EXPECTED
popup_network_prepare
[ "$(cat "$MODDIR/popup.network.retry")" = 'testboot 1000 1000 1' ]
NOW=1119;reject
NOW=1120;popup_network_prepare
NOW=1240;popup_network_prepare
NOW=1360;reject
NOW=2799;reject
NOW=2800;popup_network_prepare
[ "$(cat "$MODDIR/popup.network.retry")" = 'testboot 2800 2800 1' ]
NOW=2799;reject
BOOT=newboot NOW=1;popup_network_prepare
[ "$(cat "$MODDIR/popup.network.retry")" = 'newboot 1 1 1' ]
printf 'corrupt\n' >"$MODDIR/popup.network.retry";reject
rm "$MODDIR/popup.network.retry"
if ln -s "$TMP/missing" "$MODDIR/popup.network.retry" 2>/dev/null; then reject; fi
rm -f "$MODDIR/popup.network.retry"
BOOT=testboot NOW=1000 STATE=$POPUP_NETWORK_EXPECTED
sleep() { :; }
game_tap() { printf 'tap\n' >>"$TMP/taps"; }
popup_recover
[ "$(wc -l <"$TMP/taps")" -eq 1 ]
if popup_recover; then echo 'network cooldown ignored' >&2; exit 1; fi
[ "$(wc -l <"$TMP/taps")" -eq 1 ]
echo 'network retry opt-in/budget/interval/clock/backup/control/focus tests passed'
