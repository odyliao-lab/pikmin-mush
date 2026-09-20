#!/system/bin/sh
# Source from agent.sh. Read-only Android sensors; never change thermal/charger
# controls. Opt in per device. All times used by the policy are monotonic seconds.

power_guard_init() {
  PG_STATE=running
  PG_REASON=none
  PG_LAST_SAMPLE=-30
  PG_LAST_LOG=-300
  PG_LAST_STOP=-30
  PG_LAST_HEARTBEAT=-30
  PG_STABLE_AT=-1
  PG_DRAIN_AT=-1
  PG_HOLD_AT=0
  PG_NOW=0
  PG_BOOT="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo unknown)"
  PG_HOLD_FILE="$MODDIR/power.hold"
  PG_STATUS_FILE="$MODDIR/power.status"
  PG_LOG="$MODDIR/power.log"
  # Never source persisted state as shell code. An existing hold (even corrupt)
  # requires a fresh recovery window after an Agent restart or phone reboot.
  if [ -e "$PG_HOLD_FILE" ]; then
    PG_STATE=cooling
    PG_REASON=restart-check
    PG_HOLD_AT=-1
  fi
}

power_guard_log() {
  PG_LOG_SIZE="$(stat -c %s "$PG_LOG" 2>/dev/null || true)"
  case "$PG_LOG_SIZE" in ''|*[!0-9]*) PG_LOG_SIZE=0 ;; esac
  if [ "$PG_LOG_SIZE" -gt 131072 ]; then mv -f "$PG_LOG" "$PG_LOG.1"; fi
  PG_LINE="$(date '+%Y-%m-%dT%H:%M:%S%z') boot=$PG_BOOT uptime=$PG_NOW $* thermal=${PG_THERMAL:-unknown} battery=${PG_LEVEL:-unknown} temp_dC=${PG_TEMP:-unknown} plugged=${PG_PLUGGED:-unknown} charge_status=${PG_CHARGE:-unknown} counter_uAh=${PG_COUNTER:-unknown}"
  printf '%s\n' "$PG_LINE" >>"$PG_LOG"
  chmod 600 "$PG_LOG" 2>/dev/null || true
  echo "[power] $PG_LINE"
  PG_LAST_LOG="$PG_NOW"
}

power_guard_hold() {
  if [ "$PG_STATE" != cooling ]; then
    PG_HOLD_AT="$PG_NOW"
    PG_STATE=cooling
    PG_STABLE_AT=-1
    PG_DRAIN_AT=-1
    PG_LAST_STOP=-30
    PG_REASON="$1"
    # A separate latch: neither local nor cloud resume can erase this hold.
    (umask 077; printf '%s\n' "$PG_REASON" >"$PG_HOLD_FILE.tmp" &&
      mv -f "$PG_HOLD_FILE.tmp" "$PG_HOLD_FILE")
    power_guard_log "hold reason=$PG_REASON"
  elif [ "$PG_REASON" != "$1" ]; then
    PG_REASON="$1"
    power_guard_log "hold reason=$PG_REASON"
  fi
}

