"""Offline generator; dependencies: shapely==2.1.2, pyshp==2.3.1.

Usage: python tools/build_city_land_masks.py --zip osm-land.zip --catalog cities.json
The catalog is COUNTRY_PACK_CATALOG serialized from site/lib/scan-plans.ts.
No runtime downloads, geocoding, secrets, or device operations.
"""
import argparse
import hashlib
import json
import math
import tempfile
import zipfile
from pathlib import Path

import shapefile
import numpy as np
from shapely import STRtree, make_valid, prepare, covers, box as boxes_array
from shapely.geometry import box, shape
from shapely.ops import transform, unary_union


def generate(archive, catalog, output):
    with archive.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if digest != "79e88a74ed7276177a331c0b4b2a1ee0859e7da216bcbf98cc6479ccad69078d":
        raise ValueError("Archive differs from the pinned 2026-11-03 OSM snapshot")
    packs = json.loads(catalog.read_text(encoding="utf-8-sig"))
    cities = [(p["name"] + "/" + name, lat, lng)
              for p in packs for name, lat, lng in p["cities"]]
    boxes = [box(lng - 10_250 / (111_320 * max(.2, math.cos(math.radians(lat)))),
                 lat - 10_250 / 111_320,
                 lng + 10_250 / (111_320 * max(.2, math.cos(math.radians(lat)))),
                 lat + 10_250 / 111_320) for _, lat, lng in cities]
    tree = STRtree(boxes)
    pieces = [[] for _ in cities]
    with tempfile.TemporaryDirectory() as folder:
        with zipfile.ZipFile(archive) as z:
            for item in z.infolist():
                if item.filename.endswith((".shp", ".shx", ".dbf")):
                    # Flatten known shapefile components; no archive paths escape.
                    Path(folder, Path(item.filename).name).write_bytes(z.read(item))
        with shapefile.Reader(str(Path(folder, "land_polygons.shp"))) as reader:
            for index, item in enumerate(reader.iterShapes()):
                hits = tree.query(box(*item.bbox))
                if not len(hits):
                    continue
                geometry = make_valid(shape(item.__geo_interface__))
                for hit in hits:
                    clipped = geometry.intersection(boxes[hit])
                    if not clipped.is_empty:
                        pieces[hit].append(clipped)
                if index % 10000 == 0:
                    print("processed", index, flush=True)
    masks = {}
    for (key, lat, lng), parts in zip(cities, pieces):
        scale = 111_320 * max(.2, math.cos(math.radians(lat)))
        def project(x, y, z=None):
            return ((x - lng) * scale, (y - lat) * 111_320)
        # Union split tiles BEFORE inset, avoiding artificial seams. Simplify
        # in local metres; a 100m inward margin exceeds the 25m simplification.
        land = transform(project, unary_union(parts)).simplify(25, preserve_topology=True).buffer(-100).simplify(10, preserve_topology=True)
        if land.is_empty:
            raise ValueError("No verified land in city: " + key)
        if land.covers(box(-10_000, -10_000, 10_000, 10_000)):
            polygons = True
        else:
            # Conservative 100m cells: accept only when the ENTIRE cell is
            # inside the inset land polygon. Run-length encode rows/bands;
            # runtime needs only integer lookups, never polygon ray casting.
            axis = np.arange(-10_000, 10_000, 100)
            x, y = np.meshgrid(axis, axis)
            prepare(land)
            valid = covers(land, boxes_array(x, y, x + 100, y + 100))
            polygons = []
            for row, values in enumerate(valid):
                ranges = []
                begin = None
                for col, value in enumerate([*values, False]):
                    if value and begin is None:
                        begin = col
                    elif not value and begin is not None:
                        ranges.extend([begin, col - 1])
                        begin = None
                if polygons and polygons[-1][2] == ranges:
                    polygons[-1][1] = row
                else:
                    polygons.append([row, row, ranges])
        masks[key] = {"origin": [lat, lng], "bands": polygons}
    payload = {"revision": "osm-land-20261103-v1", "source": {
        "url": "https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip",
        "sha256": digest, "snapshot": "2026-11-03", "license": "ODbL-1.0",
        "attribution": "© OpenStreetMap contributors",
        "radiusKm": 10, "cellMetres": 100, "simplifyMetres": 25, "postInsetSimplifyMetres": 10, "insetMetres": 100,
        "catalogSha256": hashlib.sha256(catalog.read_bytes()).hexdigest()}, "cities": masks}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print("cities", len(masks), "coastal", sum(m["bands"] is not True for m in masks.values()),
          "bytes", output.stat().st_size, flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("site/lib/geo/city-land.json"))
    args = parser.parse_args()
    generate(args.zip, args.catalog, args.output)
