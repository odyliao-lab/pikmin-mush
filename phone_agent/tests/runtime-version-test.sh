#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$ROOT/runtime-version.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
game_version_clock() { printf '%s\n' "$NOW"; }
timeout() { printf x >>"$TMP/calls"; [ "$FAIL" = 0 ] || return 1; printf '%s\n' "$PACKAGE"; }
PKG=test NOW=100 FAIL=0 GAME_VERSION=155.0
PACKAGE='    versionName=156.0'
refresh_game_version
test "$GAME_VERSION" = 156.0
test "$(wc -c <"$TMP/calls")" -eq 1
PACKAGE='    versionName=157.0' NOW=159
refresh_game_version
test "$GAME_VERSION" = 156.0
test "$(wc -c <"$TMP/calls")" -eq 1
NOW=160
refresh_game_version
test "$GAME_VERSION" = 157.0
test "$(wc -c <"$TMP/calls")" -eq 2
FAIL=1 NOW=220
refresh_game_version
test "$GAME_VERSION" = unknown
FAIL=0 NOW=280 PACKAGE='    versionName=156.0 extra'
refresh_game_version
test "$GAME_VERSION" = unknown
NOW=340 PACKAGE='    versionName=156.0'
refresh_game_version
test "$GAME_VERSION" = 156.0
# A reset monotonic clock must not extend the old version cache.
NOW=1 PACKAGE='    versionName=157.0'
refresh_game_version
test "$GAME_VERSION" = 157.0
NOW=bad
refresh_game_version
test "$GAME_VERSION" = unknown
echo 'live Android version, bounded cache, failed/invalid probe and clock-reset checks passed'
