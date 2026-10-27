#!/system/bin/sh
# Android package state is authoritative, including updates while Agent stays up.
# Bound expensive package queries to once per minute; never retain a stale
# configured version when probing fails. Unknown is rejected by compatibility.
game_version_clock() {
  read -r GV_CLOCK GV_UNUSED </proc/uptime || return 1
  printf '%s\n' "${GV_CLOCK%%.*}"
}

refresh_game_version() {
  GV_NOW="$(game_version_clock)" || GV_NOW=''
  case "$GV_NOW" in ''|*[!0-9]*) GAME_VERSION=unknown; GAME_VERSION_CHECKED_AT=''; return 0;; esac
  case "${GAME_VERSION_CHECKED_AT:-}" in
    ''|*[!0-9]*) ;;
    *) if [ "$GV_NOW" -ge "$GAME_VERSION_CHECKED_AT" ] &&
          [ $((GV_NOW - GAME_VERSION_CHECKED_AT)) -lt 60 ]; then return 0; fi;;
  esac
  GAME_VERSION_CHECKED_AT=$GV_NOW
  GV_DETECTED=''
  if GV_PACKAGE="$(timeout -k 1 5 dumpsys package "$PKG" 2>/dev/null)"; then
    GV_DETECTED="$(printf '%s\n' "$GV_PACKAGE" |
      sed -n 's/^[[:space:]]*versionName=\([0-9][0-9]*\.[0-9][0-9]*\)[[:space:]]*$/\1/p' | head -n 1)"
  fi
  GV_DETECTED="${GV_DETECTED:-unknown}"
  if [ "${GAME_VERSION:-}" != "$GV_DETECTED" ]; then
    GAME_VERSION=$GV_DETECTED
    echo "[version] installed game=$GAME_VERSION"
  fi
  GV_PACKAGE=''
}
