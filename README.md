# Shadow Ledger

Tall towers take sunlight from the public. We measure how much sunlight skyscrapers take, who loses it, and whether the city got enough housing in return, in eight American downtowns: New York, Chicago, San Francisco, Boston, Seattle, Los Angeles, Philadelphia and Miami.

## Run it

No build step, no installs. Python 3 serves the site; three.js loads from a CDN.

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

The home page (`index.html`) introduces the project and lets you pick a city. Each city opens in the 3D explorer, `explore.html?city=<id>` (`nyc`, `chicago`, `sf`, `boston`, `seattle`, `la`, `philadelphia`, `miami`).

Links can jump to a moment, a tower or a park: `http://localhost:8000/explore.html?city=nyc&date=2025-12-21&time=14:30&play=0&bin=1090180` or `?city=nyc&park=Central%20Park`. Older links without a city (`/?date=…`) still open New York.

## Data

`data/` is already populated: one folder per city (`data/<id>/buildings.json`, `parks.json`, `weather.json`) plus `data/cities.json`, the list the home page and explorer read. To refresh it or change the area or year:

```sh
python3 scripts/fetch_data.py                                   # every city, 2025 weather
python3 scripts/fetch_data.py --city chicago                    # one city
python3 scripts/fetch_data.py --city nyc --bbox 40.70 -74.02 40.72 -73.99  # south west north east
python3 scripts/fetch_data.py --city nyc --year 2024
python3 scripts/fetch_data.py --manifest-only                   # just rebuild data/cities.json
```

To add a city, add an entry to `CITIES` in `scripts/fetch_data.py` (study-area bbox, timezone, starting camera view, copy) and run it with `--city <id>`.

New York uses official city data (below). Every other city uses OpenStreetMap through the [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API):

- **Buildings:** `building=*` outlines. Where a tower is mapped as `building:part`s (common for supertalls), the parts replace the outline. Parts under 30 m² (antennas, spires) are dropped.
- **Heights:** `height`, else `building:levels` × 3.3 m. Buildings with neither are drawn at a typical low-rise height (7–10 m). Each city card shows the share of buildings with a mapped height.
- **Homes:** `building:flats` where mapped. Otherwise they're estimated: apartment buildings get floor area × 80% ÷ 85 m², houses get 1, and anything else gets 0. Mixed-use towers tagged as offices or hotels show no homes, and luxury towers with big units are overcounted, so grades outside New York are approximate.
- **Parks:** `leisure=park` and `leisure=garden`.

New York's sources:

| File | Source | Notes |
| --- | --- | --- |
| `buildings.json` | [NYC Open Data: BUILDING (Building Footprints)](https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue), id `5zhs-2jue` | `height_roof` converted from feet to meters |
| `buildings.json` → `lots` | [NYC Open Data: PLUTO](https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO-/64uk-42ks), id `64uk-42ks` | Homes per tax lot (`unitsres`), address, building class. Joined to footprints by `mappluto_bbl` |
| `parks.json` | [NYC Open Data: Parks Properties](https://data.cityofnewyork.us/Recreation/Parks-Properties/enfh-gkve), id `enfh-gkve` | |
| `weather.json` | [Open-Meteo historical weather](https://open-meteo.com/en/docs/historical-weather-api) | Hourly cloud cover, solar radiation and sunshine duration |
| (live) | [NYC GeoSearch](https://geosearch.planninglabs.nyc/) | Address search fallback: any NYC address to building ID (BIN) and tax lot (BBL) |
| (live, other cities) | [OSM Nominatim](https://nominatim.org/) | Address search fallback, limited to the study area |

## Code map

| File | What it does |
| --- | --- |
| `index.html`, `home.css`, `src/home.js` | Home page: interactive shadow demo, how it works, city picker |
| `src/sun.js` | Solar position (altitude/azimuth) for any instant, a city's local time to UTC, sunrise and sunset |
| `src/shadows.js` | Analytic ground shadow of a building, to use for the park and home sunlight calculations |
| `src/shade.js` | Shade per home: ground grid, sunny-hour samples, annual public shade of a development |
| `src/developments.js` | Groups footprints into tax-lot developments, ranks them in a Web Worker (`src/shade-worker.js`), grades A–F |
| `src/parks.js` | Sunlight lost in parks: park rasterization, hour-by-hour tower shading for a year (run in `src/park-worker.js`) |
| `src/parks-ui.js` | Parks ranking, heatmap, park details and responsible towers |
| `src/search.js` | Address and name search, tower nicknames, GeoSearch / Nominatim fallback |
| `src/scene.js` | three.js scene: extruded buildings, parks, sun light with shadow mapping, selection |
| `src/weather.js` | Hourly weather lookup |
| `src/sunpath.js` | Sun-path compass diagram |
| `src/main.js` | Explorer (`explore.html`): loads the chosen city, time-lapse slider and playback, UI |

## Shade per home

For each development (a tax lot plus all of its buildings; outside New York, one OSM building and its tower parts), we take every sunny hour of the weather year (grouped by week), cast the development's shadow, and measure how much public ground it covers: streets, sidewalks, plazas and parks. Roofs don't count. Averaged over sunny hours and divided by the lot's residential units, that gives **m² of public shade per home**. Grades A–F are quintiles across all residential buildings in the mapped area.

Simplifications: shade overlapping a neighbor's shadow still counts, shadows that leave the mapped area aren't counted, and open private land such as backyards counts as public ground.

## Sunlight lost in parks

For each hour of the weather year with any direct sunshine (Open-Meteo, each weighted by its actual minutes of sun; in New York, 3,260 hours in 2025 and 3,101 sun-hours in total), we cast the shadow of every tower at that hour's sun position. A spot in a park loses that hour if a tower at or above the height threshold (default 150 m) shades it and no shorter building already does, so towers aren't charged for shade the park would get anyway. Results are kept per 4 m grid cell: the heatmap shows hours lost per spot, and each park reports the average spot, its worst spot, and the towers responsible.

Only towers inside each study area are counted, so parks near the edges are undercounted (in New York, towers south of ~42nd St are left out, which affects e.g. Father Duffy Square).
