# Allocation comparison and canary protocol

Status: measurement foundation; **no canary is active or automatically armed**.

## Fixed measurement contract

Use authenticated `allocation-shadow?view=comparison&from=<ms>&to=<ms>` with
exact [from,to) bounds. Maximum seven retained days, minimum one hour, never
before corrected-history epoch. Save results and source/version before judging.
The default is the latest corrected 24h; it is not a baseline fixed across runs.

Normal target ACKs are deduplicated by agent/target; verification targets and
returns are excluded. Opportunities require the same target AND agent, a receipt
inside that completed attempt, valid under-five capacity and a challenge not
expired at receipt. Known challenge-start identities count as eligible; unresolved
identities are separate rather than fabricated unique mushrooms. Per-agent totals
deduplicate across countries. Different agents can encounter the same challenge;
do not sum their totals as exclusive global discoveries. Large/giant subtotals can
overlap if observed level changes; the combined distinct total is authoritative.

Report wall-clock and recorded scan-hour rates separately. Recorded scan time
does not include all cooldown/offline time; it is not a throughput denominator.
Zero-row targets remain unknown. Terminal ACK success is not proof of new data.
Thermal incidents and manual rechecks must be annotated, not silently discarded.

## Pre-registered activation and acceptance gates

1. Corrected shadow >=24h, >=2 eligible regions each >=30 normal targets and
   >=1 recorded scan hour, zero orphan observations/events.
2. Durable server-side experiment record, original plan snapshot, exactly one
   healthy agent, compare-and-swap revision, 04:00/12:00/20:00 activation, 24h observation
   across normal rotations, and explicit rollback must be implemented/tested
   before arming. Exclusions Japan/Taiwan, local-date safety, non-overlap and
   20% exploration remain invariants. Other agents keep the standard plan.
3. Match baseline/control by agent, weekday/event phase, region and local-time
   stratum; at least two matched region strata and >=30 normal targets per stratum.
   Each baseline and treatment must span >=24h. Do not compare raw fleet totals
   across unrelated countries. A thermal outage like Leo 2026-09-09 is a confounder;
   retain the incident in operational rates and use a separate healthy comparison.
4. Diagnostic coverage >=95%; successful normal targets >=95%; zero-row fraction
   must not worsen >5 percentage points; restart/target and upload-error/target
   must not worsen >2 percentage points. Outcome coverage/attribution limitations
   or unresolved identity dominance mean extend/investigate, not claim improvement.
5. Improvement requires >=15% standardized eligible/wall-hour uplift across matched
   strata, without safety regression, and a positive lower 95% interval from a
   pre-registered block bootstrap over hourly strata. Low counts/insufficient
   matched strata mean extend. Do not re-select favorable windows after results.
6. Roll back at next safe switch on regression; severe runtime problems stop
   treatment immediately through the existing authenticated safe controls. Do not
   overwrite manual pause or notification verification. Expansion only at the
   next normal switch after a complete successful canary, then another full cycle.

## Remaining work

This release provides bounded per-agent/per-region metrics only. Durable experiment
record, protected control operations, rotation integration, matched estimator,
and automatic rollback are NOT implemented by this document. City route changes
remain gated on the completed regional experiment. No route or schedule changed.
