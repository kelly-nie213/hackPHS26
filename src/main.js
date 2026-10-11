import * as THREE from 'three';
import { makeProjection, projectPolygons } from './geo.js';
import { sunPosition, sunDirection, localTime, solarDay } from './sun.js';
import { buildingShadow } from './shadows.js';
import { weatherAt } from './weather.js';
import { createCityScene } from './scene.js';
import { createSunPath } from './sunpath.js';
import { buildGroundGrid, sunshineSamples, prepareFootprints, developmentShade } from './shade.js';
import { groupDevelopments, rankDevelopments, gradeFor, describeLot, titleCase } from './developments.js';
import { createSearchIndex, geocode, nicknamesFor } from './search.js';
import { setupParks } from './parks-ui.js';

const $ = (id) => document.getElementById(id);
const DEG = 180 / Math.PI;
const M_TO_FT = 3.28084;

const state = {
  date: null, // 'YYYY-MM-DD', the city's local date
  minutes: 9 * 60, // minutes after local midnight
  playing: false,
  speed: 60, // simulated minutes per real second
  useWeather: true,
  day: null, // solarDay() result for state.date
  selected: null, // development key (tax lot)
};

async function loadJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r)));

function formatTime(minutes) {
  if (minutes == null) return '—';
  const m = Math.round(minutes) % 1440;
  const h = Math.floor(m / 60);
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function compassName(azimuth) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((azimuth * DEG) / 45) % 8];
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const SKY = {
  night: new THREE.Color('#0b1026'),
  dusk: new THREE.Color('#e9a46a'),
  day: new THREE.Color('#8ec5ff'),
  overcast: new THREE.Color('#9aa3ad'),
  lowSun: new THREE.Color('#ffb36b'),
  highSun: new THREE.Color('#ffffff'),
};

/** Light levels and sky color for a sun altitude (degrees) and cloud cover (0–1). */
function lightingFor(altDeg, cloud) {
  const daylight = smoothstep(-6, 8, altDeg);
  const sky = new THREE.Color().lerpColors(SKY.night, SKY.dusk, smoothstep(-10, 0, altDeg));
  sky.lerp(SKY.day, smoothstep(0, 15, altDeg));
  sky.lerp(SKY.overcast, cloud * 0.7 * daylight);
  return {
    sun: 3.2 * smoothstep(0, 6, altDeg) * (1 - 0.8 * cloud),
    ambient: 0.2 + (0.45 + 0.5 * cloud) * daylight,
    sunColor: new THREE.Color().lerpColors(SKY.lowSun, SKY.highSun, smoothstep(0, 25, altDeg)),
    sky,
  };
}

/** The city from ?city=, defaulting to New York (older share links have no city). */
async function loadPlace(params) {
  const { cities } = await loadJSON('data/cities.json');
  const place = cities.find((c) => c.id === params.get('city')) ?? cities.find((c) => c.id === 'nyc') ?? cities[0];
  return { place, cities };
}

/** Header copy, city switcher and method notes for the chosen city. */
function showPlace(place, cities) {
  document.title = `${place.name} · Shadow Ledger`;
  $('city-name').textContent = place.name;
  $('city-tagline').textContent = place.tagline;
  const picker = $('city-picker');
  picker.replaceChildren(...cities.map((c) => new Option(`${c.name}, ${c.state}`, c.id, false, c.id === place.id)));
  picker.addEventListener('change', () => (location.href = `explore.html?city=${picker.value}`));
  $('search').placeholder = `Search a building or address in ${place.name}…`;
  $('homes-source').textContent = place.homesEstimated
    ? 'homes on the lot (from OpenStreetMap: mapped unit counts where known, otherwise estimated from building type and floor area)'
    : 'homes on the lot (PLUTO residential units)';
  $('area-note').textContent = place.note ?? `Only towers inside the mapped area (${place.area}) are included.`;
  $('data-source').textContent = place.dataSource;
  if (place.homesEstimated) $('estimate-note').hidden = false;
}

