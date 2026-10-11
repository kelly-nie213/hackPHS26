// Home page: an interactive skyline whose shadows sweep a park as you move the sun,
// headline totals, and the city picker built from data/cities.json.

const $ = (id) => document.getElementById(id);
const RAD = Math.PI / 180;
const LAT = 40.7 * RAD; // the demo uses New York's latitude

// ---------------------------------------------------------------- Hero shadow demo

// A little downtown: towers south of a park, in meters (x east, y north). The viewer stands
// north of the park looking south, so the sun is behind the skyline and shadows fall toward us.
const TOWERS = [
  { x: -150, y: -70, w: 34, d: 30, h: 70 },
  { x: -112, y: -48, w: 26, d: 26, h: 120 },
  { x: -78, y: -82, w: 30, d: 34, h: 165 },
  { x: -40, y: -46, w: 16, d: 16, h: 330, spire: true }, // slender supertall
  { x: -8, y: -76, w: 34, d: 30, h: 140 },
  { x: 30, y: -50, w: 22, d: 22, h: 250 },
  { x: 66, y: -84, w: 38, d: 32, h: 95 },
  { x: 100, y: -48, w: 18, d: 18, h: 290, spire: true },
  { x: 140, y: -72, w: 32, d: 30, h: 110 },
  { x: 176, y: -50, w: 26, d: 24, h: 60 },
];
const PARK = { x0: -190, x1: 210, y0: -14, y1: 150 };
const SEASONS = {
  summer: { decl: 23.44, label: 'Jun 21' },
  equinox: { decl: 0, label: 'Mar 20' },
  winter: { decl: -23.44, label: 'Dec 21' },
};

/** Sun altitude and compass azimuth (radians) at solar time `hours` with declination `decl`°. */
function sunAt(hours, decl) {
  const d = decl * RAD;
  const H = (hours - 12) * 15 * RAD;
  const alt = Math.asin(Math.sin(LAT) * Math.sin(d) + Math.cos(LAT) * Math.cos(d) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT) - Math.tan(d) * Math.cos(LAT)) + Math.PI;
  return { alt, az };
}

/** Sunrise and sunset in solar hours for a declination. */
function dayLength(decl) {
  const cosH = -Math.tan(LAT) * Math.tan(decl * RAD);
  const H = Math.acos(Math.max(-1, Math.min(1, cosH))) / (15 * RAD);
  return [12 - H, 12 + H];
}

function hull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function inside([x, y], poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x0, y0] = poly[j];
    const [x1, y1] = poly[i];
    if (y0 > y !== y1 > y && x < x0 + ((y - y0) * (x1 - x0)) / (y1 - y0)) hit = !hit;
  }
  return hit;
}

