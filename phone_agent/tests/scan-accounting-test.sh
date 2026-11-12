#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
MODDIR=$TMP; TSV=$TMP/data
eval "$(sed -n '/^scan_snapshot() {/,/^useful_line_count() {/p' "$ROOT/agent.sh" | sed '$d')"
printf '1\ta\t0\t0\tx\t0\t3\t3\t4\t5\t6\t7\t8\n' >"$TSV"
FULL=$(wc -c <"$TSV" | tr -d ' ')
[ "$(scan_snapshot)" = "$FULL 1" ]
# An unterminated native write is not a complete row or accepted byte range.
printf '2\tb\t0\t0\tx\t0\t3\t3\t4\t5\t6\t7\t8' >>"$TSV"
[ "$(scan_snapshot)" = "$FULL 1" ]
printf '\n' >>"$TSV"
[ "$(scan_snapshot)" = "$((FULL*2)) 2" ]
# Small mushrooms contribute bytes but not useful rows.
printf '3\tc\t0\t0\tx\t0\t1\t3\t4\t5\t6\t7\t8\n' >>"$TSV"
[ "$(scan_snapshot)" = "$((FULL*3)) 2" ]
# Normal mushrooms also retain byte coverage without counting as useful rows.
printf '4\tn\t0\t0\tx\t0\t2\t3\t4\t5\t6\t7\t8\n' >>"$TSV"
[ "$(scan_snapshot)" = "$((FULL*4)) 2" ]
# Simulate an append after fixed-size measurement, before the copy.
stat() { command stat "$@"; printf '4\td\t0\t0\tx\t0\t3\t3\t4\t5\t6\t7\t8\n' >>"$TSV"; }
[ "$(scan_snapshot)" = "$((FULL*4)) 2" ]
unset -f stat
[ "$(scan_snapshot)" = "$((FULL*5)) 3" ]
printf 'PASS coherent scan bytes/rows: partial row, excluded sizes, concurrent append\n'
