# Scoped pending-byte telemetry integration

This is the Agent-side integration procedure for the2.2.17 candidate. It does
not publish a site, change a Bot, establish device acceptance or authorize a PR
merge. Keep private device snapshots and credentials outside the repository.

## Minimal offline port

Read the local lifecycle handoff and reidentify each device before collecting
its script. Confirm the existing3/4 filter, coherent snapshot, late-object
recount and pending-end/six-column compatibility independently. A version label
alone is insufficient. Preserve each scoped uploader, authentication, DNS,
timeouts, boot/cgroup guards and recovery policy.

`phone_agent/tools/scoped-pending-telemetry.py` takes a private2.2.16 script and
prepares a candidate without accessing devices or overwriting its inputs:

```text
python phone_agent/tools/scoped-pending-telemetry.py --original <private-original.sh> --output <private-candidate.sh> --receipt <private-comparison.json>
```

The tool adds the pending function, the two existing request wrappers' headers
and assignments, and the default version. It reverses only those changes to
verify byte equality with the input, and separately checks the uploader,
snapshot, scan execution and ACK functions. Unexpected versions, line endings
or wrapper layouts require review. It does not force an unfamiliar script into
the generic implementation.

## Unknown versus zero

Known zero requires a readable regular TSV, a valid matching durable cursor,
and a complete final newline for every nonempty file. An incomplete record is
unknown even when offset equals file size. This avoids reporting a false clear
state at an invalid EOF. An unreadable/missing cursor or a cursor that differs
from the in-memory value also stays unknown: the old startup normalization and
uploader behavior are preserved. A changed size during the read stays unknown.
Unknown omits the header value; it never resets the cursor or clears pendingACK.

## Validation and deployment boundary

Run syntax, auth-stdin, pending-upload-bytes, scan-accounting, scan-late-object,
scan-ack-upload-boundary and the local recovery/lifecycle suites against each
actual scoped variant. Exercise both DNS modes, task/control paths, known zero,
positive and unknown data; retain stdin authentication and the original10/45s
task and3/5s control timeouts. Use fixtures for missing files, invalid cursors,
partial rows and the server's two-hour stall classifier. Never block production
uploads, manufacture pending or change a production cursor for a test.

Before mutation, verify guest-only root-private backups and their permissions,
extraction, hashes and copied-offset<=copied-TSV boundary; flush and recheck.
At a normal target's drained/no-pending boundary, stop the identified unique
Agent and take a stopped-Agent backup. A live game means that backup still is
not a cross-file atomic snapshot. Install only the scoped patch and effective
version, compare other config/credential bytes in the guest, sync, and restart
the original service with its original grace and cgroup policy. An Agent-only
telemetry change does not itself require a game, Hunter or guest restart.

Verify the running script/hash/config, singleton and cgroup; then collect new
formal native-object -> nonzero3/4 TSV byte range -> accepted uploader cursor
-> independently matching site data -> persisted ACK chains under the local
acceptance gate. Valid object refreshes with no3/4 data are not failures. Keep
insufficient targets and any later natural-cold recovery explicitly pending.

Agent-side fixtures and accepted legacy upload/ACK are separate from production
telemetry acceptance. A site without the new parser may ignore the header;
that is compatible behavior, not proof of the new heartbeat field. After the
coordinated site release, verify actual sampled pending telemetry separately.
Do not infer a continuous48h baseline from the deployment time or mix another
host's cutover times with local measurements.
