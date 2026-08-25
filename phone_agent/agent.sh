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
PAUSE_FILE="$MODDIR/pause.until"
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
MAP_REFRESH_FALLBACK_TIMEOUT_SECONDS="${MAP_REFRESH_FALLBACK_TIMEOUT_SECONDS:-60}"
QUERY_ONLY_RESTART_STREAK="${QUERY_ONLY_RESTART_STREAK:-12}"
DISPLAY_QUERY_TIMEOUT_SECONDS="${DISPLAY_QUERY_TIMEOUT_SECONDS:-5}"
DISPLAY_READY_TIMEOUT_SECONDS="${DISPLAY_READY_TIMEOUT_SECONDS:-20}"
STARTUP_TAP_X="${STARTUP_TAP_X:-0}"
STARTUP_WARNING_Y="${STARTUP_WARNING_Y:-0}"
STARTUP_CONTINUE_Y="${STARTUP_CONTINUE_Y:-0}"
STARTUP_LOGIN_CONTINUE_Y="${STARTUP_LOGIN_CONTINUE_Y:-0}"
# 一般重啟（非跨日第一次）預設會停在首頁儀表板，不是即時地圖畫面——
# RegisterMapObject 在儀表板/任何彈窗下都不會觸發，即使 GPS 覆寫與地圖查詢
# 仍正常運作。MAP_VIEW_TAP 是儀表板上的羅盤／探索圖示，點下去才會進地圖，
# 已於實機驗證多次可靠。
MAP_VIEW_TAP_X="${MAP_VIEW_TAP_X:-0}"
MAP_VIEW_TAP_Y="${MAP_VIEW_TAP_Y:-0}"
# Niantic 的移動過快偵測（「由於移動速度太快，一部分的遊玩將被限制」／
# 「我不是司機」）在長時間高速瞬移後可能出現，觸控關閉，不吃 ENTER/DPAD_CENTER。
SPEED_WARNING_TAP_X="${SPEED_WARNING_TAP_X:-0}"
SPEED_WARNING_TAP_Y="${SPEED_WARNING_TAP_Y:-0}"
# Pikmin 151.0 can automatically open a full-screen notification card after
# a warning/restart. Its close button overlaps the dashboard menu, so never
# tap it blindly. When enabled, inspect a few framebuffer pixels around the
# configured close-button centre and only dismiss a visibly white close
# circle. This is deliberately opt-in per device until calibrated.
NOTIFICATION_OVERLAY_DETECTION="${NOTIFICATION_OVERLAY_DETECTION:-0}"
NOTIFICATION_CLOSE_TAP_X="${NOTIFICATION_CLOSE_TAP_X:-0}"
NOTIFICATION_CLOSE_TAP_Y="${NOTIFICATION_CLOSE_TAP_Y:-0}"
NOTIFICATION_PIXEL_BRIGHTNESS_MIN="${NOTIFICATION_PIXEL_BRIGHTNESS_MIN:-230}"
# 以下三組座標目前「不會」被自動點擊（2026-08-20 實測發現它們的按鈕 Y 座標
# 常跟其他畫面的真實功能鍵重疊，誤觸風險高於效益，只在跨日第一次啟動這個
# 罕見情境才用得到）。保留設定供未來手動調整或重新設計更安全的偵測方式之後
# 再啟用；目前跨日第一次啟動就交給既有的 QUERY_ONLY_RESTART_STREAK 冷重啟
# 迴圈多試幾次頂過去。
RECAP_CONFIRM_TAP_X="${RECAP_CONFIRM_TAP_X:-0}"
RECAP_CONFIRM_TAP_Y="${RECAP_CONFIRM_TAP_Y:-0}"
MOOD_TAP_X="${MOOD_TAP_X:-0}"
MOOD_TAP_Y="${MOOD_TAP_Y:-0}"
SHARE_CLOSE_TAP_X="${SHARE_CLOSE_TAP_X:-0}"
SHARE_CLOSE_TAP_Y="${SHARE_CLOSE_TAP_Y:-0}"
SYSTEM_GPS_OVERRIDE="${SYSTEM_GPS_OVERRIDE:-0}"
# Android 9 does not expose the newer `cmd location providers` shell command.
# When configured, a local explicit-only bridge App owns the mock-location
# AppOp and writes the GPS test provider for this Agent.
GPS_BRIDGE_PACKAGE="${GPS_BRIDGE_PACKAGE:-}"
MAGISK_SU="${MAGISK_SU:-/sbin/su}"
if [ ! -x "$MAGISK_SU" ]; then
  MAGISK_SU="$(command -v su 2>/dev/null)"
