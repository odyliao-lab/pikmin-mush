#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$ROOT/popup-recovery.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
MODDIR=$TMP PKG=test POPUP_DAILY_RECAP_ENABLED=1 SCAN_RECOVERY_ENABLED=1
STATE='recap 540 2155' BLOCK=0 FOCUS=1 CONTROL=scan BACKUP_FAIL=0 START_FAIL=0
scan_can_run() { [ "$BLOCK" = 0 ]; }
scan_recovery_restart_allowed() { [ "${THROTTLE:-0}" = 0 ]; }
popup_daily_backup() { [ "$BACKUP_FAIL" = 0 ] && echo /private/verified; }
popup_state() { echo "$STATE"; }
popup_foreground() { [ "$FOCUS" = 1 ]; }
scan_control() { echo "$CONTROL"; }
cat() { if [ "$1" = /proc/sys/kernel/random/boot_id ]; then echo test-boot; else command cat "$@"; fi; }
read() {
  if [ "$2" = POPUP_CLOCK ]; then POPUP_CLOCK=${NOW:-1000}; POPUP_UNUSED=0
  else command read "$@"; fi
}
scan_recovery_started() { echo throttle >>"$TMP/actions"; }
run_as_shell() { echo "$*" >>"$TMP/actions"; }
pidof() { return 1; }
launch_game() { echo launch >>"$TMP/actions"; [ "$START_FAIL" = 0 ]; }
scan_recovery_wait_native() {
  [ "$POPUP_RECOVERY_ACTIVE" = 0 ] && [ "$POPUP_DAILY_RESTART_ACTIVE" = 1 ]
  popup_actionable driving 539 1260
  if popup_actionable recap 540 2155; then echo 'nested daily restart allowed'; exit 1; fi
  echo native >>"$TMP/actions"
  [ "${NATIVE_FAIL:-0}" = 0 ]
}
for scenario in optout disabled pause throttle backup focus changed control; do
  POPUP_DAILY_RECAP_ENABLED=1 SCAN_RECOVERY_ENABLED=1 BLOCK=0 THROTTLE=0 BACKUP_FAIL=0 FOCUS=1 CONTROL=scan
  EXPECT=$STATE
  case "$scenario" in
    optout) POPUP_DAILY_RECAP_ENABLED=0;; disabled) SCAN_RECOVERY_ENABLED=0;;
    pause) BLOCK=1;; throttle) THROTTLE=1;; backup) BACKUP_FAIL=1;; focus) FOCUS=0;;
    changed) EXPECT='recapmood 540 1650';; control) CONTROL=pause;;
  esac
  if popup_daily_restart "$EXPECT"; then echo "unsafe acceptance: $scenario"; exit 1; fi
  [ ! -e "$TMP/actions" ] && [ ! -e "$TMP/popup.recap.last-restart" ]
done
CONTROL=scan
popup_daily_restart "$STATE"
[ "$POPUP_RECOVERY_ACTIVE" = 1 ] && [ "$POPUP_DAILY_RESTART_ACTIVE" = 0 ]
grep -q 'am force-stop test' "$TMP/actions"
[ "$(wc -l <"$TMP/actions")" -eq 4 ]
if popup_daily_restart "$STATE"; then echo 'six-hour limit bypassed'; exit 1; fi
[ "$(wc -l <"$TMP/actions")" -eq 4 ]
NOW=22600 START_FAIL=1
if popup_daily_restart "$STATE"; then echo 'failed launch accepted'; exit 1; fi
[ "$(wc -l <"$TMP/actions")" -eq 7 ]
# Failed launches also consume the attempt; they cannot start a reboot loop.
START_FAIL=0
if popup_daily_restart "$STATE"; then exit 1; fi
[ "$(wc -l <"$TMP/actions")" -eq 7 ]
NOW=44200 NATIVE_FAIL=1
if popup_daily_restart "$STATE"; then echo 'failed native wait accepted'; exit 1; fi
[ "$POPUP_RECOVERY_ACTIVE" = 1 ] && [ "$POPUP_DAILY_RESTART_ACTIVE" = 0 ]
[ "$(wc -l <"$TMP/actions")" -eq 11 ]
printf 'test-boot corrupt\n' >"$TMP/popup.recap.last-restart"
if popup_daily_restart "$STATE"; then echo 'malformed limit accepted'; exit 1; fi
echo 'daily recap backup/throttle/pause/focus/control/failure tests passed'

# Exercise the REAL backup helper in a conditional: a failed filesystem
# command must stop its independent -eu shell, not fall through to success.
. "$ROOT/popup-recovery.sh"
mkdir -p "$TMP/module" "$TMP/game" "$TMP/mock"
printf 'test\n' >"$TMP/module/config"
printf '0\n' >"$TMP/module/upload.offset"
printf 'row\n' >"$TMP/game/mushrooms.tsv"
printf '#!/bin/sh\necho 0\n' >"$TMP/mock/id"
printf '#!/bin/sh\nprintf "header\\nfake 999999999 0 999999999 1 /data\\n"\n' >"$TMP/mock/df"
printf '#!/bin/sh\nexit 19\n' >"$TMP/mock/mkdir"
chmod +x "$TMP/mock/"*
MODDIR="$TMP/module" APP_FILES="$TMP/game"
OFFSET_FILE="$MODDIR/upload.offset" TSV="$APP_FILES/mushrooms.tsv"
if PATH="$TMP/mock:$PATH" popup_daily_backup >"$TMP/backup-result" 2>"$TMP/backup-error"; then
  echo 'real backup ignored a failing mkdir'; exit 1
fi
[ ! -s "$TMP/backup-result" ]
echo 'daily recap real backup conditional-errexit regression passed'
