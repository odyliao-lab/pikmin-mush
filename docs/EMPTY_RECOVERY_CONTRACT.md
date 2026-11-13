# Empty-point recovery after coordinated verification

The contract alone does not prove a website release or a fleet rollout. Generic Agent
2.2.18 adds an optional `recovery_version=1` extension to the existing lease ACK.
Installed scoped 2.2.17 Agents do not produce this extension. The existing
nonzero, same-agent/job/ordinary-target observation path remains available.
Do not backfill the extension into historical events or force-close old batches.

`dispatchProof` requires all candidates terminal and exactly one effective return
ACK by the correct agent/job. For the empty alternative, it additionally requires
a subsequent completed **ordinary** target, leased after that return, and a
persisted successful `target_completed` event with the same agent, job, target
and exact server completion time. Both rows and bytes must be zero.

The authenticated Agent attests these conditions together:

- Same single game PID and `/proc` start ticks before/after the scan, including a
  final re-read. `native.ready` must name that PID and remain identical.
- `scan.ready` must contain the fresh numeric target token, `object` source and
  a marker time after scan start. Its complete value is re-read for races.
  The token contains the complete target ID (8 decimal digits), not its suffix.
- The complete TSV prefix before/after the point must be identical and already
  covered by the accepted uploader offset. Two existing pending-byte samples
  must be exactly zero; a final coherent snapshot must match the prefix. No
  previous pending ACK is permitted. Partial/unknown/racing samples omit proof.
- The existing request-time `X-Agent-Pending-Bytes` header must independently be
  exactly zero. A positive/missing header rejects a previously frozen witness,
  including a late append before the ACK request or a delayed retry with new data.
- Device scan/marker/sample order must be coherent within ten minutes. The
  successful server ACK must be within two minutes of its sample, and proof must
  still be within two minutes of the close check. Unknown clocks fail closed.

Server parsing allowlists numeric fields, binds proof to the authenticated lease
ACK and checks persisted event/target identities. No query-only response, timeout,
heartbeat, legacy object label or plain zero ACK qualifies. No schema migration
or parallel uploader is introduced. Proof is Agent attestation under the existing
scoped-credential trust boundary, not independent cryptographic native attestation.
Delayed ACKs, clock skew, missing/truncated event detail and targets above
99,999,999 conservatively cannot use the empty path. Larger targets retain the
old bounded native token and the nonzero recovery path.

This proof certifies an object refresh without a newly retained large/giant row;
it does not establish that there were no mushrooms of any size. It does not
replace post-deployment or repair acceptance of three distinct new nonzero
targets, including native, accepted upload and persistent server ACK evidence.

## Release boundary

Publish the reviewed website code separately, then prepare a device-specific
scoped port from each freshly read installed source. The previous pending-byte
port tool deliberately does **not** install this contract. Preserve its protected
uploader, auth, guards, configuration, cursor and recovery functions. The generic
source must not be copied over a scoped installation. No scoped port or device
deployment is claimed here; it depends on the separately authorized website
publication and per-device maintenance/identity/backup/acceptance gates.

One device at a time: three-way identity check, avoid formal verification, verify
root-only complete guest backup before stopping the original Agent at its accepted
prefix/no-pending boundary, preserve Cancer guard and all local protections, then
verify the exact installed source and three new nonzero targets. No game, Hunter,
route, data cleanup, cursor reset, host reboot or new polling service is needed.

## Statistics and baseline

Soak observations now count only level3/4 and expose both stored observation-row
count and distinct location count, bounded by both server receipt endpoints.
Public discovery times and historical `discovered_by` are not current uploader
production or a complete historical discovery ledger. ACK completed-point totals
include verification; ACK rows/bytes are captured prefixes, not accepted-row totals.

Effective ordinary scan time, reliable object-empty count, refresh failures and
accepted large/giant rows per100 effective points require a complete target/lease
and evidence denominator. Until available, report them as unknown. Existing
allocation comparisons use recorded attempt durations and eligible challenge
counts; do not relabel them as this new denominator. Keep recheck, maintenance,
protection and unknown time independent. Segment by region and each device's
actual policy cutover. Require a complete post-cutover48h per device, followed by
one week of observation; do not derive a fixed yield alarm from mixed history.
The7/7/10h overview windows and12h intelligence lookbacks remain independent.

Validation uses local SQLite, fake requests and shell fixtures; it does not prove
production D1 timing, Android process/clock behavior, long-running stability or
real Discord delivery. See PR CI and the private operational handoff for exact
test commands, source hashes and rollout limits.

## Independent-review correction

A persisted ACK retry always removes the trailing `recovery_version` extension
from the outgoing request. It does not modify the saved pending record, lease,
rows/bytes, accepted cursor, or existing scan diagnostics. The original game may
have exited or restarted after sampling, so a zero pending-byte header alone is
not sufficient to replay that witness. A later fresh ordinary target must supply
new empty evidence (or the original nonzero path); retries do not mint new proof.
If the first ACK already committed, duplicate handling preserves that original
event rather than inventing a new completion time. This is still a bounded
Agent attestation at the initial request, not a promise of later uptime.

## Scoped deployment preparation

`phone_agent/tools/scoped-empty-recovery.py` prepares an offline 2.2.17 to
2.2.18 patch from the exact reviewed generic reference and the actual installed
Agent source. It has no device or network access. It refuses unknown versions,
already patched sources, ambiguous anchors and locally divergent ACK retries.
The proof records original/candidate hashes and verifies unchanged bytes outside
the allowed edits, including local authentication, uploader, control, snapshot
and pending-byte functions. It does not copy a config, credential or instance.

Run `python3 phone_agent/tests/scoped-empty-recovery-test.py` and the existing
empty-recovery, late-object, ACK-upload-boundary and pending-upload-bytes shell
regressions against each generated scoped candidate. This is preparation only:
follow the local identity, maintenance exclusion, verified guest backup, sync,
safe drain and single original service procedure for installation. Preserve
pending/TSV/cursor state and local guards. Do not restart the game merely to
change the shell Agent, and do not bypass the original service start buffer.

Keep per-member cutover times, actual loaded runtime hashes and acceptance
evidence outside Git. Verify three different new nonzero ordinary targets;
successful empty acknowledgements do not substitute for that acceptance. The
new empty extension remains an Agent attestation and does not establish uptime.
