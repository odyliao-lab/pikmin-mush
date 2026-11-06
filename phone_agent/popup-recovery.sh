#!/system/bin/sh
# Loaded only when explicitly enabled on a calibrated physical-screen agent.
popup_foreground() {
  # The focused window, not an activity retained behind a permission dialog,
  # keyguard or notification shade, must belong to the exact game package.
  timeout -k 1 5 dumpsys window 2>/dev/null |
    grep 'mCurrentFocus=' | grep -Fq " $PKG/"
}

popup_state() {
  [ "${LOCAL_DISPLAY:-0}" = 0 ] && popup_foreground || { echo unknown; return; }
  rm -f "$MODDIR/popup.raw"
  (umask 077; timeout -k 1 8 screencap "$MODDIR/popup.raw") >/dev/null 2>&1 || {
    rm -f "$MODDIR/popup.raw"; echo unknown; return;
  }
  "$MODDIR/bin/popup-probe" "$MODDIR/popup.raw"
  rm -f "$MODDIR/popup.raw"
}

popup_actionable() {
  case "$1" in driving|restricted|danger|speed|dashboard|recap|recapmood) ;; *) return 1;; esac
  case "$1" in recap|recapmood)
    [ "${POPUP_DAILY_RECAP_ENABLED:-0}" = 1 ] &&
      [ "${POPUP_DAILY_RESTART_ACTIVE:-0}" != 1 ] || return 1;; esac
  case "$2,$3" in *[!0-9,]*|,*|*,) return 1;; esac
  [ "$2" -gt 0 ] && [ "$2" -lt 1440 ] && [ "$3" -gt 0 ] && [ "$3" -lt 3120 ]
}

# This runs in a subshell: strict failures cannot terminate the owning Agent.
# Keep the complete uploader/auth/pending state on the device, never in logs.
popup_daily_backup() {
  # A separate shell keeps -e effective even when our caller tests this
  # function's exit status (POSIX functions otherwise inherit ignored errexit).
  MODDIR="$MODDIR" APP_FILES="$APP_FILES" OFFSET_FILE="$OFFSET_FILE" TSV="$TSV" sh -eu <<'DAILY_BACKUP'
  umask 077
  [ "$(id -u)" = 0 ]
  [ -d "$MODDIR" ] && [ ! -L "$MODDIR" ]
  [ -s "$MODDIR/config" ] && [ ! -L "$MODDIR/config" ]
  [ -s "$OFFSET_FILE" ] && [ -f "$TSV" ] && [ ! -L "$TSV" ]
  POPUP_ROOT=/data/adb/pikmin-ops
  [ ! -L "$POPUP_ROOT" ]
  POPUP_FREE=$(df -Pk /data | awk 'NR==2 {print $4}')
  POPUP_NEED=$((4 * ($(du -sk "$MODDIR" | awk '{print $1}') + $(stat -c %s "$TSV") / 1024 + 1) + 262144))
  [ "$POPUP_FREE" -ge "$POPUP_NEED" ]
  POPUP_B="$POPUP_ROOT/$(date +%s)-daily-recap-$$"
  [ ! -e "$POPUP_B" ]
  mkdir -p "$POPUP_B/payload/game" "$POPUP_B/verified"
  chmod 700 "$POPUP_ROOT" "$POPUP_B" "$POPUP_B/payload" "$POPUP_B/payload/game" "$POPUP_B/verified"
  cp -a "$MODDIR" "$POPUP_B/payload/module"
  # Read offset before copying the append-only TSV. This is a live snapshot,
  # not an atomic database snapshot; its copied offset must fit its copied TSV.
  cp -p "$OFFSET_FILE" "$POPUP_B/payload/module/upload.offset"
  for POPUP_FILE in "$APP_FILES"/*; do
    [ -f "$POPUP_FILE" ] || continue
    case "${POPUP_FILE##*/}" in
      mushrooms.tsv|teleport.txt|native.ready|scan.ready|map_query.ready|*.pending*|*.ack*)
        [ ! -L "$POPUP_FILE" ]; cp -p "$POPUP_FILE" "$POPUP_B/payload/game/" ;;
    esac
  done
  POPUP_OFFSET=$(cat "$POPUP_B/payload/module/upload.offset")
  case "$POPUP_OFFSET" in ''|*[!0-9]*) exit 1;; esac
  [ "$POPUP_OFFSET" -le "$(stat -c %s "$POPUP_B/payload/game/mushrooms.tsv")" ]
  chown -R 0:0 "$POPUP_B"
  chmod -R go-rwx "$POPUP_B"
  (cd "$POPUP_B/payload"; find . -type f -exec sha256sum {} \;) >"$POPUP_B/manifest.sha256"
  tar -cf "$POPUP_B/snapshot.tar" -C "$POPUP_B" payload manifest.sha256
  chmod 600 "$POPUP_B/snapshot.tar"
  tar -xf "$POPUP_B/snapshot.tar" -C "$POPUP_B/verified"
  (cd "$POPUP_B/verified/payload"; sha256sum -c ../manifest.sha256 >/dev/null)
  [ "$(stat -c %u:%a "$POPUP_B")" = 0:700 ]
  [ "$(stat -c %u:%a "$POPUP_B/snapshot.tar")" = 0:600 ]
  printf '%s\n' "$POPUP_B"
