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
| `buildings.json` → `lots` | [NYC Open Data: PLUTO](https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO-/64uk-42ks), id `64uk-42ks` | Homes per tax lot (`unitsres`), address, building class. Joined to footprints by `mappluto_bbl` |
| `parks.json` | [NYC Open Data: Parks Properties](https://data.cityofnewyork.us/Recreation/Parks-Properties/enfh-gkve), id `enfh-gkve` | |
| `weather.json` | [Open-Meteo historical weather](https://open-meteo.com/en/docs/historical-weather-api) | Hourly cloud cover, solar radiation and sunshine duration |
| (live) | [NYC GeoSearch](https://geosearch.planninglabs.nyc/) | Address search fallback: any NYC address to building ID (BIN) and tax lot (BBL) |

## Code map

| File | What it does |
| --- | --- |
| `src/sun.js` | Solar position (altitude/azimuth) for any instant, NYC local time to UTC, sunrise and sunset |
| `src/shadows.js` | Analytic ground shadow of a building, to use for the park and home sunlight calculations |
| `src/shade.js` | Shade per home: ground grid, sunny-hour samples, annual public shade of a development |
| `src/developments.js` | Groups footprints into tax-lot developments, ranks them in a Web Worker (`src/shade-worker.js`), grades A–F |
| `src/search.js` | Address and name search, tower nicknames, GeoSearch fallback |
| `src/scene.js` | three.js scene: extruded buildings, parks, sun light with shadow mapping, selection |
| `src/weather.js` | Hourly weather lookup |
| `src/sunpath.js` | Sun-path compass diagram |
| `src/main.js` | Loads data, time-lapse slider and playback, UI |

## Shade per home

For each development (a tax lot plus all of its buildings), we take every sunny hour of the weather year (grouped by week), cast the development's shadow, and measure how much public ground it covers: streets, sidewalks, plazas and parks. Roofs don't count. Averaged over sunny hours and divided by the lot's residential units, that gives **m² of public shade per home**. Grades A–F are quintiles across all residential buildings in the mapped area.

Simplifications: shade overlapping a neighbor's shadow still counts, shadows that leave the mapped area aren't counted, and open private land such as backyards counts as public ground.
