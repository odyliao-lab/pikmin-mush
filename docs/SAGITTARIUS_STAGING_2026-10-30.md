# Sagittarius staging and eight-agent capacity

The authorized Zhubei expansion adds one independent scanner candidate named
Sagittarius. The two existing Zhubei Control Center emulators retain their purpose;
they are not existing Scanner Agents and their identity/state must not be copied.

The live roster inspected on October 30 contains Aries, Cancer, Leo, Libra,
Taurus, Gemini and Virgo, all enabled. Sagittarius is an eighth candidate, not a
replacement for Virgo. Enrollment must remain disabled with no qualified slots
until device, new-data, upload and ACK acceptance succeeds.

## Capacity change

The shared enabled-agent limit increases from seven to eight. The existing atomic
activation guard rejects a ninth enabled node, including enabled nodes that are
paused or offline. Existing authentication, qualification and lease guards remain.
Automatic and manual rotation tests cover four through eight eligible nodes in
all three slots, retaining every selected city pack, nonempty routes, unique
targets, local-date eligibility and the existing noon Berlin weighting.
No second dispatcher, scheduler, Site, database or Discord sender is introduced.

Local validation passed: production Vinext build, all175 Site tests and ESLint
with zero errors (one existing unused-import warning in a maintenance fixture).
The capacity tests exercise concurrent eighth/ninth activation, disabled and
unqualified enrollment, actual SQLite target materialization, and four-through-
eight daily/manual route coverage. CI and published-runtime verification remain
separate gates until their recorded results are available.

## Device preparation and limits

A clean MuMu 6.8.8.0 Android15 instance2 was created as Sagittarius with 2 vCPU,
4 GiB guest memory, 1080x1920/240DPI, Vulkan and a configured 30FPS ceiling.
It has no inherited game account, Scanner token, pending ACK, lease or upload
cursor. The initial boot attempt pushed host commit close to its limit; it was
shut down. This does not establish three-instance capacity or stable scanning.

The Hunter156-r2 ARM64/x86_64 payloads and x86_64 popup probe were rebuilt from
the documented Gemini source and matched its exact payload hashes. Installed
game APK certificates match the documented official156 baseline. Packaging,
guest installation, login, regional qualification and formal scans are separate
gates; artifact preparation is not device acceptance.

Capacity must pass checks, merge and publish through the existing Site before
activation. Host memory headroom, user-assisted login, fresh nonzero data plus
accepted upload/effective ACK, restart recovery and sustained operation remain
required. No24-hour endurance result is claimed by this staging document.
