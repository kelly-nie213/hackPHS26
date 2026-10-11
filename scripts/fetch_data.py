#!/usr/bin/env python3
"""Download the datasets the app needs into data/<city>/ and write data/cities.json.

Sources (no API key required):
  New York (best data):
  - Buildings: NYC Open Data "BUILDING" (Building Footprints), dataset 5zhs-2jue
      https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue
      height_roof is in feet above ground.
  - Homes:     NYC Open Data "Primary Land Use Tax Lot Output (PLUTO)", dataset 64uk-42ks
      https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO-/64uk-42ks
      unitsres = residential units on the tax lot. Joined to footprints via mappluto_bbl,
      which (unlike base_bbl) points condo towers at their billing lot, where PLUTO keeps the units.
  - Parks:     NYC Open Data "Parks Properties", dataset enfh-gkve
      https://data.cityofnewyork.us/Recreation/Parks-Properties/enfh-gkve
  Every other city:
  - Buildings, building parts and parks: OpenStreetMap via the Overpass API (ODbL)
      https://wiki.openstreetmap.org/wiki/Overpass_API
      Heights come from `height`, else `building:levels`; homes from `building:flats`, else
      estimated from building type and floor area (see estimate_homes).
  All cities:
  - Weather:   Open-Meteo historical archive (hourly cloud cover, radiation, sunshine duration)
      https://open-meteo.com/en/docs/historical-weather-api

Usage:
  python3 scripts/fetch_data.py                       # every city
  python3 scripts/fetch_data.py --city chicago        # one city
  python3 scripts/fetch_data.py --city nyc --year 2024
  python3 scripts/fetch_data.py --city nyc --bbox 40.70 -74.02 40.72 -73.99   # south west north east
  python3 scripts/fetch_data.py --manifest-only       # rebuild data/cities.json from files on disk
"""

import argparse
import json
import math
import os
import time
import urllib.parse
import urllib.request

DEFAULT_YEAR = 2025

# Study areas: a few square km of each downtown, centered on the towers and the parks they shade.
# view = where the camera starts: target lat/lon, and camera offset [east, up, south] in meters.
CITIES = {
    "nyc": {
        "name": "New York", "state": "NY", "source": "nyc", "timezone": "America/New_York",
        "bbox": (40.755, -73.995, 40.802, -73.945),
        "area": "Midtown to 110th St around Central Park",
        "tagline": "Billionaires' Row's supertalls cast shadows a mile across Central Park.",
        "focus": "Central Park",
        "view": {"lat": 40.7655, "lon": -73.978, "offset": [-350, 1100, 1700]},
        "note": "Towers south of ~42nd St aren't included, so parks near the southern edge are undercounted.",
    },
    "chicago": {
        "name": "Chicago", "state": "IL", "source": "osm", "timezone": "America/Chicago",
        "bbox": (41.866, -87.645, 41.904, -87.607),
        "area": "the Loop, River North and Streeterville",
        "tagline": "The Loop's towers line the edge of Grant Park and Millennium Park.",
        "focus": "Grant Park",
        "view": {"lat": 41.8826, "lon": -87.6226, "offset": [1500, 1100, 600]},
    },
    "sf": {
        "name": "San Francisco", "state": "CA", "source": "osm", "timezone": "America/Los_Angeles",
        "bbox": (37.772, -122.425, 37.806, -122.385),
        "area": "the Financial District, SoMa and Union Square",
        "tagline": "Prop K has guarded parks from new shadows since 1984. How much sun is left?",
        "focus": "Union Square",
        "view": {"lat": 37.7895, "lon": -122.398, "offset": [1200, 1100, 1400]},
    },
    "boston": {
        "name": "Boston", "state": "MA", "source": "osm", "timezone": "America/New_York",
        "bbox": (42.343, -71.082, 42.368, -71.048),
        "area": "Downtown, Back Bay and the Common",
        "tagline": "State law caps shadows on the Common and Public Garden. Back Bay towers still reach them.",
        "focus": "Boston Common",
        "view": {"lat": 42.352, "lon": -71.07, "offset": [-200, 1100, 1600]},
    },
    "seattle": {
        "name": "Seattle", "state": "WA", "source": "osm", "timezone": "America/Los_Angeles",
        "bbox": (47.596, -122.352, 47.624, -122.318),
        "area": "Downtown, Belltown and the waterfront",
        "tagline": "In a city starved for sun, downtown towers rise over Freeway Park and the waterfront.",
        "focus": "Freeway Park",
        "view": {"lat": 47.607, "lon": -122.335, "offset": [-1500, 1000, 900]},
    },
    "la": {
        "name": "Los Angeles", "state": "CA", "source": "osm", "timezone": "America/Los_Angeles",
        "bbox": (34.036, -118.268, 34.066, -118.236),
        "area": "Downtown LA",
        "tagline": "Bunker Hill's towers stand over Pershing Square and Grand Park.",
        "focus": "Pershing Square",
        "view": {"lat": 34.0505, "lon": -118.254, "offset": [-1200, 1000, 1300]},
    },
    "philadelphia": {
        "name": "Philadelphia", "state": "PA", "source": "osm", "timezone": "America/New_York",
        "bbox": (39.942, -75.182, 39.962, -75.150),
        "area": "Center City",
        "tagline": "William Penn's five squares now sit among Center City's towers.",
        "focus": "Rittenhouse Square",
        "view": {"lat": 39.953, "lon": -75.168, "offset": [-300, 1000, 1500]},
    },
    "miami": {
        "name": "Miami", "state": "FL", "source": "osm", "timezone": "America/New_York",
        "bbox": (25.758, -80.200, 25.792, -80.180),
        "area": "Downtown and Brickell",
        "tagline": "Brickell's condo boom stacked towers along Biscayne Bay.",
        "focus": "Bayfront Park",
        "view": {"lat": 25.772, "lon": -80.19, "offset": [1300, 1000, 900]},
    },
}