power_guard_sample() {
  PG_VALID=0
  PG_THERMAL=unknown PG_LEVEL=unknown PG_TEMP=unknown
  PG_PLUGGED=unknown PG_CHARGE=unknown PG_COUNTER=unknown
  PG_BATTERY="$(timeout -k 1 5 dumpsys battery 2>/dev/null)" || return 1
  PG_THERMALS="$(timeout -k 1 5 dumpsys thermalservice 2>/dev/null)" || return 1
  # Ignore cached HAL temperatures and reject OS diagnostic sensor overrides.
  echo "$PG_BATTERY" | grep -q 'UPDATES STOPPED' && return 1
  echo "$PG_BATTERY" | grep -q 'present: true' || return 1
  echo "$PG_THERMALS" | grep -q '^IsStatusOverride: false' || return 1
  echo "$PG_THERMALS" | grep -q '^HAL Ready: true' || return 1
  PG_THERMAL="$(echo "$PG_THERMALS" | sed -n 's/^Thermal Status: //p' | tr -d '\r ')"
  PG_LEVEL="$(echo "$PG_BATTERY" | sed -n 's/^[[:space:]]*level: //p' | tr -d '\r ')"
  PG_SCALE="$(echo "$PG_BATTERY" | sed -n 's/^[[:space:]]*scale: //p' | tr -d '\r ')"
  PG_TEMP="$(echo "$PG_BATTERY" | sed -n 's/^[[:space:]]*temperature: //p' | tr -d '\r ')"
  PG_CHARGE="$(echo "$PG_BATTERY" | sed -n 's/^[[:space:]]*status: //p' | tr -d '\r ')"
  PG_COUNTER="$(echo "$PG_BATTERY" | sed -n 's/^[[:space:]]*Charge counter: //p' | tr -d '\r ')"
  PG_PLUGGED=0
  if echo "$PG_BATTERY" | grep -Eq '(AC|USB|Wireless) powered: true'; then PG_PLUGGED=1; fi
  for PG_NUMBER in "$PG_THERMAL" "$PG_LEVEL" "$PG_TEMP" "$PG_CHARGE" "$PG_COUNTER"; do
    case "$PG_NUMBER" in ''|*[!0-9]*|??????????*) return 1 ;; esac
  done
  [ "$PG_SCALE" = 100 ] && [ "$PG_LEVEL" -le 100 ] &&
    [ "$PG_THERMAL" -le 6 ] && [ "$PG_TEMP" -le 800 ] &&
    [ "$PG_COUNTER" -gt 0 ] && [ "$PG_CHARGE" -ge 1 ] &&
    [ "$PG_CHARGE" -le 5 ] || return 1
  PG_VALID=1
}

# Pure decision function; tests supply samples without changing phone sensors.
power_guard_decide() {
  [ "$PG_HOLD_AT" -ge 0 ] || PG_HOLD_AT="$PG_NOW"
  if [ "$PG_VALID" != 1 ]; then
    PG_STABLE_AT=-1 PG_DRAIN_AT=-1
    power_guard_hold sensor-unavailable
    return
  fi
  PG_ALERT=""
  if [ "$PG_THERMAL" -ge 3 ]; then PG_ALERT=thermal-severe
  elif [ "$PG_TEMP" -ge 430 ]; then PG_ALERT=battery-hot
  elif [ "$PG_TEMP" -le 50 ]; then PG_ALERT=battery-cold
  elif [ "$PG_LEVEL" -le 20 ]; then PG_ALERT=low-battery
  fi
  # A plugged-in phone can still run its battery flat while charging is thermally
  # suspended. Check actual depletion, not just the Android "charging" label.
  if [ "$PG_STATE" = running ] && [ "$PG_PLUGGED" = 1 ]; then
    if [ "$PG_DRAIN_AT" -lt 0 ]; then
      PG_DRAIN_AT="$PG_NOW" PG_DRAIN_LEVEL="$PG_LEVEL" PG_DRAIN_COUNTER="$PG_COUNTER"
    elif [ $((PG_NOW - PG_DRAIN_AT)) -ge 600 ]; then
      if [ $((PG_DRAIN_LEVEL - PG_LEVEL)) -ge 3 ] ||
          [ $((PG_DRAIN_COUNTER - PG_COUNTER)) -ge 30000 ]; then
        [ -n "$PG_ALERT" ] || PG_ALERT=plugged-draining
      fi
      PG_DRAIN_AT="$PG_NOW" PG_DRAIN_LEVEL="$PG_LEVEL" PG_DRAIN_COUNTER="$PG_COUNTER"
    fi
  else
    PG_DRAIN_AT=-1
  fi
  if [ -n "$PG_ALERT" ]; then
    PG_STABLE_AT=-1
    power_guard_hold "$PG_ALERT"
    return
  fi
  [ "$PG_STATE" = cooling ] || return 0
  # Hysteresis: light/no thermal restriction, <=39 C, >=30%, external power,
  # charging/full and no meaningful battery loss for two continuous minutes.
  if [ "$PG_THERMAL" -gt 1 ] || [ "$PG_TEMP" -gt 390 ] ||
      [ "$PG_TEMP" -lt 100 ] || [ "$PG_LEVEL" -lt 30 ] ||
      [ "$PG_PLUGGED" != 1 ] || { [ "$PG_CHARGE" != 2 ] && [ "$PG_CHARGE" != 5 ]; }; then
    PG_STABLE_AT=-1
    return
  fi
  if [ "$PG_STABLE_AT" -ge 0 ] &&
      { [ "$PG_LEVEL" -lt "$PG_STABLE_LEVEL" ] ||
        [ $((PG_STABLE_COUNTER - PG_COUNTER)) -gt 5000 ]; }; then
    PG_STABLE_AT=-1
  fi
  if [ "$PG_STABLE_AT" -lt 0 ]; then
    PG_STABLE_AT="$PG_NOW" PG_STABLE_LEVEL="$PG_LEVEL" PG_STABLE_COUNTER="$PG_COUNTER"
  fi
  if [ $((PG_NOW - PG_HOLD_AT)) -ge 180 ] && [ $((PG_NOW - PG_STABLE_AT)) -ge 120 ]; then
    PG_STATE=running PG_REASON=none PG_DRAIN_AT=-1
    rm -f "$PG_HOLD_FILE"
    power_guard_log "recovered; awaiting cloud task before launching game"
  fi
}

