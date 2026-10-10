# AFTERLIGHT: The Shadow Atlas

Tall towers in NYC take sunlight from the public. We make that trade-off visible with a browser-based civic science experience: moving solar geometry, modeled shadows, transparent evidence labels, and scenario comparisons.

The current build is an integrated browser vertical slice from the project bible. It includes the real 3D neighborhood, seasonal Sun controls, building selection, an annualized park-sunlight estimate, location-aware Sky Map, and an OrbitalWatch dashboard with CelesTrak refresh support and explicit simulated fallbacks.

## Run it

No build step, no installs. Python 3 serves the site; three.js loads from a CDN.

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

The included VS Code task **Afterlight local server** uses Ruby when Python is unavailable:

```sh
ruby --disable-gems -run -e httpd . -p 8000
```

Links can jump to a moment and a tower: `http://localhost:8000/?date=2025-12-21&time=14:30&play=0&bin=1090180`

## Data

`data/` is already populated. To refresh it or change the area or year:

```sh
python3 scripts/fetch_data.py                                   # Central Park + Billionaires' Row, 2025
python3 scripts/fetch_data.py --bbox 40.70 -74.02 40.72 -73.99  # south west north east
python3 scripts/fetch_data.py --year 2024
```

| File | Source | Notes |
| --- | --- | --- |
| `buildings.json` | [NYC Open Data: BUILDING (Building Footprints)](https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue), id `5zhs-2jue` | `height_roof` converted from feet to meters |
| `parks.json` | [NYC Open Data: Parks Properties](https://data.cityofnewyork.us/Recreation/Parks-Properties/enfh-gkve), id `enfh-gkve` | |
| `weather.json` | [Open-Meteo historical weather](https://open-meteo.com/en/docs/historical-weather-api) | Hourly cloud cover and direct/total solar radiation |

## Code map

| File | What it does |
| --- | --- |
| `src/sun.js` | Solar position (altitude/azimuth) for any instant, NYC local time to UTC, sunrise and sunset |
| `src/shadows.js` | Analytic ground shadow of a building, to use for the park and home sunlight calculations |
| `src/scene.js` | three.js scene: extruded buildings, parks, sun light with shadow mapping, selection |
| `src/weather.js` | Hourly weather lookup |
| `src/sunpath.js` | Sun-path compass diagram |
| `src/main.js` | Loads data, time-lapse slider and playback, UI |
| `src/atlas.js` | Coarse, grid-weighted annual sunlight estimate and evidence-safe ledger metrics |

## Evidence and limitations

The blue **OBSERVED** label identifies sourced NYC geometry. The teal **INFERRED** label identifies quantities derived from solar geometry and the building model. The amber **FORECAST** label identifies hypothetical height scenarios. The annual ledger samples 10 representative dates and six two-hour time slices per date across a representative park grid; it is an estimate for comparison, not a precise annual measurement. Housing counts are not present in the current dataset, so the app intentionally does not invent a shade-per-home ratio.