fi
AGENT_ID="${AGENT_ID:-primary}"
AGENT_VERSION="${AGENT_VERSION:-2.2.0}"
GAME_VERSION="${GAME_VERSION:-$(dumpsys package "$PKG" 2>/dev/null |
  sed -n 's/^[[:space:]]*versionName=//p' | head -n 1 | tr -d '\r')}"
MODULE_VERSION="${MODULE_VERSION:-151.0}"
QUERY_ONLY_STREAK=0
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
    -H "X-Agent-Version: $AGENT_VERSION" \
    -H "X-Game-Version: $GAME_VERSION" \
    -H "X-Module-Version: $MODULE_VERSION" "$@"
}

# Magisk service scripts run as root but often inherit a minimal PATH.  Every
# UI/location command must still execute as Android's shell UID, with the
# platform command path restored.  Without this helper Android 9 accepts the
# Agent loop but silently leaves Pikmin on its startup overlay.
run_as_shell() {
  [ -n "$MAGISK_SU" ] && [ -x "$MAGISK_SU" ] || return 127
  "$MAGISK_SU" -Z u:r:shell:s0 2000 -c \
    "PATH=/system/bin:/system/xbin:/vendor/bin:/sbin; export PATH; $1"
}

# `timeout <n> run_as_shell "..."` does not work: run_as_shell is a shell
# function, not something timeout(1) can exec (it fails with "No such file
# or directory", exit 127, on every call). This wraps the timeout around
# the actual su binary instead, which timeout(1) can exec. Use this any
# place that previously combined `timeout ... run_as_shell ...`.
run_as_shell_timeout() {
  RUN_TIMEOUT_SECONDS="$1"
  shift
  [ -n "$MAGISK_SU" ] && [ -x "$MAGISK_SU" ] || return 127
  timeout -k 2 "$RUN_TIMEOUT_SECONDS" "$MAGISK_SU" -Z u:r:shell:s0 2000 -c \
    "PATH=/system/bin:/system/xbin:/vendor/bin:/sbin; export PATH; $1"
}

ensure_system_gps_provider() {
  [ "$SYSTEM_GPS_OVERRIDE" = "1" ] || return 0
  appops set 2000 android:mock_location allow >/dev/null 2>&1 || return 1
  run_as_shell \
    "cmd location providers add-test-provider gps --requiresSatellite --supportsAltitude --supportsSpeed --supportsBearing --powerRequirement 3" \
    >/dev/null 2>&1 || true
  run_as_shell \
    "cmd location providers set-test-provider-enabled gps true" \
    >/dev/null 2>&1
}

set_system_gps() {
  SYSTEM_LAT="$1"
  SYSTEM_LNG="$2"
  case "$SYSTEM_LAT,$SYSTEM_LNG" in
    *[!0-9+.,-]*) return 1 ;;
  esac
  if [ "$SYSTEM_GPS_OVERRIDE" = "1" ]; then
    run_as_shell \
      "cmd location providers set-test-provider-location gps --location $SYSTEM_LAT,$SYSTEM_LNG --accuracy 3" \
      >/dev/null 2>&1 || return 1
  fi
  [ -n "$GPS_BRIDGE_PACKAGE" ] || return 0
  BRIDGE_TOKEN="$(date +%s)$$"
  # The bridge is explicit-only and has no network permission. Its package
  # owns the Android mock-location AppOp, so Android 9 can receive the same
  # system GPS updates as newer Agents without relying on `cmd location`.
  BRIDGE_OUTPUT="$(run_as_shell \
    "am broadcast --user 0 -n $GPS_BRIDGE_PACKAGE/.GpsCommandReceiver \
      -a $GPS_BRIDGE_PACKAGE.SET_LOCATION --es lat $SYSTEM_LAT --es lng $SYSTEM_LNG \
      --es token $BRIDGE_TOKEN" 2>&1)" || return 1
  # Android 9's ActivityManager reports -1 only when the receiver completed
  # successfully. Do not ACK a phantom move when the bridge rejected a write.
  echo "$BRIDGE_OUTPUT" | grep -q 'result=-1' || {
    echo "[scan] GPS bridge rejected location: $BRIDGE_OUTPUT"
    return 1
  }
}

