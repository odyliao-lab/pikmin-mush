# Fleet 154 compatibility — 2026-10-05 (Asia/Taipei)

All four active phones were manually upgraded to game 154.0 / 1789606828
after the version-update dialog blocked 153 scanning. Do not infer capture
from target completion or heartbeat. Libra remains disabled.

## Verified native contract

- Unity 6000.0.58f2, IL2CPP metadata 31.1. Consumed MapObjectProto,
  ProtoBasedMapObject, PointProto, PoiMushroomProto and PoiChallengeInfoProto
  fields retain their 153 offsets and method argument counts.
- ARM64 mapped RVAs: MapObjectManager.RegisterMapObject 0x5A77300;
  LocationController.Update 0x71DADB8; SetDeviceLocationOverrideForDebug
  0x71DB918. Cpp2IL's reported addresses for this ELF are file offsets;
  executable PT_LOAD contributes +0x4000. The binary signature regression
  checks this distinction explicitly.
- libil2cpp SHA256: 791095556486512206a2f8e3f8f69e66e3982e47dbe794cb70dec7ee6b9dff84.
- metadata SHA256: 32c28291a8a7e5d4734b3876f81765d3541bfcfa9f6e869b89dfbb7504e71020.
- Preserve fail-closed 152/153 profiles; 154 uses the same two-argument UI
  hook and deferred, metadata-resolved MapManager callback. No query hook.
- Native dual-ABI build passed (154 behavior validated on ARM64 only).
  Run `python module/tests/profile154-test.py <154 ARM64 libil2cpp.so>`.
- Site `npm test`: 82 passed; `npm audit --omit=dev`: zero vulnerabilities.
  Unsupported 155 and mixed game/module versions remain rejected.

## Leo canary

Backed up Hunter and Agent in private root storage, preserving token/config,
offset, leases and protection settings; paused, installed Hunter, rebooted.
At 23:43 runtime signatures verified 154; deferred MapManager resolved to
0xCEDA140 and installed. After the startup warning was acknowledged and map
opened, synchronizing the system GPS with the existing target restored POIs.
At 23:47:37 five fresh mushroom rows were captured, cumulative TSV
444951 -> 444956, and the existing target produced a fresh `object` marker.
Manual pause suppresses the usual system GPS provider setup; terrain alone
is not evidence of successful or unsuccessful capture.

The site compatibility release and each phone's task ACK/upload/server
acceptance must be separately recorded below; canary capture is not a soak.

## Production release and rollout

PR #127 merged as GitHub main 4c624ce. Sites source tree matches tested
subtree 249eb8b; mirror merge 8aa80512f4b26d4f9fda455062db709cf33c3555.
Sites version 101 deployment appgdep_6ac3c9a578c4819197f3e313a6618761
succeeded at 2026-10-06 00:00:57 Asia/Taipei. Public mushrooms API returned
HTTP 200. Existing source audience and runtime secrets were preserved.

Leo resumed at 00:01. Target 179121611134745 produced `source=object`,
completed point 624 with +4 rows/+420 bytes, and successful incremental
upload. Protected metrics recorded last_data_at=last_target_at=1791216145348,
zero no-data streak and healthy status. Subsequent targets 635 and 634 also
captured +6/+4 rows and uploaded. This is real post-resume capture/ACK and
server acceptance, not historical cumulative TSV or heartbeat evidence.

Aries was backed up, installed and rebooted next. DHCP changed its endpoint;
the hardware serial was rechecked before resuming. Its 154 signatures and
GPS hook were verified at runtime. First fallback was a sea target (no rows);
the next target 179121661334778 returned object readiness and point 657
captured +4 rows/+433 bytes. Both incremental uploads succeeded. Protected
metrics recorded last_data_at=1791216671156 and zero streak/healthy. Following
points 659 and 85 captured +3 rows each; the map was confirmed foreground.

Cancer was installed and rebooted next, preserving its 60% recovery threshold
and factory thermal/charging protection. At 00:12:58 Android thermal status 3
triggered `cooling/thermal-severe` at battery 76%, 37.7C. Native/scan acceptance
is pending natural cooling; no guard bypass is authorized or performed.

Scorpio installation followed while Cancer cooled; its hardware serial was
verified and private root backup retained before reboot. Runtime verified 154
signatures and MapManager resolver 0xCEDA140. Target 179121702834627 returned
object readiness and +11 rows/+1257 bytes; successful uploads totaled the same
1257 bytes. Subsequent points captured +3/+4 rows and uploaded. Protected
metrics recorded last_data_at=last_target_at=1791217070680, healthy/zero streak.

At 00:18 Cancer's thermal status had naturally fallen to 0, battery 80%,
temperature 33.3C. Android still reported charge status 4 (not charging), and
the read-only sysfs check showed charge_disable=1, input_suspend=0. This does
not satisfy the unchanged recovery policy (charging/full plus stable period).
The user was asked to reconnect its charger. No sysfs charging flags, thermal
protection or recovery policy were changed. Cancer's real native/capture/upload
validation remains pending; do not claim four-phone recovery from install alone.
