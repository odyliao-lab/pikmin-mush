# Libra 155 scanner canary

Game 155.0/code1791279164 was independently inspected from Libra's retained
operator-supplied ARM64 ELF and managed dump, not by reusing Control Center
acceptance. Exact ELF size255862512 and fingerprint are checked by
module/tests/profile155-test.py. Consumed proto fields remain unchanged.

Mapped ARM64 entries: MapObjectManager.RegisterMapObject0x5AF3F60,
LocationController.Update0x726D168, SetDeviceLocationOverrideForDebug0x726DCC8.
Executable segment file offset is RVA minus0x4000; all entry signatures match.
152/153/154 signature profiles remain independent and unknown builds failclosed.
Dynamic deferred MapManager resolver avoids hardcoding its materialization RVA.

Dual-ABI compilation passed; runtime validation covers ARM64 only. Libra
rebooted with the scanner module, while its Control Center core was disabled
with user consent and retained in a private root backup. Scanner remains paused
until server compatibility and node activation are verified. Live155 signature
guard and hooks loaded, deferred MapManager resolved after75seconds, and fresh
level2 mushroom rows were captured. These steps do not yet prove upload/ACK
or continuous stability. Other devices are unchanged.

Site compatibility permits matching155 game/module; rejects155/154 mismatch
and unsupported156. Existing matching149–154 behavior is retained.
107 site tests including build passed after updating the version-list contract;
production audit found0 vulnerabilities. Initial old version-list assertion
failure was retained and corrected, not bypassed.
