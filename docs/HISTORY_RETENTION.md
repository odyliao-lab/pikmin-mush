# History retention

The existing independent Cloudflare scheduler and GitHub fallback remain the only
schedulers. Both call the authenticated maintenance endpoint. No phone, rotation,
Discord notifier, or controller credential changes are required.

## Policies

- Existing mushroom snapshots: last observed more than 7 days ago; existing
  level 2/3 invalidation after 2 days is unchanged.
- Existing raw observations: 7 days; target history: 8 days.
- Agent events: 14 days. Closed power-pause intervals: 30 days after both resume
  and last receipt; open intervals are never removed.
- Copy, usage, report audit: 30 days in live queries. Report batches with queued
  or leased verification targets remain protected.
- Logs/terminal targets/closed jobs: 30 days, with parent and active-work guards.
  A job remains while targets, logs, target history, or rotation records refer to
  it. The latest job is always retained. Rotation history: 90 days.
- Challenge first-recorded identities, useful location catalogue, and upload
  receipt anchors are deliberately protected. Blind TTL would allow old data to
  become "new" or replay accepted uploads. Cold archival needs a queryable identity
  lookup and an acknowledged-stream compaction protocol before these can expire.

## Activation and recovery

Migration 0027 is additive. First successful maintenance initializes the durable
`history-retention-v1-policy` epoch. Additional policies run in dry-run mode for
48 hours, then automatically activate. Original 7/8-day cleanup stays active.
Before each additional deletion, the entire source row (including additive
columns) is atomically copied into `retention_backups`. A failed backup or delete
rolls back both statements. Backup JSON is private and never returned by an API.
Backups remain 7 additional days beyond the live retention period. Oversize rows
(JSON over 500,000 bytes) stay live and appear in backlog counts for investigation.

Extended maintenance shares an owner-fenced five-minute lock. Successful passes
release it immediately; failed passes retain the retry backoff. Routine work is
bounded to 2,000 archived rows and 2,000 expired backup removals per pass. Active
catch-up is bounded to 100,000 archived rows and 10,000 expired backup removals,
with per-transaction row/byte limits, rotating table order and a 15-second
between-query deletion budget. Existing failure receipts remain authoritative.
No wall-clock budget interrupts an in-flight D1 query; modified-table inventory
follows deletion, so monitor total request duration as well.

For an operator recovery, first move the policy epoch forward using a controlled
DB operation to re-enter dry-run while investigating. The library's
`restoreRetentionBackup(db,table,rowKey)` restores only unexpired allowlisted
rows and never overwrites a newer live key. Restore parent jobs before child
rows. There is intentionally no public restore or purge endpoint. Do not remove
backup tables or restore the entire production DB over newer observations.

## Inventory and alerts

`GET /api/admin/retention` accepts the existing signed-in administrator or
controller read credential, without granting any additional write capability.
It reads cached `retention_table_stats`; there is no SQL/refresh parameter.
The maintenance GET response includes the same `history` snapshot.
Totals refresh at most daily per table; eligible count, oldest eligible time,
last deletion count, checked time and safe error stage refresh on maintenance.
`row_count` is the snapshot at `counted_at`, not an exact count after later
deletes/uploads. Previous totals/timestamps allow growth comparisons. Counts are
actual SQL inventory, never cumulative upload counters. Database bytes are
reported only when D1 supplies a size metric; otherwise null.

Backlog covers every managed table rather than only mushroom snapshots. Dry-run
backlogs do not alert. Two extended failures or an active backlog lasting 24
hours escalate through the existing throttled maintenance health channel.
The original mushroom backlog alert remains unchanged. No new notification
service or duplicate scheduler is created.

Validate the first live dry-run inventory, advancing checked timestamps, no table
error stages, and normal map/upload/object/ACK flow. Full scans occur only in
scheduled maintenance, never on normal uploads or public map requests. Confirm
the first active pass after 48 hours has matching private backups and declining
eligible counts before claiming long-term storage stability.


## Backlog catch-up (2026-10-28)

The live overdue backlog target is at most **10,000 rows** across the extended
retention tables plus expired recovery copies (unexpired copies are excluded). Existing TTLs, protected identities, receipt anchors and the
seven-day atomic recovery copies are unchanged. Database bytes need not fall
immediately: recovery copies remain for seven days and D1 can reuse freed pages.

Routine passes may reuse their 2,000-row budget across rounds. When the cached
backlog exceeds 10,000, scheduled maintenance automatically uses catch-up mode:
at most 100,000 archived rows per pass, at most 5,000 rows and 2 MiB of recovery
JSON per atomic batch, with a 15-second between-query deletion budget. Accurate
inventory of modified tables follows the deletion budget, so total request time
can exceed 15 seconds. Oversize single rows remain live and visible as backlog.
Tables take turns, and parent jobs are retried after child rows are removed.
The indexed terminal-target cutoff avoids sorting the entire target table.

An owner-fenced durable lock replaces the post-success five-minute wait. It
still respects an in-flight legacy pass during rollout. Every archive/delete
checks the current owner; an expired invocation cannot delete after a new owner
has taken over, release another owner's lock or overwrite its success receipt.

`/admin/retention` is the existing administrator's operator page. Its bounded
`POST /api/admin/retention/run` requires the signed-in administrator, exact
same-origin JSON, and only `{action:"run"}`. Controller and Agent credentials do
not gain write access. The page submits serial bounded passes with three-second
gaps, stops on failure/no progress/target attainment, and supports stopping future
passes. Closing the page stops subsequent passes, not an already admitted batch.
No scheduler is added; normal Cloudflare/GitHub schedules continue. A busy
scheduled caller can explicitly report an existing completed pass within five
minutes without claiming the in-flight pass completed; stale or failing prior
receipts remain failures. Per-table error stages remain visible after a later
chunk fails even if earlier chunks succeeded.

Acceptance requires protected live identity/receipt tables to remain present,
current targets/leases and uploads to continue, confirmed recovery-copy growth
and declining overdue counts, and a final cached inventory at or below target.
A successful deployment or a growing cumulative deletion counter alone is not
acceptance. Store the operator's before/after evidence outside the repository.

Failed passes retain a five-minute retry backoff. Each successful pass verifies an indexed recovery-copy count for its archive timestamp before returning a success receipt.