refresh_local_pause() {
  LOCAL_PAUSE_KIND=""
  LOCAL_PAUSE_REMAINING=0
  [ -s "$PAUSE_FILE" ] || return 1
  LOCAL_PAUSE_VALUE="$(tr -d '\r\n ' <"$PAUSE_FILE" 2>/dev/null)"
  if [ "$LOCAL_PAUSE_VALUE" = "manual" ]; then
    LOCAL_PAUSE_KIND="manual"
    return 0
  fi
  case "$LOCAL_PAUSE_VALUE" in
    ''|*[!0-9]*) rm -f "$PAUSE_FILE"; return 1 ;;
  esac
  LOCAL_PAUSE_NOW="$(date +%s)"
  if [ "$LOCAL_PAUSE_VALUE" -le "$LOCAL_PAUSE_NOW" ]; then
    rm -f "$PAUSE_FILE"
    return 1
  fi
  LOCAL_PAUSE_KIND="timed"
  LOCAL_PAUSE_REMAINING=$((LOCAL_PAUSE_VALUE - LOCAL_PAUSE_NOW))
  return 0
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
  DISPLAY_LIST="$(run_as_shell_timeout "$DISPLAY_QUERY_TIMEOUT_SECONDS" \
    "cmd display get-displays" 2>/dev/null)" || DISPLAY_LIST=""
  if ! echo "$DISPLAY_LIST" | grep -q "Display id $DISPLAY_ID:"; then
    # Android 12 does not implement `cmd display get-displays`. Fall back to
    # DisplayManagerService so a valid virtual display is not mistaken for a
    # missing one and the game is never launched on the physical screen.
    DISPLAY_LIST="$(run_as_shell_timeout "$DISPLAY_QUERY_TIMEOUT_SECONDS" \
      "dumpsys display" 2>/dev/null)" || return 1
    echo "$DISPLAY_LIST" | grep -q "mDisplayId=$DISPLAY_ID" || return 1
  fi
  echo "$DISPLAY_ID"
}

wait_for_game_display() {
  DISPLAY_WAITED=0
  while [ "$DISPLAY_WAITED" -lt "$DISPLAY_READY_TIMEOUT_SECONDS" ]; do
    DISPLAY_ID="$(game_display_id)"
    if [ -n "$DISPLAY_ID" ]; then
      echo "$DISPLAY_ID"
      return 0
    fi
    sleep 1
    DISPLAY_WAITED=$((DISPLAY_WAITED + 1))
  done
  return 1
}

launch_game() {
  if [ "$LOCAL_DISPLAY" = "1" ]; then
    DISPLAY_ID="$(wait_for_game_display)" || {
      echo "[display] virtual display unavailable; refusing physical launch"
      return 1
    }
  else
    DISPLAY_ID="$(game_display_id)"
  fi
  if [ -n "$DISPLAY_ID" ]; then
    run_as_shell \
      "am start --display $DISPLAY_ID -n $PKG/$GAME_ACTIVITY" >/dev/null 2>&1
  else
    run_as_shell \
      "monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1
  fi
}

game_keyevent() {
  KEY_NAME="$1"
  DISPLAY_ID="$(game_display_id)"
  if [ "$LOCAL_DISPLAY" = "1" ] && [ -z "$DISPLAY_ID" ]; then
    echo "[display] virtual display unavailable; refusing physical keyevent"
    return 1
  fi
  if [ -n "$DISPLAY_ID" ]; then
    run_as_shell \
      "input -d $DISPLAY_ID keyevent $KEY_NAME" >/dev/null 2>&1
  else
    run_as_shell \
      "input keyevent $KEY_NAME" >/dev/null 2>&1
  fi
}

