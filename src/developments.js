// A "development" = one tax lot (PLUTO BBL) and every building footprint on it.
// In OpenStreetMap cities, a development is one building outline and its tower parts.
// Homes are counted per lot, so shade per home is scored per development.

import { prepareFootprints } from './shade.js';
import { nicknameFor } from './search.js';

const BUILDING_CLASS = {
  A: 'One-family home', B: 'Two-family home', C: 'Walk-up apartments', D: 'Elevator apartments',
  R: 'Condominium', S: 'Mixed residential & retail', O: 'Office', H: 'Hotel', K: 'Retail',
  L: 'Loft', M: 'Religious', I: 'Health care', W: 'Education', P: 'Cultural / assembly',
  Q: 'Park & recreation', E: 'Warehouse', F: 'Industrial', G: 'Garage', J: 'Theater',
  N: 'Institutional', U: 'Utility', V: 'Vacant land', Y: 'Government', Z: 'Miscellaneous',
};

/** What a lot is used for: NYC building class code, or the OSM building type. */
export function describeLot(lot) {
  if (lot?.type) return lot.type;
  return lot?.class ? BUILDING_CLASS[lot.class[0]] ?? lot.class : null;
}

export function titleCase(address) {
  return address?.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) ?? null;
}

/** Groups footprints by tax lot. Sets b.dev on each building; returns Map key -> development. */
export function groupDevelopments(buildings, lots, nicknames = []) {
  const devs = new Map();
  buildings.forEach((b, i) => {
    const key = b.bbl ?? `bin:${b.bin}`;
    if (!devs.has(key)) {
      const lot = lots[b.bbl] ?? null;
      devs.set(key, { key, lot, homes: lot?.homes ?? 0, buildings: [], shade: null });
    }
    devs.get(key).buildings.push(i);
    b.dev = key;
  });
  for (const dev of devs.values()) {
    const list = dev.buildings.map((i) => buildings[i]);
    const tallest = list.reduce((a, b) => (b.height > a.height ? b : a));
    dev.height = tallest.height;
    dev.year = dev.lot?.yearBuilt || tallest.year;
    // Other footprints on a lot can be small historic buildings, so only trust the tallest's name.
    dev.name =
      tallest.name ??
      nicknameFor(dev.lot?.address, nicknames) ??
      titleCase(dev.lot?.address) ??
      (/^\d+$/.test(tallest.bin) ? `Building ${tallest.bin}` : 'Unnamed building');
  }
  return devs;
}

/**
 * Scores every development with homes in a Web Worker. Calls onProgress(0..1), then
 * onDone(ranking) where ranking.percentile(value) = share of developments with less shade per home.
 */
export function rankDevelopments(devs, buildings, grid, samples, { onProgress, onDone }) {
  const residential = [...devs.values()].filter((d) => d.homes > 0);
  const worker = new Worker(new URL('./shade-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.progress != null) return onProgress(data.progress);
    for (const r of data.results) {
      devs.get(r.key).shade ??= { publicM2h: r.publicM2h, parkM2h: r.parkM2h };
    }
    const values = residential.map((d) => d.shade.publicM2h / d.homes).sort((a, b) => a - b);
    worker.terminate();
    onDone({
      count: values.length,
      percentile(v) {
        let lo = 0;
        let hi = values.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (values[mid] < v) lo = mid + 1;
          else hi = mid;
        }
        return lo / values.length;
      },
    });
  };
  worker.postMessage({
    grid,
    samples,
    developments: residential.map((d) => ({ key: d.key, footprints: prepareFootprints(d.buildings.map((i) => buildings[i])) })),
  });
}

/** Letter grade from the share of buildings that cast less shade per home (lower is better). */
export function gradeFor(percentile) {
  if (percentile < 0.2) return 'A';
  if (percentile < 0.4) return 'B';
  if (percentile < 0.6) return 'C';
  if (percentile < 0.8) return 'D';
  return 'F';
}
