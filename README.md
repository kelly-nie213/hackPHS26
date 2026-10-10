# Shadow Ledger

Tall towers in NYC take sunlight from the public. We measure how much sunlight skyscrapers take, who loses it, and whether the city got enough housing in return.

## Run it

No build step, no installs. Python 3 serves the site; three.js loads from a CDN.

```sh
python3 -m http.server 8000
# open http://localhost:8000
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