async function main() {
  const status = $('status');
  const params = new URLSearchParams(location.search);
  let place, cities, buildingData, parkData, weather;
  try {
    ({ place, cities } = await loadPlace(params));
    showPlace(place, cities);
    status.textContent = `Loading ${place.name} building footprints…`;
    [buildingData, parkData, weather] = await Promise.all(['buildings', 'parks', 'weather'].map((f) => loadJSON(`data/${place.id}/${f}.json`)));
  } catch (err) {
    status.innerHTML = `Couldn't load data (${err.message}).<br>Run <code>python3 scripts/fetch_data.py</code>, then serve this folder with <code>python3 -m http.server</code>.`;
    status.classList.add('error');
    throw err;
  }

  const [south, west, north, east] = buildingData.bbox;
  const lat = (south + north) / 2;
  const lon = (west + east) / 2;
  const proj = makeProjection(lat, lon);
  const [halfW, halfH] = proj.toXY(east, north);
  const radius = Math.hypot(halfW, halfH);

  const buildings = buildingData.buildings.map((b) => ({ ...b, polygons: projectPolygons(b.polygons, proj) }));
  const parks = parkData.parks.map((p) => ({ ...p, polygons: projectPolygons(p.polygons, proj) }));

  status.textContent = `Extruding ${buildings.length.toLocaleString()} buildings…`;
  await nextFrame();
  const city = createCityScene($('scene'), radius);
  city.addParks(parks);
  city.addBuildings(buildings);
  city.lookAt(...proj.toXY(place.view.lon, place.view.lat), place.view.offset);
  status.remove();

  // Shade-per-home setup: ground grid, a year of sunny hours, developments, background ranking.
  const devs = groupDevelopments(buildings, buildingData.lots, nicknamesFor(place.id));
  const grid = buildGroundGrid(halfW, halfH, parks, buildings);
  const { samples: sunSamples, sunnyHours } = sunshineSamples(weather, lat, lon);
  let ranking = null;
  rankDevelopments(devs, buildings, grid, sunSamples, {
    onProgress: (p) => ($('rank-status').textContent = `Ranking buildings… ${Math.round(p * 100)}%`),
    onDone: (r) => {
      ranking = r;
      $('rank-status').textContent = '';
      if (devs.has(state.selected)) renderDevelopment(devs.get(state.selected)); // swap the "…" for a grade
      updateSelection();
    },
  });

  const sunPath = createSunPath($('sunpath'));
  const slider = $('time');
  const dateInput = $('date');
  const playBtn = $('play');

  // Weather file covers one year; keep the date picker inside it.
  const year = weather.year;
  dateInput.min = `${year}-01-01`;
  dateInput.max = `${year}-12-31`;
  state.date = `${year}-06-21`;
  dateInput.value = state.date;
  $('weather-year').textContent = year;
  $('method-year').textContent = year;
  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => setDate(`${year}-${btn.dataset.preset}`));
  });

  function setDate(dateStr) {
    state.date = dateStr;
    dateInput.value = dateStr;
    state.day = solarDay(dateStr, lat, lon, place.timezone);
    const { sunrise, sunset, samples } = state.day;
    city.setSunPath(samples.map(sunDirection));
    sunPath.setDay(samples);
    $('sunrise').textContent = formatTime(sunrise);
    $('sunset').textContent = formatTime(sunset);
    const len = sunset - sunrise;
    $('daylength').textContent = `${Math.floor(len / 60)}h ${Math.round(len % 60)}m`;
    // Paint night/day bands onto the slider track.
    const pct = (m) => `${((m / 1440) * 100).toFixed(2)}%`;
    slider.style.setProperty(
      '--track',
      `linear-gradient(to right, var(--night) ${pct(sunrise - 40)}, var(--day) ${pct(sunrise + 40)}, var(--day) ${pct(sunset - 40)}, var(--night) ${pct(sunset + 40)})`,
    );
    update();
  }

  function update() {
    const when = localTime(state.date, state.minutes, place.timezone);
    const sun = sunPosition(when, lat, lon);
    const altDeg = sun.altitude * DEG;
    const wx = weatherAt(weather, state.date, state.minutes);
    const cloud = state.useWeather && wx ? wx.cloudCover / 100 : 0;

    city.setSun(sunDirection(sun), lightingFor(altDeg, cloud));
    sunPath.setSun(sun);

    slider.value = Math.round(state.minutes);
    $('clock').textContent = formatTime(state.minutes);
    $('altitude').textContent = `${altDeg.toFixed(1)}°`;
    $('azimuth').textContent = `${(sun.azimuth * DEG).toFixed(0)}° ${compassName(sun.azimuth)}`;
    $('sun-state').textContent = altDeg > 0 ? 'Sun is up' : altDeg > -6 ? 'Twilight' : 'Night';
    $('cloud').textContent = wx ? `${wx.cloudCover}%` : '—';
    $('direct').textContent = wx ? `${Math.round(wx.direct)} W/m²` : '—';

    updateSelection(sun);
  }

  function devShade(dev) {
    dev.shade ??= developmentShade(prepareFootprints(dev.buildings.map((i) => buildings[i])), grid, sunSamples);
    return dev.shade;
  }

  function updateSelection(sun = sunPosition(localTime(state.date, state.minutes, place.timezone), lat, lon)) {
    const dev = devs.get(state.selected);
    $('building-card').hidden = !dev;
    if (!dev) {
      city.setShadowHighlight([]);
      return;
    }
    const shadows = dev.buildings.map((i) => buildingShadow(buildings[i].polygons, buildings[i].height, sun)).filter(Boolean);
    city.setShadowHighlight(shadows.map((sh) => sh.ring));
    const longest = Math.max(0, ...shadows.map((sh) => sh.length));
    $('b-shadow-len').textContent = shadows.length ? `${Math.round(longest).toLocaleString()} m long` : 'sun is down';
  }

  /** Static facts + the annual score; only recomputed when the selection changes or ranking lands. */
  function renderDevelopment(dev) {
    const lot = dev.lot;
    const shade = devShade(dev);
    $('b-name').textContent = dev.name;
    const address = titleCase(lot?.address);
    $('b-address').textContent = [address !== dev.name ? address : null, describeLot(lot)].filter(Boolean).join(' · ');
    $('b-homes').textContent = `${place.homesEstimated && lot?.homesSource !== 'mapped' && dev.homes ? '~' : ''}${dev.homes.toLocaleString()}`;
    $('b-height').textContent = `${Math.round(dev.height)} m (${Math.round(dev.height * M_TO_FT).toLocaleString()} ft)`;
    $('b-year').textContent = dev.year ?? 'unknown';
    $('b-blocked').textContent = `${fmtBig(shade.publicM2h)} m²·h`;
    $('b-park').textContent = `${fmtBig(shade.parkM2h)} m²·h`;
    $('b-avg').textContent = `${Math.round(shade.publicM2h / sunnyHours).toLocaleString()} m²`;

    const grade = $('b-grade');
    if (dev.homes === 0) {
      grade.textContent = '✕';
      grade.dataset.grade = 'none';
      $('b-per-home').textContent = place.homesEstimated ? 'No homes mapped' : 'No homes';
      $('b-verdict').textContent = place.homesEstimated
        ? "OpenStreetMap doesn't list it as housing, so none of its shade is buying homes (as far as the map knows)."
        : 'Creates no housing, so all of its shade buys zero homes.';
      return;
    }
    const perHome = shade.publicM2h / dev.homes;
    $('b-per-home').textContent = `${Math.round(perHome / sunnyHours).toLocaleString()} m²`;
    if (!ranking) {
      grade.textContent = '…';
      grade.dataset.grade = 'pending';
      $('b-verdict').textContent = 'Ranking against nearby buildings…';
      return;
    }
    const pct = ranking.percentile(perHome);
    grade.textContent = gradeFor(pct);
    grade.dataset.grade = gradeFor(pct);
    $('b-verdict').textContent =
      pct >= 0.5
        ? `Casts more shade per home than ${Math.round(pct * 100)}% of the ${ranking.count.toLocaleString()} residential buildings mapped.`
        : `Casts less shade per home than ${Math.round((1 - pct) * 100)}% of the ${ranking.count.toLocaleString()} residential buildings mapped.`;
  }

  function select(key, { fly = false } = {}) {
    const dev = devs.get(key);
    state.selected = dev ? key : null;
    if (dev) parkPanel.clear();
    city.setSelectedBuildings(dev ? dev.buildings.map((i) => buildings[i]) : []);
    if (dev) {
      renderDevelopment(dev);
      if (fly) {
        const ring = buildings[dev.buildings[0]].polygons[0][0];
        city.lookAt(ring[0][0], ring[0][1], [-200 - dev.height, 250 + 1.5 * dev.height, 400 + 1.8 * dev.height]);
      }
    }
    updateSelection();
  }

  // Click (not drag) on a building to select its development.
  let downAt = null;
  city.canvas.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
  city.canvas.addEventListener('pointerup', (e) => {
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5) {
      const dev = buildings[city.pickBuilding(e.clientX, e.clientY)]?.dev;
      const ground = dev ? null : city.pickGround(e.clientX, e.clientY);
      const park = ground ? parkPanel.parkAt(ground) : -1;
      if (park >= 0) parkPanel.select(park);
      else select(dev ?? null);
    }
    downAt = null;
  });
  setupSearch(devs, buildings, select, place, proj);

  // Sunlight each park loses to tall towers over the weather year.
  const parkPanel = setupParks({
    city,
    parks,
    buildings,
    devs,
    grid,
    weather,
    lat,
    lon,
    onSelectPark: () => select(null),
    onSelectDev: (key) => select(key, { fly: true }),
  });
  $('b-close').addEventListener('click', () => select(null));

  slider.addEventListener('input', () => {
    state.minutes = +slider.value;
    update();
  });
  dateInput.addEventListener('change', () => dateInput.value && setDate(dateInput.value));
  $('speed').addEventListener('change', (e) => (state.speed = +e.target.value));
  $('use-weather').addEventListener('change', (e) => {
    state.useWeather = e.target.checked;
    update();
  });

  function setPlaying(playing) {
    state.playing = playing;
    playBtn.textContent = playing ? '❚❚' : '▶';
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    const { sunrise, sunset } = state.day;
    if (playing && (state.minutes < sunrise - 30 || state.minutes > sunset + 30)) state.minutes = sunrise - 30;
  }
  playBtn.addEventListener('click', () => setPlaying(!state.playing));
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      setPlaying(!state.playing);
    }
  });

  // Time-lapse: advance the clock each frame; loop over daylight hours.
  let last = null;
  city.onFrame = (now) => {
    const dt = last == null ? 0 : (now - last) / 1000;
    last = now;
    if (!state.playing) return;
    const { sunrise, sunset } = state.day;
    state.minutes += state.speed * Math.min(dt, 0.1);
    if (state.minutes > sunset + 30) state.minutes = sunrise - 30;
    update();
  };

  // Shareable moments: ?city=nyc&date=2025-12-21&time=13:30&play=0&bin=1090180
  const [hh, mm] = (params.get('time') ?? '').split(':').map(Number);
  if (Number.isFinite(hh)) state.minutes = hh * 60 + (mm || 0);
  setDate(/^\d{4}-\d{2}-\d{2}$/.test(params.get('date')) ? params.get('date') : state.date);
  setPlaying(params.get('play') !== '0');
  if (params.has('bin')) select(buildings.find((b) => b.bin === params.get('bin'))?.dev, { fly: true });
  if (params.has('park')) parkPanel.select(parks.findIndex((p) => p.name === params.get('park')), { fly: true });
}

