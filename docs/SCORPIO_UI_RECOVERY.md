# Scorpio 153 UI recovery — 2026-10-01

## Incident

Scorpio had a long no-data streak while blocked behind a driving notice. Its
swipe-mode configuration omitted the notice button coordinates. Calibrating a
fixed tap was insufficient: when no modal was present, that same position opened
the October activity challenge. A healthy process and GPS override did not prove
map visibility or object capture.

## Device-only canary

The visual probe now selects an exact resolution profile: existing Libra
1440×3120 is unchanged; Scorpio 1220×2712 adds static control samples for the
dashboard, activity challenge, and expanded menu. A changed/unknown screen is
not acted upon. Two fresh, agreeing captures and foreground verification remain
required before each action. Samples do not include account labels or map data.

Scorpio uses `VISUAL_RECOVERY_ENABLED=1`, physical display, its calibrated
right-to-left swipe, and `MAP_HOOK_WARMUP_SECONDS=80`. The 153 MapManager hook was
observed resolving about 75 seconds after startup. Manual pause state, token,
upload offset, original data and the assigned job were preserved. Original
configuration and probe/script backups remain on the device.

The initial driving notice and seasonal introduction were dismissed manually.
The 2026-10-02 recurrence was blocked by the restricted-area acknowledgement.
A Scorpio-only template now samples that notice's static Traditional Chinese
text and confirmation button (1220x2712), with two agreeing fresh captures and
foreground/manual-pause checks before tapping. White modal and changed-text
fixtures are rejected. Other notices, including uncalibrated driving prompts,
remain unknown. Do not claim all future pop-ups can recover automatically, or
enable this profile on other models. Device backups retain the previous probe
and script; assignment, token and upload offset are not reset.

## Verification

- NDK build with `-Wall -Werror`.
- Existing Libra and new Scorpio synthetic probe fixtures, including malformed
  input and unsupported resolution rejection.
- Visual recovery and map-entry shell regressions.
- Eight private real-device captures: dashboard/menu/activity positives and
  normal-map negatives. Captures remain outside Git.
- Subsequent target-specific object markers, incremental uploads and server
  `accepted` responses; admin displayed normal scan/data flow.
- Controlled game stop: agent reopened it, recognized the dashboard and swiped
  into the map without manual input. A target with no ready marker timed out;
  the following Jaipur target produced object readiness and accepted upload.

This is a recovery smoke test, not a multi-day soak or a fleet-wide rollout.
No website deployment or scan-allocation change is needed.

## 2026-10-02 restricted-area recurrence acceptance

- Exact device serial verified before installation; battery 100%, 35.6 C.
- Native build, both resolution fixture suites, restricted-modal negative
  fixtures, visual recovery and map-entry shell regressions passed.
- A second real notice capture matched the calibrated template. The Agent
  automatically logged warning then dashboard recovery, without a manual tap.
- Subsequent targets produced object markers and successful ACK completion;
  three consecutive productive targets captured 1, 6 and 4 rows in 9-10 seconds.
  Upload responses included `accepted=4`; public API returned 14 recent records
  attributed to Agent Scorpio, proving the resumed data reached the site.
- Installed probe/script SHA-256 matched tested source artifacts. Previous
  binaries/scripts remain on the phone. No token, offset, allocation, other
  device or factory battery/thermal protection was changed.
- This verifies this known notice, not every future game dialog or a long soak.
