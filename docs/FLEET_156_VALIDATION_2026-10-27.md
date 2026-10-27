# Fleet game156 upgrade — 2026-10-27 (Asia/Taipei)

The operator authorized upgrading Aries, Cancer, Leo and Libra to game156,
matching scanning software and necessary Site compatibility. Scorpio and all
emulators remain excluded. Existing identities, credentials, pending state,
TSV, routes and protection settings must survive each in-place upgrade.

## Exact ARM64 inputs

Read-only APK extraction from the identified Leo phone supplied156.0/code1792142832.
No substitute binary, guessed address or relabelled155 module was used.

| Input | Bytes | SHA256 |
| --- | ---: | --- |
| base.apk | 93167608 | `61c13513f3710b469f33ae3f63af9eaeca7b80fa046f3669ac73fa35392bdd8a` |
| arm64 split | 87226517 | `6aa9c204928b5f80164b4206c27960d0467038db2cc192827e5e102785b4f960` |
| libil2cpp.so | 256261664 | `b1a9781e8e7ddbdf984f6e3e90c7f753dd3ac149881fc9c14a46892eda6f6b5d` |
| global-metadata.dat | 32103680 | `5240b679b85fc1b02b1284f0fe2d8eddd33fecfde3c0688c798035719a83f878` |

Il2CppDumper6.7.46 produced dump, structs and dummy DLLs. Its final
Console.ReadKey failed on redirected stdin (exit1); this is not recorded as a
whole-tool success. Independent exact hashes, metadata31, ELF segment mapping,
managed declarations, argument counts and instruction signatures are checked by
`module/tests/profile156-test.py` against the retained operator inputs.

Mapped ARM64 RVAs: MapObjectManager.RegisterMapObject`0x5B32FF4`,
LocationController.Update`0x72B6564`, SetDeviceLocationOverrideForDebug`0x72B70C4`.
Executable file offsets are RVA minus`0x4000`. The one-argument materialization
callback remains metadata-resolved after managed startup; it is not hardcoded.
All consumed proto fields and mushroom oneof22 retain their verified offsets.
152–155 profiles remain independent; none classifies this exact ELF as an old
version. Unrecognized signatures still refuse all hooks.

The opt-in render cap and PID/version-bound native readiness from the verified
Cancer changes are retained for156. They do not disable stock thermal/charging
protection. Cancer's scoped Agent upload/guard implementation and60% recovery
threshold must remain in place during deployment.

## Build and Site release

- The exact155 ELF regression and the new156 input/layout/signature checks pass.
- NDKr27d ARM64 and x86_64 builds pass; runtime acceptance is ARM64 only.
  ARM64 Hunter SHA256 is `617674b4083013f012ba342a741256f67dd240c58f080574c6ca83433f77cd5c`.
  The explicitly packaged156.0/code1792142832/r1 ZIP SHA256 is
  `b272e4862e01b7acffad7db997da84bea6eb11733b06d1d9673c27b33a1b7f36`.
- Both156 APKs verify. Their Niantic signer certificate SHA256 matches the
  installed155 baseline: `944bda466eaf64be1c93896d5c8e9a454a07c8d8fcbc4adeeefb3545b335e979`.
  Existing155 phones receive an in-place signed package update; game data is
  not cleared. The already156 Leo APK is not reinstalled.
- All Agent shell tests pass, including actual package version changes,
  bounded caching, failed probes, native PID/version readiness and backoff.
  Phone2.2.5 programs are scoped patches retaining each installed upload/auth
  function; Cancer's separate guard is not replaced.
- Site build and144 tests pass. An initial old supported-version text assertion
  failed, was updated to156, and the complete test set passed on rerun. Lint has
  zero errors and one pre-existing unused-import warning. Production audit is0.
