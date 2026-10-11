// Annual "public sunlight blocked" by a development, and shade per home.
//
// Method
//   1. Rasterize the study area into a ground grid: building / open ground (streets,
//      sidewalks, plazas) / park.
//   2. Take every hour of the year that actually had direct sun (Open-Meteo sunshine
//      duration), grouped by week: one sun position per (week, hour of day), weighted by
//      the sunny hours it stands for.
//   3. For each sample, cast the development's ground shadow and count the public cells
//      (open ground + parks) it covers. Shadows falling on roofs don't count.
//
// Result is in m²·sun-hours per year: 1 m² of public ground kept out of the sun for one
// sunny hour. Simplification: a cell already shaded by a neighbor still counts, so
// towers in dense areas are charged for some shade they don't add on their own.

import { sunPosition, localTime } from './sun.js';
import { convexHull } from './shadows.js';

export const CATEGORY = { building: 0, open: 1, park: 2 };
const MIN_ALTITUDE = (2 * Math.PI) / 180; // below this, shadows run off the map anyway

function tracePolygon(ctx, polygons) {
  ctx.beginPath();
  for (const poly of polygons) {
    for (const ring of poly) {
      ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    }
  }
  ctx.fill('evenodd');
}

/**
 * Ground grid covering x ∈ [-halfW, halfW], y ∈ [-halfH, halfH] (meters east/north).
 * Stores per-row prefix sums of public cells so any row span can be counted in O(1).
 */
export function buildGroundGrid(halfW, halfH, parks, buildings, cell = 4) {
  const W = Math.ceil((2 * halfW) / cell);
  const H = Math.ceil((2 * halfH) / cell);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(1 / cell, 0, 0, -1 / cell, halfW / cell, halfH / cell); // meters -> pixels, north up
  ctx.fillStyle = '#f00';
  parks.forEach((p) => tracePolygon(ctx, p.polygons));
  ctx.fillStyle = '#0f0';
  buildings.forEach((b) => tracePolygon(ctx, b.polygons));
  const px = ctx.getImageData(0, 0, W, H).data;

  const publicSum = new Int32Array(H * (W + 1));
  const parkSum = new Int32Array(H * (W + 1));
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = (r * W + c) * 4;
      const cat = px[i + 1] > 127 ? CATEGORY.building : px[i] > 127 ? CATEGORY.park : CATEGORY.open;
      const k = r * (W + 1) + c;
      publicSum[k + 1] = publicSum[k] + (cat !== CATEGORY.building);
      parkSum[k + 1] = parkSum[k] + (cat === CATEGORY.park);
    }
  }
  return { W, H, cell, minX: -halfW, maxY: halfH, publicSum, parkSum };
}

/**
 * Sun samples for a year of weather: {kx, ky, weight}. A building of height h casts
 * its roof outline at offset (h·kx, h·ky); weight = sunny hours this sample represents.
 * groupDays = 1 gives one sample per actual sunny hour; 7 groups each hour of the day by week
 * (sun position from the middle day, sunshine summed over the week) for ~6× less work.
 */
export function sunshineSamples(weather, lat, lon, groupDays = 7) {
  const [y, m, d] = weather.start.slice(0, 10).split('-').map(Number);
  const days = Math.floor(weather.sunshine_duration.length / 24);
  const samples = [];
  let sunnyHours = 0;
  for (let week = 0; week * groupDays < days; week++) {
    const mid = Math.min(week * groupDays + Math.floor(groupDays / 2), days - 1);
    const date = new Date(Date.UTC(y, m - 1, d + mid)).toISOString().slice(0, 10);
    for (let hour = 0; hour < 24; hour++) {
      let weight = 0;
      for (let day = week * groupDays; day < Math.min((week + 1) * groupDays, days); day++) {
        weight += weather.sunshine_duration[day * 24 + hour] / 3600;
      }
      if (weight <= 0) continue;
      sunnyHours += weight;
      // Entry `hour` covers the hour ending at hour:00, so use its midpoint.
      const sun = sunPosition(localTime(date, hour * 60 - 30, weather.timezone), lat, lon);
      if (sun.altitude < MIN_ALTITUDE) continue;
      const k = 1 / Math.tan(sun.altitude);
      samples.push({ kx: -k * Math.sin(sun.azimuth), ky: -k * Math.cos(sun.azimuth), weight });
    }
  }
  return { samples, sunnyHours };
}

/** Column span [c0, c1] of cell centers inside a convex polygon on the row at height y, or null. */
function rowSpan(poly, y, grid) {
  let xmin = Infinity;
  let xmax = -Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x0, y0] = poly[j];
    const [x1, y1] = poly[i];
    if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) {
      const x = x0 + ((y - y0) * (x1 - x0)) / (y1 - y0);
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
    }
  }
  if (xmin > xmax) return null;
  const c0 = Math.max(0, Math.ceil((xmin - grid.minX) / grid.cell - 0.5));
  const c1 = Math.min(grid.W - 1, Math.floor((xmax - grid.minX) / grid.cell - 0.5));
  return c0 <= c1 ? [c0, c1] : null;
}

/** Footprints prepared once per development: convex hull of each outline + height. */
export function prepareFootprints(buildings) {
  return buildings.map((b) => ({ hull: convexHull(b.polygons.flatMap((p) => p[0])), height: b.height }));
}

/**
 * Annual shade a development casts on public ground.
 * Shadows of the development's own buildings are merged, so overlap isn't double counted.
 * @returns {{publicM2h: number, parkM2h: number}} m²·sun-hours per year
 */
export function developmentShade(footprints, grid, samples) {
  const { W, cell, maxY, publicSum, parkSum } = grid;
  let publicCells = 0;
  let parkCells = 0;
  for (const { kx, ky, weight } of samples) {
    const polys = [];
    let top = Infinity;
    let bottom = -Infinity;
    for (const { hull, height } of footprints) {
      const dx = kx * height;
      const dy = ky * height;
      const poly = convexHull(hull.concat(hull.map(([x, y]) => [x + dx, y + dy])));
      for (const [, y] of poly) {
        const r = (maxY - y) / cell;
        if (r < top) top = r;
        if (r > bottom) bottom = r;
      }
      polys.push(poly);
    }
    const r0 = Math.max(0, Math.floor(top));
    const r1 = Math.min(grid.H - 1, Math.ceil(bottom));
    let pub = 0;
    let park = 0;
    for (let r = r0; r <= r1; r++) {
      const y = maxY - (r + 0.5) * cell;
      const spans = [];
      for (const poly of polys) {
        const s = rowSpan(poly, y, grid);
        if (s) spans.push(s);
      }
      if (spans.length > 1) spans.sort((a, b) => a[0] - b[0]);
      const base = r * (W + 1);
      let end = -1;
      for (let [c0, c1] of spans) {
        c0 = Math.max(c0, end + 1); // skip columns already counted
        if (c1 < c0) continue;
        pub += publicSum[base + c1 + 1] - publicSum[base + c0];
        park += parkSum[base + c1 + 1] - parkSum[base + c0];
        end = c1;
      }
    }
    publicCells += pub * weight;
    parkCells += park * weight;
  }
  const area = cell * cell;
  return { publicM2h: publicCells * area, parkM2h: parkCells * area };
}
