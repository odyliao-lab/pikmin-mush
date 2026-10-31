# Parallel rechecks and one publication per report period

The Taichung notifier remains the only dispatcher, scheduler and sender.
An opt-in `parallel:true` contract-2 admission uses one durable active claim
per Agent, up to three claims under the same configured owner. Legacy claims
remain globally exclusive, including their return and resumed-data stages.
Unknown legacy queues, foreign owners and duplicate active candidate locations
block admission. Immutable replay and unknown-POST reconciliation are unchanged.

Migration 0034 retains all existing claims, defaults them to exclusive mode and
replaces the global unique index with an Agent-scoped active unique index.
The atomic admission transaction additionally enforces owner, mode, capacity,
live-queue and candidate conflicts. Rotation still defers while any admission
is active. A worker finishes its own real return ACK and accepted ordinary
scan before it can be reused. No timeout-based stealing or fake closure.

The protected read-only verification-workers endpoint returns safe eligibility
and timing fields, respecting health, fresh data, current job, rotation-slot
qualification and power protection. Discovery does not enroll a worker: the
notifier requires independently verified device identity and root-only backup
approval. Test/unknown nodes are never automatically borrowed from API presence.
New qualified workers can be enrolled through the same verified procedure.

The notifier uses bounded 20-candidate waves, two workers normally, a third when
estimated clearance plus buffer exceeds available time. Candidate membership,
receipt attribution, challenge identity checks, and participant requirements
remain unchanged. Weekend giant capacity reserves unresolved in-flight
candidates so parallel work cannot overbook the 30-result publication budget.
Each wave is polled independently; unknown transport state remains attached to
its original worker and immutable ID. Shared controller auth denial stops the
new workflow until operator review.

New scheduled periods gather large and giant results in one frozen outbox
publication at 07:00/14:00/23:00 Asia/Taipei. Only message length creates multiple
chunks. There are no progress posts or 30-minute supplements for these periods.
At cutoff, unresolved items remain explicit pending; failed final intake gets
five minutes of bounded grace, then a visibly partial publication. Already
admitted work drains its return safely, without rewriting the published pending
decisions or sending a late supplement. Original discovery windows and bounded
next-period carry remain intact. Old periods retain their original behavior.

Operator-requested one-time runs freeze an exact eight-hour half-open window
at enqueue, wait for full verification/return completion or a bounded 90-minute
deadline, then use the same unified publisher. They run only through the existing
service tick. Restart resumes only unacknowledged chunks; ambiguous Discord sends
require reconciliation and are never blindly replayed.

Deployment gate: finish the existing 2026-10-31 14:00 reports and real return
proofs before changing the formal service or cloud. Preserve credentials,
SQLite/outbox state, game/native/Agent installations, regional routes, unrelated
MuMu/LINE/Discord/fleet-summary and website-cleanup schedules. Record production
backups, enrollment, immutable eight-hour bounds, concurrent Agent evidence,
return/resumed-data proofs, single outbox key and Discord readback privately.
