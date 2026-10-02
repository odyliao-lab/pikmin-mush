#!/system/bin/sh
# Opt-in calibrated recovery. Unknown/changed screens never receive input.
visual_foreground() {
  timeout -k 1 5 dumpsys activity activities 2>/dev/null |
    grep -E 'topResumedActivity|ResumedActivity:' | grep -q "$PKG"
}

visual_state() {
  [ "$LOCAL_DISPLAY" = "0" ] && [ -x "$MODDIR/bin/ui-probe" ] || { echo unknown; return; }
  visual_foreground || { echo unknown; return; }
  # Already running as root: spawning su for a screenshot produces a Magisk
  # toast over the very controls being classified. Keep capture local/private.
  rm -f "$MODDIR/ui.raw"
  (umask 077; timeout -k 1 8 screencap "$MODDIR/ui.raw") >/dev/null 2>&1 || { rm -f "$MODDIR/ui.raw"; echo unknown; return; }
  "$MODDIR/bin/ui-probe" "$MODDIR/ui.raw"
  rm -f "$MODDIR/ui.raw"
}

visual_recover() {
  scan_can_run || return 2
  VISUAL_PREVIOUS=""
  for VISUAL_STEP in 1 2 3; do
  # Two fresh captures agree before each individual action. Never reuse a
  # recognition result after dismissing a modal or changing the page.
  VISUAL_A="$(visual_state)"
  [ "$VISUAL_A" != "$VISUAL_PREVIOUS" ] || return 0
  case "$VISUAL_A" in 'warning '*|'activity '*|'menu '*|'dashboard 0 0') ;; *) return 0;; esac
  sleep 1
  scan_can_run || return 2
  VISUAL_B="$(visual_state)"
  [ "$VISUAL_A" = "$VISUAL_B" ] || return 0
  visual_foreground || return 0
  case "$VISUAL_B" in
    'warning 720 1730') game_tap 720 1730;;
    'warning 720 1690') game_tap 720 1690;;
    'warning 610 1448') game_tap 610 1448;;
    'activity 140 2895') game_tap 140 2895;;
    'activity 120 2450'|'menu 120 2450') game_tap 120 2450;;
    'dashboard 0 0') enter_map_view;;
    *) return 0;;
  esac
  echo "[ui] verified recovery state=${VISUAL_B%% *}"
  VISUAL_PREVIOUS="$VISUAL_B"
  sleep 3
  done
}