power_guard_status() {
  (umask 077
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$PG_STATE" "$PG_REASON" "$(date +%s)" "$PG_THERMAL" "$PG_LEVEL" \
      "$PG_TEMP" "$PG_PLUGGED" "$PG_CHARGE" "$PG_COUNTER" >"$PG_STATUS_FILE.tmp" &&
      mv -f "$PG_STATUS_FILE.tmp" "$PG_STATUS_FILE")
}

power_guard_check() {
  [ "${POWER_GUARD_ENABLED:-0}" = 1 ] || return 0
  PG_CLOCK="$(cut -d. -f1 /proc/uptime 2>/dev/null)"
  case "$PG_CLOCK" in ''|*[!0-9]*) PG_CLOCK="$PG_NOW"; PG_CLOCK_VALID=0 ;; *) PG_CLOCK_VALID=1 ;; esac
  # Local/manual pause is checked by the caller first. Invalidate stale recovery
  # evidence when returning from manual pause, a long command or a clock anomaly.
  if [ "$PG_CLOCK" -lt "$PG_NOW" ] || [ $((PG_CLOCK - PG_LAST_SAMPLE)) -gt 90 ]; then
    PG_STABLE_AT=-1 PG_DRAIN_AT=-1
    PG_LAST_SAMPLE=-30
  fi
  PG_NOW="$PG_CLOCK"
  if [ -f "$MODDIR/power.cool-request" ]; then
    rm -f "$MODDIR/power.cool-request"
    power_guard_hold requested
    PG_HOLD_AT="$PG_NOW" PG_STABLE_AT=-1 PG_LAST_SAMPLE=-30
  fi
  if [ "$PG_CLOCK_VALID" != 1 ] || [ $((PG_NOW - PG_LAST_SAMPLE)) -ge 30 ]; then
    power_guard_sample || PG_VALID=0
    [ "$PG_CLOCK_VALID" = 1 ] || PG_VALID=0
    power_guard_decide
    PG_LAST_SAMPLE="$PG_NOW"
    power_guard_status
    if [ $((PG_NOW - PG_LAST_LOG)) -ge 300 ]; then power_guard_log "state=$PG_STATE reason=$PG_REASON"; fi
  fi
  if [ "$PG_STATE" = cooling ]; then
    # Retry bounded force-stop while the guard owns the scanner. Manual pause
    # bypasses this gate, so it does not fight a user playing on the phone.
    if [ $((PG_NOW - PG_LAST_STOP)) -ge 30 ]; then
      if pidof "$PKG" >/dev/null 2>&1; then
        if run_as_shell_timeout 5 "am force-stop $PKG" >/dev/null 2>&1; then
          power_guard_log "game stopped for cooldown"
        else
          power_guard_log "WARNING game stop failed; will retry"
        fi
      fi
      PG_LAST_STOP="$PG_NOW"
    fi
    return 1
  fi
  return 0
}

power_guard_heartbeat() {
  [ "${POWER_GUARD_ENABLED:-0}" = 1 ] && [ "$PG_STATE" = cooling ] || return 0
  [ $((PG_NOW - PG_LAST_HEARTBEAT)) -ge 30 ] || return 0
  PG_LAST_HEARTBEAT="$PG_NOW"
  # Keep the current target's lease, not a success/failure ACK. The next normal
  # claim resumes it or follows a newer cloud plan if it was cancelled/reassigned.
  PG_CONTROL="$(scan_control)"
  if [ "$PG_CONTROL" = stop ]; then SCAN_JOB_ID="" SCAN_TARGET_ID="" SCAN_LEASE=""; fi
}