DAILY_BACKUP
}

popup_daily_restart() {
  [ "${POPUP_DAILY_RECAP_ENABLED:-0}" = 1 ] &&
    [ "${SCAN_RECOVERY_ENABLED:-0}" = 1 ] || return 1
  scan_can_run || return 2
  scan_recovery_restart_allowed || return 1
  POPUP_BOOT=$(cat /proc/sys/kernel/random/boot_id) || return 1
  read -r POPUP_CLOCK POPUP_UNUSED </proc/uptime || return 1
  POPUP_CLOCK=${POPUP_CLOCK%%.*}
  if [ -e "$MODDIR/popup.recap.last-restart" ]; then
    read -r POPUP_OLD_BOOT POPUP_OLD_TIME <"$MODDIR/popup.recap.last-restart" || return 1
    case "$POPUP_OLD_TIME" in ''|*[!0-9]*) return 1;; esac
    if [ "$POPUP_BOOT" = "$POPUP_OLD_BOOT" ] && [ $((POPUP_CLOCK - POPUP_OLD_TIME)) -lt 21600 ]; then
      echo '[popup] daily recap restart deferred reason=six-hour-limit'
      return 1
    fi
  fi
  if ! POPUP_BACKUP=$(popup_daily_backup); then
    echo '[popup] daily recap restart blocked reason=backup-failed'
    return 1
  fi
  scan_can_run || return 2
  # Backup may take time. Reconfirm the exact classified screen and focus.
  [ "$(popup_state)" = "$1" ] && popup_foreground || return 1
  if ! POPUP_CONTROL=$(scan_control); then
    echo '[popup] daily recap restart blocked reason=control-unavailable'
    return 1
  fi
  # Ordinary dwell polling is advisory, but this new destructive action needs
  # positive permission for the current formal target. Empty/errors fail closed.
  [ "$POPUP_CONTROL" = run ] || return 2
  scan_can_run && popup_foreground || return 2
  # Persist the attempt BEFORE changing the game, including failed launches.
  (umask 077; printf '%s %s\n' "$POPUP_BOOT" "$POPUP_CLOCK" >"$MODDIR/popup.recap.last-restart") || return 1
  scan_recovery_started || return 1
  echo "[popup] daily recap cold launch backup=$POPUP_BACKUP"
  run_as_shell "am force-stop $PKG" >/dev/null 2>&1 || return 1
  POPUP_STOP_LEFT=15
  while pidof "$PKG" >/dev/null 2>&1 && [ "$POPUP_STOP_LEFT" -gt 0 ]; do
    sleep 1; POPUP_STOP_LEFT=$((POPUP_STOP_LEFT - 1))
  done
  if pidof "$PKG" >/dev/null 2>&1; then
    echo '[popup] daily recap cold launch blocked reason=process-still-alive'
    return 1
  fi
  scan_can_run || return 2
  launch_game || return $?
  # Ordinary startup notices may themselves block managed-domain readiness.
  # Let their existing guarded classifier run during the native wait, while
  # suppressing nested daily-recap attempts. Always restore both flags.
  POPUP_DAILY_RESTART_ACTIVE=1
  POPUP_RECOVERY_ACTIVE=0
  POPUP_NATIVE_RESULT=0
  scan_recovery_wait_native || POPUP_NATIVE_RESULT=$?
  POPUP_RECOVERY_ACTIVE=1
  POPUP_DAILY_RESTART_ACTIVE=0
  [ "$POPUP_NATIVE_RESULT" = 0 ] || return "$POPUP_NATIVE_RESULT"
  echo '[popup] daily recap new native session ready; scan acceptance pending'
}

