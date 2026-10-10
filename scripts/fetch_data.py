#!/usr/bin/env python3
"""Download the datasets the app needs into data/.

Sources (no API key required):
  - Buildings: NYC Open Data "BUILDING" (Building Footprints), dataset 5zhs-2jue
      https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue
      height_roof is in feet above ground.
  - Parks:     NYC Open Data "Parks Properties", dataset enfh-gkve
      https://data.cityofnewyork.us/Recreation/Parks-Properties/enfh-gkve
  - Weather:   Open-Meteo historical archive (hourly cloud cover + radiation)
      https://open-meteo.com/en/docs/historical-weather-api

Usage:
  python3 scripts/fetch_data.py                 # default area + year
  python3 scripts/fetch_data.py --year 2024
  python3 scripts/fetch_data.py --bbox 40.70 -74.02 40.72 -73.99   # south west north east
"""

import argparse
import json
import os
import urllib.parse
import urllib.request

# Central Park + Billionaires' Row (57th St supertalls) + surrounding blocks.
DEFAULT_BBOX = (40.755, -73.995, 40.802, -73.945)  # south, west, north, east
DEFAULT_YEAR = 2025

BUILDINGS_URL = "https://data.cityofnewyork.us/resource/5zhs-2jue.geojson"
PARKS_URL = "https://data.cityofnewyork.us/resource/enfh-gkve.geojson"
WEATHER_URL = "https://archive-api.open-meteo.com/v1/archive"

FEET_TO_M = 0.3048
PAGE = 20000

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data")


def get_json(url, params):
    full = url + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(full, timeout=120) as resp:
        return json.load(resp)


def socrata_all(url, params):
    """Page through a Socrata endpoint until no more features come back."""
    features, offset = [], 0
    while True:
        page = get_json(url, {**params, "$limit": PAGE, "$offset": offset, "$order": ":id"})
        features.extend(page.get("features", []))
        if len(page.get("features", [])) < PAGE:
            return features
        offset += PAGE


def round_rings(polygon):
    return [[[round(x, 6), round(y, 6)] for x, y in ring] for ring in polygon]


def polygons_of(geometry):
    if geometry is None:
        return []
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    return []


def bbox_wkt(s, w, n, e):
    return f"POLYGON(({w} {s}, {e} {s}, {e} {n}, {w} {n}, {w} {s}))"


def fetch_buildings(bbox):
    s, w, n, e = bbox
    raw = socrata_all(BUILDINGS_URL, {
        "$select": "the_geom,bin,name,height_roof,ground_elevation,construction_year,base_bbl",
        "$where": f"within_box(the_geom, {n}, {w}, {s}, {e})",
    })
    buildings = []
    for f in raw:
        p = f["properties"]
        polys = polygons_of(f["geometry"])
        if not polys or p.get("height_roof") in (None, ""):
            continue
        height_m = float(p["height_roof"]) * FEET_TO_M
        if height_m <= 0:
            continue
        buildings.append({
            "bin": p.get("bin"),
            "bbl": p.get("base_bbl"),
            "name": p.get("name"),
            "height": round(height_m, 2),
            "ground": round(float(p["ground_elevation"]) * FEET_TO_M, 2) if p.get("ground_elevation") else None,
            "year": int(p["construction_year"]) if p.get("construction_year") else None,
            "polygons": [round_rings(poly) for poly in polys],
        })
    return buildings


def fetch_parks(bbox):
    raw = socrata_all(PARKS_URL, {
        "$select": "multipolygon,name311,signname,acres,typecategory,gispropnum",
        "$where": f"intersects(multipolygon, '{bbox_wkt(*bbox)}')",
    })
    parks = []
    for f in raw:
        p = f["properties"]
        polys = polygons_of(f["geometry"])
        if not polys:
            continue
        parks.append({
            "id": p.get("gispropnum"),
            "name": p.get("signname") or p.get("name311"),
            "acres": float(p["acres"]) if p.get("acres") else None,
            "type": p.get("typecategory"),
            "polygons": [round_rings(poly) for poly in polys],
        })
    return parks


def fetch_weather(bbox, year):
    s, w, n, e = bbox
    data = get_json(WEATHER_URL, {
        "latitude": round((s + n) / 2, 4),
        "longitude": round((w + e) / 2, 4),
        "start_date": f"{year}-01-01",
        "end_date": f"{year}-12-31",
        "hourly": "cloud_cover,direct_radiation,shortwave_radiation",
        "timezone": "America/New_York",
    })
    h = data["hourly"]
    return {
        "source": "Open-Meteo historical archive",
        "year": year,
        "timezone": "America/New_York",
        "start": h["time"][0],  # local time of index 0; one entry per hour
        "cloud_cover": h["cloud_cover"],              # %
        "direct_radiation": h["direct_radiation"],    # W/m², beam sunlight (what shadows block)
        "shortwave_radiation": h["shortwave_radiation"],  # W/m², total incl. diffuse
    }


def write(name, obj):
    path = os.path.join(OUT_DIR, name)
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    print(f"  wrote {os.path.relpath(path)} ({os.path.getsize(path) / 1e6:.1f} MB)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("SOUTH", "WEST", "NORTH", "EAST"), default=DEFAULT_BBOX)
    ap.add_argument("--year", type=int, default=DEFAULT_YEAR, help="weather year to download")
    args = ap.parse_args()
    bbox = tuple(args.bbox)
    os.makedirs(OUT_DIR, exist_ok=True)

    print("Fetching building footprints…")
    buildings = fetch_buildings(bbox)
    print(f"  {len(buildings)} buildings")
    write("buildings.json", {"bbox": bbox, "buildings": buildings})

    print("Fetching parks…")
    parks = fetch_parks(bbox)
    print(f"  {len(parks)} parks")
    write("parks.json", {"bbox": bbox, "parks": parks})

    print(f"Fetching {args.year} hourly weather…")
    write("weather.json", fetch_weather(bbox, args.year))


if __name__ == "__main__":
    main()
