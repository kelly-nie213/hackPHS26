// Sunlight each park loses to tall towers over a year of real weather.
//
// For every hour of the weather year with direct sun (Open-Meteo sunshine duration),
// a park spot counts as "lost" for that hour if a tall tower shades it and no shorter
// building already does, so towers aren't charged for shade the park would have had anyway.
// Each hour is weighted by its actual minutes of sunshine.

import { convexHull } from './shadows.js';

const COARSE = 8; // coarse grid = 8×8 fine cells, for fast "could this shadow touch a park?" tests

/**
 * Rasterize parks onto the ground grid: parkId[cell] = park index + 1 (0 = not a park).
 * Exact even-odd scanline fill on cell centers, so edge cells never get a blended id.
 */
export function rasterizeParks(parks, grid) {
  const { W, H, cell, minX, maxY } = grid;
  const parkId = new Uint8Array(W * H);
  parks.forEach((park, p) => {
    const rings = park.polygons.flat();
    let top = Infinity;
    let bottom = -Infinity;
    for (const ring of rings) for (const [, y] of ring) (top = Math.min(top, y)), (bottom = Math.max(bottom, y));
    const r0 = Math.max(0, Math.floor((maxY - bottom) / cell));
    const r1 = Math.min(H - 1, Math.ceil((maxY - top) / cell));
    for (let r = r0; r <= r1; r++) {
      const y = maxY - (r + 0.5) * cell;
      const xs = [];
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [x0, y0] = ring[j];
          const [x1, y1] = ring[i];
          if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - minX) / cell - 0.5));
        const c1 = Math.min(W - 1, Math.floor((xs[k + 1] - minX) / cell - 0.5));
        for (let c = c0; c <= c1; c++) parkId[r * W + c] = p + 1;
      }
    }
  });
  return parkId;
}

/** 2D prefix sums of park cells on a coarse grid. */
function coarseParkIndex(parkId, W, H) {
  const CW = Math.ceil(W / COARSE);
  const CH = Math.ceil(H / COARSE);
  const sum = new Int32Array((CW + 1) * (CH + 1));
  const has = new Uint8Array(CW * CH);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) if (parkId[r * W + c]) has[((r / COARSE) | 0) * CW + ((c / COARSE) | 0)] = 1;
  }
  for (let r = 0; r < CH; r++) {
    for (let c = 0; c < CW; c++) {
      sum[(r + 1) * (CW + 1) + c + 1] = has[r * CW + c] + sum[r * (CW + 1) + c + 1] + sum[(r + 1) * (CW + 1) + c] - sum[r * (CW + 1) + c];
    }
  }
  return { CW, CH, sum, has };
}

/** Rasterize a convex polygon row by row, calling visit(cellIndex) for each covered cell. */
function fillConvex(poly, grid, visit) {
  const { W, H, cell, minX, maxY } = grid;
  let top = Infinity;
  let bottom = -Infinity;
  for (const [, y] of poly) (top = Math.min(top, y)), (bottom = Math.max(bottom, y));
  const r0 = Math.max(0, Math.floor((maxY - bottom) / cell));
  const r1 = Math.min(H - 1, Math.ceil((maxY - top) / cell));
  for (let r = r0; r <= r1; r++) {
    const y = maxY - (r + 0.5) * cell;
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
    const c0 = Math.max(0, Math.ceil((xmin - minX) / cell - 0.5));
    const c1 = Math.min(W - 1, Math.floor((xmax - minX) / cell - 0.5));
    for (let c = c0; c <= c1; c++) visit(r * W + c);
  }
}

/** Like fillConvex, but visits every cell the polygon touches at all (not just cell centers). */
function touchConvex(poly, grid, visit) {
  const { W, H, cell, minX, maxY } = grid;
  let top = Infinity;
  let bottom = -Infinity;
  for (const [, y] of poly) (top = Math.min(top, y)), (bottom = Math.max(bottom, y));
  const r0 = Math.max(0, Math.floor((maxY - bottom) / cell));
  const r1 = Math.min(H - 1, Math.floor((maxY - top) / cell));
  for (let r = r0; r <= r1; r++) {
    const yHi = maxY - r * cell;
    const yLo = yHi - cell;
    let xmin = Infinity;
    let xmax = -Infinity;
    const take = (x) => ((xmin = Math.min(xmin, x)), (xmax = Math.max(xmax, x)));
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [x0, y0] = poly[j];
      const [x1, y1] = poly[i];
      if (y0 >= yLo && y0 <= yHi) take(x0);
      for (const y of [yLo, yHi]) if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) take(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
    }
    const c0 = Math.max(0, Math.floor((xmin - minX) / cell));
    const c1 = Math.min(W - 1, Math.floor((xmax - minX) / cell));
    for (let c = c0; c <= c1; c++) visit(r * W + c);
  }
}

/**
 * @param buildings [{hull, height, tower}] tower = index into the tower list, or -1 if not tall
 * @param towerCount number of distinct towers (developments) that are tall
 * @param samples [{kx, ky, weight}] one per sunny hour
 * @returns lost: Float32Array per cell (sun-hours lost), towerPark: Float64Array[tower * parks + park]
 *   of park cell-hours each tower takes (towers can overlap, so these can sum past the total)
 */
