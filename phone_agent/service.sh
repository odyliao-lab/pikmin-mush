#!/system/bin/sh
MODDIR=${0%/*}

until [ "$(getprop sys.boot_completed)" = "1" ]; do
  sleep 5
done

if [ -f "$MODDIR/config" ]; then
  # shellcheck disable=SC1090
  . "$MODDIR/config"
fi

if [ "${LOCAL_DISPLAY:-0}" = "1" ] && [ -x "$MODDIR/local-display.sh" ]; then
  "$MODDIR/local-display.sh" start-daemon >>"$MODDIR/local-display-boot.log" 2>&1 || exit 1
  DISPLAY_ATTEMPT=0
  until "$MODDIR/local-display.sh" status >/dev/null 2>&1; do
    if [ "$DISPLAY_ATTEMPT" -ge 90 ]; then
      echo "[service] local display did not become healthy" >>"$MODDIR/local-display-boot.log"
      exit 1
    fi
    sleep 1
    DISPLAY_ATTEMPT=$((DISPLAY_ATTEMPT + 1))
  done
fi

if [ -f "$MODDIR/agent.pid" ]; then
  OLD_PID="$(cat "$MODDIR/agent.pid" 2>/dev/null)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    OLD_COMMAND="$(tr '\000' ' ' <"/proc/$OLD_PID/cmdline" 2>/dev/null)"
    case "$OLD_COMMAND" in
      *"$MODDIR/agent.sh"*) exit 0 ;;
    esac
  fi
  rm -f "$MODDIR/agent.pid"
fi

nohup "$MODDIR/agent.sh" >>"$MODDIR/agent.log" 2>&1 &
echo $! >"$MODDIR/agent.pid"