popup_recover() {
  POPUP_PREVIOUS=""
  for POPUP_STEP in 1 2 3; do
    scan_can_run || return 2
    POPUP_A="$(popup_state)"
    [ "$POPUP_A" != "$POPUP_PREVIOUS" ] || return 0
    # No eval; the only accepted roles originate in the calibrated classifier.
    set -- $POPUP_A
    [ "$#" = 3 ] && popup_actionable "$1" "$2" "$3" || return 0
    sleep 1
    scan_can_run || return 2
    POPUP_B="$(popup_state)"
    [ "$POPUP_A" = "$POPUP_B" ] && popup_foreground || return 0
    scan_can_run || return 2
    # The guard can take time or change the foreground (for example stopping
    # the game for charging protection). Recheck focus after that final guard.
    popup_foreground || return 0
    case "$1" in recap|recapmood)
      # The final recap leads to a personal mood choice, with no observed skip.
      # Never choose a mood or share. Use one backed-up, throttled cold launch.
      popup_daily_restart "$POPUP_B" || return $?
      return 0
      ;;
    esac
    POPUP_INPUT_ALLOWED=1
    POPUP_TAP_RESULT=0
    game_tap "$2" "$3" || POPUP_TAP_RESULT=$?
    POPUP_INPUT_ALLOWED=0
    [ "$POPUP_TAP_RESULT" = 0 ] || return "$POPUP_TAP_RESULT"
    echo "[popup] recovery input kind=$1 x=$2 y=$3"
    POPUP_PREVIOUS="$POPUP_B"
    sleep 2
    scan_can_run || return 2
    POPUP_AFTER="$(popup_state)"
    if [ "$POPUP_AFTER" = "$POPUP_PREVIOUS" ]; then
      echo "[popup] recovery unconfirmed kind=$1 reason=screen-unchanged"
      return 0
    fi
    # Unknown includes the map, transitions and unsupported screens. It proves
    # neither a recovered map nor a completed scan; leave acceptance to object,
    # upload and ACK evidence. Never call a successful input a recovery success.
    echo "[popup] screen state changed kind=$1 next=$POPUP_AFTER"
  done
}

popup_tick_if_due() {
  [ "${POPUP_RECOVERY_ENABLED:-0}" = 1 ] || return 0
  [ "${POPUP_RECOVERY_ACTIVE:-0}" != 1 ] || return 0
  POPUP_INTERVAL="${POPUP_RECOVERY_INTERVAL_SECONDS:-30}"
  case "$POPUP_INTERVAL" in ''|*[!0-9]*) POPUP_INTERVAL=30;; esac
  [ "$POPUP_INTERVAL" -ge 15 ] && [ "$POPUP_INTERVAL" -le 120 ] || POPUP_INTERVAL=30
  read -r POPUP_UPTIME POPUP_UNUSED </proc/uptime || return 0
  POPUP_NOW="${POPUP_UPTIME%%.*}"
  [ $((POPUP_NOW - ${POPUP_LAST_AT:--120})) -ge "$POPUP_INTERVAL" ] || return 0
  POPUP_LAST_AT="$POPUP_NOW"
  POPUP_RECOVERY_ACTIVE=1
  POPUP_RESULT=0
  popup_recover || POPUP_RESULT=$?
  POPUP_RECOVERY_ACTIVE=0
  return "$POPUP_RESULT"
}

# When opted in, old visual checkpoints use this classifier too. Legacy blind
# key/tap/swipe calls are suppressed in agent.sh; only popup_recover may tap.
visual_recover() { popup_tick_if_due; }