export function computeLostSunlight({ grid, parkId, parkCount, buildings, towerCount, samples }, onProgress) {
  const { W, H, cell, minX, maxY } = grid;
  const coarse = coarseParkIndex(parkId, W, H);
  const bboxes = buildings.map(({ hull }) => {
    const xs = hull.map((p) => p[0]);
    const ys = hull.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });

  // Could the swept box [x0,y0]-[x1,y1] touch any park cell?
  const touchesPark = (x0, y0, x1, y1) => {
    const C = COARSE * cell;
    const c0 = Math.max(0, Math.floor((x0 - minX) / C));
    const c1 = Math.min(coarse.CW - 1, Math.floor((x1 - minX) / C));
    const r0 = Math.max(0, Math.floor((maxY - y1) / C));
    const r1 = Math.min(coarse.CH - 1, Math.floor((maxY - y0) / C));
    if (c0 > c1 || r0 > r1) return false;
    const s = coarse.sum;
    const w = coarse.CW + 1;
    return s[(r1 + 1) * w + c1 + 1] - s[r0 * w + c1 + 1] - s[(r1 + 1) * w + c0] + s[r0 * w + c0] > 0;
  };

  // Coarse cells (with park) that some tower's shadow reaches this hour; short buildings
  // only matter there.
  const coarseGrid = { W: coarse.CW, H: coarse.CH, cell: COARSE * cell, minX, maxY };
  const towerReach = new Uint32Array(coarse.CW * coarse.CH);
  const reachedByTower = (x0, y0, x1, y1, stamp) => {
    const C = coarseGrid.cell;
    const c0 = Math.max(0, Math.floor((x0 - minX) / C));
    const c1 = Math.min(coarse.CW - 1, Math.floor((x1 - minX) / C));
    const r0 = Math.max(0, Math.floor((maxY - y1) / C));
    const r1 = Math.min(coarse.CH - 1, Math.floor((maxY - y0) / C));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (towerReach[r * coarse.CW + c] === stamp) return true;
    return false;
  };
  const sweptBox = (i, dx, dy) => {
    const [bx0, by0, bx1, by1] = bboxes[i];
    return [Math.min(bx0, bx0 + dx), Math.min(by0, by0 + dy), Math.max(bx1, bx1 + dx), Math.max(by1, by1 + dy)];
  };
  const shadowPoly = (b, dx, dy) => convexHull(b.hull.concat(b.hull.map(([x, y]) => [x + dx, y + dy])));
  const tallIdx = [];
  const shortIdx = [];
  buildings.forEach((b, i) => (b.tower >= 0 ? tallIdx : shortIdx).push(i));

  const lost = new Float32Array(W * H);
  const towerPark = new Float64Array(towerCount * parkCount);
  const lowStamp = new Uint32Array(W * H); // = sample# + 1 when a short building shades the cell
  const lostStamp = new Uint32Array(W * H); // = sample# + 1 once the cell's loss is counted
  const towerStamp = new Uint32Array(W * H); // de-dupes multiple footprints of one tower

  samples.forEach(({ kx, ky, weight }, s) => {
    const stamp = s + 1;
    // 1. Tower shadows that can reach a park, and the coarse park cells they cover.
    const towers = [];
    for (const i of tallIdx) {
      const b = buildings[i];
      const dx = kx * b.height;
      const dy = ky * b.height;
      if (!touchesPark(...sweptBox(i, dx, dy))) continue;
      const poly = shadowPoly(b, dx, dy);
      towers.push([b.tower, poly]);
      touchConvex(poly, coarseGrid, (k) => coarse.has[k] && (towerReach[k] = stamp));
    }
    if (!towers.length) return;
    // 2. Short buildings' shadows, only where towers' shadows land in parks.
    for (const i of shortIdx) {
      const b = buildings[i];
      const dx = kx * b.height;
      const dy = ky * b.height;
      if (!reachedByTower(...sweptBox(i, dx, dy), stamp)) continue;
      fillConvex(shadowPoly(b, dx, dy), grid, (k) => parkId[k] && (lowStamp[k] = stamp));
    }
    // 3. Tower shade on park cells that short buildings don't already shade.
    // Towers sorted so each tower's footprints are adjacent, for the per-tower de-dupe.
    towers.sort((a, b) => a[0] - b[0]);
    let current = -1;
    let towerStampValue = 0;
    for (const [t, poly] of towers) {
      if (t !== current) (current = t), (towerStampValue = s * towerCount + t + 1);
      fillConvex(poly, grid, (k) => {
        const p = parkId[k];
        if (!p || lowStamp[k] === stamp || towerStamp[k] === towerStampValue) return;
        towerStamp[k] = towerStampValue;
        towerPark[t * parkCount + p - 1] += weight;
        if (lostStamp[k] !== stamp) {
          lostStamp[k] = stamp;
          lost[k] += weight;
        }
      });
    }
    if (s % 200 === 0) onProgress?.(s / samples.length);
  });
  return { lost, towerPark };
}

/** Per-park totals from the lost-hours grid. */
export function summarizeParks(parkId, parkCount, lost, cellArea) {
  const stats = Array.from({ length: parkCount }, () => ({ cells: 0, lostCellHours: 0, maxLost: 0 }));
  for (let k = 0; k < parkId.length; k++) {
    const p = parkId[k];
    if (!p) continue;
    const st = stats[p - 1];
    st.cells++;
    st.lostCellHours += lost[k];
    if (lost[k] > st.maxLost) st.maxLost = lost[k];
  }
  return stats.map((st) => ({
    area: st.cells * cellArea, // m², as rasterized
    avgLost: st.cells ? st.lostCellHours / st.cells : 0, // sun-hours lost by the average spot
    maxLost: st.maxLost, // worst spot
    lostM2h: st.lostCellHours * cellArea,
  }));
}

export function prepareBuildings(buildings, towerOf) {
  return buildings.map((b, i) => ({ hull: convexHull(b.polygons.flatMap((p) => p[0])), height: b.height, tower: towerOf(i) }));
}