function fmtBig(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million`;
  return Math.round(n).toLocaleString();
}

/** Is [x, y] inside any of a building's polygons (even-odd over all rings)? */
function insideBuilding([x, y], polygons) {
  let inside = false;
  for (const ring of polygons.flat()) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x0, y0] = ring[j];
      const [x1, y1] = ring[i];
      if (y0 > y !== y1 > y && x < x0 + ((y - y0) * (x1 - x0)) / (y1 - y0)) inside = !inside;
    }
  }
  return inside;
}

/** Search box: local suggestions while typing; Enter falls back to the city's geocoder. */
function setupSearch(devs, buildings, select, place, proj) {
  const input = $('search');
  const list = $('search-results');
  const msg = $('search-msg');
  const entries = [];
  for (const dev of devs.values()) {
    if (dev.lot?.address) entries.push({ label: titleCase(dev.lot.address), key: dev.key });
    if (dev.name !== titleCase(dev.lot?.address)) entries.push({ label: dev.name, key: dev.key });
  }
  const index = createSearchIndex(entries, nicknamesFor(place.id));
  let results = [];
  let active = 0;

  const say = (text) => {
    msg.textContent = text;
    msg.hidden = !text;
  };
  const choose = (item) => {
    input.value = item.label;
    list.hidden = true;
    say('');
    select(item.key, { fly: true });
  };
  const render = () => {
    list.replaceChildren(
      ...results.map((item, i) => {
        const li = document.createElement('li');
        li.textContent = item.label;
        if (item.hint) li.append(Object.assign(document.createElement('small'), { textContent: item.hint }));
        li.classList.toggle('active', i === active);
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          choose(item);
        });
        return li;
      }),
    );
    list.hidden = !results.length;
  };

  input.addEventListener('input', () => {
    results = index.suggest(input.value);
    active = 0;
    say('');
    render();
  });
  input.addEventListener('blur', () => (list.hidden = true));
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % Math.max(1, results.length);
      render();
    } else if (e.key === 'Escape') {
      list.hidden = true;
    } else if (e.key === 'Enter') {
      if (results.length && !list.hidden) return choose(results[active]);
      const text = input.value.trim();
      if (!text) return;
      say('Looking up address…');
      try {
        const hit = await geocode(text, place);
        const point = hit && proj.toXY(hit.lon, hit.lat);
        const building =
          hit &&
          (buildings.find((b) => b.bin === hit.bin) ??
            buildings.find((b) => b.bbl === hit.bbl) ??
            buildings.find((b) => insideBuilding(point, b.polygons)));
        // "233, South Wacker Drive, Loop, …" (Nominatim) or "217 W 57th St, Manhattan, …" (GeoSearch)
        const parts = hit?.label.split(',') ?? [];
        const label = titleCase(/^\d+$/.test(parts[0]?.trim()) ? `${parts[0]}${parts[1]}` : parts[0]);
        if (building) choose({ label, key: building.dev });
        else say(hit ? `${label} is outside the mapped area (${place.area}).` : 'No address found.');
      } catch {
        say('Address lookup failed. Check your connection.');
      }
    }
  });
}

main();
