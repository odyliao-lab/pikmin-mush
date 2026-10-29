#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
eval "$(sed -n '/^write_game_teleport() {/,/^}/p' "$ROOT/agent.sh")"
APP_FILES="$TMP/game"; mkdir "$APP_FILES"
TELEPORT="$APP_FILES/teleport.txt"
OWNER=10058 GROUP=10058 FAIL_CHOWN=0
stat() {
  if [ "$3" = "$APP_FILES" ]; then
    case "$2" in %u) echo "$OWNER";; %g) echo "$GROUP";; *) return 1;; esac
  else command stat "$@"; fi
}
chown() {
  [ "$FAIL_CHOWN" = 0 ] || return 1
  printf '%s\n' "$1" >"$TMP/owner-call"
}
umask 077
write_game_teleport '1.25,2.5,123456'
[ "$(cat "$TELEPORT")" = '1.25,2.5,123456' ]
[ "$(cat "$TMP/owner-call")" = '10058:10058' ]
[ "$(stat -c %a "$TELEPORT")" = 600 ]
write_game_teleport '3.5,4.75,654321'
[ "$(cat "$TELEPORT")" = '3.5,4.75,654321' ]
FAIL_CHOWN=1
if write_game_teleport '5,6,7'; then echo chown-failure-ignored; exit 1; fi
FAIL_CHOWN=0; OWNER=0
if write_game_teleport '8,9,10'; then echo root-app-directory-accepted; exit 1; fi
OWNER=10058; GROUP=invalid
if write_game_teleport '8,9,10'; then echo invalid-owner-accepted; exit 1; fi
GROUP=10058
rm "$TELEPORT"; printf 'preserved\n' >"$TMP/unrelated"
ln -s "$TMP/unrelated" "$TELEPORT"
if write_game_teleport '8,9,10'; then echo symlink-accepted; exit 1; fi
[ "$(cat "$TMP/unrelated")" = preserved ]
echo 'new control file ownership, private permissions, repeated writes and failure guards passed'
