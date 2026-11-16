# Bounded fleet baseline report proposal

Status: offline core, conservative SELECT adapter and default-disabled authenticated
API candidate implemented and locally tested; production profiling, deployment
and private readback remain pending. This document defines a read-only measurement supplement to
[allocation comparisons](../site/lib/allocation-comparison.mjs). It does not
enable allocation, add a collector or certify a baseline.

## Offline reference core

[`fleet-baseline-core.mjs`](../site/lib/fleet-baseline-core.mjs) provides pure
`baselineWindow` and `buildFleetBaseline` functions over an explicitly complete
retained-history snapshot. It has no database, network or device access. A total
input-row cap bounds this reference calculation; truncated, missing, ambiguous
or oversized input returns unknown aggregates, while a validated complete empty
snapshot can report zero. The cap is not a validated Worker query/memory budget.

Unknown count/capacity/finish metadata is recorded separately from known
ineligible observations; completeness of eligible counts is explicit. The
reference calculation leaves caller-owned snapshot and pending/cursor data
unchanged and emits no raw observation, challenge, Agent or lease identifiers.

The core computes fleet unions, retained-history first/repeat, reconciled receipt
partitions, terminal retry accounting and persisted job/cycle event spans. It
keeps full-cycle hours, active-qualified wall time, verified-empty witnesses,
spare budget and rollout readiness unknown/false. It uses the earliest retained
completion attempt for receipt alignment so a later ACK retry cannot absorb a
late row. Current targets take precedence over an archived duplicate.

[`fleet-baseline-core.test.mjs`](../site/tests/fleet-baseline-core.test.mjs)
exercises these semantics with synthetic complete/incomplete snapshots. This is
a reference for the bounded SELECT candidate, not a request to export unbounded
production history into memory. Local migrated-SQLite fixtures exercise the actual
SELECTs, route authorization and no-write behavior; production cost profiling
and live private readback are still required before enabling the candidate.

## Conservative read candidate

[`fleet-baseline-read.mjs`](../site/lib/fleet-baseline-read.mjs) reads a capped
retained-history projection through one D1 SELECT batch. The initial history
epoch read is checked again inside the batch. Missing schema/index/epoch,
epoch drift, failed or incomplete reads and limit overflows return503 with
unknown aggregates. There is no schema initialization, retry, pagination,
dispatch, cleanup or fallback to separately timed queries.

The authenticated [GET route](../site/app/api/admin/fleet-baseline/route.ts) is
disabled unless `FLEET_BASELINE_READ_ENABLED=1`. The default is0; this is a
separate read-only release gate, not canary opt-in. All responses are private
and no-store. Administrator/controller checks precede the flag and all DB work;
neither Agent credentials nor anonymous access are accepted.

The effective lookback starts at the later of corrected-history epoch and the
seven-day physical observation-retention boundary. Candidate limits are20,000
rows per collection plus an overflow sentinel,4MiB projected snapshot,256 cycle
groups and128KiB response. The five collections remain within the reference
core's100,000-row cap. Receipt and event range scans require the existing time
indexes; target/challenge lookups use primary keys. Oversized identifiers become
invalid/unknown; event detail is reduced to the diagnostic enum inside SQL.

This intentionally conservative implementation can reject a dense retained
history even when the requested window is small. A LIMIT bounds returned rows,
not database rows scanned or query time. Reported D1 reads above1,000,000 reject
the result **after execution**; this is not a cancellation mechanism or a
proven safe production allowance. Missing cost metadata is not zero cost.
Profile real D1 execution/memory and optimize lookback projection as needed
before authorizing publication/enabling the flag. No production48h baseline,
active-qualified hours, spare budget or verified-empty witness is established.

