# Taichung 156.1 deployment — 2026-11-06

Scope: Aries, Cancer, Leo, Libra, Gemini, Taurus and Virgo. The Zhubei
Aquarius/Sagittarius/Capricorn instances were excluded. No host reboot occurred.
Each member now has game156.1/code1793076318 and Hunter156.1-r1. Phone Agent2.2.5
and emulator Agent2.2.10 authentication/upload implementations were retained;
only each effective MODULE_VERSION was synchronized. Cancer's guard,60% recovery
threshold and15FPS, Libra's disabled core/compass tap, and MuMu libnb.so30-second
NativeBridge wait were preserved.

## Inputs and release provenance

Exact official APK/signature, ELF and metadata checks are in
[the candidate record](FLEET_1561_CANDIDATE_2026-11-06.md). The existing emulator
156.0 base APK had a different hash from the phones; its v2 signature and full
content digest were independently verified against the same installed signer
before in-place installation. No game data was cleared. Native ARM64 payload
SHA256: `2dc01b7ef621227da430e0e61b4c7867d1549c3d0f1a81cf67b36c3cb51b7880`;
x86_64 loader: `3a9e2177b379ae68718c016e71839b7c4d04233e5a2673fdc8011a060ae8d010`.
ZIP SHA256: `95e9975859afe6d2df520717ad448df44939dcaad5eaff2d7298dedc537636bf`.
The x86_64 loader runs the ARM64 game through NativeBridge; native x86 game
compatibility is not claimed.

PR192 merged as `48f18092eade833bd0497f9744644d4161d64aa2` after the authoring
assistant's explicitly requested review and successful CI. It was not an
independent human review. Site build/207tests passed; prior production audit0.
The exact Site tree was `6016fa7c65213cf649d5642701dc65b4e511e98d`, identical to
the tested GitHub subtree; source `06b1c2f18624799f6d2475b32a7239b02ff6cb02`,
Sites version133 deployment `appgdep_6aed53c19cf0819197d89bed2874e226` succeeded.
The compatibility change retains all previously matching versions.

## Bounded runtime evidence

Device identity, effective AGENT_ID and production node were checked before
deployment. Root-only backups retained Agent/config/credentials, Hunter, original
TSV, offset and pending/ACK state inside each device. Archive extraction,
manifest hashes, ownership/mode and copied-offset <= copied-TSV were checked.
These were live multi-file snapshots, not atomic database snapshots. Taurus's
instance shell additionally required a guest exit-status marker; host tool exit0
alone was not accepted.

Each member loaded PID/version-matching native.ready and completed at least
three different new formal targets. Selected evidence below gives the native
refresh token and nonzero rows/bytes; each was correlated with map-object
readiness, uploads/cursor progress, and the successful HTTP ACK completion path.

| Member | Three selected refresh tokens | New rows / bytes |
| --- | --- | --- |
| Aries |179393941929651;179393950728426;179393953428428|7/713;1/101;5/523|
| Cancer |179393979629890;179393981929889;179393984329892|3/102;6/625;6/617|
| Leo |179393871428522;179393873628525;179393875828524|7/713;12/1266;6/689|
| Libra |179394027129910;179394029129913;179394030929915|5/549;3/311;5/518|
| Gemini |179394106829143;179394108529146;179394112629144|4/412;2/206;2/119|
| Taurus |179394184629365;179394186629367;179394194729371|3/307;4/309;1/103|
| Virgo |179394283928604;179394286028602;179394287928603|3/206;2/206;1/103|

Protected production metrics/maintenance independently confirmed accepted fresh
uploads. They do not provide individual upload receipts for every target; that
correlation uses the device's HTTP200/cursor and successful ACK path. Private
observations and backup paths remain outside Git under the operator's
`pikmin-operations/2026-11-06/upgrade-1561` directory.

Cold starts produced zero-row/timeouts and bounded automatic game restarts;
none counted toward acceptance. Libra's fresh ordinary driving reminder was
dismissed. Virgo initially produced no objects across several targets, then
produced nonzero data on later formal targets without route reassignment.
Follow-up also observed transient Aries offline/Leo no-data warnings; Leo
subsequently uploaded new data and Aries returned online. Heartbeat-only health,
empty points and normal cold-start waits are not proof of failure or recovery.
This is bounded acceptance, not an all-day stability or zero-timeout claim.

For the remaining Zhubei deployment use
[the host-specific upgrade prompt](ZHUBEI_1561_UPGRADE_PROMPT.md); re-identify the
local instances and verify their own backups/runtime rather than replaying the
Taichung scripts.
