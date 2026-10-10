// Ground-shadow geometry for extruded buildings (flat ground, parallel sun rays).
//
// The 3D view uses GPU shadow mapping for rendering. These functions compute the same
// shadows analytically, so we can measure them: e.g. later, intersect them with park
// polygons and sum over every hour of the year to get "sun-hours lost".

import { shadowOffset } from './sun.js';

/** Andrew's monotone chain. points: [[x, y], ...] -> hull in counter-clockwise order. */
export function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function polygonArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a) / 2;
}

/**
 * Ground shadow of one building: the footprint swept along the shadow direction.
 * The exact shadow of a prism is footprint ∪ (footprint + offset) ∪ the swept edges;
 * for convex footprints (most towers) that equals this convex hull.
 *
 * @param polygons building footprint in meters, [[outerRing, ...holes], ...]
 * @returns {{ring: number[][], length: number, area: number} | null} null at night
 */
export function buildingShadow(polygons, height, sun) {
  const offset = shadowOffset(height, sun);
  if (!offset) return null;
  const pts = [];
  for (const poly of polygons) {
    for (const [x, y] of poly[0]) pts.push([x, y], [x + offset[0], y + offset[1]]);
  }
  const ring = convexHull(pts);
  return { ring, length: Math.hypot(offset[0], offset[1]), area: polygonArea(ring) };
}
