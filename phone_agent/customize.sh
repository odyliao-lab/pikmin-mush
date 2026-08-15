#!/system/bin/sh
# Keep per-device configuration and hardware-specific display assets when
# installing this agent module over an existing instance.
OLD_MODULE="/data/adb/modules/pikmin_scanner_agent"
for name in config token upload.offset last.seq game.display localvd-drain scrcpy-server; do
  if [ -f "$OLD_MODULE/$name" ]; then
    cp "$OLD_MODULE/$name" "$MODPATH/$name"
  fi
done

# A recovery deployment may place a newly-issued Agent credential in this
# root-only staging file.  Consume it once during the Magisk install so the
# credential never enters versioned source or installer logs.
TOKEN_STAGE="/data/local/tmp/pikmin-agent-token"
if [ -s "$TOKEN_STAGE" ]; then
  cp "$TOKEN_STAGE" "$MODPATH/token"
  chmod 0600 "$MODPATH/token"
  rm -f "$TOKEN_STAGE"
fi

chmod 0755 "$MODPATH/agent.sh" "$MODPATH/service.sh" \
  "$MODPATH/local-display.sh" "$MODPATH/control.sh" "$MODPATH/action.sh" \
  "$MODPATH/uninstall.sh"
[ -f "$MODPATH/localvd-drain" ] && chmod 0755 "$MODPATH/localvd-drain"
[ -f "$MODPATH/scrcpy-server" ] && chmod 0644 "$MODPATH/scrcpy-server"