function formatClock(hours) {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60) % 24;
  return `${((h + 11) % 12) + 1}:${String(total % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const clamp01 = (t) => Math.min(1, Math.max(0, t));

function setupHero() {
  const canvas = $('hero-canvas');
  const ctx = canvas.getContext('2d');
  const shadowLayer = document.createElement('canvas');
  const sctx = shadowLayer.getContext('2d');
  const slider = $('demo-slider');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Park sample points for the "% in shadow" readout.
  const samples = [];
  for (let i = 0; i < 48; i++) {
    for (let j = 0; j < 20; j++) {
      samples.push([PARK.x0 + ((i + 0.5) * (PARK.x1 - PARK.x0)) / 48, PARK.y0 + ((j + 0.5) * (PARK.y1 - PARK.y0)) / 20]);
    }
  }

  const state = { t: 0.35, season: 'winter', auto: !reduceMotion, lastInput: 0 };
  let view = null; // projection, recomputed on resize

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    for (const c of [canvas, shadowLayer]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const narrow = w < 860;
    // Wide screens: skyline right of the headline. Narrow screens: skyline below the buttons,
    // with the control panel pushed down to sit just under the park.
    const scale = narrow ? w / 470 : Math.min(w / 820, h / 660);
    let horizon = h * 0.6;
    if (narrow) {
      const heroTop = canvas.parentElement.getBoundingClientRect().top;
      const ctaBottom = document.querySelector('.cta').getBoundingClientRect().bottom - heroTop;
      horizon = ctaBottom + 20 + 365 * scale;
      const panel = document.querySelector('.hero-panel');
      const gap = `${Math.round(horizon - ctaBottom + 110 * scale)}px`;
      if (panel.style.marginTop !== gap) panel.style.marginTop = gap; // resizes the hero, re-running this once
    }
    view = {
      w,
      h,
      scale,
      cx: narrow ? w / 2 : w * 0.64,
      horizon,
      depth: 0.42, // how much ground depth shows (oblique view from above)
      shear: 0.18, // slight sideways view so tower sides show
    };
    draw();
  }

  /** World (x east, y north, z up) to screen. Looking south: east is on the left. */
  function project(x, y, z = 0) {
    const { cx, horizon, scale, depth, shear } = view;
    const sy = horizon + (y + 90) * depth * scale - z * scale;
    return [cx - x * scale - (y + 90) * shear * scale, sy];
  }

  function hours() {
    const [rise, set] = dayLength(SEASONS[state.season].decl);
    return rise + 0.15 + state.t * (set - rise - 0.3);
  }

  function draw() {
    if (!view) return;
    const { w, h } = view;
    const season = SEASONS[state.season];
    const hr = hours();
    const sun = sunAt(hr, season.decl);
    const altDeg = sun.alt / RAD;
    const day = clamp01(altDeg / 12);

    // Sky: dusk orange near the horizon, deepening blue as the sun climbs.
    const zenith = mix([30, 27, 75], [56, 116, 196], day);
    const glow = mix([249, 115, 22], [186, 224, 253], clamp01((altDeg - 3) / 25));
    const sky = ctx.createLinearGradient(0, 0, 0, view.horizon);
    sky.addColorStop(0, rgb(mix([11, 17, 32], zenith, 0.85)));
    sky.addColorStop(1, rgb(glow));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Sun disc: azimuth across the screen (east on the left), altitude up.
    const sx = view.cx - Math.sin(sun.az) * Math.min(w * 0.5, 700);
    const sy = view.horizon - (altDeg / 75) * view.horizon * 0.95;
    const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, 140);
    halo.addColorStop(0, 'rgba(253, 224, 71, 0.55)');
    halo.addColorStop(1, 'rgba(253, 224, 71, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(sx - 140, sy - 140, 280, 280);
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(sx, sy, 16, 0, Math.PI * 2);
    ctx.fill();

    // Ground and park.
    // Ground fades in from the horizon haze, then darkens toward the page below.
    const top = view.horizon - 40 * view.scale;
    const ground = ctx.createLinearGradient(0, top, 0, h);
    ground.addColorStop(0, rgb(glow, 0));
    ground.addColorStop(0.12, rgb(mix([30, 41, 59], [148, 163, 184], day * 0.7)));
    ground.addColorStop(0.75, rgb(mix([15, 23, 42], [100, 116, 139], day * 0.6)));
    ground.addColorStop(1, rgb([11, 17, 32]));
    ctx.fillStyle = ground;
    ctx.fillRect(0, top, w, h - top);
    const parkPoly = [
      [PARK.x0, PARK.y0],
      [PARK.x1, PARK.y0],
      [PARK.x1, PARK.y1],
      [PARK.x0, PARK.y1],
    ];
    ctx.fillStyle = rgb(mix([44, 74, 50], [124, 179, 107], day));
    fillPoly(ctx, parkPoly.map(([x, y]) => project(x, y)));
    // Paths through the park.
    ctx.strokeStyle = rgb(mix([60, 80, 70], [214, 211, 196], day), 0.7);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(...project(PARK.x0, 40));
    ctx.quadraticCurveTo(...project(0, 140), ...project(PARK.x1, 70));
    ctx.moveTo(...project(-20, PARK.y0));
    ctx.quadraticCurveTo(...project(40, 70), ...project(-60, PARK.y1));
    ctx.stroke();

    // Shadows: drawn opaque on their own layer, then laid down once so overlaps don't stack.
    let shaded = 0;
    sctx.clearRect(0, 0, w, h);
    if (sun.alt > 0.01) {
      const k = 1 / Math.tan(sun.alt);
      const dx = -k * Math.sin(sun.az);
      const dy = -k * Math.cos(sun.az);
      const shadows = TOWERS.map((t) => {
        const base = [
          [t.x - t.w / 2, t.y - t.d / 2],
          [t.x + t.w / 2, t.y - t.d / 2],
          [t.x + t.w / 2, t.y + t.d / 2],
          [t.x - t.w / 2, t.y + t.d / 2],
        ];
        return hull(base.concat(base.map(([x, y]) => [x + dx * t.h, y + dy * t.h])));
      });
      sctx.fillStyle = '#000';
      for (const s of shadows) fillPoly(sctx, s.map(([x, y]) => project(x, y)));
      shaded = samples.filter((p) => shadows.some((s) => inside(p, s))).length / samples.length;
      ctx.save();
      ctx.globalAlpha = 0.42 * clamp01(altDeg / 4);
      ctx.drawImage(shadowLayer, 0, 0, w, h);
      ctx.restore();
    } else {
      shaded = 1;
    }

    // Towers, far to near. Faces facing the viewer (north) are in shade while the sun is south.
    const lit = rgb(mix([71, 85, 105], [241, 245, 249], day));
    const dark = rgb(mix([15, 23, 42], [100, 116, 139], day));
    const side = rgb(mix([30, 41, 59], [176, 186, 200], day));
    const eastLit = Math.sin(sun.az) > 0;
    for (const t of [...TOWERS].sort((a, b) => a.y - b.y)) {
      const x0 = t.x - t.w / 2;
      const x1 = t.x + t.w / 2;
      const y0 = t.y - t.d / 2;
      const y1 = t.y + t.d / 2;
      // The west face shows (looking south, the far edge sits right of the near one); it's lit in the afternoon.
      ctx.fillStyle = eastLit ? side : lit;
      fillPoly(ctx, [project(x0, y0, 0), project(x0, y1, 0), project(x0, y1, t.h), project(x0, y0, t.h)]);
      ctx.fillStyle = dark;
      fillPoly(ctx, [project(x0, y1, 0), project(x1, y1, 0), project(x1, y1, t.h), project(x0, y1, t.h)]);
      ctx.fillStyle = lit;
      fillPoly(ctx, [project(x0, y0, t.h), project(x1, y0, t.h), project(x1, y1, t.h), project(x0, y1, t.h)]);
      if (t.spire) {
        ctx.strokeStyle = dark;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(...project(t.x, t.y, t.h));
        ctx.lineTo(...project(t.x, t.y, t.h + 30));
        ctx.stroke();
      }
      // Windows: a few lit rows at dusk.
      if (day < 0.6) {
        ctx.fillStyle = `rgba(253, 230, 138, ${0.5 * (1 - day / 0.6)})`;
        for (let z = 12; z < t.h - 6; z += 14) {
          for (let x = x0 + 4; x < x1 - 3; x += 7) {
            if ((x * 7 + z * 3 + t.h) % 5 < 2) {
              const [px, py] = project(x, y1, z);
              ctx.fillRect(px - 1.5 * view.scale, py, 2.5 * view.scale, 3 * view.scale);
            }
          }
        }
      }
    }

    $('demo-park').textContent = `${Math.round(shaded * 100)}%`;
    $('demo-time').textContent = formatClock(hr);
    $('demo-season').textContent = season.label;
    slider.value = Math.round(state.t * 1000);
  }

  function fillPoly(c, pts) {
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fill();
  }

  // Pointer anywhere over the hero moves the sun (east = left, matching the view).
  const hero = canvas.parentElement;
  hero.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.target.closest('.hero-panel, .cta, .nav')) return;
    state.t = clamp01(e.clientX / view.w);
    state.lastInput = performance.now();
    draw();
  });
  slider.addEventListener('input', () => {
    state.t = slider.value / 1000;
    state.lastInput = performance.now();
    draw();
  });
  document.querySelectorAll('[data-season]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.season = btn.dataset.season;
      document.querySelectorAll('[data-season]').forEach((b) => b.setAttribute('aria-checked', b === btn));
      draw();
    });
  });

  // Drift the sun across the sky while nobody's steering it.
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state.auto && now - state.lastInput > 2500 && !document.hidden) {
      state.t = (state.t + dt * 0.06) % 1;
      draw();
    }
    requestAnimationFrame(frame);
  }
  new ResizeObserver(resize).observe(canvas);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- Cities

const fmt = (n) => n.toLocaleString('en-US');
const MAX_SKYLINE_M = 550; // shared scale so skylines compare across cities

/** Small seeded PRNG, so each city's skyline arrangement is stable between visits. */
function seeded(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** Mini skyline from a city's tallest towers (shared height scale), with shadows reaching right. */
function skylineSVG(heights, id) {
  const W = 300;
  const H = 110;
  const ground = 96;
  const rand = seeded(id);
  // Tallest towers cluster near the middle, the rest scatter outward like a real downtown.
  const bars = heights.slice(0, 28).map((h, i) => ({ h, pos: 0.5 + (rand() - 0.5) * Math.min(1, 0.25 + i / 18) }));
  bars.sort((a, b) => a.pos - b.pos);
  const slot = (W - 16) / bars.length;
  const scale = (ground - 8) / MAX_SKYLINE_M;
  const parts = [`<rect class="ground" x="0" y="${ground}" width="${W}" height="${H - ground}"/>`];
  const towers = bars.map(({ h }, i) => {
    const bw = slot * (0.55 + rand() * 0.4);
    const x = 8 + slot * i + (slot - bw) / 2;
    const bh = Math.max(3, h * scale);
    parts.push(`<rect class="shadow" x="${x + bw}" y="${ground}" width="${Math.min(110, bh * 1.1)}" height="6" />`);
    return `<rect class="bar${h >= 150 ? ' tall' : ''}" x="${x.toFixed(1)}" y="${(ground - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1"><title>${h} m</title></rect>`;
  });
  parts.push(...towers, `<circle class="sun" cx="${W - 24}" cy="22" r="9"/>`);
  return `<svg class="skyline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${parts.join('')}</svg>`;
}