game_tap() {
  TAP_X="$1"
  TAP_Y="$2"
  [ "$TAP_X" -gt 0 ] 2>/dev/null || return 1
  [ "$TAP_Y" -gt 0 ] 2>/dev/null || return 1
  DISPLAY_ID="$(game_display_id)"
  if [ "$LOCAL_DISPLAY" = "1" ] && [ -z "$DISPLAY_ID" ]; then
    echo "[display] virtual display unavailable; refusing physical tap"
    return 1
  fi
  if [ -n "$DISPLAY_ID" ]; then
    run_as_shell "input -d $DISPLAY_ID tap $TAP_X $TAP_Y" \
      >/dev/null 2>&1
  else
    run_as_shell "input tap $TAP_X $TAP_Y" >/dev/null 2>&1
  fi
}

# Unity exposes no useful accessibility nodes for its notification card.
# screencap's raw output begins with width, height, pixel-format and color
# space (four uint32 values), followed by RGBA_8888 pixels. A card close
# button is a white circle; the dashboard/menu at the same location is green.
# Keep this in a subshell so `set --` used while parsing does not affect the
# Agent's outer positional parameters.
notification_overlay_visible() (
  [ "$NOTIFICATION_OVERLAY_DETECTION" = "1" ] || exit 1
  [ "$NOTIFICATION_CLOSE_TAP_X" -gt 32 ] 2>/dev/null || exit 1
  [ "$NOTIFICATION_CLOSE_TAP_Y" -gt 32 ] 2>/dev/null || exit 1

  NOTIFY_RAW="/data/local/tmp/pikmin-notify-$$.raw"
  run_as_shell_timeout 5 "screencap $NOTIFY_RAW" >/dev/null 2>&1 || {
    rm -f "$NOTIFY_RAW"
    exit 1
  }
  set -- $(od -An -N 8 -tu4 "$NOTIFY_RAW" 2>/dev/null)
  NOTIFY_WIDTH="$1"
  NOTIFY_HEIGHT="$2"
  case "$NOTIFY_WIDTH" in
    ''|*[!0-9]*|0)
      rm -f "$NOTIFY_RAW"
      exit 1
      ;;
  esac
  case "$NOTIFY_HEIGHT" in
    ''|*[!0-9]*|0)
      rm -f "$NOTIFY_RAW"
      exit 1
      ;;
  esac

  NOTIFY_BRIGHT_SAMPLES=0
  for NOTIFY_SAMPLE in \
    "$NOTIFICATION_CLOSE_TAP_X,$((NOTIFICATION_CLOSE_TAP_Y - 30))" \
    "$NOTIFICATION_CLOSE_TAP_X,$((NOTIFICATION_CLOSE_TAP_Y + 30))" \
    "$((NOTIFICATION_CLOSE_TAP_X - 30)),$NOTIFICATION_CLOSE_TAP_Y" \
    "$((NOTIFICATION_CLOSE_TAP_X + 30)),$NOTIFICATION_CLOSE_TAP_Y"; do
    NOTIFY_X="${NOTIFY_SAMPLE%,*}"
    NOTIFY_Y="${NOTIFY_SAMPLE#*,}"
    [ "$NOTIFY_X" -ge 0 ] 2>/dev/null && [ "$NOTIFY_X" -lt "$NOTIFY_WIDTH" ] 2>/dev/null || continue
    [ "$NOTIFY_Y" -ge 0 ] 2>/dev/null && [ "$NOTIFY_Y" -lt "$NOTIFY_HEIGHT" ] 2>/dev/null || continue
    NOTIFY_OFFSET=$((16 + ((NOTIFY_Y * NOTIFY_WIDTH + NOTIFY_X) * 4)))
    set -- $(dd if="$NOTIFY_RAW" bs=1 skip="$NOTIFY_OFFSET" count=4 2>/dev/null | od -An -tu1 2>/dev/null)
    [ "$#" -eq 4 ] || continue
    if [ "$1" -ge "$NOTIFICATION_PIXEL_BRIGHTNESS_MIN" ] 2>/dev/null && \
       [ "$2" -ge "$NOTIFICATION_PIXEL_BRIGHTNESS_MIN" ] 2>/dev/null && \
       [ "$3" -ge "$NOTIFICATION_PIXEL_BRIGHTNESS_MIN" ] 2>/dev/null; then
      NOTIFY_BRIGHT_SAMPLES=$((NOTIFY_BRIGHT_SAMPLES + 1))
    fi
  done
  rm -f "$NOTIFY_RAW"
  [ "$NOTIFY_BRIGHT_SAMPLES" -ge 3 ]
)

