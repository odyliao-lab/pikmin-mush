#!/system/bin/sh
MODDIR=${0%/*}
if [ -f "$MODDIR/agent.pid" ]; then
  kill "$(cat "$MODDIR/agent.pid" 2>/dev/null)" 2>/dev/null
fi
