#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
eval "$(sed -n '/^wait_for_agent_boot_delay() {/,/^}/p' "$ROOT/service.sh")"
log_service() { :; }
sleep() { WAITED=$((WAITED + $1)); [ "${FAIL_SLEEP:-0}" = 0 ]; }
for AGENT_BOOT_DELAY_SECONDS in 0 1 7 120 300; do
  WAITED=0
  wait_for_agent_boot_delay
  [ "$WAITED" -eq "$AGENT_BOOT_DELAY_SECONDS" ]
done
for AGENT_BOOT_DELAY_SECONDS in -1 301 1000 01 invalid '1;exit 0'; do
  WAITED=0
  if wait_for_agent_boot_delay; then echo invalid-delay-accepted; exit 1; fi
  [ "$WAITED" -eq 0 ]
done
unset AGENT_BOOT_DELAY_SECONDS
WAITED=0
wait_for_agent_boot_delay
[ "$WAITED" -eq 0 ]
AGENT_BOOT_DELAY_SECONDS=120 FAIL_SLEEP=1 WAITED=0
if wait_for_agent_boot_delay; then echo interrupted-sleep-ignored; exit 1; fi
[ "$WAITED" -eq 5 ]
echo 'boot grace defaults, bounds and interrupted wait passed'
