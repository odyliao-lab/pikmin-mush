# Six-Agent capacity and staged enrollment

The sixth device must be qualified and the tested Site release published before
activation. Gemini installation and live acceptance are separate from this
capacity change; an online heartbeat is not scan acceptance.

## Paths reviewed and changed

- `rotation-plan.mjs`: daily/manual planners share the six-enabled-node limit.
  Four-node curated routes remain unchanged; five/six use the existing greedy
  country-pack balancing. No city catalog or local-day guard changes.
- Enrollment issues an independent credential but creates a **disabled** node
  with `capabilities_json.rotation_slots=[]`. This cannot enter rotation while
  software, login, and geography are being tested.
- The existing authenticated Agent action API sets tested slots only while the
  node is disabled. Enable uses one conditional SQL write to enforce six enabled
  nodes, including paused/offline enabled nodes; disabled Scorpio is excluded.
- Automatic and manual rotation select enabled, unpaused nodes seen within 30
  minutes and qualified for the current slot. Missing policy preserves existing
  nodes; malformed/empty explicit policy grants no qualification.
- Claiming also enforces the qualified slot and country sets, including the
  fallback that ignores country preferences. JSON binding keeps the country
  filter under D1's parameter ceiling. Existing unrestricted fallback survives.
- The fleet UI shows qualifications, stages creation, and exposes explicit
  qualification editing and capacity-aware activation.

`asia`, `emea`, and `americas` are coarse deployment qualification scopes. They
must be granted from this device's actual game/native/new-data evidence, not its
emulator model. One successful city does not prove every city or all-day uptime.
Unverified slots remain excluded until separately tested. Existing nodes are not
retroactively restricted or rewritten by this release.

## Validation

Behavioral tests exercise actual enrollment/action endpoints and actual daily
and manual rotation against SQLite, including target materialization. Four,
five, and six qualified nodes retain every selected city, unique country-pack
ownership, nonempty routes, unique sampled targets, and bounded queue size.
Tests cover concurrent activation, disabled Scorpio, paused/offline exclusion,
untested-slot exclusion, and the claim fallback boundary. Sampling tests retain
the noon Berlin 3x policy and route budgets through six nodes and four cycles.

04:00 / 12:00 / 20:00 Asia/Taipei, local 01:00 eligibility, Taiwan/Japan exclusion,
existing verification coordination, independent maintenance and Discord services
remain unchanged. No database, project, Site or scheduler is created.

Release follows GitHub PR/checks/merge, exact Site subtree comparison, source
push, archive packaging and succeeded deployment before Gemini activation.
