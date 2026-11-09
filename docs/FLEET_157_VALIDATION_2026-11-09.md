# Taichung 157.0 upgrade — 2026-11-09

Status: **partial operational recovery; acceptance in progress**. All seven
installed signed game157/Hunter157.0-r1. Six have new nonzero scan/upload chains;
Cancer additionally passed an automatic cold-entry regression. Gemini
requires the user's Google account selection and is maintenance-paused through
the normal control entry. This is not seven-node completion.

Scope is mushroom scanning only. No Control Center, Scorpio, Seed Lens or
Zhubei device upgrade; no host reboot, game uninstall/data clear, route,
scheduler, dispatcher, Discord sender or credential replacement.

Game157.0/code1793360009 and Hunter157.0-r1 use the exact signed inputs and
payload hashes in [the candidate record](FLEET_157_CANDIDATE_2026-11-09.md).
Installed APK signatures were independently checked before each in-place update.
Root-only device backups preserve original Agent/config/credentials, Hunter,
TSV, offset, pending/ACK and original APKs. Archive extraction, SHA manifests,
owner/mode and copied-offset<=copied-TSV were verified. These are live snapshots,
not atomic database snapshots. A final no-pending/uploaded boundary snapshot is
also retained after stopping only the original Agent for that member's update.

Existing per-device Agent variants, power/render/map-entry/network/popup
settings remain; only effective MODULE_VERSION changes to157.0. Cancer's probe
alone additionally changes to the tested p25 build, retaining its already
deployed opt-in announcement support. Config excluding MODULE_VERSION, other
helpers and credential hashes are compared privately. No credential hash is
published here. Gemini's temporary maintenance pause is not a permanent user STOP;
after login it must be resumed through control.sh and freshly revalidated.

## Source, checks and website

Native commit18b90ee and site commitc50bbf6 merged via PR199 as
`8a33d2e8eee2dc3d53b006c35d57438b711368bd`. The authoring assistant performed
source review, not an independent human review. Both PR/main Security CI passed.
Local site lint had0 errors/1 existing unused-helper warning, build/207tests,
maintenance3tests and production dependency audit passed. Exact157/retained156.1
profiles and NDK ARM64/x86_64 builds/package passed, separately from device proof.

The tested site subtree `b84c20d3385d0b3f4042ec9daddb594e7c0ce4fd` was merged
into the release mirror and its exact resulting tree checked before building.
Sites source `e4dff94700b1b018136aa579c28e6824c70935de`, version134 deployment
`appgdep_6af17297269c8191911b83bef729a9f6` succeeded. Public access was preserved.
Only additive157 compatibility changed; older matching pairs remain accepted,
mismatches/future158 remain rejected. No DB schema/category change was needed:
consumed layouts and mushroom type values are unchanged from156.1.

Public `/`, `/map.html`, `/event-spots.html` resolve to their existing canonical
HTML routes with HTTP200. Mushroom/event/version APIs returned200; public
mushroom response has no private agents array. Anonymous `/admin` still routes
to sign-in; authenticated admin UI was not separately exercised. Protected live
metrics expose157 compatibility and fresh accepted device data.

## Bounded runtime acceptance

Each passing member has same-PID/version native.ready, at least3 distinct new
native map-object refresh tokens, nonzero useful TSV rows/bytes, uploaded cursor
coverage and the successful completion/HTTP ACK path. Protected site maintenance
independently confirms new accepted uploads/data after that member's reboot.
Individual per-target production receipts were not independently fetched.
Legacy completion logs omit full job/target IDs; their token suffixes identify
distinct targets modulo100000. No zero-row point or heartbeat counts as success.

| Member | State |
| --- | --- |
| Aries | Passed new157 PID, >=3 distinct nonzero chains and preserved config/helpers |
| Cancer | Initial acceptance invalidated by later dashboard stall; p25 deployed, passed automatic cold entry and >=3 new nonzero chains on new PID17320 |
| Leo | Passed new157 PID, >=3 distinct nonzero chains and preserved config/helpers |
| Libra | Passed new157 PID, >=3 distinct nonzero chains and preserved config/helpers |
| Gemini | Initially passed, later login failure after host suspension; one Retry led to Google account chooser; requires user login, maintenance-paused |
| Taurus | Passed; fresh accepted data after host suspension/resume |
| Virgo | Interrupted after signed APK install; reconciled actual157 before installing remaining core only; rebooted and passed >=3 new nonzero chains |

