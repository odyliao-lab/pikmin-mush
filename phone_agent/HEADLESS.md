# Headless phone scanning

## Fully autonomous phone mode

For a rooted physical phone that must scan while disconnected from the computer, install the
on-device display manager once:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\phone_agent\install-local-display.ps1 `
  -Serial ANDROID_ADB_SERIAL
```

This installs the current `agent.sh`, a Magisk-booted phone watchdog, and the display assets,
then sets `LOCAL_DISPLAY=1` in the private phone config. It stops the old Agent and starts the
new Agent only after the trusted virtual display is healthy. USB may then remain disconnected.
See `SPEC_ON_DEVICE_DISPLAY.md` for architecture, recovery, and verified tests.

The installer refuses to run while the serial-scoped Windows Supervisor Scheduled Task, a
recorded live Supervisor process, or a manually started Windows headless scrcpy session exists.
Remove the Task and stop any manual session first:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\phone_agent\install-supervisor-task.ps1 uninstall `
  -Serial ANDROID_ADB_SERIAL
```

The Windows modes below remain useful for interactive debugging and screen viewing, but are
not required by autonomous phone mode.

`headless-agent.ps1` lets the phone keep scanning without leaving Pikmin Bloom visible on
its physical screen. The game still runs on the rooted Android phone; the PC owns the
hidden display session and can start, inspect, or stop it through ADB.

## Modes

- `virtual` (recommended): creates a hidden Android display for Pikmin Bloom. The phone's
  main display remains available for the launcher or another app.
- `screen-off`: keeps the game on the main logical display but turns off the physical
  panel. It uses less graphics bandwidth, but the phone cannot simultaneously show
  another app.

The phone Agent reads `game.display` from its Magisk module directory. Launches, recovery
restarts, and confirmation key events are sent to that display. If scrcpy disconnects and
the display disappears, the Agent rejects the stale id and falls back to the main display.

Windows scrcpy processes are owned by an exact `(PID, process name, ADB serial, session marker)`
identity. The marker is `PikminHeadless-<safe-serial>`; PID and process name alone must never be
used to stop a session in a multi-phone deployment.

For upgrades, legacy virtual and screen-off sessions without the new serial marker are accepted
only when their complete fixed argument signature and serial match. The shared rules live in
`windows-process-identity.ps1` and are covered by
`tests/windows-process-identity.tests.ps1`. A live scrcpy at the state PID with an unverifiable
identity causes `stop` to preserve state and fail for manual inspection.
The same fail-closed disposition is checked before `start`, so it cannot create a replacement
beside an unverifiable live scrcpy; Supervisor recovery stops at the same guard.

## Requirements

- The phone is connected by ADB and the `pikmin_scanner_agent` Magisk module is installed.
- scrcpy 4.1 is available. The default expected location is:
  `C:\Users\<user>\AppData\Local\CodexTools\scrcpy-v4.1\scrcpy.exe`.
- Run from the repository root in Windows PowerShell.

## Commands

```powershell
# Start with the game on a hidden virtual display
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\phone_agent\headless-agent.ps1 start -Mode virtual

# Check the PC process, virtual display, and resumed game state
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\phone_agent\headless-agent.ps1 status

# Stop, remove game.display, and return the game to display 0
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\phone_agent\headless-agent.ps1 stop

# Alternative: turn off only the physical panel
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\phone_agent\headless-agent.ps1 start -Mode screen-off
```

Pass `-Serial <adb-serial>`, `-AdbPath <path>`, or `-ScrcpyPath <path>` when auto-detection
or the defaults do not match the machine. Without `-Serial`, exactly one authorized ADB
device must be connected.

## Emulator track

This script still uses the physical Android phone. A separate MuMu Player 15 prototype proved
that an x86_64 Zygisk loader can load the ARM64 capture payload and install both game hooks,
but Google/Pikmin login fails even with the hook disabled. The emulator is therefore a research
environment, not a production Scanner replacement. See `EMULATOR_LAB.md` for the evidence.

## Windows Supervisor

`supervisor.ps1` keeps ADB, scrcpy/display, Pikmin resumed state, and the phone Agent healthy.
Its complete behavior and recovery invariants are defined in `SPEC_HEADLESS_SUPERVISOR.md`.

```powershell
# Start a hidden long-running monitor
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\phone_agent\supervisor.ps1 start `
  -Serial 7lw8ibvghe6dtof6 -Mode virtual

# Read its last health snapshot
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\phone_agent\supervisor.ps1 status `
  -Serial 7lw8ibvghe6dtof6 -Mode virtual

# Stop monitoring while leaving the Scanner session alive
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\phone_agent\supervisor.ps1 stop `
  -Serial 7lw8ibvghe6dtof6 -Mode virtual

# Stop monitoring and shut down the headless display session
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\phone_agent\supervisor.ps1 shutdown `
  -Serial 7lw8ibvghe6dtof6 -Mode virtual
```

For a dedicated phone, replace `virtual` with `screen-off`. Copy
`supervisor.config.example.json` to a private machine-local path to customize timing and tool
locations; it contains no credentials.

Optional logon auto-start:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\phone_agent\install-supervisor-task.ps1 install `
  -Serial 7lw8ibvghe6dtof6 -Mode virtual
```

Both this installer and `headless-agent.ps1 start` refuse Windows ownership while the phone
config contains `LOCAL_DISPLAY=1`, the validated daemon PID is alive, or its local display is
healthy. Disable and stop the on-device daemon before switching modes.
