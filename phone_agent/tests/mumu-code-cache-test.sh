#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
eval "$(sed -n '/^prepare_mumu_code_cache() {/,/^}/p' "$ROOT/agent.sh")"
MODDIR="$TMP/module" APP_FILES="$TMP/game/files" PKG=com.nianticlabs.pikmin
mkdir -p "$MODDIR" "$APP_FILES" "$TMP/game/code_cache"
CACHE="$TMP/game/code_cache/.hptc_kache_nticlabs.pikmin"
printf 'retained-account\n' >"$TMP/game/account"
printf 'retained-tsv\n' >"$APP_FILES/mushrooms.tsv"
printf 'retained-offset\n' >"$MODDIR/upload.offset"
printf 'retained-ack\n' >"$MODDIR/scan.pending"
printf 'retained-other-cache\n' >"$TMP/game/code_cache/other"
ARCH=x86_64 BRIDGE=libnb.so RUNNING=0 FAIL_CHOWN=0
uname() { echo "$ARCH"; }
getprop() { echo "$BRIDGE"; }
pidof() { [ "$RUNNING" = 1 ]; }
chown() { [ "$FAIL_CHOWN" = 0 ]; }
MUMU_CODE_CACHE_REFRESH=0
printf first >"$CACHE"
prepare_mumu_code_cache
[ "$(cat "$CACHE")" = first ]
MUMU_CODE_CACHE_REFRESH=1
ARCH=aarch64
if prepare_mumu_code_cache; then echo phone-accepted; exit 1; fi
ARCH=x86_64 BRIDGE=other.so
if prepare_mumu_code_cache; then echo wrong-bridge-accepted; exit 1; fi
BRIDGE=libnb.so RUNNING=1
if prepare_mumu_code_cache; then echo live-cache-moved; exit 1; fi
RUNNING=0
prepare_mumu_code_cache
[ ! -e "$CACHE" ]
[ "$(cat "$MODDIR/mumu-code-cache/cache.previous")" = first ]
[ "$(stat -c %a "$MODDIR/mumu-code-cache")" = 700 ]
[ "$(stat -c %a "$MODDIR/mumu-code-cache/cache.previous")" = 600 ]
prepare_mumu_code_cache
printf second >"$CACHE"
prepare_mumu_code_cache
[ "$(cat "$MODDIR/mumu-code-cache/cache.previous")" = second ]
ln -s "$TMP/game/account" "$CACHE"
if prepare_mumu_code_cache; then echo symlink-accepted; exit 1; fi
rm "$CACHE"
printf third >"$CACHE"
printf partial >"$MODDIR/mumu-code-cache/cache.next"
if prepare_mumu_code_cache; then echo partial-move-overwritten; exit 1; fi
[ "$(cat "$CACHE")" = third ]
rm "$MODDIR/mumu-code-cache/cache.next"
mv "$MODDIR/mumu-code-cache/cache.previous" "$TMP/previous.saved"
mkdir "$MODDIR/mumu-code-cache/cache.previous"
if prepare_mumu_code_cache; then echo backup-directory-accepted; exit 1; fi
[ "$(cat "$CACHE")" = third ]
rmdir "$MODDIR/mumu-code-cache/cache.previous"
mv "$TMP/previous.saved" "$MODDIR/mumu-code-cache/cache.previous"
FAIL_CHOWN=1
if prepare_mumu_code_cache; then echo permission-failure-ignored; exit 1; fi
[ "$(cat "$MODDIR/mumu-code-cache/cache.next")" = third ]
[ "$(cat "$TMP/game/account")" = retained-account ]
[ "$(cat "$APP_FILES/mushrooms.tsv")" = retained-tsv ]
[ "$(cat "$MODDIR/upload.offset")" = retained-offset ]
[ "$(cat "$MODDIR/scan.pending")" = retained-ack ]
[ "$(cat "$TMP/game/code_cache/other")" = retained-other-cache ]
echo 'MuMu cache opt-in, platform/live/symlink guards, verified backups and preserved state passed'
