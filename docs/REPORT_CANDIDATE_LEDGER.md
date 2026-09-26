# Scheduled report contract 2 (2026-09-26)

## Incident and boundary

A report prepared at 05:30 could correctly recheck a candidate but later drop it
when the sender fetched the public map for 00:00–07:00 again. Public `first_seen`
can change on a challenge transition. In addition, candidates discovered between
preparation and publication were never appended, and total caps silently omitted
overflow. A completed verification also disappeared when a scan loop deleted its
targets. These are separate failure modes.

## New interfaces

- Authenticated `GET /api/controller/report-candidates?from=SECONDS&to=SECONDS&level=3|4`:
  half-open `[from,to)` immutable `mushroom_challenges.first_recorded_at` membership;
  current eligible snapshot, 500-row cursor pages, at most 48 hours, no public cache.
- `POST /api/controller/verification` with `contract:2`: immutable bounded wave,
  80 large / 30 giant maximum; one atomic D1 insert transaction including return
  waypoint. Does not cancel other batches. Old manual contract remains compatible.
- `GET /api/controller/verification?batch=...&contract=2`: exact target, completed
  agent and lease-time observation, full type/count/challenge evidence. The current
  POI snapshot may veto old approval (new challenge, participants, expiry), but
  cannot replace the observation with an unrelated upload.
- Additive migration 0022 extends target archives with lease/batch metadata.
  Rotation preserves recheck evidence; pre-migration archives are NOT backfilled
  with invented evidence. Data retain existing retention bounds.

## Discord service

Implemented separately in `ody-discord-bot/app/pikmin_report_ledger.py`.
07:00 / 14:00 / 00:00 and 90-minute lead/grace remain unchanged. Every five
minutes, intake appends candidates through the publication cutoff; final intake
must succeed before completeness is claimed. Immutable original snapshots and
challenge keys survive changes to public-map discovery timestamps.

80/30 are wave sizes, not total candidate/publication caps. One wave at a time
across both kinds, with persisted payload and idempotent replay. At the deadline,
partial results explicitly show pending counts; unconfirmed candidates can carry
once to the next window. A failed final intake is backfilled next window. Already
delivered reports/chunks are not replayed. No database/outbox reset during rollout.

Counts reconcile: candidates = eligible + invalid + pending; eligible = delivered
this time + previously delivered. Large/giant outputs stay separate and only
split for message length. Weekday giants require 1–4 participants after recheck;
weekend giants retain the no-recheck 0–4 policy and fresh final intake.

## Honest limits

`start_ms=0` is unresolved identity, not proof of a globally unique challenge.
Changing challenge key/type during a recheck remains explicitly unconfirmed,
not silently approved from a new spawn. A newly observed challenge is eligible
for its own discovery window. Identical idle respawns cannot always be identified
from available game fields. Old pre-observation-history discovery cannot be
reconstructed. Rechecks older than 3 hours are pending, not fresh approvals.
The service can report a backlog but cannot guarantee Leo can visit unlimited
points within 90 minutes. No change to scan allocation, device safety or mobile
modules is part of this release.

## Validation and rollout

Tests cover changed discovery time, cutoff arrival, >80 waves, midnight, challenge
change, failed intake, deferred carry, evidence after queue deletion, wrong
agent/target, later full participants, and outbox replay. Publish Sites first;
the notifier rejects contract mismatch, then deploy/restart the Discord service.
Confirm actual protected response/ACK evidence and the next timed report's
candidate reconciliation + confirmed Discord chunk IDs. A build or health check
alone is not real-window acceptance. Roll back the scheduler routing if needed,
while preserving additive migration and all ledger/outbox rows.
