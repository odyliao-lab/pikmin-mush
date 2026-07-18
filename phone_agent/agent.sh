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
SCAN_PENDING="$MODDIR/scan.pending"

if [ ! -f "$CONFIG" ]; then
  echo "[agent] missing $CONFIG"
  exit 1
fi
. "$CONFIG"

POLL_SECONDS="${POLL_SECONDS:-2}"
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
    return
  fi
  TOP="$(su -Z u:r:shell:s0 2000 -c "dumpsys activity activities" 2>/dev/null |
    grep mResumedActivity | head -n 1)"
  case "$TOP" in
    *"$PKG"*) ;;
    *)
      su -Z u:r:shell:s0 2000 -c \
        "monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1
      sleep 8
      ;;
  esac
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

restart_game_for_scan() {
  RESTART_JOB="$1"
  echo "[scan] no new rows, restarting game session at current GPS"
  su -Z u:r:shell:s0 2000 -c "am force-stop $PKG" >/dev/null 2>&1
  interruptible_wait 2 "$RESTART_JOB" || return 2
  su -Z u:r:shell:s0 2000 -c \
    "monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1
  interruptible_wait 25 "$RESTART_JOB" || return 2
  su -Z u:r:shell:s0 2000 -c "input keyevent KEYCODE_ENTER" >/dev/null 2>&1
  su -Z u:r:shell:s0 2000 -c "input keyevent KEYCODE_DPAD_CENTER" >/dev/null 2>&1
  interruptible_wait 5 "$RESTART_JOB" || return 2
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

  ensure_game_running
  BEFORE_SIZE="$(file_size)"
  BEFORE_LINES="$(useful_line_count)"
  echo "$TASK_LAT,$TASK_LNG" >"$TELEPORT"
  if [ "$(cat "$TELEPORT" 2>/dev/null)" != "$TASK_LAT,$TASK_LNG" ]; then
    echo "[scan] GPS write failed job=$JOB_ID point=$TASK_INDEX"
    send_scan_ack "$JOB_ID" "$TASK_TARGET_ID" "$TASK_LEASE" 0 0 0
    return
  fi
  echo "[scan] $TASK_COUNTRY-$TASK_CITY $((TASK_INDEX + 1))/$TASK_TOTAL GPS=$TASK_LAT,$TASK_LNG"
  sleep 3
  su -Z u:r:shell:s0 2000 -c "input keyevent KEYCODE_ENTER" >/dev/null 2>&1
  su -Z u:r:shell:s0 2000 -c "input keyevent KEYCODE_DPAD_CENTER" >/dev/null 2>&1
  if [ "$TASK_COOLDOWN" -gt 0 ]; then
    echo "[scan] cross-city cooldown ${TASK_COOLDOWN}s"
    interruptible_wait "$TASK_COOLDOWN" "$JOB_ID" || return
  fi
  interruptible_wait "$TASK_DWELL" "$JOB_ID" || return
  upload_new
  AFTER_SIZE="$(file_size)"
  AFTER_LINES="$(useful_line_count)"
  NEW_BYTES=$((AFTER_SIZE - BEFORE_SIZE))
  NEW_ROWS=$((AFTER_LINES - BEFORE_LINES))
  [ "$NEW_BYTES" -lt 0 ] && NEW_BYTES=0
  [ "$NEW_ROWS" -lt 0 ] && NEW_ROWS=0
  if [ "$NEW_ROWS" -eq 0 ]; then
    if restart_game_for_scan "$JOB_ID"; then
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
    echo "[scan] completed point=$((TASK_INDEX + 1)) rows=+$NEW_ROWS bytes=+$NEW_BYTES"
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
