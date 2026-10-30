# Validated region expansion and Virgo return — 2026-10-30

The operator requested adding successfully sampled cities to normal fleet coverage and returning Virgo to ordinary scanning, with fleet-wide redistribution at the next regular switch.

## Scope

Add three noon/EMEA packs, five city centres: Ukraine (Kyiv 50.4501,30.5234; Lviv 49.8397,24.0297), Kenya (Nairobi -1.2921,36.8219), South Africa (Cape Town -33.9249,18.4241; Johannesburg -26.2041,28.0473). These centres returned new map objects and nonzero Lv2–4 data in isolated local feasibility samples. They do not imply nationwide coverage or increased large/elemental probability. Lagos was unconfirmed and is excluded, as are untested follow-up cities and Russia. Taiwan/Japan remain outside rotation.

There are now 70 scheduled country packs and 422 city centres (79 Asia/Oceania, 190 EMEA, 153 Americas). Existing city radii and sampling policy apply; only five new centres are added. Three new pack timezones use Europe/Kyiv, Africa/Nairobi, Africa/Johannesburg, with DST-boundary coverage. The 04:00 and 20:00 pack sets are unchanged; noon Berlin remains exactly 3x at the existing route budget.

## Activation

Keep the completed 2026-10-30 EMEA rotation job and leases unchanged until 20:00 Taipei even if Virgo resumes or the planned pack list differs. The date-bound hold expires exactly at 20:00; explicit manual redeploy retains its existing semantics. Do not call manual redeploy for this rollout. At 20:00, normal online/qualified fleet selection includes Virgo and rebuilds the Americas job; first scheduled dispatch of the new EMEA cities is 2026-10-31 12:00. Request-driven triggering, verification deferral, local-date eligibility and 04/12/20 schedule are retained.

Capacity remains eight from PR180; Sagittarius and other agents are not reconfigured by this change. Virgo retains agent-virgo-7adc7120, existing credentials, game156/native156-r2/Agent2.2.10 and 2vCPU/4GB/native render15.

## Device transition

Stop/verify any research supervisor before starting ordinary Agent. Back up config/token/upload.offset/pending state and complete original TSV on-device under root-only permissions. Preserve the research dataset. Start the ordinary Agent while both cloud and local pause remain set: this drains the existing TSV tail via the normal authenticated upload endpoint with no active target attribution. Do not advance/reset the offset, delete TSV/pending state, substitute credentials, or count those historical rows as new formal target success. After the tail is accepted, resume normal scanning and verify at least three fresh official targets with object, nonzero data, accepted upload and ACK. On auth failure stop the affected path.

## Validation

Regression checks cover retained existing lease/job when a seventh node joins, redistribution at the next switch, materialization of all five new cities next noon, 4–8-agent coverage/no duplicates, timezone/DST safety and unchanged Berlin weighting. Full site tests, production dependency audit and exact-tree Sites release evidence are recorded during deployment. No Android binaries, Discord services or database resets are part of this rollout.
