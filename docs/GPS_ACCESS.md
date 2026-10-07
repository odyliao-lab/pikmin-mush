# GPS access boundary

Only the dispatch-authenticated `ody.liao@gmail.com` account can open the scan
console or change the GPS password. Existing controller-authorized operational
APIs remain separate: notifier, candidate ledger, verification and fleet reads
retain their service authentication and exact data contract. No schedule,
candidate filters, quota, phone configuration or Discord formatting changed.

Anonymous mushroom reads return null latitude/longitude, omit cluster and live
agent locations, ignore bounding boxes and allow only coarse catalogue city
search. Password holders can load exact map markers and copy GPS; inline GPS
text remains owner-only. Coordinates already delivered cannot be retracted;
shared passwords can still be shared. This is access control, not copy prevention.

Owner sets a 12–128 character password in the console's “GPS 複製密碼” disclosure.
Until configured, visitor GPS access fails closed. Passwords are salted PBKDF2
SHA256 (100000 iterations), never plaintext in storage. Browser grants are
purpose-separated HMAC-signed `__Host-` HttpOnly/Secure/SameSite=Strict cookies,
valid 12 hours from successful unlock. Each protected read checks the current
password revision; rotation invalidates existing grants. No password or grant
is put in localStorage or a URL. Signing uses the existing server-only audit key.

Unlock attempts use a persistent per-source 10/15-minute budget. Sources are
purpose-separated keyed hashes, not stored IP addresses. Cleanup deletes at most
20 source budgets older than 24 hours per admitted attempt, using a window index.
It never touches mushroom or report state. Password-holder map reads retain the
public read guard. Owner/controller exact reads bypass shared response caching.
Anonymous responses use a new redacted cache namespace so old GPS cache entries
cannot be reused. All security/status endpoints are private/no-store.

Release verification: build, full site tests, lint and production dependency audit;
Discord read-auth/format/ledger tests; live anonymous GPS redaction, spatial-probe
rejection, forged identity denial, private controller reads and candidate GET.
Do not emit GPS/credentials or send test Discord reports. Human owner login and
password configuration are separate from automated server-side acceptance.

Rollback: do not roll back to a pre-protection public API (it exposes GPS).
Disable visitor access by owner password rotation if needed; preserve migrations
and report state. Fix forward for frontend defects while leaving server redaction
enabled. Existing device/controller tokens must not be changed for this feature.
