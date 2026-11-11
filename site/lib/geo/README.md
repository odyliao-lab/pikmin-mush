# OSM-derived city land masks

© OpenStreetMap contributors. Database licensed under ODbL 1.0:
https://opendatacommons.org/licenses/odbl/1-0/
Source: https://osmdata.openstreetmap.de/data/land-polygons.html
Snapshot/source archive SHA-256 and generation parameters are in
[`city-land.json`](city-land.json).
See [GLOBAL_LAND_REGIONS.md](../../../docs/GLOBAL_LAND_REGIONS.md) for reproduction,
coverage, conservative coast policy and limitations. This is a derived database;
redistribute it with attribution and the same database license.

The mask conservatively removes offshore samples; it does not certify every
remaining point as accessible land or exclude all inland water. It is used by
city route sampling, not as evidence of an in-game mushroom or event GPS point.
