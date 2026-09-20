#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODDIR="$(mktemp -d)"
trap 'rm -rf "$MODDIR"' EXIT
PKG=test.game
source "$ROOT/power-guard.sh"

healthy() {
  PG_VALID=1 PG_THERMAL=0 PG_LEVEL=80 PG_TEMP=350 PG_PLUGGED=1 PG_CHARGE=2 PG_COUNTER=1000000
}
reset_guard() {
  rm -f "$MODDIR/power.hold" "$MODDIR/power.cool-request"
  power_guard_init
  healthy
  PG_NOW=100
}
expect_hold() { test "$PG_STATE" = cooling; test -s "$MODDIR/power.hold"; }

# Disabled is a complete no-op, even on older Android without thermalservice.
reset_guard
POWER_GUARD_ENABLED=0
power_guard_check
test ! -e "$MODDIR/power.status"

reset_guard
power_guard_decide
test "$PG_STATE" = running
PG_THERMAL=3
power_guard_decide
expect_hold
test "$PG_REASON" = thermal-severe
PG_NOW=1000 PG_THERMAL=2
power_guard_decide
expect_hold # Moderate heat never qualifies for recovery.
PG_THERMAL=1 PG_NOW=1010
power_guard_decide
PG_NOW=1129
power_guard_decide
expect_hold
PG_NOW=1130
power_guard_decide
test "$PG_STATE" = running
test ! -e "$MODDIR/power.hold"

# Battery heat, low charge, missing sensors and battery cold are protective.
for trigger in hot low unknown cold; do
  reset_guard
  case "$trigger" in hot) PG_TEMP=430 ;; low) PG_LEVEL=20 ;; unknown) PG_VALID=0 ;; cold) PG_TEMP=50 ;; esac
  power_guard_decide
  expect_hold
done

# Even 100% + "charging" can hide a draining cell: check the charge counter.
reset_guard
PG_LEVEL=100
power_guard_decide
PG_NOW=699 PG_COUNTER=960000
power_guard_decide
test "$PG_STATE" = running
PG_NOW=700
power_guard_decide
expect_hold
test "$PG_REASON" = plugged-draining

reset_guard
power_guard_decide
PG_NOW=700 PG_LEVEL=77
power_guard_decide
expect_hold

# Unplug/replug cannot reuse the plugged-in drain baseline.
reset_guard
power_guard_decide
PG_NOW=400 PG_PLUGGED=0
power_guard_decide
PG_NOW=800 PG_PLUGGED=1 PG_LEVEL=70
power_guard_decide
test "$PG_STATE" = running

reset_guard
power_guard_hold requested
power_guard_decide
PG_NOW=220
power_guard_decide
expect_hold # Two minutes stable is not the minimum three-minute cooldown.
PG_NOW=280 PG_CHARGE=4
power_guard_decide
expect_hold
PG_CHARGE=2 PG_PLUGGED=0 PG_NOW=500
power_guard_decide
expect_hold
PG_PLUGGED=1 PG_LEVEL=29 PG_NOW=800
power_guard_decide
expect_hold
healthy
PG_NOW=900
power_guard_decide
PG_NOW=1000 PG_COUNTER=990000
power_guard_decide # Continuing depletion resets the stable interval.
PG_NOW=1119
power_guard_decide
expect_hold
PG_NOW=1120
power_guard_decide
test "$PG_STATE" = running

# Agent restart keeps the latch but never trusts its old timer/content.
reset_guard
power_guard_hold requested
printf '$(touch do-not-execute)\n' >"$MODDIR/power.hold"
power_guard_init
test "$PG_REASON" = restart-check
healthy
PG_NOW=2000
power_guard_decide
expect_hold
PG_NOW=2179
power_guard_decide
expect_hold
PG_NOW=2180
power_guard_decide
test "$PG_STATE" = running
test ! -e do-not-execute

# Parser fixture: no device writes or OS temperature overrides for testing.
BATTERY=$'Current Battery Service state:\n  AC powered: true\n  USB powered: false\n  Wireless powered: false\n  Charge counter: 1239000\n  status: 2\n  present: true\n  level: 100\n  scale: 100\n  temperature: 380'
THERMALS=$'IsStatusOverride: false\nThermal Status: 2\nHAL Ready: true'
timeout() {
  case "${*: -1}" in
    battery) printf '%s\n' "$BATTERY" ;;
    thermalservice) printf '%s\n' "$THERMALS" ;;
    *) return 1 ;;
  esac
}
power_guard_sample
test "$PG_VALID/$PG_LEVEL/$PG_THERMAL/$PG_TEMP/$PG_PLUGGED/$PG_COUNTER" = 1/100/2/380/1/1239000
THERMALS=$'IsStatusOverride: true\nThermal Status: 0\nHAL Ready: true'
if power_guard_sample; then echo 'must reject thermal overrides' >&2; exit 1; fi
test "$PG_VALID" = 0
THERMALS=$'IsStatusOverride: false\nThermal Status: 0\nHAL Ready: true'
BATTERY="$BATTERY"$'\nUPDATES STOPPED'
if power_guard_sample; then echo 'must reject battery overrides' >&2; exit 1; fi
BATTERY='truncated'
if power_guard_sample; then echo 'must reject missing sensors' >&2; exit 1; fi
unset -f timeout

# Run the real sampling gate with a fake clock and read-only fixtures. Check
# cadence, unavailable sensors, gap/restart hysteresis and real stop callbacks.
reset_guard
POWER_GUARD_ENABLED=1
CLOCK=100 SENSOR_OK=1 STOP_COUNT=0 SAMPLE_COUNT=0
cut() { if [ "${*: -1}" = /proc/uptime ]; then echo "$CLOCK"; else command cut "$@"; fi; }
power_guard_sample() { SAMPLE_COUNT=$((SAMPLE_COUNT + 1)); healthy; PG_VALID="$SENSOR_OK"; }
pidof() { echo 123; }
run_as_shell_timeout() { STOP_COUNT=$((STOP_COUNT + 1)); }
power_guard_check
power_guard_check
test "$SAMPLE_COUNT" -eq 1
CLOCK=130 SENSOR_OK=0
if power_guard_check; then echo 'unknown sensor allowed scanning' >&2; exit 1; fi
test "$STOP_COUNT" -eq 1
test "$PG_STATE" = cooling
CLOCK=160 SENSOR_OK=1
if power_guard_check; then exit 1; fi
CLOCK=1000
if power_guard_check; then echo 'stale recovery samples allowed resume' >&2; exit 1; fi
test "$PG_STABLE_AT" -eq 1000
for CLOCK in 1030 1060 1090; do if power_guard_check; then exit 1; fi; done
CLOCK=1120
power_guard_check
test "$PG_STATE" = running
unset -f cut pidof run_as_shell_timeout

# Heartbeat renews but never ACKs, and a cancelled target is not replayed.
reset_guard
POWER_GUARD_ENABLED=1
power_guard_hold requested
SCAN_JOB_ID=42 SCAN_TARGET_ID=100 SCAN_LEASE=test-lease
scan_control() { printf 'heartbeat\n' >>"$MODDIR/calls"; echo run; }
power_guard_heartbeat
test "$SCAN_TARGET_ID" = 100
power_guard_heartbeat
test "$(wc -l <"$MODDIR/calls")" -eq 1
scan_control() { echo stop; }
PG_NOW=140
power_guard_heartbeat
test -z "$SCAN_TARGET_ID"

echo 'power guard policy/parser tests passed'
