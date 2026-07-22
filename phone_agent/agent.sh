#!/system/bin/sh
MODDIR=${0%/*}
CONFIG="$MODDIR/config"
PKG="com.nianticlabs.pikmin"
GAME_ACTIVITY="com.nianticproject.ichigo.IchigoUnityPlayerActivity"
APP_FILES="/data/user/0/$PKG/files"
TSV="$APP_FILES/mushrooms.tsv"
TELEPORT="$APP_FILES/teleport.txt"
OFFSET_FILE="$MODDIR/upload.offset"
SEQ_FILE="$MODDIR/last.seq"
CHUNK="$MODDIR/upload.chunk"
RESPONSE="$MODDIR/curl.response"
SCAN_PENDING="$MODDIR/scan.pending"
DISPLAY_FILE="$MODDIR/game.display"
SCAN_READY="$APP_FILES/scan.ready"
QUERY_READY="$APP_FILES/map_query.ready"
MAX_UPLOAD_CHUNK_BYTES=262144

if [ ! -f "$CONFIG" ]; then
  echo "[agent] missing $CONFIG"
  exit 1
fi
. "$CONFIG"

POLL_SECONDS="${POLL_SECONDS:-2}"
MAP_REFRESH_EXPERIMENT="${MAP_REFRESH_EXPERIMENT:-0}"
MAP_REFRESH_TIMEOUT_SECONDS="${MAP_REFRESH_TIMEOUT_SECONDS:-18}"
MAP_REFRESH_SETTLE_SECONDS="${MAP_REFRESH_SETTLE_SECONDS:-3}"
MAP_REFRESH_FALLBACK_TIMEOUT_SECONDS="${MAP_REFRESH_FALLBACK_TIMEOUT_SECONDS:-40}"
STARTUP_TAP_X="${STARTUP_TAP_X:-0}"
STARTUP_CONTINUE_Y="${STARTUP_CONTINUE_Y:-0}"
STARTUP_LOGIN_CONTINUE_Y="${STARTUP_LOGIN_CONTINUE_Y:-0}"
AGENT_ID="${AGENT_ID:-primary}"
AGENT_VERSION="${AGENT_VERSION:-2.0.0}"
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
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Agent-Id: $AGENT_ID" \
    -H "X-Agent-Version: $AGENT_VERSION" "$@"
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
  [ "$COUNT" -gt "$MAX_UPLOAD_CHUNK_BYTES" ] && COUNT="$MAX_UPLOAD_CHUNK_BYTES"
  dd if="$TSV" of="$CHUNK" bs=1 skip="$OFFSET" count="$COUNT" 2>/dev/null || return 1
  CODE="$(auth_curl -o "$RESPONSE" -w '%{http_code}' -X POST \
    -H 'Content-Type: application/octet-stream' \
    --data-binary "@$CHUNK" "$SERVER_URL/api/agent/upload" 2>/dev/null)"
  if [ "$CODE" = "200" ]; then
    NEXT_OFFSET=$((OFFSET + COUNT))
    save_offset "$NEXT_OFFSET"
    echo "[agent] uploaded $COUNT bytes, offset=$NEXT_OFFSET"
    return 0
  fi
  echo "[agent] upload failed http=$CODE"
  return 1
}

game_display_id() {
  DISPLAY_ID="$(cat "$DISPLAY_FILE" 2>/dev/null)"
  case "$DISPLAY_ID" in ''|*[!0-9]*) return 1 ;; esac
  su -Z u:r:shell:s0 2000 -c "cmd display get-displays" 2>/dev/null |
    grep -q "Display id $DISPLAY_ID:" || return 1
  echo "$DISPLAY_ID"
}

launch_game() {
  DISPLAY_ID="$(game_display_id)"
  if [ -n "$DISPLAY_ID" ]; then
    su -Z u:r:shell:s0 2000 -c \
      "am start --display $DISPLAY_ID -n $PKG/$GAME_ACTIVITY" >/dev/null 2>&1
  else
    su -Z u:r:shell:s0 2000 -c \
      "monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1
  fi
}

game_keyevent() {
  KEY_NAME="$1"
  DISPLAY_ID="$(game_display_id)"
  if [ -n "$DISPLAY_ID" ]; then
    su -Z u:r:shell:s0 2000 -c \
      "input -d $DISPLAY_ID keyevent $KEY_NAME" >/dev/null 2>&1
  else
    su -Z u:r:shell:s0 2000 -c \
      "input keyevent $KEY_NAME" >/dev/null 2>&1
  fi
}

game_tap() {
  TAP_X="$1"
  TAP_Y="$2"
  [ "$TAP_X" -gt 0 ] 2>/dev/null || return 1
  [ "$TAP_Y" -gt 0 ] 2>/dev/null || return 1
  DISPLAY_ID="$(game_display_id)"
  if [ -n "$DISPLAY_ID" ]; then
    su -Z u:r:shell:s0 2000 -c "input -d $DISPLAY_ID tap $TAP_X $TAP_Y" \
      >/dev/null 2>&1
  else
    su -Z u:r:shell:s0 2000 -c "input tap $TAP_X $TAP_Y" >/dev/null 2>&1
  fi
}

game_is_resumed() {
  su -Z u:r:shell:s0 2000 -c "dumpsys activity activities" 2>/dev/null |
    grep -E 'topResumedActivity|ResumedActivity:' |
    grep -q "$PKG"
}

ensure_game_running() {
  if ! pidof "$PKG" >/dev/null 2>&1; then
    launch_game
    sleep 25
    game_keyevent KEYCODE_ENTER
    game_keyevent KEYCODE_DPAD_CENTER
    return
  fi
  if ! game_is_resumed; then
    launch_game
    sleep 8
  fi
}

number_or_zero() {
  case "$1" in ''|*[!0-9]*) echo 0 ;; *) echo "$1" ;; esac
}

file_size() {
  SIZE_NOW="$(stat -c %s "$TSV" 2>/dev/null)"
  number_or_zero "$SIZE_NOW"
}

useful_line_count() {
  # TSV 第 7 欄是蘑菇等級；Fleet 只統計等級 2 以上，避免小型蘑菇
  # 觸發「有擷取」判定或灌入每個 target 的 captured rows。
  LINES_NOW="$(awk -F '\t' '$7 + 0 >= 2 { count++ } END { print count + 0 }' "$TSV" 2>/dev/null)"
  LINES_NOW="$(echo "$LINES_NOW" | tr -d ' ')"
  number_or_zero "$LINES_NOW"
}

scan_control() {
  auth_curl "$SERVER_URL/api/agent/v2/control?job_id=$SCAN_JOB_ID&target_id=$SCAN_TARGET_ID&lease=$SCAN_LEASE" 2>/dev/null
}

interruptible_wait() {
  WAIT_LEFT="$(number_or_zero "$1")"
  WAIT_JOB="$2"
  while [ "$WAIT_LEFT" -gt 0 ]; do
    WAIT_STEP=5
    [ "$WAIT_LEFT" -lt 5 ] && WAIT_STEP="$WAIT_LEFT"
    sleep "$WAIT_STEP"
    WAIT_LEFT=$((WAIT_LEFT - WAIT_STEP))
    CONTROL="$(scan_control)"
    case "$CONTROL" in
      pause|stop) return 2 ;;
    esac
  done
  return 0
}

refresh_marker_matches() {
  MARKER_FILE="$1"
  EXPECTED_TOKEN="$2"
  [ -s "$MARKER_FILE" ] || return 1
  MARKER_TOKEN="$(cut -f1 "$MARKER_FILE" 2>/dev/null)"
  [ "$MARKER_TOKEN" = "$EXPECTED_TOKEN" ]
}

wait_for_map_refresh() {
  REFRESH_TOKEN="$1"
  REFRESH_JOB="$2"
  REFRESH_LEFT="$(number_or_zero "${3:-$MAP_REFRESH_TIMEOUT_SECONDS}")"
  REFRESH_PHASE="${4:-direct}"
  REFRESH_TOTAL="$REFRESH_LEFT"
  QUERY_SEEN_AT=0
  while [ "$REFRESH_LEFT" -gt 0 ]; do
    if refresh_marker_matches "$SCAN_READY" "$REFRESH_TOKEN"; then
      echo "[scan] $REFRESH_PHASE refresh ready target=$REFRESH_TOKEN source=object"
      return 0
    fi
    if refresh_marker_matches "$QUERY_READY" "$REFRESH_TOKEN"; then
      [ "$QUERY_SEEN_AT" -eq 0 ] && QUERY_SEEN_AT="$REFRESH_LEFT"
      QUERY_AGE=$((QUERY_SEEN_AT - REFRESH_LEFT))
      if [ "$QUERY_AGE" -ge "$(number_or_zero "$MAP_REFRESH_SETTLE_SECONDS")" ]; then
        echo "[scan] $REFRESH_PHASE refresh ready target=$REFRESH_TOKEN source=query"
        return 0
      fi
    fi
    sleep 1
    REFRESH_LEFT=$((REFRESH_LEFT - 1))
    REFRESH_ELAPSED=$((REFRESH_TOTAL - REFRESH_LEFT))
    if [ "$REFRESH_PHASE" = "fallback" ] && [ "$REFRESH_ELAPSED" -eq 10 ]; then
      game_keyevent KEYCODE_ENTER
      game_keyevent KEYCODE_DPAD_CENTER
    fi
    # After a reboot, Pikmin may stay on the two touch-only "continue" screens
    # even though Android reports the Unity activity as resumed. Only tap while
    # the fallback still has no map-query/object marker, so normal scans are not
    # disturbed once the map is actually ready.
    if [ "$REFRESH_PHASE" = "fallback" ] && [ "$REFRESH_ELAPSED" -eq 15 ]; then
      game_tap "$STARTUP_TAP_X" "$STARTUP_CONTINUE_Y" || true
    fi
    if [ "$REFRESH_PHASE" = "fallback" ] && [ "$REFRESH_ELAPSED" -eq 22 ]; then
      game_tap "$STARTUP_TAP_X" "$STARTUP_LOGIN_CONTINUE_Y" || true
    fi
    if [ $((REFRESH_LEFT % 10)) -eq 0 ]; then
      CONTROL="$(scan_control)"
      case "$CONTROL" in
        pause|stop) return 2 ;;
      esac
    fi
  done
  echo "[scan] $REFRESH_PHASE refresh timeout target=$REFRESH_TOKEN"
  return 1
}

restart_game_for_scan() {
  RESTART_JOB="$1"
  RESTART_TOKEN="$2"
  echo "[scan] no new rows, restarting game session at current GPS"
  su -Z u:r:shell:s0 2000 -c "am force-stop $PKG" >/dev/null 2>&1
  sleep 2
  if [ "$MAP_REFRESH_EXPERIMENT" = "1" ]; then
    rm -f "$SCAN_READY" "$QUERY_READY"
  fi
  launch_game
  if [ "$MAP_REFRESH_EXPERIMENT" = "1" ]; then
    wait_for_map_refresh "$RESTART_TOKEN" "$RESTART_JOB" \
      "$MAP_REFRESH_FALLBACK_TIMEOUT_SECONDS" fallback || return $?
    sleep 1
  else
    interruptible_wait 25 "$RESTART_JOB" || return 2
    game_keyevent KEYCODE_ENTER
    game_keyevent KEYCODE_DPAD_CENTER
    interruptible_wait 5 "$RESTART_JOB" || return 2
  fi
  [ -n "$(pidof "$PKG" 2>/dev/null)" ]
}

send_scan_ack() {
  ACK_JOB="$1"
  ACK_TARGET="$2"
  ACK_LEASE="$3"
  ACK_ROWS="$4"
  ACK_BYTES="$5"
  ACK_OK="$6"
  auth_curl -X POST --data-binary '' \
    "$SERVER_URL/api/agent/v2/ack?job_id=$ACK_JOB&target_id=$ACK_TARGET&lease=$ACK_LEASE&ok=$ACK_OK&rows=$ACK_ROWS&bytes=$ACK_BYTES" \
    >/dev/null 2>&1
}

retry_scan_ack() {
  [ -s "$SCAN_PENDING" ] || return 0
  PENDING="$(cat "$SCAN_PENDING" 2>/dev/null)"
  OLD_IFS="$IFS"
  IFS="$(printf '\t')"
  set -- $PENDING
  IFS="$OLD_IFS"
  if send_scan_ack "$1" "$2" "$3" "$4" "$5" 1; then
    rm -f "$SCAN_PENDING"
    echo "[scan] pending ACK completed job=$1 target=$2"
    return 0
  fi
  SCAN_JOB_ID="$1"
  SCAN_TARGET_ID="$2"
  SCAN_LEASE="$3"
  if [ "$(scan_control)" = "stop" ]; then
    rm -f "$SCAN_PENDING"
    echo "[scan] discarded pending ACK for stopped job=$1"
    return 0
  fi
  return 1
}

execute_scan_task() {
  JOB_ID="$1"
  TASK_TARGET_ID="$2"
  TASK_INDEX="$3"
  TASK_TOTAL="$4"
  TASK_LAT="$5"
  TASK_LNG="$6"
  TASK_DWELL="$7"
  TASK_DELAY="$8"
  TASK_COOLDOWN="$9"
  shift 9
  TASK_CYCLE="$1"
  TASK_LEASE="$2"
  TASK_COUNTRY="$3"
  TASK_CITY="$4"
  [ "$TASK_COUNTRY" = "-" ] && TASK_COUNTRY=""
  SCAN_JOB_ID="$JOB_ID"
  SCAN_TARGET_ID="$TASK_TARGET_ID"
  SCAN_LEASE="$TASK_LEASE"
  TASK_STARTED_AT="$(date +%s)"

  ensure_game_running
  BEFORE_SIZE="$(file_size)"
  BEFORE_LINES="$(useful_line_count)"
  if [ "$MAP_REFRESH_EXPERIMENT" = "1" ] && [ "$TASK_COOLDOWN" -gt 0 ]; then
    echo "[scan] cross-city cooldown ${TASK_COOLDOWN}s before direct refresh"
    interruptible_wait "$TASK_COOLDOWN" "$JOB_ID" || return
    TASK_COOLDOWN=0
  fi
  TELEPORT_VALUE="$TASK_LAT,$TASK_LNG"
  if [ "$MAP_REFRESH_EXPERIMENT" = "1" ]; then
    # A lease retry may receive the same target and coordinates. Use a fresh
    # per-attempt token so the native watcher reapplies GPS and emits new markers.
    REFRESH_TOKEN="$(date +%s)$(printf '%05d' $((TASK_TARGET_ID % 100000)))"
    TELEPORT_VALUE="$TASK_LAT,$TASK_LNG,$REFRESH_TOKEN"
  fi
  if [ "$MAP_REFRESH_EXPERIMENT" = "1" ]; then
    rm -f "$SCAN_READY" "$QUERY_READY"
  fi
  echo "$TELEPORT_VALUE" >"$TELEPORT"
  if [ "$(cat "$TELEPORT" 2>/dev/null)" != "$TELEPORT_VALUE" ]; then
    echo "[scan] GPS write failed job=$JOB_ID point=$TASK_INDEX"
    send_scan_ack "$JOB_ID" "$TASK_TARGET_ID" "$TASK_LEASE" 0 0 0
    return
  fi
  echo "[scan] $TASK_COUNTRY-$TASK_CITY $((TASK_INDEX + 1))/$TASK_TOTAL GPS=$TASK_LAT,$TASK_LNG"
  sleep 1
  game_keyevent KEYCODE_ENTER
  game_keyevent KEYCODE_DPAD_CENTER
  if [ "$TASK_COOLDOWN" -gt 0 ]; then
    echo "[scan] cross-city cooldown ${TASK_COOLDOWN}s"
    interruptible_wait "$TASK_COOLDOWN" "$JOB_ID" || return
  fi
  REFRESH_OK=0
  if [ "$MAP_REFRESH_EXPERIMENT" = "1" ]; then
    wait_for_map_refresh "$REFRESH_TOKEN" "$JOB_ID" \
      "$MAP_REFRESH_TIMEOUT_SECONDS" direct
    REFRESH_RESULT=$?
    [ "$REFRESH_RESULT" -eq 2 ] && return
    [ "$REFRESH_RESULT" -eq 0 ] && REFRESH_OK=1
  else
    interruptible_wait "$TASK_DWELL" "$JOB_ID" || return
  fi
  upload_new
  AFTER_SIZE="$(file_size)"
  AFTER_LINES="$(useful_line_count)"
  NEW_BYTES=$((AFTER_SIZE - BEFORE_SIZE))
  NEW_ROWS=$((AFTER_LINES - BEFORE_LINES))
  [ "$NEW_BYTES" -lt 0 ] && NEW_BYTES=0
  [ "$NEW_ROWS" -lt 0 ] && NEW_ROWS=0
  if [ "$MAP_REFRESH_EXPERIMENT" = "1" ] && [ "$REFRESH_OK" -eq 0 ]; then
    echo "[scan] direct refresh unavailable; using cold restart fallback"
    if restart_game_for_scan "$JOB_ID" "$REFRESH_TOKEN"; then
      upload_new
      AFTER_SIZE="$(file_size)"
      AFTER_LINES="$(useful_line_count)"
      NEW_BYTES=$((AFTER_SIZE - BEFORE_SIZE))
      NEW_ROWS=$((AFTER_LINES - BEFORE_LINES))
      [ "$NEW_BYTES" -lt 0 ] && NEW_BYTES=0
      [ "$NEW_ROWS" -lt 0 ] && NEW_ROWS=0
      echo "[scan] fallback captured rows=+$NEW_ROWS bytes=+$NEW_BYTES"
    else
      echo "[scan] fallback restart failed or was interrupted"
    fi
  elif [ "$MAP_REFRESH_EXPERIMENT" != "1" ] && [ "$NEW_ROWS" -eq 0 ]; then
    if restart_game_for_scan "$JOB_ID" ""; then
      upload_new
      AFTER_SIZE="$(file_size)"
      AFTER_LINES="$(useful_line_count)"
      NEW_BYTES=$((AFTER_SIZE - BEFORE_SIZE))
      NEW_ROWS=$((AFTER_LINES - BEFORE_LINES))
      [ "$NEW_BYTES" -lt 0 ] && NEW_BYTES=0
      [ "$NEW_ROWS" -lt 0 ] && NEW_ROWS=0
      echo "[scan] recovery captured rows=+$NEW_ROWS bytes=+$NEW_BYTES"
    else
      echo "[scan] recovery restart failed or was interrupted"
    fi
  fi
  interruptible_wait "$TASK_DELAY" "$JOB_ID" || return
  printf '%s\t%s\t%s\t%s\t%s\n' \
    "$JOB_ID" "$TASK_TARGET_ID" "$TASK_LEASE" "$NEW_ROWS" "$NEW_BYTES" >"$SCAN_PENDING"
  if send_scan_ack "$JOB_ID" "$TASK_TARGET_ID" "$TASK_LEASE" "$NEW_ROWS" "$NEW_BYTES" 1; then
    rm -f "$SCAN_PENDING"
    TASK_FINISHED_AT="$(date +%s)"
    TASK_ELAPSED=$((TASK_FINISHED_AT - TASK_STARTED_AT))
    if [ "$MAP_REFRESH_EXPERIMENT" = "1" ]; then
      [ "$REFRESH_OK" -eq 1 ] && TASK_MODE="direct" || TASK_MODE="fallback"
    else
      TASK_MODE="legacy"
    fi
    echo "[scan] completed point=$((TASK_INDEX + 1)) rows=+$NEW_ROWS bytes=+$NEW_BYTES mode=$TASK_MODE elapsed=${TASK_ELAPSED}s"
  else
    echo "[scan] ACK pending job=$JOB_ID point=$TASK_INDEX"
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
      if game_keyevent KEYCODE_ENTER && game_keyevent KEYCODE_DPAD_CENTER; then
        ack "$seq" 1 "" ""
      else
        ack "$seq" 0 "" ""
      fi
      ;;
    restart)
      OLD_PID="$(pidof "$PKG" 2>/dev/null)"
      su -Z u:r:shell:s0 2000 -c "am force-stop $PKG"
      sleep 2
      launch_game
      sleep 25
      game_keyevent KEYCODE_ENTER
      game_keyevent KEYCODE_DPAD_CENTER
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

echo "[agent] started id=$AGENT_ID version=$AGENT_VERSION server=$SERVER_URL"
while true; do
  upload_new
  if [ "$AGENT_ID" = "primary" ]; then
    COMMAND="$(auth_curl "$SERVER_URL/api/agent/command?since=$LAST_SEQ" 2>/dev/null)"
    if [ -n "$COMMAND" ]; then
      OLD_IFS="$IFS"
      IFS="$(printf '\t')"
      set -- $COMMAND
      IFS="$OLD_IFS"
      execute_command "$1" "$2" "$3" "$4"
    fi
  fi
  if retry_scan_ack; then
    TASK="$(auth_curl "$SERVER_URL/api/agent/v2/task" 2>/dev/null)"
    if [ -n "$TASK" ]; then
      OLD_IFS="$IFS"
      IFS="$(printf '\t')"
      set -- $TASK
      IFS="$OLD_IFS"
      case "$2" in
        target)
          execute_scan_task "$1" "$3" "$4" "$5" "$6" "$7" "$8" "$9" \
            "${10}" "${11}" "${12}" "${13}" "${14}"
          ;;
        pause|wait|'') ;;
        error) echo "[scan] cloud scan plan error job=$1" ;;
      esac
    fi
  fi
  sleep "$POLL_SECONDS"
done
