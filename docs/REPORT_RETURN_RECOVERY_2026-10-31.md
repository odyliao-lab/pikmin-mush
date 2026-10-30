# Cancelled report-return recovery — 2026-10-31

An admitted report wave can outlive the regional scan job. Previously automatic
rotation deferred candidate checks but not the return target or the subsequent
ordinary-data proof. Once candidates completed, rotation could cancel the return;
the durable admission correctly refused to close, blocking later reports.

Automatic rotation now waits for every live verification kind and every active
durable admission. Stop-job writes recheck admission inside the atomic batch;
manual redeploy refuses to preempt an active coordinated dispatch. Existing
04:00/12:00/20:00 scheduling, qualification and Berlin weighting are retained.

An explicitly authorized `recover-return` action on the existing protected
controller dispatch endpoint accepts the exact existing batch/owner and a stable
recovery ID. It requires complete candidate inventory, the original cancelled
return, a superseded/inactive original job, a fresh enabled/unpaused same agent,
a live different current job and no live verification queue. One atomic write
records the recovery and creates one current-route return continuation. The
original admission, candidates, cancelled return and original job ID are retained.

Retries with the same recovery ID reconcile the existing continuation; they do
not replay admission or create another return. The proof labels original and
recovery jobs separately. A valid same-agent return ACK followed by a new accepted
ordinary observation in that recovery job is required before normal close. A
heartbeat, cancelled row, unknown POST, empty result or timeout cannot unlock it.

The original Taichung service can hold an operator-authorized durable intent and
consume it in its existing tick. Unknown POST results are GET-reconciled, auth
denial stops the path, and an explicit bounded per-report resume authorization
keeps that report's frozen discovery window/candidates after its usual deadline.
Other reports retain their existing policy. No additional scheduler or sender.

Validation before publication: all182 Site tests pass, production build passes,
production dependency audit0; ESLint0 errors/one existing unused fixture import.
Taichung Python170 tests pass (two existing dependency warnings). Tests cover
cancelled/unknown states, original-job retention, rollback, idempotent recovery,
post-return data proof, automatic/manual rotation guard, lost POST reconciliation,
auth denial and fixed-window resume. Actual deployment and production scan/send
acceptance must be recorded separately in the private operations record.
