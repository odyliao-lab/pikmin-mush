#!/system/bin/sh

set -u

ACTION="${1:-status}"
BASE_DIR="${PIKMIN_LOCAL_DISPLAY_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)}"
RUNTIME_DIR="${PIKMIN_LOCAL_DISPLAY_RUNTIME:-/data/local/tmp/pikmin-local-display-runtime}"
SERVER_JAR="$BASE_DIR/scrcpy-server"
DRAIN_BIN="$BASE_DIR/localvd-drain"
SERVER_PID_FILE="$RUNTIME_DIR/server.pid"
DRAIN_PID_FILE="$RUNTIME_DIR/drain.pid"
DAEMON_PID_FILE="$RUNTIME_DIR/daemon.pid"
SERVER_LOG="$RUNTIME_DIR/server.log"
DRAIN_LOG="$RUNTIME_DIR/drain.log"
DAEMON_LOG="$BASE_DIR/local-display-daemon.log"
DISPLAY_FILE="/data/adb/modules/pikmin_scanner_agent/game.display"
SCID="50494b4d"
SOCKET_NAME="scrcpy_$SCID"
SIZE="${PIKMIN_LOCAL_DISPLAY_SIZE:-720x1600}"
DPI="${PIKMIN_LOCAL_DISPLAY_DPI:-320}"
PACKAGE="com.nianticlabs.pikmin"
ACTIVITY="com.nianticproject.ichigo.IchigoUnityPlayerActivity"

alive() {
  pid="$(cat "$1" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  command_line="$(tr '\000' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true)"
  case "$1" in
    *server.pid) echo "$command_line" | grep -Eq 'scrcpy.Server|local-display.sh internal-server' ;;
    *drain.pid) echo "$command_line" | grep -Eq 'localvd-drain|local-display.sh internal-drain' ;;
    *daemon.pid) echo "$command_line" | grep -q 'local-display.sh daemon' ;;
    *) return 1 ;;
  esac
}

display_present() {
  [ -n "$1" ] && dumpsys display 2>/dev/null | grep -Eq "mDisplayId=$1([^0-9]|$)"
}

stop_worker() {
  pid_file="$1"
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if ! alive "$pid_file"; then
    rm -f "$pid_file"
    return 0
  fi

  kill "$pid" 2>/dev/null || true
  attempt=0
  while alive "$pid_file" && [ "$attempt" -lt 50 ]; do
    sleep 0.1
    attempt=$((attempt + 1))
  done
  if alive "$pid_file"; then
    kill -9 "$pid" 2>/dev/null || true
    attempt=0
    while alive "$pid_file" && [ "$attempt" -lt 20 ]; do
      sleep 0.1
      attempt=$((attempt + 1))
    done
  fi
  if alive "$pid_file"; then
    echo "Worker did not stop: $pid" >&2
    return 1
  fi
  rm -f "$pid_file"
}

stop_workers() {
  old_display_id="$(display_id_from_log)"
  stop_worker "$DRAIN_PID_FILE" || return 1
  stop_worker "$SERVER_PID_FILE" || return 1
  attempt=0
  while display_present "$old_display_id" && [ "$attempt" -lt 50 ]; do
    sleep 0.1
    attempt=$((attempt + 1))
  done
  if display_present "$old_display_id"; then
    echo "Virtual display did not disappear: $old_display_id" >&2
    return 1
  fi
}

display_id_from_log() {
  sed -n 's/.*New display: .* (id=\([0-9][0-9]*\)).*/\1/p' "$SERVER_LOG" 2>/dev/null | tail -n 1
}