dismiss_notification_overlay_if_visible() {
  if notification_overlay_visible; then
    echo "[scan] notification overlay detected; closing safely x=$NOTIFICATION_CLOSE_TAP_X y=$NOTIFICATION_CLOSE_TAP_Y"
    if game_tap "$NOTIFICATION_CLOSE_TAP_X" "$NOTIFICATION_CLOSE_TAP_Y"; then
      echo "[scan] notification overlay close tap sent"
      # Unity can drop the first touch immediately after a framebuffer read.
      # Retry exactly once, but only after proving that the same card remains;
      # never send a second blind tap to the overlapping dashboard menu.
      sleep 2
      if notification_overlay_visible; then
        echo "[scan] notification overlay still visible; retrying close tap"
        game_tap "$NOTIFICATION_CLOSE_TAP_X" "$NOTIFICATION_CLOSE_TAP_Y" || \
          echo "[scan] notification overlay retry tap failed"
      fi
      return 0
    fi
    echo "[scan] notification overlay close tap failed"
  fi
  return 1
}

# 2026-08-20 現場測試教訓，記在這裡因為它決定了下面 wait_for_map_refresh
# fallback 分支的寫法，不是只是背景知識：
# 1) 固定座標點擊「不是」無害的 no-op——這款遊戲不同畫面的底部/中段功能列
#    常常共用相近的 Y 座標（地圖畫面右側捷徑欄、事件頁籤列、首頁儀表板的
#    「完成N場探險」進度條都落在同一段 Y 範圍），畫面跟預期不同時點擊會
#    誤觸別的畫面上真實存在的功能鍵，而不是點在空白處——包括既有、已在
#    正式機隊沿用的 STARTUP_WARNING_Y/STARTUP_CONTINUE_Y 座標，實測也曾誤
#    觸「完成N場探險」進度條、被帶去活動頁面。
# 2) KEYCODE_BACK 不是通用安全牌：從地圖畫面按 BACK 會回到首頁儀表板，但
#    從儀表板（沒有更上層畫面可退）按 BACK 會把遊戲整個切到背景、跳出到
#    桌面或其他 App——比任何誤觸都更糟（掃描完全停擺，需要人工切回遊戲），
#    因此完全不用 KEYCODE_BACK。
# 3) 因為每次點擊都有誤觸風險，「重複掃描、期待某輪會對」的設計是在放大
#    風險而不是收斂——所以下面沿用原本的寫法：每個座標只在固定的一個時間
#    點各點一次，不是每 20 秒重複整輪。這跟既有 STARTUP_* 三個座標的風險
#    profile 一致，沒有讓情況變得更糟，只是多涵蓋了新發現的兩種畫面。
#
# 每日跨零點第一次啟動才會出現的步數回顧（計數動畫可長達 60-90 秒）、心情
# 打卡、分享卡，目前**刻意不**自動點擊收斂——這三個畫面的按鈕座標跟地圖/
# 儀表板真實功能鍵重疊的風險最高，且只影響「跨日後第一個掃描點」，讓
# QUERY_ONLY_RESTART_STREAK 用既有的冷重啟迴圈多重試幾次去等它自然過去，
# 比冒著誤觸或跳出遊戲的風險更安全。座標留在 config.example 供手動調整或
# 未來設計出更安全的偵測方式後再啟用。

game_is_resumed() {
  run_as_shell "dumpsys activity activities" 2>/dev/null |
    grep -E 'topResumedActivity|ResumedActivity:' |
    grep -q "$PKG"
}

