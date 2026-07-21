#!/system/bin/sh
MODDIR=${0%/*}
BOOT_LOG="$MODDIR/local-display-boot.log"
SERVICE_LOCK="$MODDIR/service.lock"
DISPLAY_WAIT_SECONDS="${PIKMIN_DISPLAY_BOOT_WAIT:-120}"
STATUS_TIMEOUT_SECONDS="${PIKMIN_DISPLAY_STATUS_TIMEOUT:-10}"

log_service() {
  echo "$(date '+%Y-%m-%dT%H:%M:%S%z') [service] $*" >>"$BOOT_LOG"
}

owned_pid() {
  CHECK_PID="$1"
  CHECK_PATH="$2"
  [ -n "$CHECK_PID" ] && kill -0 "$CHECK_PID" 2>/dev/null || return 1
  CHECK_COMMAND="$(tr '\000' ' ' 2>/dev/null <"/proc/$CHECK_PID/cmdline" || true)"
  case "$CHECK_COMMAND" in
    *"$CHECK_PATH"*) return 0 ;;
    *) return 1 ;;
  esac
}

acquire_service_lock() {
  if mkdir "$SERVICE_LOCK" 2>/dev/null; then
    echo $$ >"$SERVICE_LOCK/pid"
    return 0
  fi
  LOCK_PID="$(cat "$SERVICE_LOCK/pid" 2>/dev/null || true)"
  if owned_pid "$LOCK_PID" "$MODDIR/service.sh"; then
    log_service "another service instance is already running pid=$LOCK_PID"
    return 1
  fi
  rm -rf "$SERVICE_LOCK"
  mkdir "$SERVICE_LOCK" || return 1
  echo $$ >"$SERVICE_LOCK/pid"
}

release_service_lock() {
  LOCK_PID="$(cat "$SERVICE_LOCK/pid" 2>/dev/null || true)"
  [ "$LOCK_PID" = "$$" ] && rm -rf "$SERVICE_LOCK"
}

start_agent() {
  OLD_PID="$(cat "$MODDIR/agent.pid" 2>/dev/null || true)"
  if owned_pid "$OLD_PID" "$MODDIR/agent.sh"; then
    log_service "Agent already running pid=$OLD_PID"
    return 0
  fi
  rm -f "$MODDIR/agent.pid"
  nohup setsid "$MODDIR/agent.sh" >>"$MODDIR/agent.log" 2>&1 </dev/null &
  NEW_PID=$!
  echo "$NEW_PID" >"$MODDIR/agent.pid"
  sleep 1
  if ! owned_pid "$NEW_PID" "$MODDIR/agent.sh"; then
    log_service "Agent failed to start pid=$NEW_PID"
    rm -f "$MODDIR/agent.pid"
    return 1
  fi
  log_service "Agent started pid=$NEW_PID"
}

acquire_service_lock || exit 0
trap release_service_lock EXIT

until [ "$(getprop sys.boot_completed)" = "1" ]; do
  sleep 5
done

# A locked Android 13 keyguard can leave Pikmin "resumed" on the trusted
# virtual display while blocking its map/login flow. This is harmless on
# devices without a secure credential and keeps unattended reboot recovery
# from becoming a false-online, zero-output scanner.
wm dismiss-keyguard >/dev/null 2>&1 || true

if [ -f "$MODDIR/config" ]; then
  # shellcheck disable=SC1090
  . "$MODDIR/config"
fi

case "${WIFI_ADB_PORT:-0}" in
  ''|0|*[!0-9]*) ;;
  *)
    setprop persist.adb.tcp.port "$WIFI_ADB_PORT"
    setprop service.adb.tcp.port "$WIFI_ADB_PORT"
    stop adbd
    start adbd
    log_service "Wi-Fi ADB requested on port $WIFI_ADB_PORT"
    ;;
esac

if [ "${LOCAL_DISPLAY:-0}" = "1" ] && [ -x "$MODDIR/local-display.sh" ]; then
  if timeout -k 3 20 "$MODDIR/local-display.sh" start-daemon >>"$BOOT_LOG" 2>&1; then
    DISPLAY_DEADLINE=$(($(date +%s) + DISPLAY_WAIT_SECONDS))
    DISPLAY_HEALTHY=0
    while [ "$(date +%s)" -lt "$DISPLAY_DEADLINE" ]; do
      if timeout -k 2 "$STATUS_TIMEOUT_SECONDS" \
          "$MODDIR/local-display.sh" status >/dev/null 2>&1; then
        DISPLAY_HEALTHY=1
        break
      fi
      sleep 2
    done
    if [ "$DISPLAY_HEALTHY" -eq 1 ]; then
      log_service "local display is healthy"
    else
      log_service "local display is not healthy after ${DISPLAY_WAIT_SECONDS}s; daemon will keep recovering while Agent starts"
    fi
  else
    log_service "local display daemon start timed out or failed; Agent starts with display fallback"
  fi
fi

start_agent
