# Headless Scanner Supervisor Specification

> Status: implementation baseline, 2026-07-19
> Scope: Windows controller plus a rooted physical Android Scanner node

## 1. Goal

Run Pikmin mushroom scanning without keeping the game visible or requiring routine phone
interaction. Android remains the trusted game runtime; Windows owns display lifecycle,
health checks, recovery, and operator commands.

The supported production topology is:

```text
Windows Supervisor
  -> ADB + scrcpy
  -> physical Android phone
       -> Pikmin Bloom on hidden/physically-dark display
       -> Zygisk capture module
       -> phone_agent/agent.sh
       -> cloud Fleet API
```

MuMu is excluded from production. Native Bridge injection was proven, but Google/Pikmin
login failed with the capture module disabled. See `phone_agent/EMULATOR_LAB.md`.

## 2. Operating modes

### 2.1 `virtual` (default)

scrcpy creates a 720x1600/320 virtual display and starts Pikmin there. The main phone display
remains available for other apps. `game.display` stores the active display id so Agent game
launches, recovery restarts, and key events remain on that display.

### 2.2 `screen-off`

Pikmin stays on display 0 while scrcpy disables the physical panel. This is preferred for a
dedicated Scanner node because it minimizes panel power and prevents burn-in.

## 3. Responsibility boundaries

| Component | Responsibility |
| --- | --- |
| Zygisk module | Capture mushroom objects and apply location override. |
| `agent.sh` | Lease work, write teleport control, upload TSV bytes, ACK, and recover a scan with no rows. |
| `service.sh` | Ensure one Agent parent process after Android boot. |
| `headless-agent.ps1` | Create/remove one scrcpy display session and persist its local state. |
| `supervisor.ps1` | Long-running health loop, explicit-failure recovery, status, and lifecycle commands. |

The Supervisor must never start a second Agent when the recorded Agent PID is alive. It must
never advance upload offsets, edit scan leases, or infer cloud job state.

## 4. Supervisor commands

```text
start     launch a hidden Windows Supervisor process
run       run the health loop in the current process (diagnostics/service use)
once      execute one health/recovery pass
status    print the last persisted health snapshot
stop      stop monitoring but leave the current Scanner session running
shutdown  stop monitoring and stop the headless display session
```

State and logs live outside the repository:

```text
%LOCALAPPDATA%\CodexTools\pikmin-supervisor\<adb-serial>\
  state.json
  supervisor.log
  stop.request
```

The underlying headless session state is also serial-scoped at
`%LOCALAPPDATA%\CodexTools\pikmin-headless\<adb-serial>\state.json`, so multiple nodes do
not overwrite each other.

## 5. Health model

Each poll records:

- ADB connection state.
- managed scrcpy PID and mode.
- configured virtual display id and whether it still exists.
- Pikmin PID and resumed-activity state.
- Agent PID and `kill -0` result.
- TSV byte size and most recent observed growth time.
- recovery counters and last error.

Overall states:

- `healthy`: ADB, headless session, game resumed, and Agent are healthy.
- `degraded`: connected, but a recoverable component is unhealthy or TSV is stale.
- `offline`: ADB device unavailable; no device mutations are attempted.
- `stopped`: the Supervisor exited by operator request.

TSV staleness is diagnostic only. A paused Fleet job, cooldown, or empty map region can
legitimately produce no rows.

## 6. Recovery state machine

Recovery uses a configurable cooldown to prevent restart storms.

1. **ADB unavailable**: record `offline`, wait, and retry. Do not kill local scrcpy until ADB
   returns because a transient USB reset may recover the same session.
2. **scrcpy dead or virtual display missing/mismatched**: call `headless-agent.ps1 stop`, then
   `start` in the configured mode. Verify the new state and display id.
3. **Agent PID dead**: remove only its stale `agent.pid`, run `service.sh`, and verify a live
   replacement PID.
4. **Game not resumed**: allow `GameResumeGraceSeconds`; then launch the explicit activity on
   the configured display. Agent-level force-stop recovery remains owned by `agent.sh`.
5. **Repeated failure**: continue monitoring but cap automatic recovery attempts within a
   rolling run. Record `degraded` and the exact error for operator inspection.

## 7. Safety invariants

- Validate ADB serial and use exact device-scoped commands.
- Validate managed Windows PIDs by process name before stopping them.
- Clear `game.display` before destroying its scrcpy virtual display.
- A stale/missing display id makes `agent.sh` fall back to display 0.
- Preserve phone token, config, offset, pending ACK, TSV, and scan leases during recovery.
- Never treat lack of new mushrooms alone as proof of failure.
- Log rotation is bounded and does not contain Agent tokens or config contents.

## 8. Configuration

`supervisor.config.example.json` documents the supported keys. A deployment may pass a private
config path or override the ADB serial on the command line. Credentials are not part of the
Supervisor configuration.

## 9. Acceptance tests

1. Start in `virtual`; game is resumed on the new display and main display remains usable.
2. Kill managed scrcpy; Supervisor creates one replacement display and updates `game.display`.
3. Kill the Agent parent; Supervisor starts exactly one replacement parent without changing
   offset or pending ACK files.
4. Disconnect/reconnect USB; state becomes `offline`, then returns to `healthy` without manual
   intervention.
5. `stop` leaves scanning alive; `shutdown` clears display state and stops scrcpy.
6. During a 30-minute run, TSV/Agent progress continues and no duplicate Agent parent appears.

### 9.1 Verified on Redmi Note 10 5G

The following fault injections passed on 2026-07-19:

- Killing managed scrcpy rebuilt virtual display 10 as display 11, updated `game.display`,
  and returned Pikmin to resumed state.
- Killing the Agent parent restarted exactly one parent with a new PID; upload offset and the
  pending ACK survived and completed.
- `stop` left scrcpy, the display, game, and Agent alive.
- `shutdown` removed `game.display` and stopped scrcpy; starting the Supervisor rebuilt a
  healthy session on display 12.
- Serial-scoped headless state migration preserved the live session without a restart.

Physical USB unplug/reconnect and a dedicated 30-minute Supervisor soak remain follow-up
tests; ordinary headless scanning itself has already continued across multiple scan targets.