BUILDINGS_URL = "https://data.cityofnewyork.us/resource/5zhs-2jue.geojson"
PLUTO_URL = "https://data.cityofnewyork.us/resource/64uk-42ks.json"
PARKS_URL = "https://data.cityofnewyork.us/resource/enfh-gkve.geojson"
WEATHER_URL = "https://archive-api.open-meteo.com/v1/archive"
OVERPASS_URLS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
USER_AGENT = "ShadowLedger/1.0 (sunlight research project)"

FEET_TO_M = 0.3048
PAGE = 20000
MAX_PARKS = 250  # park ids are stored in a Uint8Array in the browser

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")


def get_json(url, params):
    full = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(full, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
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


def ring_area_m2(ring):
    kx = 111320 * math.cos(math.radians(ring[0][1]))
    pts = [(x * kx, y * 110540) for x, y in ring]
    return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))) / 2


def footprint_area_m2(polygons):
    """Shoelace area of the outer rings, after scaling degrees to meters."""
    return sum(ring_area_m2(poly[0]) for poly in polygons)


# ---------------------------------------------------------------- New York (NYC Open Data)

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


def fetch_nyc(bbox):
    print("Fetching building footprints…")
    buildings = fetch_buildings(bbox)
    print(f"  {len(buildings)} buildings")
    print("Fetching PLUTO tax lots (homes per building)…")
    lots = fetch_lots(bbox, [b["bbl"] for b in buildings])
    attach_homes(buildings, lots)
    matched = sum(1 for b in buildings if b["homes"] is not None)
    print(f"  {len(lots)} lots, {matched}/{len(buildings)} buildings matched")
    print("Fetching parks…")
    parks = fetch_parks(bbox)
    return {"bbox": bbox, "buildings": buildings, "lots": lots}, parks


# ---------------------------------------------------------------- Other cities (OpenStreetMap)

SKIP_BUILDINGS = {"roof", "carport", "no", "construction", "ruins", "shelter"}
HOUSES = {"house", "detached", "semidetached_house", "bungalow", "farm"}
MULTIFAMILY = {"apartments", "residential", "dormitory"}
BUILDING_TYPES = {
    "apartments": "Apartments", "residential": "Residential", "dormitory": "Dormitory",
    "house": "House", "detached": "House", "semidetached_house": "Semi-detached house",
    "terrace": "Row houses", "office": "Office", "commercial": "Commercial", "retail": "Retail",
    "hotel": "Hotel", "church": "Religious", "cathedral": "Religious", "hospital": "Health care",
    "school": "Education", "university": "Education", "college": "Education",
    "parking": "Parking garage", "garage": "Garage", "industrial": "Industrial",
    "warehouse": "Warehouse", "government": "Government", "civic": "Civic", "public": "Civic",
    "tower": "Tower", "train_station": "Transit", "transportation": "Transit", "stadium": "Stadium",
}
LEVEL_M = 3.3
MIN_PART_M2 = 30
FLOOR_EFFICIENCY = 0.8  # share of floor area that's inside homes
HOME_M2 = 85  # average US apartment, about 900 sq ft