case "$ACTION" in
  internal-server)
    echo $$ > "$SERVER_PID_FILE"
    export CLASSPATH="$SERVER_JAR"
    exec app_process / com.genymobile.scrcpy.Server 4.1 \
      scid="$SCID" tunnel_forward=true log_level=info \
      video_bit_rate=100000 max_fps=1 audio=false control=false \
      send_device_meta=false send_frame_meta=false send_dummy_byte=false \
      cleanup=false new_display="$SIZE/$DPI" vd_destroy_content=false \
      stay_awake=true keep_active=true
    ;;
  internal-drain)
    echo $$ > "$DRAIN_PID_FILE"
    exec "$DRAIN_BIN" "$SOCKET_NAME"
    ;;
  start)
    if alive "$SERVER_PID_FILE" && alive "$DRAIN_PID_FILE"; then
      display_id="$(display_id_from_log)"
      if display_present "$display_id"; then
        echo "$display_id" > "$DISPLAY_FILE"
        chmod 600 "$DISPLAY_FILE"
        echo "Local display already running (id=$display_id)."
        exit 0
      fi
    fi

    stop_workers || exit 1

    [ -r "$SERVER_JAR" ] || { echo "Missing $SERVER_JAR" >&2; exit 1; }
    [ -x "$DRAIN_BIN" ] || { echo "Missing executable $DRAIN_BIN" >&2; exit 1; }

    mkdir -p "$RUNTIME_DIR"
    chmod 700 "$RUNTIME_DIR"
    rm -f "$SERVER_PID_FILE" "$DRAIN_PID_FILE" "$SERVER_LOG" "$DRAIN_LOG"

    nohup setsid "$BASE_DIR/local-display.sh" internal-server \
      >"$SERVER_LOG" 2>&1 </dev/null &
    echo $! > "$SERVER_PID_FILE"
    attempt=0
    while [ "$attempt" -lt 50 ]; do
      alive "$SERVER_PID_FILE" || { cat "$SERVER_LOG" >&2; exit 1; }
      [ -s "$SERVER_LOG" ] && break
      sleep 0.1
      attempt=$((attempt + 1))
    done

    attempt=0
    while [ "$attempt" -lt 60 ]; do
      rm -f "$DRAIN_PID_FILE" "$DRAIN_LOG"
      nohup setsid "$BASE_DIR/local-display.sh" internal-drain \
        >"$DRAIN_LOG" 2>&1 </dev/null &
      echo $! > "$DRAIN_PID_FILE"
      sleep 0.5
      alive "$DRAIN_PID_FILE" && break
      sleep 0.5
      attempt=$((attempt + 1))
    done
    alive "$DRAIN_PID_FILE" || { cat "$DRAIN_LOG" >&2; exit 1; }

    attempt=0
    display_id=""
    while [ "$attempt" -lt 300 ]; do
      display_id="$(display_id_from_log)"
      [ -n "$display_id" ] && break
      alive "$SERVER_PID_FILE" || { cat "$SERVER_LOG" >&2; exit 1; }
      alive "$DRAIN_PID_FILE" || { cat "$DRAIN_LOG" >&2; exit 1; }
      sleep 0.1
      attempt=$((attempt + 1))
    done
    [ -n "$display_id" ] || { echo "Display id was not reported." >&2; exit 1; }

    echo "$display_id" > "$DISPLAY_FILE"
    chmod 600 "$DISPLAY_FILE"
    am start --display "$display_id" -n "$PACKAGE/$ACTIVITY" >/dev/null
    echo "Local display started (id=$display_id)."
    ;;
  start-daemon)
    mkdir -p "$RUNTIME_DIR"
    if alive "$DAEMON_PID_FILE"; then
      echo "Local display daemon already running (pid=$(cat "$DAEMON_PID_FILE"))."
      exit 0
    fi
    rm -f "$DAEMON_PID_FILE"
    setsid "$BASE_DIR/local-display.sh" daemon >>"$DAEMON_LOG" 2>&1 </dev/null &
    daemon_pid=$!
    attempt=0
    while [ "$attempt" -lt 50 ]; do
      published="$(cat "$DAEMON_PID_FILE" 2>/dev/null || true)"
      [ "$published" = "$daemon_pid" ] && break
      kill -0 "$daemon_pid" 2>/dev/null || break
      sleep 0.1
      attempt=$((attempt + 1))
    done
    alive "$DAEMON_PID_FILE" || { echo "Local display daemon failed to start." >&2; exit 1; }
    echo "Local display daemon started (pid=$(cat "$DAEMON_PID_FILE"))."
    ;;
  daemon)
    echo $$ > "$DAEMON_PID_FILE"
    trap 'rm -f "$DAEMON_PID_FILE"' EXIT
    trap 'exit 0' INT TERM
    while true; do
      if ! "$BASE_DIR/local-display.sh" status >/dev/null 2>&1; then
        echo "$(date '+%Y-%m-%dT%H:%M:%S%z') rebuilding local display"
        "$BASE_DIR/local-display.sh" start || true
      fi
      sleep 15
    done
    ;;
  stop)
    daemon_pid="$(cat "$DAEMON_PID_FILE" 2>/dev/null || true)"
    if alive "$DAEMON_PID_FILE" && [ "$daemon_pid" != "$$" ]; then
      # The daemon is a setsid session leader. Terminate its process group so an
      # in-flight `local-display.sh start` child cannot publish replacement workers
      # after stop_workers has finished.
      kill -TERM "-$daemon_pid" 2>/dev/null || kill "$daemon_pid" 2>/dev/null || true
      attempt=0
      while kill -0 "$daemon_pid" 2>/dev/null && [ "$attempt" -lt 20 ]; do
        sleep 0.1
        attempt=$((attempt + 1))
      done
      if alive "$DAEMON_PID_FILE"; then
        kill -9 "$daemon_pid" 2>/dev/null || true
      fi
      rm -f "$DAEMON_PID_FILE"
    fi
    display_id="$(display_id_from_log)"
    stop_workers || exit 1
    if [ -f "$DISPLAY_FILE" ]; then
      configured="$(cat "$DISPLAY_FILE" 2>/dev/null || true)"
      [ -z "$display_id" ] || [ "$configured" = "$display_id" ] && rm -f "$DISPLAY_FILE"
    fi
    echo "Local display stopped."
    ;;
  status)
    display_id="$(display_id_from_log)"
    if alive "$SERVER_PID_FILE" && alive "$DRAIN_PID_FILE" && display_present "$display_id"; then
      echo "running display=$display_id server=$(cat "$SERVER_PID_FILE") drain=$(cat "$DRAIN_PID_FILE")"
      exit 0
    fi
    echo "stopped"
    exit 1
    ;;
  *)
    echo "usage: $0 {start-daemon|start|status|stop}" >&2
    exit 2
    ;;
esac