function cityCard(c) {
  const s = c.stats;
  const a = document.createElement('a');
  a.className = 'city-card';
  a.href = `explore.html?city=${c.id}`;
  a.setAttribute('aria-label', `Explore ${c.name}`);
  const tallest = s.tallest.name ? `${s.tallest.name}, ${s.tallest.height} m` : `${s.tallest.height} m`;
  a.innerHTML = `
    ${skylineSVG(s.skyline, c.id)}
    <div class="city-body">
      <div class="city-title"><h3></h3><span></span></div>
      <p class="city-tagline"></p>
      <dl class="city-stats">
        <div><dd>${fmt(s.towers150)}</dd><dt>Over 150 m</dt></div>
        <div><dd>${s.tallest.height} m</dd><dt>Tallest</dt></div>
        <div><dd>${fmt(s.parks)}</dd><dt>Parks</dt></div>
      </dl>
      <div class="city-foot">
        <span class="badge ${c.homesEstimated ? '' : 'official'}"></span>
        <span class="go">Explore →</span>
      </div>
    </div>`;
  a.querySelector('h3').textContent = c.name;
  a.querySelector('.city-title span').textContent = c.state;
  a.querySelector('.city-tagline').textContent = c.tagline;
  a.querySelector('.badge').textContent = c.homesEstimated
    ? `OpenStreetMap · ${Math.round(s.heightCoverage * 100)}% heights mapped`
    : 'Official city data';
  a.title = `Tallest: ${tallest} · ${fmt(s.buildings)} buildings · ${fmt(s.sunHours)} sunny hours in ${s.year}`;
  return a;
}