def overpass(query):
    last = None
    for attempt in range(3):
        for url in OVERPASS_URLS:
            try:
                data = urllib.parse.urlencode({"data": query}).encode()
                req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=300) as resp:
                    return json.load(resp)["elements"]
            except Exception as err:  # busy servers answer with HTML or time out; try the next mirror
                last = err
                print(f"  {url.split('/')[2]}: {err}; retrying")
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"Overpass failed: {last}")


def parse_length(value):
    """OSM height/min_height: '120', '120 m', '394 ft', "394'" -> meters, or None."""
    if not value:
        return None
    v = value.strip().lower().replace(",", ".")
    feet = v.endswith(("ft", "'", "feet"))
    try:
        number = float(v.rstrip("ftme' ").split()[0].split(";")[0])
    except (ValueError, IndexError):
        return None
    return number * FEET_TO_M if feet else number


def parse_levels(value):
    try:
        return float(value.split(";")[0])
    except (AttributeError, ValueError):
        return None


def stitch_rings(ways):
    """Join member ways ([[lon, lat], ...]) end to end into closed rings."""
    rings, pending = [], [list(w) for w in ways if len(w) > 1]
    while pending:
        ring = pending.pop()
        while ring[0] != ring[-1]:
            for i, w in enumerate(pending):
                if w[0] == ring[-1]:
                    ring += w[1:]
                elif w[-1] == ring[-1]:
                    ring += w[::-1][1:]
                elif w[-1] == ring[0]:
                    ring = w[:-1] + ring
                elif w[0] == ring[0]:
                    ring = w[::-1][:-1] + ring
                else:
                    continue
                pending.pop(i)
                break
            else:
                break  # unclosable fragment
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring)
    return rings


def point_in_ring(x, y, ring):
    inside = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


def element_polygons(el):
    """Overpass `out geom` element -> GeoJSON-style polygons [[outer, *holes], ...]."""
    if el["type"] == "way":
        ring = [[p["lon"], p["lat"]] for p in el.get("geometry", [])]
        return [[ring]] if len(ring) >= 4 and ring[0] == ring[-1] else []
    outers, inners = [], []
    for m in el.get("members", []):
        if m["type"] == "way" and m.get("geometry"):
            (inners if m.get("role") == "inner" else outers).append([[p["lon"], p["lat"]] for p in m["geometry"]])
    polys = [[r] for r in stitch_rings(outers)]
    for hole in stitch_rings(inners):
        for poly in polys:
            if point_in_ring(*hole[0], poly[0]):
                poly.append(hole)
                break
    return polys


def element_height(tags):
    """(height in meters, True if measured) from tags; a guess from the building type otherwise."""
    h = parse_length(tags.get("height"))
    if h and h > 0:
        return h, True
    levels = parse_levels(tags.get("building:levels"))
    if levels and levels > 0:
        return levels * LEVEL_M + (parse_levels(tags.get("roof:levels")) or 0) * LEVEL_M * 0.5, True
    kind = tags.get("building") or ""
    return (7.0 if kind in HOUSES else 9.0 if kind == "terrace" else 10.0), False


def estimate_homes(tags, floor_area):
    flats = parse_levels(tags.get("building:flats"))
    if flats is not None:
        return int(flats)
    kind = tags.get("building")
    if kind in MULTIFAMILY:
        return max(1, round(floor_area * FLOOR_EFFICIENCY / HOME_M2))
    if kind in HOUSES:
        return 1
    if kind == "terrace":
        return max(1, round(floor_area / 150))
    return 0


def osm_address(tags):
    num, street = tags.get("addr:housenumber"), tags.get("addr:street")
    return f"{num} {street}".upper() if num and street else None


def osm_year(tags):
    d = tags.get("start_date") or ""
    return int(d[:4]) if d[:4].isdigit() else None


def bbox_of(polys):
    xs = [x for poly in polys for x, _ in poly[0]]
    ys = [y for poly in polys for _, y in poly[0]]
    return min(xs), min(ys), max(xs), max(ys)