Cancer initially required a normal compass tap, but later repeated zero-row
timeouts disproved sustained recovery. Three private home frames isolated the
cause: existing frame/text anchors matched, while translucent compass-interior
samples exceeded tolerance24. PR200 retains the already deployed announcement
support and adds a separate p25 dashboard profile using32 opaque glyph and32
green negative-space samples, radius<=25. Existing p8/global tolerance24,
dual-frame/focus/pause/power gates remain unchanged. Three actual private images
were recognized by the candidate on Cancer; synthetic adversarial/package tests
passed in CI. Source commit1b84060, mergef1cb7d9; authoring-assistant review is not
an independent human review. Only Cancer's classifier was atomically replaced
after a new root-only archive was extracted and SHA/owner/mode verified. New
probe SHA256: c23405681787e22f66e137d6ca003c989876225e0c962291a31a3b3ebfb6000f.

At16:44:37 Taipei a no-pending/fully uploaded boundary permitted one game-only
stop. The same original Agent3720 relaunched gamePID17320, automatically handled
the danger notice and dashboard compass, reached same-PID157 native ready, then
completed>=3distinct new nonzero object/TSV/upload/completion chains by16:49:15.
No manual compass/input was supplied during this regression. Existing lower
level version/payload/helper/config/credential checks also passed; the old
pre-fix accepted tokens were excluded using a fresh host observation boundary.

Leo required its known ordinary danger reminder dismissal plus compass; Libra
required its driving reminder dismissal plus compass during initial upgrade.
No shop/payment/reward consumption or blind RPC was used. All future prompt
variants and long-duration stability are not established by this bounded run.

## Host interruption and remaining maintenance limits

All three MuMu VMs suspended together while host C: had only475136 bytes free.
Vendor logs show suspended/paused and disk-write failures; an explicit DISK_FULL
line was not found, so the exact causal chain is not proven. Task-owned large
inputs, generated dump intermediates and old APK copies were recoverably moved
to the user-authorized NAS; task dependencies moved to M: with junctions.
No game/VM data or unrelated user files were deleted. C: recovered to about2.6GB,
still low; live VM disks remain on C: and capacity needs ongoing attention.

Exact registered VM UUID/config, loopback listener and fresh guest Android ID
were independently verified before vendor VBoxManage resume (not reset/rebuild).
Guest operations continued on their original endpoints. MuMuManager info still
reports902 despite VMState=running; this maintenance API health is unresolved.
A task-local independently bound identity fallback was used, without changing
the installed read-only helper or pretending902 means healthy.

Gemini/Taurus guest clocks remained1284/1425seconds behind after resume, despite
auto_time=1. The normal Android network_time_update_service force_refresh returned
true on each; fresh guest and host epochs then agreed within1second. No test time
injection, manual date, NTP server override or automatic-time setting change was
used. Virgo's clock already matched. No causal claim about the Gemini login
failure is established from this correlation alone.

At16:49:53 Taipei the final bounded read found Aries, Cancer, Leo, Libra,
Taurus and Virgo with signed157 APK/core hashes, same-PID native157, exactly
one original Agent, accepted useful data/upload within180seconds, no active
local pause, and preserved credentials/config/helpers (Cancer probe excepted).
Taurus's new cold-restart PID13803 also resumed accepted data. Global registered
dispatch inventory was empty with no next cursor; this does not certify unknown
historical/unregistered work. Gemini remains locally maintenance-paused pending
user account choice even though the cloud enabled/paused flags alone look active.

Maintenance root-grant toasts can obscure startup inspection, so subsequent
checks leave a bounded no-root warmup (phones180s, MuMu270s). This is an operator
observation change, not an Agent scheduling/settings change. A bounded ADB
connect timeout during Cancer's reboot stopped the host coordinator; existing
state was reconciled and observation resumed without reinstallation/reboot.

Private per-member evidence and backup locations remain outside Git under the
operator's `pikmin-operations/2026-11-09/upgrade-157`. No all-day stability or
fully automatic handling of all future prompts is claimed.
