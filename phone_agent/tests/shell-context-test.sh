#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export CAPTURE_DIR="$TMP"
TEST_SH=$(command -v sh)
TEST_SLEEP=$(command -v sleep)
for fixture in su runcon; do printf '#!%s\n' "$TEST_SH" >"$TMP/$fixture"; done
cat >>"$TMP/su" <<'EOF'
printf '%s\n' "$@" >"$CAPTURE_DIR/su-args"
if [ "$1" = -Z ]; then [ "$2" = u:r:shell:s0 ]; shift 2; fi
[ "$1" = 2000 ] && [ "$2" = -c ] || exit 91
exec sh -c "$3"
EOF
cat >>"$TMP/runcon" <<'EOF'
[ "$1" = u:r:shell:s0 ] || exit 92
[ "${FAIL_CONTEXT:-0}" = 0 ] || exit 93
shift
exec "$@"
EOF
chmod 700 "$TMP/su" "$TMP/runcon"
MAGISK_SU="$TMP/su"
# Substitute only Android executable locations; exercise the real quoting,
# su arguments, branching, exit propagation and timeout behavior.
eval "$(sed -n '/^shell_su_command() {/,/^}/p; /^run_as_shell() {/,/^}/p; /^run_as_shell_timeout() {/,/^}/p' "$ROOT/agent.sh" | sed "s|/system/bin/runcon|$TMP/runcon|g; s|/system/bin/sh|$TEST_SH|g")"
for SHELL_SU_MODE in magisk ksu-runcon; do
  [ "$(run_as_shell "printf '%s' \"a'b c\"")" = "a'b c" ]
  [ "$(run_as_shell_timeout 2 "printf '%s' \"a'b c\"")" = "a'b c" ]
  if run_as_shell 'exit 23'; then exit 1; else [ "$?" = 23 ]; fi
  if run_as_shell_timeout 1 "'$TEST_SLEEP' 5"; then exit 1; else [ "$?" = 124 ]; fi
done
SHELL_SU_MODE=ksu-runcon FAIL_CONTEXT=1; export FAIL_CONTEXT
if run_as_shell "touch '$TMP/unsafe'"; then exit 1; else [ "$?" = 93 ]; fi
[ ! -e "$TMP/unsafe" ]
SHELL_SU_MODE=invalid
if run_as_shell true; then exit 1; else [ "$?" = 64 ]; fi
echo 'Magisk/KernelSU shell identity arguments, quoting, timeout and fail-closed tests passed'
