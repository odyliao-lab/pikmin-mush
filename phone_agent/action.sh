#!/system/bin/sh

MODDIR=${0%/*}
RECOVERY_LOG="$MODDIR/manual-recovery.log"
DISPLAY_STOP_TIMEOUT="${PIKMIN_DISPLAY_STOP_TIMEOUT:-45}"
SERVICE_TIMEOUT="${PIKMIN_SERVICE_RECOVERY_TIMEOUT:-160}"

log_recovery() {
  LINE="$(date '+%Y-%m-%dT%H:%M:%S%z') [recovery] $*"
  echo "$LINE"
  echo "$LINE" >>"$RECOVERY_LOG"
}

process_command() {
  tr '\000' ' ' 2>/dev/null <"/proc/$1/cmdline" || true
}

stop_owned_pid_file() {
  PID_FILE="$1"
  NEEDLE="$2"
  LABEL="$3"
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$PID" ] || return 0
  COMMAND="$(process_command "$PID")"
  case "$COMMAND" in
    *"$NEEDLE"*) ;;
    *) return 0 ;;
  esac

  log_recovery "stopping $LABEL pid=$PID"
  kill -TERM "-$PID" 2>/dev/null || kill "$PID" 2>/dev/null || true
  sleep 2
  COMMAND="$(process_command "$PID")"
  case "$COMMAND" in
    *"$NEEDLE"*) kill -9 "-$PID" 2>/dev/null || kill -9 "$PID" 2>/dev/null || true ;;
  esac
}

verify_agent() {
  AGENT_PID="$(cat "$MODDIR/agent.pid" 2>/dev/null || true)"
  [ -n "$AGENT_PID" ] && kill -0 "$AGENT_PID" 2>/dev/null || return 1
  AGENT_COMMAND="$(process_command "$AGENT_PID")"
  case "$AGENT_COMMAND" in
    *"$MODDIR/agent.sh"*) return 0 ;;
    *) return 1 ;;
  esac
}

log_recovery "manual Scanner recovery started"

# A boot service may be blocked in a framework status call. Stop only processes
# published by the service lock whose cmdline still contains this module's
# exact service path. This avoids an expensive and racy scan of every /proc PID.
stop_owned_pid_file "$MODDIR/service.lock/pid" "$MODDIR/service.sh" "stale service"
rm -rf "$MODDIR/service.lock"

# Stop only this module's Agent. The service will publish one validated parent.
stop_owned_pid_file "$MODDIR/agent.pid" "$MODDIR/agent.sh" "Agent"
rm -f "$MODDIR/agent.pid"

# Manual recovery is intentionally a cold display restart. This also terminates
# a daemon blocked in an old status child before the bounded implementation runs.
if ! timeout -k 5 "$DISPLAY_STOP_TIMEOUT" \
    "$MODDIR/local-display.sh" stop >>"$RECOVERY_LOG" 2>&1; then
  log_recovery "display stop timed out; continuing with guarded service recovery"
fi

if ! timeout -k 5 "$SERVICE_TIMEOUT" \
    "$MODDIR/service.sh" >>"$RECOVERY_LOG" 2>&1; then
  log_recovery "service recovery timed out or failed"
  exit 1
fi

sleep 3
if ! verify_agent; then
  log_recovery "Agent verification failed"
  exit 1
fi

if timeout -k 2 10 "$MODDIR/local-display.sh" status >>"$RECOVERY_LOG" 2>&1; then
  DISPLAY_RESULT="healthy"
else
  DISPLAY_RESULT="recovering"
fi
log_recovery "recovery completed agent_pid=$AGENT_PID display=$DISPLAY_RESULT"
exit 0
