import { buildingShadow } from './shadows.js';

// Deliberately coarse, transparent sampling for the Living Atlas estimate.
// This is a comparison aid, not a survey-grade annual sunlight total.
const DATES = ['03-20', '04-20', '05-21', '06-21', '07-22', '08-22', '09-22', '10-22', '11-21', '12-21'];
const HOURS = [7, 9, 11, 13, 15, 17];

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > y !== yj > y;
    if (crosses && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function bounds(ring) {
  return ring.reduce(
    (b, [x, y]) => ({ minX: Math.min(b.minX, x), maxX: Math.max(b.maxX, x), minY: Math.min(b.minY, y), maxY: Math.max(b.maxY, y) }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
}

function area(ring) {
  return Math.abs(ring.reduce((sum, [x, y], i) => {
    const [px, py] = ring[(i + ring.length - 1) % ring.length];
    return sum + px * y - x * py;
  }, 0)) / 2;
}

/** Estimate direct-sun hours and area-weighted loss for one selected tower. */
export function annualShadowEstimate(park, building, dateYear, lat, lon, height, nycTime, sunPosition) {
  const ring = park.polygons[0]?.[0];
  if (!ring || !building) return null;
  const box = bounds(ring);
  const grid = 18;
  const points = [];
  for (let iy = 0; iy < grid; iy++) for (let ix = 0; ix < grid; ix++) {
    const p = [box.minX + ((ix + 0.5) / grid) * (box.maxX - box.minX), box.minY + ((iy + 0.5) / grid) * (box.maxY - box.minY)];
    if (pointInRing(p, ring)) points.push(p);
  }
  if (!points.length) return null;
  let sunSamples = 0;
  let shadeSamples = 0;
  for (const md of DATES) for (const hour of HOURS) {
    const sun = sunPosition(nycTime(`${dateYear}-${md}`, hour * 60), lat, lon);
    if (sun.altitude <= 0) continue;
    sunSamples += points.length;
    const shadow = buildingShadow(building.polygons, height, sun);
    if (!shadow) continue;
    shadeSamples += points.reduce((n, p) => n + (pointInRing(p, shadow.ring) ? 1 : 0), 0);
  }
  const parkArea = park.acres * 4046.856;
  const lossFraction = sunSamples ? shadeSamples / sunSamples : 0;
  const sampledSunHours = (sunSamples / points.length) * 2; // six 2-hour representative samples per date
  const loss = sampledSunHours * parkArea * lossFraction * (365 / DATES.length);
  const totalSunHours = sampledSunHours * (365 / DATES.length);
  return { parkArea, lossFraction, annualSunHours: totalSunHours, availableSunHours: totalSunHours * (1 - lossFraction), lossM2h: loss, samples: DATES.length * HOURS.length };
}

export function polygonArea(ring) {
  return area(ring);
}
