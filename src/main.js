import * as THREE from 'three';
import { makeProjection, projectPolygons } from './geo.js';
import { sunPosition, sunDirection, nycTime, solarDay } from './sun.js';
import { buildingShadow } from './shadows.js';
import { weatherAt } from './weather.js';
import { createCityScene } from './scene.js';
import { createSunPath } from './sunpath.js';
import { annualShadowEstimate } from './atlas.js';
import { createOrbitWatch } from './orbitwatch.js';
import { createSkyMap } from './skymap.js';

const $ = (id) => document.getElementById(id);
const DEG = 180 / Math.PI;
const M_TO_FT = 3.28084;

// Initial camera: looking north up 57th St's "Billionaires' Row" toward Central Park.
const START_VIEW = { lat: 40.7655, lon: -73.978, offset: [-350, 1100, 1700] };

const state = {
  date: null, // 'YYYY-MM-DD', NYC local
  minutes: 9 * 60, // minutes after local midnight
  playing: false,
  speed: 60, // simulated minutes per real second
  useWeather: true,
  day: null, // solarDay() result for state.date
  selected: -1,
  scenarioHeight: null,
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

async function main() {
  const status = $('status');
  status.textContent = 'Loading NYC building footprints…';
  let buildingData, parkData, weather;
  try {
    [buildingData, parkData, weather] = await Promise.all(['data/buildings.json', 'data/parks.json', 'data/weather.json'].map(loadJSON));
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
  city.lookAt(...proj.toXY(START_VIEW.lon, START_VIEW.lat), START_VIEW.offset);
  status.remove();

  const sunPath = createSunPath($('sunpath'));
  const slider = $('time');
  const dateInput = $('date');
  const playBtn = $('play');
  const largestPark = parks.reduce((best, park) => (park.acres > (best?.acres ?? 0) ? park : best), null);
  let activeOrbit = null;

  const screenMarkup = {
    sky: `<div class="screen-inner sky-screen"><div class="screen-kicker">EXPLORE THE SKY · SKY MAP</div><h1>Your window to space</h1><p class="screen-lede">See constellation patterns for your actual device location, then explore the Sun, Moon, planets, and satellites above the skyline.</p><div class="skymap-dashboard"><div id="sky-world" class="sky-world"></div><aside class="sky-hud"><b>LOCATION-AWARE SKY</b><button id="sky-location">ORIENT TO MY LOCATION</button><div id="sky-location-status" class="screen-fact"><b>LOCATION NOT SET</b><span>Allow location to orient the constellation layer.</span></div><p class="microcopy">Select an object in the dome or use the direct controls.</p><div class="sky-object-buttons"><button data-sky-object="Sun · seasonal path">SUN</button><button data-sky-object="Moon · observation target">MOON</button><button data-sky-object="Mars · planet candidate">MARS</button><button data-sky-object="ISS · satellite pass">ISS</button></div><div id="sky-object-readout" class="screen-fact"><b>READY</b><span>Select the Sun, Moon, Mars, or ISS.</span></div><label>Sun altitude <output id="full-sky-value">32°</output><input id="full-sky-altitude" type="range" min="5" max="80" value="32"></label><div class="sky-education"><b>LEARN</b><span>Stars appear to move because Earth rotates.</span><span>Planets shine steadily; aircraft blink and satellites glide.</span></div></aside></div><p class="screen-note">Constellations are an educational orientation layer; precise astronomical positioning requires a dedicated ephemeris/catalog service.</p></div>`,
    orbit: `<div class="screen-inner orbit-screen"><div class="screen-kicker">ENTER ORBIT · ORBITALWATCH</div><h1>Space debris &amp; satellite re-entry tracker</h1><p class="screen-lede">Monitor active satellites, dead space junk, close encounters, and re-entry risk in one orbital safety dashboard.</p><div class="orbital-dashboard"><div id="orbit-world" class="orbit-world"></div><aside class="orbit-hud"><div class="orbit-legend"><span><i class="dot green"></i> ACTIVE</span><span><i class="dot red"></i> DEBRIS</span><span><i class="dot gold"></i> STATION</span></div><button id="orbit-refresh" class="refresh-button">REFRESH CELESTRAK STATIONS</button><div id="orbit-source" class="microcopy">Catalog status: simulated fallback · click refresh for live station elements.</div><label>Simulation speed <output id="orbit-speed-value">1×</output><input id="orbit-speed" type="range" min="1" max="20" value="1"></label><div class="orbit-section"><b>CLOSE ENCOUNTER WARNING</b><button class="alert-row active">ISS vs DEB-441 <span>4.2 km</span></button><button class="alert-row">Starlink-321 vs DEB-827 <span>8.7 km</span></button><button id="trigger-burn" class="burn-button">TRIGGER AVOIDANCE BURN</button><p id="burn-status" class="microcopy">Simulated CARA-style assessment · not an operational safety product.</p></div><div class="orbit-section"><b>RE-ENTRY WATCH</b><p class="microcopy">CZ-5B core · altitude 142 km · decay forecast: 18–31 h · uncertainty high.</p></div></aside></div><div class="orbit-analytics"><b>KESSLER CASCADE MODEL</b><span>2060 projection</span><label>Active Debris Removal <input id="adr-slider" type="range" min="0" max="100" value="35"></label><div class="cascade-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><span id="adr-readout">Moderate intervention slows the modeled cascade.</span></div><p class="screen-note">Live station elements come from CelesTrak’s public GP JSON endpoint; debris and conjunctions remain explicitly labeled as modeled until their source data is connected.</p></div>`,
  };

  function closeScreen() {
    activeOrbit?.dispose(); activeOrbit = null; $('mode-screen').hidden = true; document.body.classList.remove('mode-open');
  }
  function openScreen(mode) {
    if (mode === 'city') { closeScreen(); return; }
    activeOrbit?.dispose(); activeOrbit = null;
    const screen = $('mode-screen'); screen.innerHTML = screenMarkup[mode]; screen.hidden = false; document.body.classList.add('mode-open');
    if (mode === 'sky') {
      const slider = $('full-sky-altitude'); const sky = createSkyMap($('sky-world'), (name) => { $('sky-object-readout').innerHTML = `<b>${name}</b><span>Educational identification · check time, place, and data source before treating it as an observation.</span>`; });
      slider.addEventListener('input', () => { $('full-sky-value').textContent = `${slider.value}°`; sky.setAltitude(slider.value); });
      $('sky-location').addEventListener('click', () => { if (!navigator.geolocation) { $('sky-location-status').innerHTML = '<b>UNAVAILABLE</b><span>This browser does not provide device location. Default NYC orientation remains active.</span>'; return; } $('sky-location-status').innerHTML = '<b>REQUESTING LOCATION</b><span>Permission prompt will resolve within 8 seconds.</span>'; navigator.geolocation.getCurrentPosition(({ coords }) => { sky.setLocation(coords.latitude, coords.longitude); $('sky-location-status').innerHTML = `<b>LOCATION SET</b><span>${coords.latitude.toFixed(2)}°, ${coords.longitude.toFixed(2)}° · constellation orientation updated.</span>`; }, () => { $('sky-location-status').innerHTML = '<b>USING DEFAULT</b><span>Location permission timed out or was denied. NYC orientation remains active.</span>'; }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }); });
      screen.querySelectorAll('[data-sky-object]').forEach((button) => button.addEventListener('click', () => sky.selectObject(button.dataset.skyObject)));
    } else if (mode === 'orbit') {
      activeOrbit = createOrbitWatch($('orbit-world'), (object) => { $('burn-status').textContent = `${object.id} selected · ${object.type} · ${object.altitude} km modeled altitude.`; });
      $('orbit-speed').addEventListener('input', (e) => { activeOrbit.setSpeed(e.target.value); $('orbit-speed-value').textContent = `${e.target.value}×`; });
      $('orbit-refresh').addEventListener('click', async () => { $('orbit-source').textContent = 'Loading CelesTrak station elements…'; try { const catalog = await activeOrbit.loadLiveCatalog(); const latest = catalog.map((x) => x.EPOCH).filter(Boolean).sort().at(-1); $('orbit-source').textContent = `LIVE CelesTrak · ${catalog.length} station records · latest epoch ${latest ?? 'unknown'}.`; } catch (error) { $('orbit-source').textContent = `Live catalog unavailable (${error.message}). Simulated fallback remains active.`; } });
      $('trigger-burn').addEventListener('click', () => { $('burn-status').textContent = 'SIMULATION: burn raised the miss distance from 4.2 km to 18.6 km. Safe-orbit result is illustrative.'; });
      screen.querySelectorAll('.alert-row').forEach((row) => row.addEventListener('click', () => { screen.querySelectorAll('.alert-row').forEach((r) => r.classList.toggle('active', r === row)); $('burn-status').textContent = `${row.textContent.trim()} selected · review the modeled miss distance before triggering a burn.`; }));
      $('adr-slider').addEventListener('input', (e) => { $('adr-readout').textContent = +e.target.value > 65 ? 'High removal effort: the modeled cascade declines by 2060.' : +e.target.value > 35 ? 'Moderate intervention slows the modeled cascade.' : 'Low removal effort: the modeled cascade continues to grow.'; });
    }
  }

  const modeCopy = {
    sky: `<div class="module-heading"><div><div class="eyebrow">SKY MAP · SKYLINE LENS</div><h2>What can the city still see?</h2></div><span class="evidence inferred">INFERRED</span></div>
      <div class="sky-module"><div class="sky-dome" id="sky-dome"><span class="sky-label north">N</span><span class="sky-label east">E</span><span class="sky-label south">S</span><span class="sky-label west">W</span><span class="star s1">✦</span><span class="star s2">✦</span><span class="star s3">✦</span><span class="star s4">✦</span><span class="sky-sun" id="sky-sun">☼</span><div class="skyline-mask"></div></div>
      <label class="module-control">Viewpoint <select id="sky-view"><option>Central Park · ground level</option><option>57th Street · sidewalk</option><option>Rooftop · 250 m</option></select></label>
      <label class="module-control">Sun altitude <output id="sky-altitude-value">32°</output><input id="sky-altitude" type="range" min="5" max="80" value="32" /></label>
      <p id="sky-readout" class="module-readout">The skyline masks the lowest part of the horizon. Higher viewpoints reveal more of the sky dome.</p></div>
      <p class="microcopy">This is a local-sky visualization. Building obstruction is separate from clouds, light pollution, and atmospheric conditions.</p>`,
    orbit: `<div class="module-heading"><div><div class="eyebrow">ORBITALWATCH · EDUCATIONAL TRACKS</div><h2>Objects above the skyline</h2></div><span class="evidence observed">EPOCH · SIMULATED CATALOG</span></div>
      <div class="orbit-module"><div class="orbit-stage"><div class="orbit-glow"></div><div class="orbit-earth">EARTH</div><i class="orbit-ring ring-a"></i><i class="orbit-ring ring-b"></i><i class="orbit-ring ring-c"></i><button class="orbit-object sat-a" data-object="Atlas Relay">●</button><button class="orbit-object sat-b" data-object="Defunct Weathercraft">●</button><button class="orbit-object sat-c" data-object="Tracked Debris">●</button></div>
      <div class="orbit-objects"><button class="object-button active" data-object="Atlas Relay">ACTIVE · Atlas Relay</button><button class="object-button" data-object="Defunct Weathercraft">DEFUNCT · Weathercraft</button><button class="object-button" data-object="Tracked Debris">DEBRIS · Fragment 441</button></div><div id="orbit-detail" class="module-readout">Atlas Relay · low Earth orbit · 408 km altitude · catalog epoch 2025-01-01.</div></div>
      <p class="microcopy">Tracks are propagated teaching visualizations. A line crossing is not a collision prediction; real conjunction assessment requires uncertainty data.</p>`,
  };
  document.querySelectorAll('.mode').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('.mode').forEach((b) => b.classList.toggle('active', b === button));
    openScreen(button.dataset.mode);
    return;
    /* Legacy inline mode panel retained below for reference. */
    const panel = $('mode-panel');
    if (button.dataset.mode === 'city') { panel.hidden = true; return; }
    panel.innerHTML = modeCopy[button.dataset.mode];
    panel.hidden = false;
    if (button.dataset.mode === 'sky') {
      const slider = $('sky-altitude');
      const sun = $('sky-sun');
      const output = $('sky-altitude-value');
      const viewpoint = $('sky-view');
      const updateSky = () => {
        const altitude = +slider.value;
        output.textContent = `${altitude}°`;
        sun.style.transform = `translate(-50%, -50%) rotate(${(altitude - 32) * 0.8}deg) translateY(-${Math.max(18, altitude * 1.1)}px)`;
        $('sky-readout').textContent = viewpoint.value.includes('Rooftop') ? 'From this height, the skyline mask drops below the celestial band: more of the sky dome is visible.' : altitude < 20 ? 'At this low solar angle, nearby towers occupy more of the visible horizon.' : 'The Sun clears the modeled skyline at this angle; building obstruction is still distinct from weather and light pollution.';
      };
      slider.addEventListener('input', updateSky); viewpoint.addEventListener('change', updateSky); updateSky();
    }
    if (button.dataset.mode === 'orbit') {
      const details = { 'Atlas Relay': 'Atlas Relay · active · low Earth orbit · 408 km altitude · epoch 2025-01-01.', 'Defunct Weathercraft': 'Defunct Weathercraft · inactive · medium Earth orbit · 1,180 km altitude · epoch 2024-11-18.', 'Tracked Debris': 'Fragment 441 · debris · illustrative track · uncertainty not available.' };
      panel.querySelectorAll('[data-object]').forEach((objectButton) => objectButton.addEventListener('click', () => {
        panel.querySelectorAll('[data-object]').forEach((b) => b.classList.toggle('active', b === objectButton || b.dataset.object === objectButton.dataset.object));
        $('orbit-detail').textContent = details[objectButton.dataset.object];
      }));
    }
  }));

  // Weather file covers one year; keep the date picker inside it.
  const year = weather.year;
  dateInput.min = `${year}-01-01`;
  dateInput.max = `${year}-12-31`;
  state.date = `${year}-06-21`;
  dateInput.value = state.date;
  $('weather-year').textContent = year;
  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => setDate(`${year}-${btn.dataset.preset}`));
  });

  function setDate(dateStr) {
    state.date = dateStr;
    dateInput.value = dateStr;
    state.day = solarDay(dateStr, lat, lon);
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
    const when = nycTime(state.date, state.minutes);
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

  function updateSelection(sun = sunPosition(nycTime(state.date, state.minutes), lat, lon)) {
    const card = $('building-card');
    const b = buildings[state.selected];
    card.hidden = !b;
    if (!b) {
      city.setShadowHighlight(null);
      return;
    }
    const height = state.scenarioHeight ?? b.height;
    const shadow = buildingShadow(b.polygons, height, sun);
    city.setShadowHighlight(shadow?.ring);
    $('b-name').textContent = b.name || `Building ${b.bin}`;
    $('b-height').textContent = `${Math.round(height)} m (${Math.round(height * M_TO_FT).toLocaleString()} ft)`;
    $('b-year').textContent = b.year ?? 'unknown';
    $('b-bin').textContent = b.bin;
    $('b-shadow-len').textContent = shadow ? `${Math.round(shadow.length).toLocaleString()} m` : 'no sun';
    $('b-shadow-area').textContent = shadow ? `${Math.round(shadow.area).toLocaleString()} m²` : '—';
    $('scenario-height').value = Math.round(height);
    $('scenario-height-value').textContent = `${Math.round(height)} m`;
    const estimate = annualShadowEstimate(largestPark, b, year, lat, lon, height, nycTime, sunPosition);
    if (estimate) {
      $('ledger-with').textContent = `${Math.round(estimate.availableSunHours).toLocaleString()} sun-h/yr`;
      $('ledger-without').textContent = `${Math.round(estimate.annualSunHours).toLocaleString()} sun-h/yr`;
      $('ledger-loss').textContent = `${Math.round(estimate.lossM2h).toLocaleString()} m²h/yr`;
    }
  }

  function select(index) {
    state.selected = index;
    state.scenarioHeight = buildings[index]?.height ?? null;
    city.setSelectedBuilding(buildings[index] ?? null);
    updateSelection();
  }

  // Click (not drag) on a building to select it.
  let downAt = null;
  city.canvas.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
  city.canvas.addEventListener('pointerup', (e) => {
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5) select(city.pickBuilding(e.clientX, e.clientY));
    downAt = null;
  });
  $('b-close').addEventListener('click', () => select(-1));
  $('scenario-height').addEventListener('input', (e) => {
    if (state.selected < 0) return;
    state.scenarioHeight = +e.target.value;
    updateSelection();
  });

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

  // Shareable moments: ?date=2025-12-21&time=13:30&play=0&bin=1090180
  const params = new URLSearchParams(location.search);
  const [hh, mm] = (params.get('time') ?? '').split(':').map(Number);
  if (Number.isFinite(hh)) state.minutes = hh * 60 + (mm || 0);
  setDate(/^\d{4}-\d{2}-\d{2}$/.test(params.get('date')) ? params.get('date') : state.date);
  setPlaying(params.get('play') !== '0');
  if (params.has('bin')) select(buildings.findIndex((b) => b.bin === params.get('bin')));
}

main();
