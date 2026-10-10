// Flat local projection: lon/lat degrees <-> meters east/north of an origin.
// Accurate to well under a meter across a few kilometers, which is all we need.

const M_PER_DEG_LAT = 110540;

export function makeProjection(lat0, lon0) {
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    lat0,
    lon0,
    toXY: (lon, lat) => [(lon - lon0) * mPerDegLon, (lat - lat0) * M_PER_DEG_LAT],
    toLonLat: (x, y) => [x / mPerDegLon + lon0, y / M_PER_DEG_LAT + lat0],
  };
}

// GeoJSON-style [[[lon, lat], ...], ...] polygons -> same shape in meters.
export function projectPolygons(polygons, proj) {
  return polygons.map((poly) => poly.map((ring) => ring.map(([lon, lat]) => proj.toXY(lon, lat))));
}
