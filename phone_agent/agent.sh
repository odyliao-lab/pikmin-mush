#!/system/bin/sh
MODDIR=${0%/*}
CONFIG="$MODDIR/config"
PKG="com.nianticlabs.pikmin"
APP_FILES="/data/user/0/$PKG/files"
TSV="$APP_FILES/mushrooms.tsv"
TELEPORT="$APP_FILES/teleport.txt"
OFFSET_FILE="$MODDIR/upload.offset"
SEQ_FILE="$MODDIR/last.seq"
CHUNK="$MODDIR/upload.chunk"
RESPONSE="$MODDIR/curl.response"

if [ ! -f "$CONFIG" ]; then
  echo "[agent] missing $CONFIG"
  exit 1
fi
. "$CONFIG"

POLL_SECONDS="${POLL_SECONDS:-2}"
[ -n "$TOKEN" ] || TOKEN="$(cat "$MODDIR/token" 2>/dev/null)"
if [ -z "$TOKEN" ]; then
  echo "[agent] missing token"
  exit 1
fi
OFFSET="$(cat "$OFFSET_FILE" 2>/dev/null)"
LAST_SEQ="$(cat "$SEQ_FILE" 2>/dev/null)"
case "$OFFSET" in ''|*[!0-9]*) OFFSET=0 ;; esac
case "$LAST_SEQ" in ''|*[!0-9]*) LAST_SEQ=0 ;; esac

auth_curl() {
  /system/bin/curl -fsS --connect-timeout 10 --max-time 45 \
    -H "Authorization: Bearer $TOKEN" "$@"
}

save_offset() {
  OFFSET="$1"
  echo "$OFFSET" >"$OFFSET_FILE"
}

save_seq() {
  LAST_SEQ="$1"
  echo "$LAST_SEQ" >"$SEQ_FILE"
}

ack() {
  seq="$1"
  ok="$2"
  lat="$3"
  lng="$4"
  url="$SERVER_URL/api/agent/ack?seq=$seq&ok=$ok"
  [ -n "$lat" ] && url="$url&lat=$lat&lng=$lng"
  auth_curl -X POST --data-binary '' "$url" >/dev/null 2>&1
}

upload_new() {
  [ -f "$TSV" ] || return 0
  SIZE="$(stat -c %s "$TSV" 2>/dev/null)"
  case "$SIZE" in ''|*[!0-9]*) return 0 ;; esac
  if [ "$SIZE" -lt "$OFFSET" ]; then
    save_offset 0
  fi
  [ "$SIZE" -le "$OFFSET" ] && return 0
  COUNT=$((SIZE - OFFSET))
  dd if="$TSV" of="$CHUNK" bs=1 skip="$OFFSET" count="$COUNT" 2>/dev/null || return 1
  CODE="$(auth_curl -o "$RESPONSE" -w '%{http_code}' -X POST \
    -H 'Content-Type: application/octet-stream' \
    --data-binary "@$CHUNK" "$SERVER_URL/api/agent/upload" 2>/dev/null)"
  if [ "$CODE" = "200" ]; then
    save_offset "$SIZE"
    echo "[agent] uploaded $COUNT bytes, offset=$SIZE"
    return 0
  fi
  echo "[agent] upload failed http=$CODE"
  return 1
}

ensure_game_running() {
  if ! pidof "$PKG" >/dev/null 2>&1; then
    su -Z u:r:shell:s0 2000 -c "monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1
    sleep 25
    su -Z u:r:shell:s0 2000 -c "input keyevent KEYCODE_ENTER"
    su -Z u:r:shell:s0 2000 -c "input keyevent KEYCODE_DPAD_CENTER"
  fi
}

execute_command() {
  seq="$1"
  op="$2"
  a="$3"
  b="$4"
  case "$op" in
    wait|'')
      return 0
      ;;
    reset)
      save_seq 0
      return 0
      ;;
    teleport)
      echo "$a,$b" >"$TELEPORT"
      if [ "$(cat "$TELEPORT" 2>/dev/null)" = "$a,$b" ]; then
        ensure_game_running
        ack "$seq" 1 "$a" "$b"
      else
        ack "$seq" 0 "" ""
      fi
      ;;
    confirm)
      if su -Z u:r:shell:s0 2000 -c "input keyevent KEYCODE_ENTER" &&
         su -Z u:r:shell:s0 2000 -c "input keyevent KEYCODE_DPAD_CENTER"; then
        ack "$seq" 1 "" ""
      else
        ack "$seq" 0 "" ""
      fi
      ;;
    restart)
      OLD_PID="$(pidof "$PKG" 2>/dev/null)"
      su -Z u:r:shell:s0 2000 -c "am force-stop $PKG"
      sleep 2
      su -Z u:r:shell:s0 2000 -c "monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1
      sleep 25
      su -Z u:r:shell:s0 2000 -c "input keyevent KEYCODE_ENTER"
      su -Z u:r:shell:s0 2000 -c "input keyevent KEYCODE_DPAD_CENTER"
      sleep 5
      NEW_PID="$(pidof "$PKG" 2>/dev/null)"
      if [ -n "$NEW_PID" ] && [ "$NEW_PID" != "$OLD_PID" ]; then
        ack "$seq" 1 "" ""
      else
        echo "[agent] restart verification failed old=$OLD_PID new=$NEW_PID"
        ack "$seq" 0 "" ""
      fi
      ;;
    sync)
      save_offset 0
      if upload_new; then ack "$seq" 1 "" ""; else ack "$seq" 0 "" ""; fi
      ;;
    status)
      LOC="$(cat "$TELEPORT" 2>/dev/null)"
      LAT="${LOC%%,*}"
      LNG="${LOC#*,}"
      if [ -n "$LAT" ] && [ "$LNG" != "$LOC" ]; then
        ack "$seq" 1 "$LAT" "$LNG"
      else
        ack "$seq" 0 "" ""
      fi
      ;;
    *)
      echo "[agent] unknown command: $op"
      ack "$seq" 0 "" ""
      ;;
  esac
  save_seq "$seq"
}

echo "[agent] started server=$SERVER_URL"
while true; do
  upload_new
  COMMAND="$(auth_curl "$SERVER_URL/api/agent/command?since=$LAST_SEQ" 2>/dev/null)"
  if [ -n "$COMMAND" ]; then
    OLD_IFS="$IFS"
    IFS="$(printf '\t')"
    set -- $COMMAND
    IFS="$OLD_IFS"
    execute_command "$1" "$2" "$3" "$4"
  fi
  sleep "$POLL_SECONDS"
done
