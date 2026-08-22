#!/system/bin/sh

MODDIR="${PIKMIN_AGENT_CONTROL_DIR:-${0%/*}}"
PAUSE_FILE="$MODDIR/pause.until"
AUDIT_LOG="$MODDIR/control.log"
AGENT_LOG="$MODDIR/agent.log"
CONFIG="$MODDIR/config"

# Match the Agent's shell-domain location calls.  Magisk service scripts run
# as root, but Android location commands need the shell SELinux domain.
MAGISK_SU="${MAGISK_SU:-/sbin/su}"
if [ ! -x "$MAGISK_SU" ]; then
  MAGISK_SU="$(command -v su 2>/dev/null || true)"
fi

now_epoch() {
  date +%s
}

write_audit() {
  printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$1" >>"$AUDIT_LOG"
  chmod 600 "$AUDIT_LOG" 2>/dev/null || true
}

status() {
  if [ ! -s "$PAUSE_FILE" ]; then
    echo "running"
    return 0
  fi
  value="$(tr -d '\r\n ' <"$PAUSE_FILE" 2>/dev/null)"
  if [ "$value" = "manual" ]; then
    echo "paused manual"
    return 0
  fi
  case "$value" in
    ''|*[!0-9]*) rm -f "$PAUSE_FILE"; echo "running"; return 0 ;;
  esac
  now="$(now_epoch)"
  if [ "$value" -le "$now" ]; then
    rm -f "$PAUSE_FILE"
    write_audit "auto-resume"
    echo "running"
    return 0
  fi
  echo "paused until $value $((value - now))"
}

snapshot() {
  SNAP_STATE="$(status)"
  SNAP_LOCATION=""
  SNAP_LAT=""
  SNAP_LNG=""
  SNAP_PROGRESS=""
  SNAP_ROWS=""
  SNAP_ELAPSED=""

  SNAP_GPS_LINE="$(tail -n 300 "$AGENT_LOG" 2>/dev/null | \
    grep '^\[scan\] .* GPS=' | tail -n 1)"
  if [ -n "$SNAP_GPS_LINE" ]; then
    SNAP_BODY="${SNAP_GPS_LINE#*] }"
    SNAP_GPS="${SNAP_BODY##* GPS=}"
    SNAP_LEFT="${SNAP_BODY% GPS=*}"
    SNAP_PROGRESS="${SNAP_LEFT##* }"
    SNAP_LOCATION="${SNAP_LEFT% *}"
    SNAP_LAT="${SNAP_GPS%%,*}"
    SNAP_LNG="${SNAP_GPS#*,}"
  fi

  SNAP_RESULT_LINE="$(tail -n 300 "$AGENT_LOG" 2>/dev/null | \
    grep '^\[scan\] completed point=' | tail -n 1)"
  if [ -n "$SNAP_RESULT_LINE" ]; then
    SNAP_ROWS="${SNAP_RESULT_LINE#* rows=+}"
    SNAP_ROWS="${SNAP_ROWS%% *}"
    SNAP_ELAPSED="${SNAP_RESULT_LINE#* elapsed=}"
    SNAP_ELAPSED="${SNAP_ELAPSED%%s*}"
  fi

  printf 'snapshot\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$SNAP_STATE" "$SNAP_LOCATION" "$SNAP_LAT" "$SNAP_LNG" \
    "$SNAP_PROGRESS" "$SNAP_ROWS" "$SNAP_ELAPSED" "$(now_epoch)"
}

watch_status() {
  interval="${1:-5}"
  case "$interval" in
    ''|*[!0-9]*) echo "error invalid-watch-interval" >&2; exit 2 ;;
  esac
  if [ "$interval" -lt 2 ] || [ "$interval" -gt 60 ]; then
    echo "error watch-interval-out-of-range" >&2
    exit 2
  fi
  while true; do
    snapshot
    sleep "$interval"
  done
}

