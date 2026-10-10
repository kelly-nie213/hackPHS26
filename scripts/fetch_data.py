#!/usr/bin/env python3
"""Download the datasets the app needs into data/.

Sources (no API key required):
  - Buildings: NYC Open Data "BUILDING" (Building Footprints), dataset 5zhs-2jue
      https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue
      height_roof is in feet above ground.
  - Homes:     NYC Open Data "Primary Land Use Tax Lot Output (PLUTO)", dataset 64uk-42ks
      https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO-/64uk-42ks
      unitsres = residential units on the tax lot. Joined to footprints via mappluto_bbl,
      which (unlike base_bbl) points condo towers at their billing lot, where PLUTO keeps the units.
  - Parks:     NYC Open Data "Parks Properties", dataset enfh-gkve
      https://data.cityofnewyork.us/Recreation/Parks-Properties/enfh-gkve
  - Weather:   Open-Meteo historical archive (hourly cloud cover, radiation, sunshine duration)
      https://open-meteo.com/en/docs/historical-weather-api

Usage:
  python3 scripts/fetch_data.py                 # default area + year
  python3 scripts/fetch_data.py --year 2024
  python3 scripts/fetch_data.py --bbox 40.70 -74.02 40.72 -73.99   # south west north east
"""

import argparse
import json
import math
import os
import urllib.parse
import urllib.request

# Central Park + Billionaires' Row (57th St supertalls) + surrounding blocks.
DEFAULT_BBOX = (40.755, -73.995, 40.802, -73.945)  # south, west, north, east
DEFAULT_YEAR = 2025

BUILDINGS_URL = "https://data.cityofnewyork.us/resource/5zhs-2jue.geojson"
PLUTO_URL = "https://data.cityofnewyork.us/resource/64uk-42ks.json"
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
    """Page through a Socrata endpoint until no more rows/features come back."""
    rows, offset = [], 0
    while True:
        page = get_json(url, {**params, "$limit": PAGE, "$offset": offset, "$order": ":id"})
        if isinstance(page, dict):  # GeoJSON endpoint
            page = page.get("features", [])
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        offset += PAGE


def normalize_bbl(value):
    return str(int(float(value))) if value not in (None, "") else None


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
        "$select": "the_geom,bin,name,height_roof,ground_elevation,construction_year,base_bbl,mappluto_bbl",
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
            "bbl": normalize_bbl(p.get("mappluto_bbl") or p.get("base_bbl")),
            "name": p.get("name"),
            "height": round(height_m, 2),
            "ground": round(float(p["ground_elevation"]) * FEET_TO_M, 2) if p.get("ground_elevation") else None,
            "year": int(p["construction_year"]) if p.get("construction_year") else None,
            "polygons": [round_rings(poly) for poly in polys],
        })
    return buildings


def fetch_lots(bbox, bbls):
    """PLUTO rows for the tax lots in `bbls`, keyed by BBL (queried by lot centroid, with a margin)."""
    s, w, n, e = bbox
    m = 0.003
    wanted = set(bbls)
    rows = socrata_all(PLUTO_URL, {
        "$select": "bbl,address,unitsres,unitstotal,numfloors,bldgclass,landuse,ownername,yearbuilt,resarea,bldgarea",
        "$where": f"latitude between {s - m} and {n + m} and longitude between {w - m} and {e + m}",
    })
    lots = {}
    for r in rows:
        bbl = normalize_bbl(r["bbl"])
        if bbl in wanted:
            num = lambda k: float(r[k]) if r.get(k) not in (None, "") else None
            lots[bbl] = {
                "address": r.get("address"),
                "homes": int(num("unitsres") or 0),
                "units": int(num("unitstotal") or 0),
                "floors": num("numfloors"),
                "class": r.get("bldgclass"),
                "landuse": r.get("landuse"),
                "owner": r.get("ownername"),
                "yearBuilt": int(num("yearbuilt")) if num("yearbuilt") else None,
                "resArea": num("resarea"),
                "bldgArea": num("bldgarea"),
            }
    return lots


def footprint_area_m2(polygons):
    """Shoelace area of the outer rings, after scaling degrees to meters."""
    total = 0.0
    for poly in polygons:
        ring = poly[0]
        kx = 111320 * math.cos(math.radians(ring[0][1]))
        pts = [(x * kx, y * 110540) for x, y in ring]
        total += abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))) / 2
    return total


def attach_homes(buildings, lots):
    """Give each footprint its share of its lot's homes.

    A lot with several buildings (e.g. a tower plus a low annex) splits its units by
    building volume, so the tower gets nearly all of them.
    """
    by_lot = {}
    for b in buildings:
        b["volume"] = footprint_area_m2(b["polygons"]) * b["height"]
        by_lot.setdefault(b["bbl"], []).append(b)
    for bbl, group in by_lot.items():
        lot = lots.get(bbl)
        total_volume = sum(b["volume"] for b in group) or 1
        for b in group:
            b["homes"] = round(lot["homes"] * b["volume"] / total_volume, 1) if lot else None
    for b in buildings:
        del b["volume"]


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
        "hourly": "cloud_cover,direct_radiation,shortwave_radiation,sunshine_duration",
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
        "sunshine_duration": h["sunshine_duration"],  # seconds of direct sun in the hour (WMO: beam > 120 W/m²)
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

    print("Fetching PLUTO tax lots (homes per building)…")
    lots = fetch_lots(bbox, [b["bbl"] for b in buildings])
    attach_homes(buildings, lots)
    matched = sum(1 for b in buildings if b["homes"] is not None)
    print(f"  {len(lots)} lots, {matched}/{len(buildings)} buildings matched")
    write("buildings.json", {"bbox": bbox, "buildings": buildings, "lots": lots})

    print("Fetching parks…")
    parks = fetch_parks(bbox)
    print(f"  {len(parks)} parks")
    write("parks.json", {"bbox": bbox, "parks": parks})

    print(f"Fetching {args.year} hourly weather…")
    write("weather.json", fetch_weather(bbox, args.year))


if __name__ == "__main__":
    main()