def fetch_osm(bbox):
    s, w, n, e = bbox
    b = f"{s},{w},{n},{e}"
    print("Fetching OpenStreetMap buildings and parks…")
    elements = overpass(
        f"[out:json][timeout:280];("
        f"way[building]({b});relation[building][type=multipolygon]({b});"
        f"way['building:part']({b});relation['building:part'][type=multipolygon]({b});"
        f"way[leisure~'^(park|garden)$']({b});relation[leisure~'^(park|garden)$'][type=multipolygon]({b});"
        f");out tags geom;"
    )
    outlines, parts, park_els = [], [], []
    for el in elements:
        tags = el.get("tags", {})
        polys = element_polygons(el)
        if not polys:
            continue
        item = {"el": el, "tags": tags, "polys": polys, "bbox": bbox_of(polys)}
        if tags.get("building:part") not in (None, "no"):
            # Antenna masts and spires are mapped as tiny parts; they cast thin shadows, not public shade.
            if footprint_area_m2(polys) >= MIN_PART_M2:
                parts.append(item)
        elif tags.get("building") and tags["building"] not in SKIP_BUILDINGS:
            outlines.append(item)
        elif tags.get("leisure") in ("park", "garden"):
            park_els.append(item)

    # Tall towers are often mapped as an outline plus `building:part`s carrying the real heights.
    # Use the parts in place of the outline, as 3D OSM renderers do. A part outside every
    # outline stands on its own.
    parts_of = {}
    for part in parts:
        x0, y0, x1, y1 = part["bbox"]
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        for o in outlines:
            ox0, oy0, ox1, oy1 = o["bbox"]
            if ox0 <= cx <= ox1 and oy0 <= cy <= oy1 and any(point_in_ring(cx, cy, p[0]) for p in o["polys"]):
                parts_of.setdefault(id(o), []).append(part)
                break
        else:
            if part["tags"].get("building") not in SKIP_BUILDINGS:
                outlines.append(part)

    buildings, lots = [], {}
    measured = 0
    for o in outlines:
        tags = o["tags"]
        key = f"{o['el']['type'][0]}{o['el']['id']}"
        pieces = parts_of.get(id(o)) or [o]
        floor_area = 0.0
        for piece in pieces:
            height, known = element_height({**tags, **piece["tags"]} if piece is not o else tags)
            measured += known
            area = footprint_area_m2(piece["polys"])
            floor_area += area * max(1, round(height / LEVEL_M))
            buildings.append({
                "bin": key,
                "bbl": key,
                "name": tags.get("name"),
                "height": round(height, 2),
                "year": osm_year(tags),
                "polygons": [round_rings(p) for p in piece["polys"]],
            })
        lots[key] = {
            "address": osm_address(tags),
            "homes": estimate_homes(tags, floor_area),
            "homesSource": "mapped" if "building:flats" in tags else "estimated",
            "type": BUILDING_TYPES.get(tags.get("building")),
            "yearBuilt": osm_year(tags),
        }
    print(f"  {len(buildings)} buildings ({len(parts)} tower parts), {measured} with mapped heights")

    parks = []
    for p in park_els:
        acres = footprint_area_m2(p["polys"]) / 4046.86
        name = p["tags"].get("name")
        if not name and acres < 0.5:
            continue
        parks.append({
            "id": f"{p['el']['type'][0]}{p['el']['id']}",
            "name": name or "Unnamed park",
            "acres": round(acres, 2),
            "type": "Garden" if p["tags"].get("leisure") == "garden" else "Park",
            "polygons": [round_rings(poly) for poly in p["polys"]],
        })
    parks.sort(key=lambda p: -p["acres"])
    return {"bbox": bbox, "buildings": buildings, "lots": lots, "heightsMeasured": measured}, parks[:MAX_PARKS]


# ---------------------------------------------------------------- Weather, output, manifest

def fetch_weather(bbox, year, timezone):
    s, w, n, e = bbox
    data = get_json(WEATHER_URL, {
        "latitude": round((s + n) / 2, 4),
        "longitude": round((w + e) / 2, 4),
        "start_date": f"{year}-01-01",
        "end_date": f"{year}-12-31",
        "hourly": "cloud_cover,direct_radiation,shortwave_radiation,sunshine_duration",
        "timezone": timezone,
    })
    h = data["hourly"]
    return {
        "source": "Open-Meteo historical archive",
        "year": year,
        "timezone": timezone,
        "start": h["time"][0],  # local time of index 0; one entry per hour
        "cloud_cover": h["cloud_cover"],              # %
        "direct_radiation": h["direct_radiation"],    # W/m², beam sunlight (what shadows block)
        "shortwave_radiation": h["shortwave_radiation"],  # W/m², total incl. diffuse
        "sunshine_duration": h["sunshine_duration"],  # seconds of direct sun in the hour (WMO: beam > 120 W/m²)
    }


