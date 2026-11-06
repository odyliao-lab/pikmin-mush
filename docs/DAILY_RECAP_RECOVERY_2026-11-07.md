# Daily recap recovery — Aries / Cancer

The operator reported the nightly step recap blocking Aries and Cancer. Both
were already on maps at the first inspection, so the exact original blockage
was not captured. Controlled playback then reproduced the final step card and
the following mood question. Back did not dismiss either observed screen;
selecting a mood or sharing was deliberately avoided. The previous recovery
supported ordinary notices/dashboard only, leaving these screens to the slower
generic no-data restart path.

## Local recovery

`POPUP_DAILY_RECAP_ENABLED=1` was enabled only on the two identified phones.
The original Agent/uploader/auth implementation and Cancer power guard were
hash-checked unchanged; only the popup library, classifier and this config key
were deployed. Game/Hunter remain 156.1 / 156.1-r1. No host/device reboot,
route change, extra scheduler, Discord sender or website deployment was needed.

The classifier has fixed 1080×2400 and 1080×2160 Traditional Chinese layouts.
Date, step totals, map, avatar, moving card corners and animated mood features
are excluded. Opaque card interior and fixed wording/outline anchor the mood
screen. Two fresh matching classifications plus exact game focus are required.
No time-of-day-only inputs, mood selection, share action or generic back key
are introduced.

Recovery verifies a root-only device-local snapshot of all Agent state and the
original TSV/markers before a cold launch. Archive extraction and checksums,
ownership/mode, free space and copied offset ≤ copied TSV are checked. The
snapshot is live, not atomic. Any failure stops the action. An independent
`sh -eu` preserves strict backup failures even when the caller tests its status.
Manual pause, thermal/charging protection and a positive formal-target control
response remain mandatory. Existing cold-start throttling is preserved; one
recap attempt per six hours per boot also counts failed launches. Ordinary
calibrated startup notices remain recoverable during PID/version native waiting,
while nested recap restarts are suppressed.

## Bounded live validation

Aries automatically left a reproduced final recap; Cancer automatically left a
reproduced mood screen. Each created its own verified root-only snapshot and
started a new native game session. Both returned to the original job 419.
These distinct new object-refresh tokens were correlated with nonzero rows,
nonzero byte deltas, upload progress and successful ACK completion:

| Member | Object target token | New rows | New bytes |
| --- | --- | ---: | ---: |
| Aries | 179398032963551 | 6 | 105 |
| Aries | 179398036063554 | 8 | 840 |
| Aries | 179398039063547 | 4 | 419 |
| Cancer | 179398117163853 | 2 | 208 |
| Cancer | 179398119664362 | 5 | 520 |
| Cancer | 179398122264358 | 8 | 832 |

Native object log IDs matched these refreshed targets; `native.ready` matched
the respective new PID and 156.1. Protected production metrics/maintenance
provided the independent accepted-data/upload timestamps. Private screenshots,
full safe observations, backup locations and acceptance evidence are kept
outside Git. Zero-byte outcomes were excluded from this three-target gate.

ARM64 builds use warnings as errors. Fifteen private real frames and 167
synthetic positive/negative/translation fixtures passed. Shell regressions
cover focus, pause, thermal protection, opt-in, no personal input, backup
failure, failed launch/native wait, positive control, six-hour throttling and
conditional-errexit. Site regression tests: 207 passed; production audit: zero
vulnerabilities. This is bounded recovery validation, not proof of all-day
stability or of unobserved languages/layout variants. Other members retain
their original configuration; new layouts require separate calibration.
