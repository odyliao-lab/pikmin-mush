#!/system/bin/sh
# Opt-in for a Hunter build that writes PID-bound native.ready after hooking.
scan_recovery_started() {
  read -r RECOVERY_CLOCK RECOVERY_UNUSED </proc/uptime || return 1
  RECOVERY_BOOT="$(cat /proc/sys/kernel/random/boot_id)" || return 1
  (umask 077; printf '%s %s\n' "$RECOVERY_BOOT" "${RECOVERY_CLOCK%%.*}" >"$MODDIR/recovery.last-start")
}

scan_recovery_restart_allowed() {
  RECOVERY_LIMIT="${SCAN_RESTART_MIN_SECONDS:-300}"
  case "$RECOVERY_LIMIT" in ''|*[!0-9]*) RECOVERY_LIMIT=300;; esac
  [ "$RECOVERY_LIMIT" -ge 120 ] && [ "$RECOVERY_LIMIT" -le 1800 ] || RECOVERY_LIMIT=300
  [ -s "$MODDIR/recovery.last-start" ] || return 0
  read -r RECOVERY_BOOT RECOVERY_LAST <"$MODDIR/recovery.last-start" || return 1
  [ "$RECOVERY_BOOT" = "$(cat /proc/sys/kernel/random/boot_id)" ] || return 0
  case "$RECOVERY_LAST" in ''|*[!0-9]*) return 1;; esac
  read -r RECOVERY_CLOCK RECOVERY_UNUSED </proc/uptime || return 1
  RECOVERY_AGE=$(( ${RECOVERY_CLOCK%%.*} - RECOVERY_LAST ))
  if [ "$RECOVERY_AGE" -lt "$RECOVERY_LIMIT" ]; then
    echo "[recovery] cold restart deferred age=${RECOVERY_AGE}s minimum=${RECOVERY_LIMIT}s"
    return 1
  fi
}

scan_recovery_wait_native() {
  RECOVERY_LEFT=120
  RECOVERY_CONTROL_TICKS=30
  while [ "$RECOVERY_LEFT" -gt 0 ]; do
    scan_can_run || return 2
    READY_PID='' READY_VERSION='' READY_EXTRA=''
    if [ -r "$APP_FILES/native.ready" ]; then
      read -r READY_PID READY_VERSION READY_EXTRA <"$APP_FILES/native.ready" || true
    fi
    # Exact running process + exact game version; old markers cannot authorize
    # a new Unity process, nor can the marker substitute for object evidence.
    case "$READY_PID" in ''|*[!0-9]*) ;;
      *) if [ -z "$READY_EXTRA" ] && [ "$READY_PID" = "$(pidof "$PKG")" ] &&
            [ "$READY_VERSION" = "$GAME_VERSION" ]; then
           echo "[recovery] native ready pid=$READY_PID game=$READY_VERSION"
           return 0
         fi;;
    esac
    if [ "${SCAN_RECOVERY_CONTROL_POLL:-0}" = 1 ] &&
        [ "$RECOVERY_CONTROL_TICKS" -ge 30 ]; then
      RECOVERY_CONTROL_TICKS=0
      RECOVERY_CONTROL="$(scan_control)"
      case "$RECOVERY_CONTROL" in
        pause) return 2;;
        stop) [ -z "${SCAN_LEASE:-}" ] || return 2;;
      esac
    fi
    guarded_startup_wait 5 || return 2
    RECOVERY_LEFT=$((RECOVERY_LEFT - 5))
    RECOVERY_CONTROL_TICKS=$((RECOVERY_CONTROL_TICKS + 5))
  done
  echo '[recovery] native startup timeout; no readiness claim'
  return 1
}
