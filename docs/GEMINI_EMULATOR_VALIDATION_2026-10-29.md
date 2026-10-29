# Gemini deployment validation (in progress)

Gemini is staged as the sixth scanner. Formal target/upload/ACK acceptance and
autonomous reboot acceptance are **not yet complete**. The node remains disabled
with no region qualification. Installation, login, map objects and native.ready
are separate evidence levels and do not count as successful formal scans.

## Identity and preserved state

- MuMu instance1, Gemini, ADB127.0.0.1:16416, AndroidID1b5270f6e85fde28.
- Independent site node gemini-e5e815fa; private token/config root0600.
- Original Pokémon GO and Go Orbit Android apps were removed only after a
  verified private926368256-byte backup with5424 readable archive members.
  Target settings, packages and root/module inventory are retained privately.
- KernelSU3.2.5/code32525 retained; NeoZygisk2.4/289-08080ef-release.
  No second root framework, authentication patch or Health Connect overlay.
- Android15/API35, actual primary ABI x86_64, libnb.so NativeBridge, ARM64 game;
  uname is not used to identify architecture or device.
- Game156.0/code1792142832 and official certificate/IL2CPP digests match the
  documented156 baseline. Existing five devices and disabled Scorpio untouched.

## Startup comparison and Hunter156.0-r2

Original Hunter failed with error0 after guarded fixed-file translation-cache
refresh, a bounded retry, a quiet cold start, and retention of Gemini's own
successful cache. Hunter-off cold startup reached the dashboard with Health
Connect still absent; that missing service is not treated as the login cause.
Only the fixed MuMu translation-cache file was moved with hash/permission guards;
account data, preferences, databases, TSV, offsets and ACK were preserved.

An isolated candidate delaying scanner hooks120s still failed **before** those
hooks ran; it was rejected. A second candidate delayed NativeBridge payload
loading from5s to30s while retaining the original ARM64 payload. In boot
1fe18f57-15fc-4fe7-8ccd-bd16c5c5c179, PID2124 independently reached the dashboard,
captured map objects and produced native.ready2124/156.0. No authentication
function, credential, integrity verdict or version/signature gate was changed.
This is bounded compatibility evidence, not a proven general explanation for
all error0 reports and not formal scan acceptance.

The release applies the longer wait only to x86 NativeBridge with exact library
name libnb.so. Other bridge names retain5s. The ARM64 payload stays byte-identical
to156.0-r1. Hunter revision is separate from protocol MODULE_VERSION=156.0.

| Release artifact | SHA256 |
| --- | --- |
| Hunter156.0-r2 ZIP | e04ca3b36a1164fb1c50ab36dc712a02aafc695f95e20873f58b03b9ff0d5618 |
| ARM64 payload | 617674b4083013f012ba342a741256f67dd240c58f080574c6ca83433f77cd5c |
| x86_64 loader | 84b41c6880e18cd775d526b304e929521b125bc2df209d691bbc207c9d8653a0 |
| Gemini x86_64 popup-probe | 4448120a2d87525fe6dbea72dbcde049d6317bf663f5cc591a28f7dee12ddb01 |

## Calibration and checks

Six private dashboard frames across boots exposed animated flower scenery
through the compass edge. Samples now stay on its opaque glyph/interior; public
Friends/Notifications labels and frame gates are retained. No private account,
step count or avatar samples enter the repo. All three groups still require every
sample within the same24-channel tolerance; two fresh agreeing frames and game
foreground remain required before input. Existing notice roles/gates unchanged.

Android x86_64 NativeBridge delay-selection test passed, including unknown and
lookalike library names. The x86_64 probe passed122 positive, negative, translated,
malformed and changing-scenery fixtures on Gemini, plus six real private frames
and two fresh dashboard classifications. Site171 tests and the production
dependency audit passed. CI, merged source deployment, regional qualification,
formal scans and full reboot validation remain distinct release gates.

Capacity was published as existing Sites project version122 from source
0fd051089b7dbb2697371255cb89feebb2cd3c62. Native/Agent-only changes do not change
that site tree. Capacity details are in
[the six-Agent record](GEMINI_SIX_AGENT_CAPACITY_2026-10-29.md).

Windows and MuMu must keep running. Short observations do not prove all-day
stability. Private operations and screenshots remain outside Git.
