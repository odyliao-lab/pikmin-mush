# 157.0 scanner candidate — 2026-11-09

Scope: Taichung Aries/Cancer/Leo/Libra and Gemini/Taurus/Virgo only. No Control
Center, Scorpio, Zhubei fleet, Discord scheduler/sender or route changes.

Hunter target `157.0-r1`, game `157.0 / 1793360009`: additive new game support;
Agent protocol and installed per-device scoped variants remain unchanged.
Website accepts matching 157.0 pairs while preserving older matching versions;
mismatched modules and unknown future games remain rejected.

## Exact offline inputs

Obtained the ARM64 base + split bundle from APKMirror's 157.0 release/variant,
through a normal browser download. Android Build Tools 35 apksigner verified
both APK signatures and source stamps, with certificate SHA-256
`944bda466eaf64be1c93896d5c8e9a454a07c8d8fcbc4adeeefb3545b335e979`.
Fresh installed signatures must also match before each device update.

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| base.apk | 74766568 | `0f9aa76ee7437f99d104eff78c5e448c639f04cf9ca70676dad8e78be25758ab` |
| split_config.arm64_v8a.apk | 87435413 | `bfed99c8b4e0c40cdc046d81ae48d7676ce6996e23354b0c5f1c4ac8b82f5ddd` |
| libil2cpp.so | 257043464 | `6c36ef78a6d1f45cf5b36c73761ed526226a081d981001b71608984afde246a5` |
| global-metadata.dat | 32230812 | `3f6c34de9955a27c0b273ad72d9ea52baa3d7a54aefb060eb75a065a4bca5eb2` |

Il2CppDumper 6.7.46 completed metadata-v31 extraction. Executable PT_LOAD
mapped RVA minus file offset is `0x4000`; new entrypoints are `0x5B87ED0`,
`0x732957C`, `0x732A0DC`, each guarded by 32 exact bytes. All consumed proto
fields, mushroom oneof value, managed hook arguments and delayed MapManager
registration/recalculate contracts retain their expected layouts. No unknown
profile fallback was added. NativeBridge startup delay and render opt-in remain.

## Local evidence (not gameplay acceptance)

- `profile157-test.py` passed exact input hashes, mapped prologues/arguments,
  consumed layouts, corruption comparisons and exclusion of 152–156.1 profiles.
- `profile1561-test.py` passed against retained original 156.1 inputs, including
  rejection of all three new 157 entrypoints on that ELF.
- NDK r27d ARM64 and x86_64 Release builds passed; packaging passed portable
  Magisk archive checks with explicit version/code/revision arguments.
- ARM64 payload SHA-256:
  `583bd393c4fe0ff6fa772c8fb7dff51cc62d9b4e1ef1fdfffb15547669b0260b`.
- x86_64 payload SHA-256:
  `d9dda4fd542b9e3bcacebaf526bea30816d17b7df182827b0978b79913b1460f`.
- Package SHA-256:
  `fa82f508164c7d54b4f6cb05bf62e4d3a69e29da2ae561f6a72d3eba0ce63034`.

At this candidate checkpoint no production device was updated and no website
release was deployed. Do not interpret compilation/profile validation as scan,
upload or ACK acceptance. Device evidence belongs in the subsequent validation
record. Preserve root-only verified backups and pending/offset/thermal guards.
