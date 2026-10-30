# Virgo staging and emulator recovery — 2026-10-30

The fleet capacity gate increases from six to seven. Enrollment still creates a
disabled node, qualification remains explicit, and the atomic enable guard rejects
an eighth enabled node. This change does not enroll or enable Scorpio.

Regression coverage includes four through seven eligible nodes in all three slots,
summer/winter local-date rules, unique/nonempty routes, city coverage, Berlin's
existing EMEA weight, and concurrent enable attempts at the capacity boundary.

## Recovery before expansion

Lowering Taurus/Gemini to 720x1280 invalidated the 1080-wide popup and compass
calibration. Both were restored to effective 1080x1920, 240 DPI; MuMu's configured
frame-rate ceiling remains 30. No new 720-wide classifier is deployed. The host
still exhibited CPU saturation, so three-instance capacity is not established.

Both existing instances passed at least three fresh formal targets, correlated
with native object markers, nonzero TSV rows below the upload cursor, and the
successful server-ACK completion path. Protected metrics also showed healthy
status and zero upload failures. This is bounded recovery evidence, not a 24h soak.

Private operational evidence is stored outside Git under the operator's
`pikmin-operations/2026-10-30/virgo` directory. Root-only guest backups preserve
configuration, credentials, upload cursor, pending state and game files.

## New instance

MuMu instance 3 is named Virgo. Its independent node is
`agent-virgo-7adc7120`; Android ID was independently assigned and verified.
The copied Gemini token was removed before registration. Inherited runtime state
was isolated and the initial upload cursor excludes inherited historical TSV.
The independent credential was transferred without logging it; the temporary
credential file was removed after guest permission and identity checks.

Virgo remains disabled until game login, actual native loading, region
qualification, and new formal scan/upload/ACK acceptance are verified.
Game/native 156 loading alone is insufficient. The initial game launch returned
connection error 0 despite successful public HTTPS connectivity; an existing
translation-cache refresh procedure is being evaluated. No integrity bypass,
authentication relaxation, game-data clearing, or account-secret automation is
part of the capacity change.

After the cache refresh also returned error 0, the operator explicitly authorized
resetting only Virgo's game data. Complete root-only game and Agent archives were
verified before the reset. Agent configuration and token were compared before and
after and remained unchanged; Virgo's new-game upload cursor starts at zero.
Clean game onboarding and sign-in require the operator; no other node was reset.