game_is_on_display() {
  EXPECTED_DISPLAY_ID="$1"
  case "$EXPECTED_DISPLAY_ID" in ''|*[!0-9]*) return 1 ;; esac
  run_as_shell "am stack list" 2>/dev/null |
    awk -v wanted="$EXPECTED_DISPLAY_ID" -v package="$PKG" '
      /RootTask id=/ {
        on_display = index($0, "displayId=" wanted " ") > 0 ||
          $0 ~ ("displayId=" wanted "$")
      }
      on_display && index($0, package) > 0 { found = 1 }
      END { exit(found ? 0 : 1) }
    '
}

ensure_game_running() {
  if [ "$LOCAL_DISPLAY" = "1" ]; then
    EXPECTED_DISPLAY_ID="$(wait_for_game_display)" || {
      echo "[display] virtual display unavailable; game cannot be verified"
      return 1
    }
    if pidof "$PKG" >/dev/null 2>&1 &&
        ! game_is_on_display "$EXPECTED_DISPLAY_ID"; then
      echo "[display] game is on the wrong display; recreating on id=$EXPECTED_DISPLAY_ID"
      run_as_shell "am force-stop $PKG" >/dev/null 2>&1
      sleep 2
    fi
  fi
  if ! pidof "$PKG" >/dev/null 2>&1; then
    launch_game || return 1
    sleep 25
  elif ! game_is_resumed; then
    launch_game || return 1
    sleep 8
  fi
  # Android 9 can report the Unity activity as resumed while the game still
  # displays a touch-only startup or speed-warning overlay. These are harmless
  # no-ops on the live map and make every scan point self-healing after a
  # reboot/session restart.
  game_keyevent KEYCODE_ENTER || true
  game_keyevent KEYCODE_DPAD_CENTER || true
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
  # Control polling is advisory during dwell/refresh waits. Keep its timeout
  # short so a slow control endpoint cannot stretch a bounded map refresh into
  # several minutes. Empty/error responses fail open; lease validation still
  # happens on the normal task and ACK requests.
  /system/bin/curl -fsS --connect-timeout 3 --max-time 5 \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Agent-Id: $AGENT_ID" \
    -H "X-Agent-Version: $AGENT_VERSION" \
    -H "X-Game-Version: $GAME_VERSION" \
    -H "X-Module-Version: $MODULE_VERSION" \
    "$SERVER_URL/api/agent/v2/control?job_id=$SCAN_JOB_ID&target_id=$SCAN_TARGET_ID&lease=$SCAN_LEASE" \
    2>/dev/null
}

