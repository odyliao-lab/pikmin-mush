#!/system/bin/sh

MODDIR="${PIKMIN_AGENT_CONTROL_DIR:-${0%/*}}"
PAUSE_FILE="$MODDIR/pause.until"
AUDIT_LOG="$MODDIR/control.log"
AGENT_LOG="$MODDIR/agent.log"

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

case "${1:-status}" in
  power-status)
    if [ -s "$MODDIR/power.status" ]; then
      cat "$MODDIR/power.status"
    else
      echo "unknown guard-not-observed"
    fi
    ;;
  cool-now)
    # Only requests extra protection; no command bypasses the recovery checks.
    if [ ! -f "$MODDIR/power-guard.sh" ] ||
        ! grep -Eq "^POWER_GUARD_ENABLED=['\"]?1['\"]?$" "$MODDIR/config"; then
      echo "error guard-not-enabled" >&2
      exit 2
    fi
    (umask 077; printf 'requested\n' >"$MODDIR/power.cool-request")
    write_audit "cooldown requested"
    echo "cooldown requested"
    ;;
  status) status ;;
  snapshot) snapshot ;;
  watch) watch_status "${2:-5}" ;;
  pause) pause_minutes "${2:-}" ;;
  pause-manual)
    printf 'manual\n' >"$PAUSE_FILE"
    chmod 600 "$PAUSE_FILE"
    write_audit "pause manual"
    status
    ;;
  resume)
    rm -f "$PAUSE_FILE"
    write_audit "resume"
    status
    ;;
  *)
    echo "usage: $0 {status|snapshot|watch [SECONDS]|pause MINUTES|pause-manual|resume|power-status|cool-now}" >&2
    exit 2
    ;;
esac