pause_minutes() {
  minutes="$1"
  case "$minutes" in
    ''|*[!0-9]*) echo "error invalid-minutes" >&2; exit 2 ;;
  esac
  if [ "$minutes" -lt 1 ] || [ "$minutes" -gt 10080 ]; then
    echo "error minutes-out-of-range" >&2
    exit 2
  fi
  until_epoch="$(( $(now_epoch) + minutes * 60 ))"
  tmp="$PAUSE_FILE.tmp.$$"
  printf '%s\n' "$until_epoch" >"$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$PAUSE_FILE"
  write_audit "pause minutes=$minutes until=$until_epoch"
  status
}

pause_manual() {
  printf 'manual\n' >"$PAUSE_FILE"
  chmod 600 "$PAUSE_FILE"
  write_audit "pause manual"
}

run_as_shell() {
  [ -n "$MAGISK_SU" ] && [ -x "$MAGISK_SU" ] || return 127
  "$MAGISK_SU" -Z u:r:shell:s0 2000 -c \
    "PATH=/system/bin:/system/xbin:/vendor/bin:/sbin; export PATH; $1"
}

stop_running_agent() {
  agent_pid="$(cat "$MODDIR/agent.pid" 2>/dev/null || true)"
  case "$agent_pid" in ''|*[!0-9]*) return 0 ;; esac
  [ -r "/proc/$agent_pid/cmdline" ] || return 0
  agent_cmd="$(tr '\000' ' ' <"/proc/$agent_pid/cmdline" 2>/dev/null || true)"
  case "$agent_cmd" in
    *"$MODDIR/agent.sh"*) kill "$agent_pid" 2>/dev/null || true ;;
  esac
}

release_gps() {
  # Config is local and root-only.  It may contain the Agent token, but this
  # script never prints it; only the GPS mode/package variables are used.
  SYSTEM_GPS_OVERRIDE=0
  GPS_BRIDGE_PACKAGE=""
  [ -f "$CONFIG" ] && . "$CONFIG"

  if [ "$SYSTEM_GPS_OVERRIDE" = "1" ]; then
    run_as_shell "cmd location providers set-test-provider-enabled gps false" \
      >/dev/null 2>&1 || true
    run_as_shell "cmd location providers remove-test-provider gps" \
      >/dev/null 2>&1 || true
  fi
  if [ -n "$GPS_BRIDGE_PACKAGE" ]; then
    # Android 9 bridge devices hand the exclusive mock-location AppOp back to
    # the user's Joystick. Resume below grants it back before Agent polling.
    appops set "$GPS_BRIDGE_PACKAGE" android:mock_location deny \
      >/dev/null 2>&1 || true
  fi
}

restore_gps_access() {
  GPS_BRIDGE_PACKAGE=""
  [ -f "$CONFIG" ] && . "$CONFIG"
  [ -n "$GPS_BRIDGE_PACKAGE" ] || return 0
  appops set "$GPS_BRIDGE_PACKAGE" android:mock_location allow \
    >/dev/null 2>&1 || true
}

handoff_gps() {
  # Do this in order: stop future writes first, then clear the last test
  # location.  The pause file survives reboot, so service.sh cannot take GPS
  # back until the user explicitly presses Resume in the control App.
  pause_manual
  stop_running_agent
  release_gps
  write_audit "gps handoff to external controller"
  echo "paused manual gps released"
}

case "${1:-status}" in
  status) status ;;
  snapshot) snapshot ;;
  watch) watch_status "${2:-5}" ;;
  pause) pause_minutes "${2:-}" ;;
  pause-manual)
    pause_manual
    status
    ;;
  handoff-gps) handoff_gps ;;
  resume)
    restore_gps_access
    rm -f "$PAUSE_FILE"
    write_audit "resume"
    status
    ;;
  *)
    echo "usage: $0 {status|snapshot|watch [SECONDS]|pause MINUTES|pause-manual|handoff-gps|resume}" >&2
    exit 2
    ;;
esac
