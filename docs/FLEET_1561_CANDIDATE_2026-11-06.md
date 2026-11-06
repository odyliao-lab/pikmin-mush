# Pikmin Bloom 156.1 candidate — 2026-11-06

This is a candidate profile, not fleet acceptance. The inputs were extracted
read-only from the serial-verified Leo device, which reported game version
156.1 and versionCode 1793076318. The APK signing-block certificate SHA-256
matched the earlier 156.0 certificate; independent cryptographic signature
verification is still required before rollout.

| Input | Size | SHA-256 |
| --- | ---: | --- |
| base.apk | 93343814 | 070c75d6e253317438dc4ac1b0f60b5dbf9e5250763827b7c6b6197f0e81e9dc |
| arm64 split | 87267477 | 7b05aa1c10acad9266c1daeea68d466c138b2ecb35a9d03717af273dd13e4836 |
| libil2cpp.so | 256384336 | 97ef6650f73d99ca8c7ebbbdf2d059d0d41ea68c036fde05634003f6a052aefb |
| global-metadata.dat | 32142292 | b3e4d8ec9a9e8794f68132b01c49a7b05f1be57497654efd1d785892e5810eff |

Il2CppDumper 6.7.46 returned exit 0 and generated a metadata-v31 dump. The
candidate mapped RVAs are `0x5B42820`, `0x72CEF78` and `0x72CFAD8` for
MapObjectManager.RegisterMapObject, LocationController.Update and
SetDeviceLocationOverrideForDebug, respectively. The exact input hash,
executable-segment mapping, 32-byte entrypoint signatures, managed declarations,
consumed field layouts and rejection of prior profiles are checked by
`module/tests/profile1561-test.py`. The existing 156.0 profile is separately
checked against unintended 156.1 classification.

Both native ABIs compile; no 156.1 device or emulator runtime acceptance is
claimed. Before production deployment, follow `docs/RELEASE_GATES.md`, verify
APK signatures, validate compatibility with the live deployed Site, back up each
identified device and establish a single-device canary with PID-bound readiness
and three different nonzero target/upload/acceptance/ACK chains. Preserve each
Agent's authentication and upload implementation, Cancer's guard and 15 FPS,
and Libra's disabled core and compass entry. Roll out sequentially only after
canary validation. Unknown login or 2FA screens require the operator.
