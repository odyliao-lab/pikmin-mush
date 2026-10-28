# Independent mushroom maintenance

## Architecture

- Main: dedicated Cloudflare Worker `maintenance-worker/`, every 15 minutes
  (UTC minutes 2,17,32,47). No public route, Sites migration, or phone dependency.
- Secondary: existing GitHub Actions maintenance workflow; its existing secret is unchanged.
- Final fallback: Agent upload background task, after one hour without successful
  cleanup or while bounded batches need draining. Upload response does not wait.
- All paths share the existing D1 five-minute lease and bounded deletion limits.
  Retention periods, fleet rotation and mushroom report schedules are unchanged.

The external Worker only POSTs to the fixed HTTPS maintenance endpoint. Redirects
are refused. It retries at most twice and requires a recent cleanup timestamp and
an explicit independent-source acknowledgement; HTTP200 alone is insufficient.

## Status and alerts

`maintenance_state` retains GitHub success in `mushroom-retention-scheduled`,
independent success in `mushroom-retention-independent`, and cleanup results in
`mushroom-retention`. A manual request must not impersonate either scheduled source.

- Healthy: either scheduled source has succeeded in three hours and mushroom
  cleanup is recent, with no persistent mushroom backlog, fewer than two history
  failures and no history backlog lasting24h. GitHub alone being late is not an alert.
- Degraded: both schedules are late but cleanup succeeded within one hour. The
  notice explicitly says cleanup remains normal; no phone restart is requested.
- Critical: cleanup older than one hour, at least two consecutive failures, or
  actual pending mushroom deletions persist for one hour. Full history batches
  alone do not prove mushroom backlog. The first observed pending timestamp is
  stored durably and reset when pending becomes zero.
- History cleanup independently raises critical after two consecutive history
  failures or a positive history pending count lasting at least24h. Mushroom
  `pending=0` / `consecutiveFailures=0` do not negate those reasons. The notice
  identifies mushroom, history, or combined causes; a saturated batch alone is
  not a critical reason.
- Separate alert keys permit immediate escalation; accepted Discord sends throttle
  the same severity for24h. Failed delivery retries after5min, not a24h suppression.
- If the site cannot return a valid receipt, the independent Worker sends a separate
  connectivity/credential warning. Cloudflare KV limits that warning to once daily.
  KV is eventually consistent, so this limiter is best-effort, not exactly-once.

No notification body includes private GPS, response bodies, or secrets. No forced
failure test should be sent to production Discord.

### Diagnostic fields (2026-10-28 fix; not deployed)

Fix base: `7fdd9a106a724f49b6d2f854e4e636f135df80ba`, isolated branch
`codex/maintenance-health-diagnostics-20261028`, targeting main through PR review.
This patch is not a live
deployment or a claim that production alert delivery has recovered.

The GitHub response parser logs an allowlisted `maintenanceHealth` JSON object:
severity, individual reason booleans, mushroom/history pending counts, history
consecutive failures and the history backlog start. Missing legacy fields remain
`null`, not `false` or zero. `evaluatedAt`, `cleanupAge` and scheduled receipts use
seconds; `historyBacklogSinceMs` and `responseAtMs` use milliseconds. `workflowSha`
identifies the Actions workflow revision only; it is not the deployed Site SHA.
Correlate the Site deployment/source separately before attributing a live result
to a repository version.

Alert events retain their existing names and add `attemptedAt` (seconds) and
`httpStatus` (integer or null). Failure records in the alert's own
`maintenance_state` row use `last_failed_at` and a fixed `last_failure_stage`:
`request` means no HTTP response was obtained, `http_<status>` means HTTP rejection,
`http_unknown` means no usable status, and `record_success` means HTTP succeeded
but storing its success receipt failed. The last case does not prove that Discord
rejected delivery. Failure persistence is best effort; the structured event is
still emitted if the database write fails. Old failure receipts are historical
and must be compared with the latest success/attempt timestamps. No raw remote
body, exception text, URL or credential is retained. Cleanup receipts, severity
thresholds, five-minute retry and24h success throttling are unchanged.

These changes expose causes; they do not clear history backlog or establish
recovery. After an authorized deployment, inspect existing natural runs and
read-only state snapshots for reason fields, distinct history pending trends,
and alert attempt/success/failure timestamps. A single successful cleanup or
notification does not establish sustained recovery. Do not increase retention
budgets or change periods solely to make the health label green.

Local validation of this candidate: Site build and151 tests pass, including seven
new reason/notification/parser regression tests; the independent scheduler's
three existing tests also pass. These tests use local SQLite and fake network
responses. They do not send maintenance requests or Discord notifications.
Lint has zero errors and the existing unused `restoreRetentionBackup` import
warning in the regression helper. The production lockfile audit reports no
moderate, high or critical advisories.
Read-only live snapshots contain history cleanup receipts dated2026-10-28 at
12:17 and12:32 Asia/Taipei: pending2103303 →2102890, zero history consecutive
failures, and unchanged backlog
start1792814536741. Mushroom pending/failures remain0/0. This short net decrease
does not prove sustainable drainage or recovery, and it does not retroactively
recover omitted reason fields from the two historical Actions responses.

## Provisioning (Cloudflare account login required)

Sites owns its own Worker and D1. Do not deploy this helper over the Sites Worker,
change Sites hosting configuration, or reuse platform-owned Cloudflare credentials.

1. From `site/`, use the installed Wrangler to login to the user's Cloudflare account.
   Select the intended account explicitly if more than one is available. If the
   account has never used Workers, initialize its account-level `workers.dev`
   subdomain in Workers & Pages first. Otherwise Wrangler may upload the script
   but fail to attach the cron with Cloudflare error 10063. Keep this helper's
   `workers_dev` and preview routes disabled.
2. Create a KV namespace for the helper's alert throttle. Put its returned ID and
   account ID in an ignored `maintenance-worker/wrangler.local.jsonc`, retaining
   the committed config and adding binding `ALERT_STATE`. No tokens in config.
3. Deploy first with `triggers.crons=[]`; generate a new scoped secret and install
   it as `INDEPENDENT_MAINTENANCE_TOKEN` on Sites, `MAINTENANCE_TOKEN` on the helper.
   Install `DISCORD_WEBHOOK` via Wrangler secret stdin, never argv. Preserve the
   existing GitHub/Sites `MAINTENANCE_TOKEN`; never extract GitHub secrets through CI.
4. Publish the Site endpoint changes; verify authenticated POST and schema tests.
5. Deploy helper with minutes2,17,32,47 enabled. Verify real scheduled execution,
   a fresh `mushroom-retention-independent` receipt and site pending/failure counts.
   A local test, manual request or deployed code alone does not prove cron works.
6. Observe two natural triggers. Retain GitHub and upload fallback throughout.

After activation, the D1 `mushroom-retention-independent` timestamp should
advance at each scheduled minute. Record that timestamp alongside the cleanup
success and failure counts; a successful deploy or manual POST is insufficient.

Before account login/provisioning, the helper is **prepared, not deployed**. Do not
claim the independent schedule is active until its natural trigger is observed.

## Tests and rollback

- `cd site; npm test; npm audit --omit=dev`
- `node --test maintenance-worker/index.test.mjs`
- Rollback helper by setting its cron list empty; leave the Site/GitHub/fallback
  running. Do not erase maintenance history or lower alert thresholds to hide failure.
