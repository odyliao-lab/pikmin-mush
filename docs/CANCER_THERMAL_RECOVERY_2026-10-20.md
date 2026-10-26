# Cancer thermal recovery canary — 2026-10-20 (Asia/Taipei)

Only Cancer (`agent-4-pixel-3-cd8643b9`, serial `8ADX0QS09`) was maintained.
The operator authorized phone changes/reboots and declined battery replacement.
Aries, Leo, Libra and disabled Scorpio were not changed. No Site deployment, manual database edits,
rotation settings, notification service or controller credential changes occurred.

## Observed failure and scope

The 48 hours ending 14:02:53 contained 233 `thermal-severe` episodes and
843.33 minutes of protection pauses (29.3%). Trigger battery temperature was
37.1–38.0°C at 100% charge. The system reported severe skin thermal status;
the HAL `fps-therm-monitor` name is a skin sensor, not a frame-rate measurement.
Its severe threshold is 45°C. These were not low-battery/plugged-draining holds.

The recent scan log had 24 cold restarts among 26 completed points, and the
last TSV/upload before maintenance was 11:55:38. The dashboard classifier
rejected seven green compass pixels despite matching all frame/text samples.
The green button is translucent over an animated background. Repeated cold
starts also waited less than the deferred native hook's approximately 75-second
startup, then attempted another restart. These are observed software problems;
the measurements do not establish their individual contributions to heating.

Fuel-gauge full/design estimates were 1,283/2,944 mAh with 773 cycles; other
logical battery nodes disagreed. This is not a calibrated battery-health test.
USB PD negotiated a 9 V/2 A ceiling, not a measurement of actual input watts.
Brightness was already at its minimum. Ambient temperature, case removal and
external airflow were not confirmed, so the tests are not controlled A/B trials.

## Installed changes and preserved state

- Agent 2.2.4, with opt-in `SCAN_RECOVERY_ENABLED=1` and a 300-second fallback
  restart interval. Startup waits at most 120 seconds for `native.ready` to
  match the running PID and exact game version, with manual/thermal checks.
  The hook-ready marker is never treated as object/scan evidence.
- Hunter `v155.0-r2-thermal`, built with explicit game155.0/code1791279164.
  `package-module.ps1` still defaults to152; version arguments were not omitted.
  Only an app-private allowlisted render option enables the limiter; absent or
  invalid input and unavailable Unity API leave the game setting unchanged.
  It runs on Unity's main thread and verifies the value by reading it back.
- Cancer compass samples were calibrated across five real backgrounds, keeping
  all three feature groups and the original RGB tolerance. Both opaque white
  glyph and green negative-space samples are required. No general click or
  color-tolerance relaxation was introduced.

Cancer retained its pre-existing upload implementation and its Oct3 Pixel
Defender recovery extension. Its deployed Agent is a scoped patch of the
backed-up phone source, not a byte-identical replacement by the entire repo
Agent. The unrelated receipt-upload implementation was not migrated here.
The original power-guard script SHA256 remains
`99236e5311f2d9deb5ca1200f50eb87c30ee4563f89ecfc96a04fe2a9148bda8`.
Stock thermal/charging protections and the 60% resume threshold remain intact.

Root-private backup on Cancer:
`/data/adb/pikmin-private-backups/thermal-cancer-8ADX0QS09-20261020-143742`.
Both before/quiesced archives retain Agent/Hunter state and the original TSV.
Config, token, offset, TSV and pending state were checked before/after the
quiesced installation. Secrets remain on the phone; none are in this record.
Quiesced archive SHA256:
`502c8de4350a3832202b83904eb04736e1bf5cafc8453f6628fadaa8904500fd`.

Installed artifact SHA256:

| Artifact | SHA256 |
| --- | --- |
| Cancer scoped agent.sh | `c41c67adf33e858e049b9f882077ab8abcc19c209c42f53b3d87c89cfe1a6e2a` |
| scan-recovery.sh | `23446af803c36dc3e885e8d8ca3db09ab70c2c372ed4a0b7f115bd5f1c436dad` |
| popup-probe | `081f7f9959ac03f3c697acb5426da488f4f8d2e7625a50a67868ccc7117da42b` |
| Hunter ARM64 | `794aa2bec2e35b13858fe7ed14923daab7f09b9802da8c9ebcb22c02e33cdff1` |