const SORTS = {
  towers: (a, b) => b.stats.towers150 - a.stats.towers150,
  tallest: (a, b) => b.stats.tallest.height - a.stats.tallest.height,
  sun: (a, b) => b.stats.sunHours - a.stats.sunHours,
  name: (a, b) => a.name.localeCompare(b.name),
};

async function setupCities() {
  const grid = $('city-grid');
  let cities;
  try {
    const res = await fetch('data/cities.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ({ cities } = await res.json());
  } catch (err) {
    grid.innerHTML = `<p class="loading">Couldn't load the city list (${err.message}). Run <code>python3 scripts/fetch_data.py</code>, then serve this folder with <code>python3 -m http.server</code>.</p>`;
    return;
  }

  const sum = (key) => cities.reduce((n, c) => n + c.stats[key], 0);
  const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  $('cities-title').textContent = `${words[cities.length] ?? cities.length} cities to explore`;
  $('t-cities').textContent = cities.length;
  $('t-buildings').textContent = fmt(sum('buildings'));
  $('t-towers').textContent = fmt(sum('towers150'));
  $('t-hours').textContent = fmt(sum('sunHours'));

  const render = (key) => grid.replaceChildren(...[...cities].sort(SORTS[key]).map(cityCard));
  document.querySelectorAll('[data-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-sort]').forEach((b) => b.setAttribute('aria-checked', b === btn));
      render(btn.dataset.sort);
    });
  });
  render('towers');
}

setupHero();
setupCities();
