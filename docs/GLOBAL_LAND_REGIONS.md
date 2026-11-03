# Global land-aware scan regions — 2026-11-03

The operator requested whole-fleet redistribution, offshore exclusion, and
Southern Africa expansion. This changes the ordinary region plan, not the
historical-yield allocator (which remains shadow-only).

## Land mask and limits

`site/lib/geo/city-land.json` is an offline derived database from
[OSM land polygons](https://osmdata.openstreetmap.de/data/land-polygons.html),
2026-11-03 snapshot, split WGS84 archive SHA-256
`79e88a74ed7276177a331c0b4b2a1ee0859e7da216bcbf98cc6479ccad69078d`.
© OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
The derived database is distributed under ODbL 1.0; retain source and attribution.
This is coastline data, not a guarantee about inland lakes, rivers, game map
content, or GPS accuracy. It must not be presented as a complete water map.

Generation clips to every catalogue city's maximum 10km square plus a 250m
processing margin, unions split tiles, projects to local metres, simplifies
25m, insets 100m and simplifies 10m again. Only entire 100m cells covered by
that inset polygon are admitted. Row bands/ranges compress the cells; runtime
lookups require no external network and no polygon walk per target. Margins
are engineering conservatism, not a claim of survey accuracy. Very narrow
islands and the immediate coast can be excluded; do not bypass the mask or
fallback to an unverified city centre when a city has zero admissible points.
An unknown/new city fails closed until its mask is regenerated and tested.
If a coarse phase misses all land on a narrow peninsula, only that city is
searched at 100m spacing within the same bounds, retaining the sparse budget.

Auto catalogue grids are filtered BEFORE sparse sampling, phase shifting and
Berlin's redistribution. Custom bounding boxes remain explicit operator jobs
and are outside this city-mask coverage. Scheduled mode always selects auto.
Version is recorded in normalized automatic job config as landMaskRevision.

Reproduce from the pinned archive (do not assume a mutable download still has
this SHA): install shapely==2.1.2 and pyshp==2.3.1 in a separate tooling env,
run `node tools/export_scan_catalog.mjs > cities.json`, then
`python tools/build_city_land_masks.py --zip osm-land.zip --catalog cities.json`.
The generator emits archive/catalog hashes and geometric parameters. Publish
the derived JSON and this notice together. Large raw archives stay outside Git.

## Allocation

All fleet sizes (including four) use deterministic largest-workload-first
balancing. Production weights are actual admissible sampled target counts
under the scheduled radius/profile/budget, before Berlin redistributes its
owner's unchanged budget. Four devices no longer use fixed historical routes.
Scheduled radius keeps larger existing values but has a 3km floor so a tiny
one-off radius cannot silently defeat Berlin's required 24-point budget. The
per-city sparse sampling cap and total point budget do not increase.
Country/slot qualification, unique target leases, no Taiwan/Japan scheduled
coverage, local date >=01:00 and 04:00/12:00/20:00 Taipei switches remain.
More agents than Asia country packs share packs through distinct atomic target
leases. Offline, paused and unqualified members are never force-enabled.
No short-term yield/rate measurement changes fleet allocation.

## Added Southern Africa coverage

South Africa expands from two to six cities. New country packs: Namibia (3),
Botswana (2), Lesotho (1), Eswatini (2), Zimbabwe (2), Zambia (4), Mozambique (3).
This adds seven countries and 21 cities, bringing scheduled coverage to 77
packs / 443 cities. The catalogue including manual Taiwan/Japan is 79 packs.

New city coordinates are from [GeoNames cities15000](https://download.geonames.org/export/dump/cities15000.zip),
[CC BY 4.0](https://download.geonames.org/export/dump/readme.txt).
Existing Cape Town/Johannesburg coordinates are retained. Use IANA zones via
Intl, including Africa/Windhoek; never hardcode Namibia's historical offset.
UN Southern Africa is ZA/NA/BW/LS/SZ. ZW/ZM/MZ are explicitly the broader
southern geographic expansion, not labelled UN Southern Africa.
Source: [UN M49](https://unstats.un.org/unsd/methodology/m49/).
Coordinates are city centres, not evidence of game acceptance or mushroom yield.

## Safe activation

Deploy tested GitHub main through the existing public Sites project. Existing
automatic rotation reconciles changed route packs only after no active durable
dispatch and no queued/leased verification target remains. Manual redeploy now
also refuses unfinished verification (it no longer cancels candidate checks).
Both cancellation and final recheck protect those guards. Do not clear outbox,
lease, pending data or notification state to force activation. If an explicit
operator job prevents automatic reconciliation, use the existing signed-in
administrator's redeploy action; controller credentials gain no admin access.

Keep the existing sole Discord sender and separate giant/large messages.
Record deployment SHA/version, new job, full roster/assignments and fresh
nonzero accepted scan evidence in the private operations report.