[`fleet-baseline-read.test.mjs`](../site/tests/fleet-baseline-read.test.mjs)
uses the real migrated schema with SQLite query-only mode, validates SQL/core
equivalence, indexes, sentinel/byte/output limits, epoch drift and route gates.
These local results do not prove D1 production isolation/performance or native
device execution. D1 batch behavior follows the
[official binding contract](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

## Missing measurements

The existing city comparison provides absolute receipt/completion windows and
ordinary-target effort. Its Agent/city challenge subtotals overlap, and its
attempt-attributed population omits late/background receipts. Neither those
subtotals nor captured TSV rows can establish exclusive fleet production,
first/repeat discovery, full cycle time or active-Agent wall time.

Keep the [large/giant policy](LARGE_GIANT_ONLY_POLICY_2026-11-12.md) and the
[empty recovery evidence boundary](EMPTY_RECOVERY_CONTRACT.md). A successful
empty ACK does not replace post-deployment nonzero-chain acceptance. Unknown
client cutovers limit client captured/wire comparisons; server-filtered level3/4
observations form a separate population.

## Proposed request and read boundary

Candidate endpoint: `GET /api/admin/fleet-baseline?from=<ms>&to=<ms>`.
It exists only in this unshipped, default-disabled candidate.

- Require the existing administrator or controller authorization before DB work.
  Keep private/no-store responses and existing credentials. No public access,
  alternate token, authentication relaxation or identity-header impersonation.
- Reuse the absolute half-open `[from,to)` rules in `comparisonWindow`: safe
  integer milliseconds, both bounds present, one hour to seven days, no future
  end, and within retained corrected history. Missing history epoch is unavailable,
  not an instruction to initialize it.
- Issue SELECTs against existing schema only. Do not call `rotationStatus`,
  `ensureDailyRotation`, task claim, cleanup, dispatch or schema initialization;
  do not insert a maintenance epoch from this GET. Missing schema returns503.
- Return fixed numeric aggregates and explicit availability metadata. Exclude
  coordinates, location/challenge IDs, lease values, credentials, arbitrary
  event detail and raw process/device evidence.
- A bounded query plan and output cap must be profiled before deployment. Any
  timeout, truncation, retention gap or response cap leaves the affected measure
  unknown or explicitly incomplete; never substitute zero or set readiness true.
  Do not start a polling service, scheduled sender or background DB export.

## Separate populations

1. **Accepted observation rows:** count stored `mushroom_observations` rows with
   `level IN (3,4)` and server `received_at` inside the requested interval. Use
   integer second bounds equivalent to `[from,to)` in milliseconds. Receipt
   retries retain their existing deduplication identity; these are stored rows,
   not every attempted wire row or every upload delivery.
2. **Resolved challenges:** fleet-wide `COUNT(DISTINCT challenge_key)` after the
   same receipt/level filtering and `identity_confidence='challenge_start'`.
   Deduplicate across Agents, targets and cities. Report unresolved stored rows
   separately; do not invent a distinct challenge count for unresolved identities.
3. **Eligible opportunities:** additionally require known positive capacity,
   `0 <= challenger_count < 5`, count no greater than capacity, and no known
   finish before receipt. Report this as eligible-at-receipt history, not current
   availability. A challenge observed at both levels can appear in both level
   subtotals; their union is the fleet distinct total, not their sum.
4. **Attribution:** partition accepted rows into ordinary-target attempt-aligned,
   late/background, verification/return and missing/orphan target attribution.
   Preserve all partitions in accounting. Do not discard late receipts or attach
   them to a nearby ACK without evidence. Eligible challenge partitions may
   overlap; row partitions must reconcile to the stored-row total.
5. **First/repeat in retained history:** derive the earliest retained level3/4
   observation, not `mushroom_challenges.first_recorded_at`, which is shared by
   older levels. Name these measures as first/repeat *within retained history*.
   Include known lookback coverage and left-censoring; unresolved or unavailable
   history remains unknown. Do not advertise first-ever global discoveries.

Agent/city contributions may overlap in challenge counts and must be labelled
non-additive. Fleet distinct counts must be computed from the union population,
not by adding those contributions. Do not change stored challenge identity or
replay uploads to make the report fit a new definition.

## Effort, cycles and evidence

Use current targets plus `scan_target_history`, preferring the current record
once when IDs overlap. Normal effort excludes verification and return targets.
Deduplicate ACK terminal events by Agent/target inside the requested report;
declare the rule and keep failures, missing evidence and orphan records visible.
Separately identify retries crossing adjacent report boundaries so summing
window reports cannot silently turn retry ACKs into unique points.

Expose job/cycle attribution only where persisted target/history fields prove
it. Never assign an archived target the current job's latest cycle. Distinguish
first/last observed event span, recorded attempt durations and a genuinely
reconstructable full cycle; a partial cycle is not a first-round completion.
Cycle count or shifted-grid rounds alone do not measure redundant coverage.

Report diagnostic evidence coverage. Object-empty, query-only, timeout,
unclassified zero and accepted nonzero are separate populations. Unknown or
malformed evidence does not become successful empty scanning. Preserve the
existing bounded evidence parser and [ACK evidence route](../site/lib/target-ack-evidence.mjs).

Active qualified Agent wall time needs historical eligibility, maintenance,
protection, recheck and offline intervals. Current registration/online counts,
heartbeat counts and sums of attempt durations cannot replace that history.
Until those intervals are reconstructable, normalized active-Agent-hour rates
and spare route capacity remain null. Keep recorded-attempt rates explicitly
named and separate from wall-time rates.

## Readiness and required validation

The response must distinguish query-range coverage, policy/population provenance,
two reconstructable windows per rotation slot, diagnostic/attribution coverage
and comparison readiness. An elapsed48h request is only one check. Keep
`activation_ready:false`; rollout requires its own review and explicit canary
opt-in under [release gates](RELEASE_GATES.md). Preserve04/12/20 rotation,
local-date eligibility, Berlin weight, land masks and Japan/Taiwan exclusions.

Before implementing a release, cover these behavioral fixtures:

- Authorization failures perform no DB work; valid requests perform no mutations.
- Seconds/milliseconds and both boundary instants; malformed, future, expired
  or missing-epoch windows; unavailable queries return unknown/incomplete.
- One challenge across Agents/cities/targets and at both retained levels;
  level1/2 exclusion without changing receipt/cursor/pending state.
- A challenge first seen at level2 and later3; left-censored and unresolved
  history; first-in-retained-history differs from first-ever discovery.
- Late/background uploads after ACK, missing target attribution, failed target,
  rechecks/returns, current/archive duplicates, and cross-window ACK retries.
- Partial cycles, absent archived cycle/city, changing fleet eligibility and
  unavailable wall-time intervals; no assumed full Agent-hour denominator.
- Empty recovery witness, query-only, timeout, malformed detail and absent proof
  remain distinct; report generation never restarts an Agent or dispatches work.
- Output whitelist, bounded execution and no automatic activation on dense or
  sparse fixtures. Preserve the existing upload/ACK/auth regression suites.

Private production samples and device cutovers stay outside Git. A future
implementation needs isolated tests, an immutable source/build, separately
authorized publication and an authenticated readback. Revert an unshipped report
candidate through Git; a published read-only route must not require reverting
Agent data, migrations, cursors or the retained-size policy.
