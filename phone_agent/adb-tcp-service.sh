#!/system/bin/sh
# Magisk service.d helper for a dedicated, owned scanner phone.  It restores
# authenticated ADB-over-TCP after boot so the maintenance endpoint remains
# stable.  The device must still have previously authorized the host's ADB key.

PORT="${PIKMIN_ADB_TCP_PORT:-5555}"
case "$PORT" in
  ''|*[!0-9]*|0|[1-9][0-9][0-9][0-9][0-9]*) exit 2 ;;
esac

while [ "$(getprop sys.boot_completed)" != "1" ]; do
  sleep 2
done

setprop service.adb.tcp.port "$PORT"
setprop persist.adb.tcp.port "$PORT"
setprop ctl.restart adbd