interruptible_wait() {
  WAIT_LEFT="$(number_or_zero "$1")"
  WAIT_JOB="$2"
  while [ "$WAIT_LEFT" -gt 0 ]; do
    refresh_local_pause && return 2
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
  REFRESH_SOURCE=""
  REFRESH_TOTAL="$REFRESH_LEFT"
  QUERY_SEEN_AT=0
  while [ "$REFRESH_LEFT" -gt 0 ]; do
    refresh_local_pause && return 2
    if refresh_marker_matches "$SCAN_READY" "$REFRESH_TOKEN"; then
      REFRESH_SOURCE="object"
      echo "[scan] $REFRESH_PHASE refresh ready target=$REFRESH_TOKEN source=object"
      return 0
    fi
    if refresh_marker_matches "$QUERY_READY" "$REFRESH_TOKEN"; then
      [ "$QUERY_SEEN_AT" -eq 0 ] && QUERY_SEEN_AT="$REFRESH_LEFT"
      QUERY_AGE=$((QUERY_SEEN_AT - REFRESH_LEFT))
      if [ "$QUERY_AGE" -ge "$(number_or_zero "$MAP_REFRESH_SETTLE_SECONDS")" ]; then
        REFRESH_SOURCE="query"
        echo "[scan] $REFRESH_PHASE refresh ready target=$REFRESH_TOKEN source=query"
        return 0
      fi
    fi
    sleep 1
    REFRESH_LEFT=$((REFRESH_LEFT - 1))
    REFRESH_ELAPSED=$((REFRESH_TOTAL - REFRESH_LEFT))
    # Ordering matters here, and is not arbitrary — this loop exits the
    # instant a marker appears, so whichever action fires FIRST and actually
    # works is the only one that ends up mattering; anything scheduled later
    # never gets a chance to run. 2026-08-20 testing found:
    #  - A plain app-level restart (restart_game_for_scan, i.e. the common
    #    case here — not a full device reboot) reliably lands on the home
    #    dashboard directly, not on any dialog. MAP_VIEW_TAP alone from a
    #    freshly-landed dashboard reliably opens the live map — verified
    #    repeatedly on-device.
    #  - STARTUP_WARNING_Y/STARTUP_CONTINUE_Y were designed for the two
    #    touch-only screens that follow an actual device reboot (see
    #    service.sh); firing them against a plain dashboard with no dialog
    #    present can instead land on the dashboard's own quest-progress bar
    #    and wander into an unrelated challenges/events menu — a real,
    #    previously-undiagnosed risk that predates this file's changes
    #    tonight, not something introduced by MAP_VIEW_TAP.
    #  - KEYCODE_BACK is not used anywhere here: from the dashboard root
    #    (no parent screen left to pop) it can send the whole app to the
    #    background instead of closing anything, which is worse than any
    #    mis-tap and would stall scanning until a human switches back.
    # So: try the cheap, high-confidence recovery (MAP_VIEW_TAP) first. Only
    # once that has had a fair chance and still no marker showed up do we
    # fall through to the reboot-specific taps, on the chance this really is
    # a post-reboot dialog rather than a plain dashboard. Each coordinate
    # fires exactly once per fallback attempt (not on a repeating timer) —
    # repeating the same blind guess would only compound whichever mistake
    # it made the first time.
    if [ "$REFRESH_PHASE" = "fallback" ] && [ "$REFRESH_ELAPSED" -eq 8 ]; then
      game_keyevent KEYCODE_ENTER
      game_keyevent KEYCODE_DPAD_CENTER
      game_tap "$MAP_VIEW_TAP_X" "$MAP_VIEW_TAP_Y" || true
    fi
    if [ "$REFRESH_PHASE" = "fallback" ] && [ "$REFRESH_ELAPSED" -eq 20 ]; then
      game_tap "$SPEED_WARNING_TAP_X" "$SPEED_WARNING_TAP_Y" || true
      game_tap "$STARTUP_TAP_X" "$STARTUP_WARNING_Y" || true
      game_tap "$STARTUP_TAP_X" "$STARTUP_CONTINUE_Y" || true
    fi
    if [ "$REFRESH_PHASE" = "fallback" ] && [ "$REFRESH_ELAPSED" -eq 30 ]; then
      game_tap "$STARTUP_TAP_X" "$STARTUP_LOGIN_CONTINUE_Y" || true
      game_tap "$MAP_VIEW_TAP_X" "$MAP_VIEW_TAP_Y" || true
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
  run_as_shell "am force-stop $PKG" >/dev/null 2>&1
  sleep 2
  if [ "$MAP_REFRESH_EXPERIMENT" = "1" ]; then
    rm -f "$SCAN_READY" "$QUERY_READY"
  fi
  launch_game || return 1
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

  if refresh_local_pause; then
    echo "[scan] local pause requested before point=$TASK_INDEX"
    return
  fi
  if ! set_system_gps "$TASK_LAT" "$TASK_LNG"; then
    echo "[scan] system GPS write failed job=$JOB_ID point=$TASK_INDEX"
    send_scan_ack "$JOB_ID" "$TASK_TARGET_ID" "$TASK_LEASE" 0 0 0
    return
  fi
  if ! ensure_game_running; then
    echo "[scan] game unavailable on configured display job=$JOB_ID point=$TASK_INDEX"
    send_scan_ack "$JOB_ID" "$TASK_TARGET_ID" "$TASK_LEASE" 0 0 0
    return
  fi
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
  if [ "$MAP_REFRESH_EXPERIMENT" = "1" ] && [ "$REFRESH_OK" -eq 1 ]; then
    if [ "$REFRESH_SOURCE" = "query" ] && [ "$NEW_ROWS" -eq 0 ]; then
      QUERY_ONLY_STREAK=$((QUERY_ONLY_STREAK + 1))
      echo "[scan] query-only empty streak=$QUERY_ONLY_STREAK/$QUERY_ONLY_RESTART_STREAK"
      # A map-query response proves that the GPS override and backend round trip
      # worked, but it does *not* prove that the live map is visible.  In 151.0
      # the speed/restricted-area acknowledgement can sit above the dashboard:
      # query callbacks still arrive there, while RegisterMapObject cannot run.
      # Do this bounded recovery on the first empty response instead of waiting
      # for twelve query-only points (which previously left an Agent idle for
      # several minutes behind one acknowledgement dialog).  The first tap
      # dismisses the known warning; the second opens the dashboard map.  Each
      # is made at most once per query-only streak, so it cannot become a blind
      # repeating tap loop on a different screen.
      if [ "$QUERY_ONLY_STREAK" -eq 1 ]; then
        echo "[scan] query-only recovery: dismiss warning and open map"
        game_tap "$SPEED_WARNING_TAP_X" "$SPEED_WARNING_TAP_Y" || true
        interruptible_wait 1 "$JOB_ID" || return
        if dismiss_notification_overlay_if_visible; then
          interruptible_wait 1 "$JOB_ID" || return
        fi
        game_tap "$MAP_VIEW_TAP_X" "$MAP_VIEW_TAP_Y" || true
      fi
      if [ "$QUERY_ONLY_STREAK" -ge "$(number_or_zero "$QUERY_ONLY_RESTART_STREAK")" ]; then
        echo "[scan] query-only streak reached; cold restarting game at current GPS"
        if restart_game_for_scan "$JOB_ID" "$REFRESH_TOKEN"; then
          upload_new
          AFTER_SIZE="$(file_size)"
          AFTER_LINES="$(useful_line_count)"
          NEW_BYTES=$((AFTER_SIZE - BEFORE_SIZE))
          NEW_ROWS=$((AFTER_LINES - BEFORE_LINES))
          [ "$NEW_BYTES" -lt 0 ] && NEW_BYTES=0
          [ "$NEW_ROWS" -lt 0 ] && NEW_ROWS=0
          echo "[scan] query-only recovery captured rows=+$NEW_ROWS bytes=+$NEW_BYTES"
        else
          echo "[scan] query-only recovery restart failed or was interrupted"
        fi
        QUERY_ONLY_STREAK=0
      fi
    else
      QUERY_ONLY_STREAK=0
    fi
  fi
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
      QUERY_ONLY_STREAK=0
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
        if ensure_game_running; then
          ack "$seq" 1 "$a" "$b"
        else
          ack "$seq" 0 "" ""
        fi
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
      run_as_shell "am force-stop $PKG"
      sleep 2
      if ! launch_game; then
        ack "$seq" 0 "" ""
        return 0
      fi
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

if ! ensure_system_gps_provider; then
  echo "[agent] system GPS provider setup failed"
  exit 1
fi
LOCAL_PAUSE_LOGGED=0
echo "[agent] started id=$AGENT_ID agent=$AGENT_VERSION game=${GAME_VERSION:-unknown} module=$MODULE_VERSION server=$SERVER_URL"
while true; do
  upload_new
  if refresh_local_pause; then
    if [ "$LOCAL_PAUSE_LOGGED" -eq 0 ]; then
      if [ "$LOCAL_PAUSE_KIND" = "manual" ]; then
        echo "[agent] locally paused until manual resume"
      else
        echo "[agent] locally paused remaining=${LOCAL_PAUSE_REMAINING}s"
      fi
      LOCAL_PAUSE_LOGGED=1
    fi
    sleep "$POLL_SECONDS"
    continue
  fi
  if [ "$LOCAL_PAUSE_LOGGED" -eq 1 ]; then
    echo "[agent] local pause ended; resuming"
    LOCAL_PAUSE_LOGGED=0
  fi
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
        version-mismatch) echo "[scan] version mismatch: $3" ;;
        error) echo "[scan] cloud scan plan error job=$1" ;;
      esac
    fi
  fi
  sleep "$POLL_SECONDS"
done
