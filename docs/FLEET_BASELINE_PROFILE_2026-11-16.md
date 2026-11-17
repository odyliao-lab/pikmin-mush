# Baseline report local query and memory profile

This is a completed local synthetic validation of PR224, not a deployment,
production D1 performance claim or qualified48h fleet baseline. The read flag
remains off. No production DB, Agent, credential, uploader, cursor, pending state,
device or existing inspection was changed.

## Method

The manual [profiler](../site/scripts/profile-fleet-baseline.mjs) bundles the
actual GET route and adapter into a local workerd Worker and applies the real
Drizzle migrations to an ephemeral Miniflare D1. It generates its own fixture
controller credential, binds only local storage, denies outbound Worker fetches,
and listens on loopback with ephemeral ports. It reads no hosting manifest,
`.env`, saved credential or production sample. Its instance is disposed in
`finally`; it is not a scheduled collector.

Baseline source: `dd68ca1e800eac6c1f86716b9e3ca03ee65cbe03`. Candidate source
and instrumented Worker SHA256s are recorded in the private profile result.
Both use the same generated workload and7 timed requests per case. Times are
host elapsed request-to-JSON times; local DB/IPC is included, production network
and production CPU limits are not. The sample p95 is nearest rank over7 requests,
not a stable service SLO. Runs are sequential on the same host.

The profiler injects local-only checkpoints, diagnostic-enum query metadata and
debugger pauses. Timed requests run with pauses disabled; a separate memory
request captures `Runtime.getHeapUsage` on the user Worker isolate at stages.
An actual heap-snapshot self-size is used for retained-after-GC observations.
Neither host Node RSS nor inspector heap capacity is called Worker live memory.
Stage samples are not continuous peaks, and JS heap/backing/embedder values do
not establish complete production Worker memory accounting or a128MB guarantee.
Local workerd need not enforce the production memory limit.

## Findings and fixes

- The original adapter exported up to80,005 projected rows before reporting an
  overflow. Maximum-key fixtures reached121.93MiB sampled JS used heap before
  rejection, plus backing storage. This was not a safe production-memory proof.
- Added indexed, sentinel-bounded preflight row/serialized-byte checks. Their
  results only reject; actual report data still comes from a rechecked SELECT
  batch. Growth after preflight remains unknown instead of becoming a partial0.
- Reduced projection to window data and actual first-receipt/prior-completion
  witnesses, retaining first/repeat, late receipt and cross-window retry rules.
- Incremental byte checking avoids a second all-collections JSON allocation.
- One in-flight report per isolate bounds overlap; busy responses perform no
  DB work and do not start a retry loop or background service.
- Actual D1 binding exposed an intermediate optimization's parameter-count
  mismatch that a permissive SQLite named-argument fixture did not catch. The
  final code binds exactly the largest positional slot; both SQLite regression
  and real local D1 execution pass. Failed intermediate runs are excluded below.

## Results

Each populated fixture has the stated number of window observations and terminal
events, with10 synthetic Agent identities. Requests cover an almost48h window
inside six days of retained history. No result is real fleet yield.

| Fixture | Old median ms | New median ms | New sample p95 ms | New outcome | Largest staged JS used heap MiB |
| --- | ---: | ---: | ---: | --- | ---: |
| Empty | 9.7 | 13.8 | 22.9 | 200, complete zero | 1.56 |
| Sparse100 | 13.3 | 19.6 | 27.0 | 200,100 rows | 1.83 |
| Dense6,000 | 221.8 | 332.7 | 376.8 | 200,6,000 rows | 36.33 |
| Long keys6,000 | 316.4 | 53.4 | 59.9 | 503, byte cap / unknown | 1.06 |
| Near row cap19,000 | 654.6 | 97.2 | 103.9 | 503, byte cap / unknown | 1.06 |
| Maximum-key workload20,000 | 1,048.6 | 218.5 | 237.0 | 503, byte cap / unknown | 1.05 |
| Row overflow20,001 | 591.9 | 98.5 | 104.5 | 503, row cap / unknown | 1.05 |
|100 window rows +25,000 unrelated old rows |608.5,503 unknown|52.5|55.9|200,100 rows|2.70|

