# Public mushroom read guard (2026-10-07)

Only `/api/mushrooms` origin reads are affected. The website remains public;
this is not login or an allowlist and cannot prevent all copying of public data.
GitHub source visibility and website access are independent.

## Evidence and limits

A bounded Worker sample found 47 changing half-degree bbox requests within
15.986 seconds from one source. The 44 paired traces returned no mushrooms but
read 2,487,800 D1 rows. This proves expensive automated-looking spatial queries,
not successful theft, visitor identity, GitHub discovery, or Sites quota impact.

Admission is one atomic D1 upsert shared across Worker instances. Per salted
network source and fixed minute: at most 60 origin reads, 12 bbox changes, and
4 concurrent origin reads. Repeated identical bbox pagination does not spend
another spatial slot. Cache HITs bypass shared origin admission. Invalid or
arbitrary Authorization does not bypass admission. Only the existing validated
controller credential bypasses it, preserving trusted Discord queries. Agent
upload/task/ACK/control routes are unchanged.

Rejection is 429 with Retry-After and no-store, before mushroom/count queries.
Missing platform identity, missing hash key, or unavailable admission is 503;
it never silently disables protection. Each accepted miss costs an admission
write and release write. Each rejected origin attempt still costs one small
statement and a Worker request. This is not edge/WAF DDoS protection.

Raw IP, GPS, searches and tokens are not stored in the budget table. Sources
and bbox values are salted/hashed; the existing COPY_AUDIT_HASH_KEY must exist.
Leases expire in 60 seconds if release fails. Existing bounded maintenance
removes at most 500 budget records older than one hour per pass. No mushroom,
observation or upload receipt is deleted by this new stage.

## Acceptance and limitations

Real local D1 tests cover concurrent admission across independent callers,
rate/spatial limits, expiry, source isolation, privacy, and trusted-vs-fake
authorization. Existing tests preserve pagination, cache TTL and exclusions.
Live acceptance must check public reads/HIT, authenticated uncached Discord
reads, and natural Agent uploads/ACKs independently of build/CI success.

Users sharing a public IP share the budget. A fixed-minute boundary permits a
larger short burst; the concurrency cap still applies. IPv6/address rotation or
multiple sources can bypass per-source quotas. Neither private GitHub nor
README removal revokes previously copied URLs or public data. Monitor 429/503,
latency and D1 read/write costs before changing these limits.

## Recovery

Prefer a forward release adjusting only the public admission thresholds. Retain
the additive 0024 migration; never delete observation data. If the new guard
causes availability failures, a forward corrective release may restore the
previous public-reader integration while retaining the table and Discord auth.
Never weaken controller authentication or discard pending Agent uploads.