Installed game APK/split/ELF fingerprints were independently checked against
the retained verified155 artifacts. The ELF SHA256 is
`3e841abebcd6502fdf2599cba458dcc1a86cb189262a0f46d8d660337802813a`.
Signature guards and profile addresses were not changed. Native replacement
was followed by a phone reboot: boot ID
`a0a98b81-d51e-43ad-8e05-729d48884045`. Boot recovery waited for the original
guard to permit charging recovery at14:51:54. PID11092 subsequently wrote
hook-ready155 and render20 markers; the later render15 test used PID17391.

## Runtime evidence

The 20 FPS option measured20.23 FPS across127 SurfaceFlinger presentation
timestamps; the 15 option measured14.94 FPS across127 timestamps. Rate is
computed from frame count over total elapsed time, not the inverse median
interval: presentation intervals can alternate across display refreshes.
API readback alone is not a measured frame rate. The final option is15.
Unity documents the mobile render-rate behavior in its
[Application.targetFrameRate reference](https://docs.unity.cn/6000.2/Documentation/ScriptReference/Application-targetFrameRate.html).

The classifier autonomously closed the driving notice and entered the map.
The new155 PID-bound native marker was followed by fresh object markers, new
TSV rows, uploads and successful ACKs for formal job333. Strict nonzero cloud
examples below all have `ok=1`, `refresh_source=object`, `restarts=0`,
`upload_failures=0` and HTTP200. Zero-row/zero-byte ACKs are excluded.

| Target | Rows | Bytes | Render option |
| --- | ---: | ---: | ---: |
| 1522558 | 2 | 221 | 20 |
| 1522564 | 2 | 206 | 15 |
| 1522563 | 5 | 206 | 15 |
| 1522568 | 3 | 308 | 15 |
| 1522569 | 3 | 338 | 15 |

A read-only live D1 inspection also found the existing Cancer node enabled,
unpaused, game/module155.0, Agent2.2.4, current job333, refreshed `last_data_at`
and `no_data_streak=0`. Existing region tags and work assignment were retained.
No writes or controller-token retry were used for verification.

The bounded observer completed 51 samples from14:54:19 to15:19:27 (25m08s).
No sample reached thermal status3, and the guard logged no new protective hold
in the post-recovery interval checked. The20 option's sampled skin range was
42.03–43.72°C; the15 option's 30 samples spanned14m35s and42.56–43.20°C,
with battery36.8–37.1°C. These spans include startup and gameplay, not just
steady-state map load. At15:19:27 the TSV and upload offset both equalled
52,188,064 bytes, up10,927 bytes from the pre-maintenance baseline.
At15:19:34 a separate archive comparison verified the original52,177,137-byte
TSV prefix and token unchanged. TSV lines increased from491,208 to491,312
(+104). Config's original1,872-byte prefix also matched both private copies.
The last observed15-FPS game PID remained17391, with one Agent process3811.

A final read-only node check found last_data_at15:20:12, enabled/unpaused,
Agent2.2.4, matching155 versions and no_data_streak0. Additional strict cloud
ACKs included target1522582 (4 rows/412 bytes) and1522584 (4 rows/427 bytes),
both object/HTTP200 with zero restarts/upload failures. Test files were removed;
the bounded observer exited while the phone Agent remained autonomous.

## Checks and operational limits

Dual-ABI native compilation passed; device runtime coverage is ARM64 only.
The allowlist parser ran successfully on Android, including missing/malformed,
embedded-NUL, unsupported-rate and trailing-payload cases. All Agent shell
tests passed, including manual/thermal interruption, stale/wrong-version
markers, reboot-aware backoff and upload preservation. The classifier passed
72 positive/adversarial fixtures and retained real dashboard/map checks.
Site build/108 tests, production dependency audit (zero) and Windows deployment
hardening/process-identity checks passed.

Initial CI exposed a test assumption that host uptime already exceeded300s;
the test now uses a deterministic clock and covers a105-second host. The
subsequent GitHub build and validation jobs passed; no gate was bypassed.

This is a one-phone canary on the branch above PR143, not approval to upgrade
the remaining fleet. No website publication is needed for these phone changes.
The bounded computer-side observer is only for this maintenance session;
normal scanning remains autonomous on the phone. Short observation cannot
prove all-day stability; no24-hour stability claim is made.

If recovery is required, first pause and preserve the *current* data/pending
state, then restore only the necessary backed-up binaries/settings. Do not
overwrite new TSV/upload/ACK state with an old archive. A Hunter rollback needs
a reboot and renewed loaded-version plus object/upload/ACK verification.
Keep existing protective holds; do not force resume or raise thermal limits.