This improves overload handling and unrelated-history behavior, at the cost of
about111ms in this dense valid fixture; ordinary reads are not uniformly faster.
Normal-case heap samples include garbage from warmed requests, so a relative
heap percentage is not treated as a deterministic bound. The largest backing
storage sample in the final matrix was4.90MiB, reported separately from JS heap.

Thirty additional sparse reads produced retained-after-GC samples of
1.1143,1.1153,1.1150,1.1178,1.1180,1.1180MiB. This bounded run found no continuing
retained growth; it is not an endurance/leak-free guarantee. Four concurrent
HTTP submissions produced two200 results and two503 busy results; arrivals may
serialize, so this does not require exactly one success. A deterministic held-
request unit test proves no second DB read begins while the first is active and
that failure releases the guard.

All8 final cases,56 timed requests,8 checkpointed requests,30 repeated reads
and the4-submission concurrency check completed with assertions passing.

## Reproduce

Use the installed lockfile dependencies from `site/`; no added dependency or
production credential is required. Miniflare5's explicit v4-option conversion
is used rather than assuming the older constructor format still works.

```text
node scripts/profile-fleet-baseline.mjs --samples 7 --source-ref dd68ca1e800eac6c1f86716b9e3ca03ee65cbe03 --out <private-baseline-directory>
node scripts/profile-fleet-baseline.mjs --samples 7 --out <private-candidate-directory>
```

Node24.22.1, Miniflare5.20261023.1-beta, workerd1.20261023.1 and esbuild0.28.2
from the existing lockfile were used on Windows x64. The recorded query metadata
covers the batch; the epoch/advisory preflight `.first()` calls do not expose
metadata here. End-to-end timings include them. Do not add the trace fields and
call them a complete database-rows-read or CPU budget.

Keep generated profile Workers, D1 files, raw inspector material
and private source samples outside Git. Only synthetic aggregate results and
the reusable harness belong here.

## Remaining release boundary

Production build and314/314 site tests passed, including18 reference and20
adapter/route fixtures. ESLint has zero errors and one existing maintenance-
helper warning. Production dependency audit found zero vulnerabilities; no
dependency inputs changed. These checks do not certify device execution.

The local query/memory validation is complete for this workload matrix. The
candidate remains draft, unmerged, unpublished and default-disabled. Production
D1 cost, network/concurrent-Worker behavior and authenticated private readback
remain separate release checks. Missing historical eligibility, maintenance,
native-chain and Taichung cutover evidence still prevent fleet capacity
qualification. Do not enable a city expansion, sampling budget or canary from
these synthetic timings. Apply the existing [release gates](RELEASE_GATES.md).

Runtime/method references: [Miniflare D1](https://developers.cloudflare.com/workers/testing/miniflare/storage/d1/),
[Worker memory profiling](https://developers.cloudflare.com/workers/observability/dev-tools/memory-usage/),
[Worker limits](https://developers.cloudflare.com/workers/platform/limits/).

## Final route recheck on2026-11-17

After the policy inventory route and isolated Next16.4.6 dependency update, the
full local workerd matrix was repeated (seven timed reads/case, stage checkpoints,
30 repeated reads and four concurrent requests). All harness assertions passed.


| Fixture | Status | Median ms | p95 ms |
|---|---:|---:|---:|
| empty | 200 | 13.5 | 24.2 |
| sparse | 200 | 21.3 | 28.3 |
| dense | 200 | 342.9 | 365.9 |
| long-keys | 503 | 54.2 | 59.9 |
| near-cap | 503 | 96.6 | 101.6 |
| max-key-bytes | 503 | 208.4 | 227.4 |
| overflow | 503 | 109.0 | 115.8 |
| short-window-large-history | 200 | 49.2 | 56.8 |

The baseline adapter SHA256 remains `dd0e01bf11eeadfeb1d62cd430512611a3bff7aaea9d54c207e5fa575cf541aa`.
Final route SHA256 is `2eebf83c97df15a711f59b3eada433ce921d2ec0f0d82b28ce93b1ae5cd57469`.
These synthetic reads still do not measure production D1 CPU/cost, whole Worker
peak memory or device qualification. The earlier draft/unpublished status above
is the dated2026-11-16 checkpoint; publication provenance is recorded separately.
Full site regressions now pass319/319, including23 adapter/route/policy tests.
Production audit passes after the dependency update.
