#!/system/bin/sh
MODDIR=${0%/*}

until [ "$(getprop sys.boot_completed)" = "1" ]; do
  sleep 5
done

if [ -f "$MODDIR/agent.pid" ]; then
  OLD_PID="$(cat "$MODDIR/agent.pid" 2>/dev/null)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    exit 0
  fi
fi

nohup "$MODDIR/agent.sh" >>"$MODDIR/agent.log" 2>&1 &
echo $! >"$MODDIR/agent.pid"
