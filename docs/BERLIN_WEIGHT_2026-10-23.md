# Noon Berlin sampling and city outcome measurement

Owner-authorized fixed policy, not an inferred claim of special game parameters.
Only newly created EMEA/noon rotation jobs receive `berlin-3x-v1`.
04:00 Asia/Oceania and 20:00 Americas explicitly clear inherited weighting.
Existing jobs are not rebuilt by publication. Country eligibility, four-phone
membership, verification precedence, cooldown, native refresh and power guards
are unchanged. The owner explicitly authorized publishing this fixed route policy;
the automatic allocation optimizer remains shadow-only.

For the current four-phone configuration, noon has 185 cities and four samples
per city. Berlin receives twelve distinct grid points per cycle instead of four.
Eight points are removed round-robin from other cities assigned to the SAME
Agent's route. Donor cities rotate across cycles; every city keeps at least one
point, and each route's original total is preserved. Other routes keep their exact
budgets. A reduced fleet with only one sample/city, insufficient donors, or a grid
too small for exactly 3x retains the base plan; do not erase a city or increase load.
The policy is frozen in the job config and applies consistently on subsequent
loops. A forward release clearing it rolls back weighting at the next normal switch.

`GET /api/admin/allocation-cities?from=<ms>&to=<ms>` uses existing admin/controller
read authorization and no-store. Windows are half-open, 1h–7d and within corrected
history. Per Agent/country/city results include attempted/completed/failed normal
targets, recorded scan hours, distinct eligible large/giant challenges, unresolved
identities and large elemental counts: fire 11, water 12, crystal 13, electric 17,
poison 18. Each elemental count requires level=3, valid capacity/count<5, unexpired
receipt, matching target+Agent within the completed attempt. Rechecks, returns,
duplicate ACKs, wrong-Agent receipts, failures and unknown challenge identities do
not inflate qualified opportunities. Per-city/Agent totals may overlap, so do not
sum them as exclusive fleet discoveries. Recorded scan hours exclude unrecorded
cooldown/offline time; no fabricated city wall-time denominator is provided.

Migration 0030 preserves city on future target archives. Older archives default
to an empty city and remain a separate unknown-city bucket. Historical country
statistics retain their old contract. City rates are descriptive and do not prove
Berlin uplift. Compare matched local times and event/weekday strata after enough
fresh city data accumulate, retaining battery/thermal incidents. Review seven days
initially; extend for sparse samples. The existing 15% uplift/confidence and health
gates still apply before claiming improvement or expanding an automatic optimizer.
