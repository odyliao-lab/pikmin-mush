# Maintenance receipt diagnostics, 2026-11-09

## Scope and evidence

This source candidate starts at `0317521f28b72096de9c68c415c1dc35253ed095`.
It is a local repair and diagnostic improvement, not a deployment or a claim of
production recovery. The HTTP 503 responses in natural GitHub runs
[42542091138](https://github.com/odyliao-lab/pikmin-mush/actions/runs/42542091138)
and [42582092556](https://github.com/odyliao-lab/pikmin-mush/actions/runs/42582092556)
did not retain the endpoint's failure stage. Their exact cause remains unknown.
A later successful request does not reconstruct that missing evidence.

Two local fixed-clock regressions demonstrate a mushroom receipt memo defect:

- A successful receipt cached at age 299 seconds can be returned at age 301
  seconds, even if another owner has already recorded a newer success.
- A lock loser can cache an old unsuccessful receipt and keep returning it after
  the owner completes. This unnecessarily extends the local observation delay.

Both tests fail on the base source and pass with the repair. The 30-second memo
now requires a valid, recent success and zero recorded failures. Invalid entries
cause a normal D1 probe; no new retry loop or forced cleanup is introduced. D1's
five-minute claim guard remains authoritative and unchanged.

History retention releases a successful owner's lock immediately. It does not
have a separate successful-run throttle exceeding the receipt window. Its busy
result can represent another owner, a failed-run backoff, or legacy invocation
protection. Busy alone is not a success receipt. A busy result without a recent
successful receipt still returns HTTP 503 and does not update the source marker.

The integer-second mushroom lease can remain protected in the fractional second
just after the strict 300-second receipt boundary. That request continues to fail
closed. This patch does not shorten the lease or relax receipt validation to hide
that boundary.

## Changes

- Authenticated POST failures return HTTP 503 plus `maintenanceFailure`, and emit
  the matching `maintenance_request_failed` event. Stages are fixed: `schema`,
  `mushroom_run`, `mushroom_receipt`, `history_run`, `history_receipt`,
  `source_receipt`, `health`, and `snapshot`.
- Receipt rejection reasons distinguish invalid/future timestamps, stale success,
  incomplete history work, recorded failures, and table failures. Mushroom
  validation now also rejects non-finite/far-future success and recorded failures;
  it never converts an unsuccessful receipt into success.
- The summary contains only allowlisted event names, numeric timestamps/failure
  counts, and booleans. Mushroom timestamps use seconds; fields ending in `Ms`
  use milliseconds. `historyBusy=null` means the run did not return that state.
- `sourceReceiptRecorded=true` distinguishes later health/snapshot failures from
  a receipt rejected before the source marker write. Such HTTP 503 responses
  must not be interpreted as proof that cleanup itself failed. Existing marker
  write ordering and HTTP failure semantics are unchanged.
- Actions preserves HTTP status and the allowlisted failure summary even when
  curl rejects a non-2xx response. Missing legacy or malformed fields remain
  unknown/null. Raw response bodies, errors, URLs, tokens and fleet rows are not
  printed. A rejected request still fails the job.
- Fleet delivery logs its own HTTP status, or a request-stage failure with no
  status. A fleet HTTP 404 is distinct from the maintenance endpoint's HTTP 503.
  Notification destinations, contents, trigger rules, secrets and retries are
  unchanged. No notification was sent to validate this change.

Retention periods, deletion budgets, archive byte safeguards, history locks,
cron schedules, independent Worker behavior, and device operations are unchanged.
No forced maintenance request, workflow rerun, credential change, remote push,
merge, or production deployment is part of this candidate.

## Verification and next step

Regression tests use a fixed clock, local SQLite, VM-injected dependencies, and
stubbed Python transports. They cover the memo failures, busy/stale history,
receipt boundaries, stage-specific failures, authentication, source marker
ordering, malformed responses, and absence of private strings from diagnostics.

Local validation on Node 24.22.1: Site build passes; 217 Site tests and all 10
independent Worker tests pass. Lint has zero errors and the existing unused
`restoreRetentionBackup` import warning. Production lockfile audit reports no
moderate, high, or critical advisories. Standalone `tsc --noEmit` still fails with
104 pre-existing diagnostics, including missing Cloudflare worker/D1 types;
compiler-host comparison against the base versions of both changed TypeScript
files produced the same 104 diagnostics, with no additions (ignoring line
offsets). This is not a claim of a clean standalone typecheck or remote CI run.

After review and any separately authorized publication/deployment, observe natural
scheduled runs and correlate their new stage/reason with existing D1 receipts.
Do not label either historical 503 as a cache or history race without that
correlation. Repairing a failed notification destination is a separate authorized
operation; this patch does not establish notification recovery.