- Code main: `35ce19b1e78f878f5f4d7c1fe18254b57cc10533` (PR160).
  Exact tested Site tree: `e8158b411e0cd17c564e3a2fb1ef3f44ac87b323`.
  Sites source: `a591e3c7260a3adca110b6125a1b8f955128e7d1`.
  Existing project published **v118**, deployment
  `appgdep_6adfefb4d44c8191a9cb8add2dcab81d`, status **succeeded**.
  Production metrics confirms156 support; APIs respond200. Legacy HTML entry
  URLs normalize to the existing clean map/event paths. Project, public
  audience, D1, nodes, regions, schedules and notification service are retained.

## Physical acceptance

All four phones retain their original physical serial/config/cloud association.
Game156.0/code1792142832, Hunter156.0-r1 and scoped Agent2.2.5 are verified on
each. Four necessary native-replacement reboots have different before/after
boot IDs; every final game PID matches its156 native readiness marker. All
four installed Hunter files match the verified ARM64 build hash above.

Each sample below is a distinct new formal job354 target with fresh native
object evidence, nonzero TSV and upload bytes, HTTP200 accepted ACK and
subsequent Site data. Values in parentheses are the Agent's ACK rows/bytes.
Zero-row, zero-byte, timeout and query-only acknowledgements are excluded.
The bounded log collector is not a complete count of every accepted target.

| Phone | Original Agent identity | Three sampled accepted targets (rows/bytes) | Last sampled ACK (Taipei) |
| --- | --- | --- | --- |
| Aries | `primary` | 1615355(2/224), 1615356(2/208), 1615359(2/240) | 09:17:44 |
| Cancer | `agent-4-pixel-3-cd8643b9` | 1615090(9/863), 1615089(1/104), 1615061(2/103) | 09:16:53 |
| Leo | `agent5-9431de09` | 1615556(5/524), 1615555(2/225), 1615566(2/226) | 09:18:35 |
| Libra | `agent-libra-a6ee0460` | 1615410(7/720), 1615413(5/531), 1615414(6/618) | 09:18:36 |

Final protected API snapshot at **2026-10-27 09:25:19 Asia/Taipei** reports all four
healthy and version-compatible, enabled/unpaused, without upload silence.
Data ages are below one minute. Local fresh markers, TSV growth and advancing
upload offsets corroborate the cloud observations; heartbeats or map images
alone were not used for acceptance. Routes remain the existing04:00 Asia/
Oceania job;12:00 Berlin3x and the20:00 rotation are unchanged.

Aries showed its previously authorized existing Google account and a transient
sign-in error. One ordinary Retry returned MTK Ody to the game; no password,
2FA, new account, credential rotation or data clearing was used. Its existing
classifier subsequently recognized the dashboard and tapped the compass.
Libra entered the map and retains both compass tap and the disabled Control
Center core marker. Scorpio and emulators were never operated.

Cancer entered its original thermal-severe protection during startup. The
guard stopped the game and later resumed under its original stability rules;
there was no forced resume or stock protection change. Its original guard,
60% threshold and15 FPS option are preserved. New156 readback is15;127
SurfaceFlinger presentation timestamps measure approximately15.17 FPS over
8.31seconds. The final guard is running/none with thermal status1; battery80%
and Android's own charging restriction remain under stock control.

Phone-private, root-only before/quiesced archives retain config/token, pending
state, offsets, original TSV and installed APKs. All original TSV prefixes,
phone tokens, unrelated config fields and guard scripts compare unchanged;
offsets advance normally. Full backup paths, exact phone program hashes, boot
IDs, screenshots, safe API snapshots and ACK receipts are retained in the
external private operation record for2026-10-27/upgrade156. No phone credential
was exported, printed, committed or sent to a new service. The original
Discord service is unchanged; no second scheduler or sender was started.

This is bounded live acceptance, **not24-hour stability or a battery-health
claim**. Cancer's observed thermal protection episode remains part of the
record even though it recovered. x86_64 was compiled only; the four physical
ARM64 devices provide the runtime coverage.
