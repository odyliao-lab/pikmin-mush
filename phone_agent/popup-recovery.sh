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
  case "$1" in driving|restricted|danger|speed|dashboard) ;; *) return 1;; esac
  case "$2,$3" in *[!0-9,]*|,*|*,) return 1;; esac
  [ "$2" -gt 0 ] && [ "$2" -lt 1440 ] && [ "$3" -gt 0 ] && [ "$3" -lt 3120 ]
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
    POPUP_INPUT_ALLOWED=1
    POPUP_TAP_RESULT=0
    game_tap "$2" "$3" || POPUP_TAP_RESULT=$?
    POPUP_INPUT_ALLOWED=0
    [ "$POPUP_TAP_RESULT" = 0 ] || return "$POPUP_TAP_RESULT"
    echo "[popup] verified recovery kind=$1 x=$2 y=$3"
    POPUP_PREVIOUS="$POPUP_B"
    sleep 2
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