def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    print(f"  wrote {os.path.relpath(path)} ({os.path.getsize(path) / 1e6:.1f} MB)")


def fetch_city(city_id, year, bbox=None):
    city = CITIES[city_id]
    bbox = tuple(bbox or city["bbox"])
    out = os.path.join(DATA_DIR, city_id)
    print(f"== {city['name']}")
    building_data, parks = fetch_nyc(bbox) if city["source"] == "nyc" else fetch_osm(bbox)
    write(os.path.join(out, "buildings.json"), building_data)
    print(f"  {len(parks)} parks")
    write(os.path.join(out, "parks.json"), {"bbox": bbox, "parks": parks})
    print(f"Fetching {year} hourly weather…")
    write(os.path.join(out, "weather.json"), fetch_weather(bbox, year, city["timezone"]))


def city_stats(city_id):
    """Headline numbers for the home page, from the files on disk."""
    folder = os.path.join(DATA_DIR, city_id)
    with open(os.path.join(folder, "buildings.json")) as f:
        bd = json.load(f)
    with open(os.path.join(folder, "parks.json")) as f:
        parks = json.load(f)["parks"]
    with open(os.path.join(folder, "weather.json")) as f:
        weather = json.load(f)
    tallest_by_lot = {}
    for b in bd["buildings"]:
        key = b.get("bbl") or b.get("bin")
        if b["height"] > tallest_by_lot.get(key, {"height": 0})["height"]:
            tallest_by_lot[key] = b
    towers = sorted(tallest_by_lot.values(), key=lambda b: -b["height"])
    top = towers[0]
    lot = bd["lots"].get(top.get("bbl")) or {}
    s, w, n, e = bd["bbox"]
    return {
        "bbox": bd["bbox"],
        "year": weather["year"],
        "buildings": len(bd["buildings"]),
        "towers150": sum(1 for b in towers if b["height"] >= 150),
        "homes": round(sum(l.get("homes") or 0 for l in bd["lots"].values())),
        "parks": len(parks),
        "parkAcres": round(sum(p.get("acres") or 0 for p in parks)),
        "areaKm2": round((n - s) * 110.54 * (e - w) * 111.32 * math.cos(math.radians((s + n) / 2)), 1),
        "sunHours": round(sum(weather["sunshine_duration"]) / 3600),
        "tallest": {"name": top.get("name") or (lot.get("address") or "").title() or None, "height": round(top["height"])},
        "skyline": [round(b["height"]) for b in towers[:40]],
        "heightCoverage": round(bd["heightsMeasured"] / len(bd["buildings"]), 2) if "heightsMeasured" in bd else 1,
    }


def write_manifest():
    cities = []
    for city_id, city in CITIES.items():
        if not os.path.exists(os.path.join(DATA_DIR, city_id, "buildings.json")):
            print(f"  skipping {city_id}: no data yet")
            continue
        entry = {k: v for k, v in city.items() if k != "bbox"}
        cities.append({
            "id": city_id,
            **entry,
            "homesEstimated": city["source"] != "nyc",
            "dataSource": "NYC Open Data (footprints, PLUTO)" if city["source"] == "nyc" else "OpenStreetMap",
            "stats": city_stats(city_id),
        })
    write(os.path.join(DATA_DIR, "cities.json"), {"cities": cities})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--city", choices=[*CITIES, "all"], default="all")
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("SOUTH", "WEST", "NORTH", "EAST"), help="override the city's study area")
    ap.add_argument("--year", type=int, default=DEFAULT_YEAR, help="weather year to download")
    ap.add_argument("--manifest-only", action="store_true", help="only rebuild data/cities.json")
    args = ap.parse_args()
    if not args.manifest_only:
        for city_id in CITIES if args.city == "all" else [args.city]:
            fetch_city(city_id, args.year, args.bbox)
    write_manifest()


if __name__ == "__main__":
    main()
