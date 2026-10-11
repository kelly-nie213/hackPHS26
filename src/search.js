// Building search: instant local matches on addresses/names, then a geocoder as a fallback
// (NYC GeoSearch in New York, OpenStreetMap Nominatim elsewhere).

const ABBREV = {
  W: 'WEST', E: 'EAST', N: 'NORTH', S: 'SOUTH',
  ST: 'STREET', STR: 'STREET', AVE: 'AVENUE', AV: 'AVENUE', PL: 'PLACE', BLVD: 'BOULEVARD',
  PKWY: 'PARKWAY', SQ: 'SQUARE', CT: 'COURT', RD: 'ROAD', DR: 'DRIVE', LN: 'LANE', TER: 'TERRACE',
  CPW: 'CENTRAL PARK WEST', CPS: 'CENTRAL PARK SOUTH',
};

/** "217 W. 57th St" and "217 WEST 57 STREET" both -> "217 WEST 57 STREET". */
export function normalizeAddress(text) {
  return text
    .toUpperCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\b(\d+)(ST|ND|RD|TH)\b/g, '$1')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ABBREV[t] ?? t)
    .join(' ');
}

// Well-known towers people search by name, per city; resolved through their street address.
// (OpenStreetMap cities already carry building names, so only New York needs these.)
const NICKNAMES = {
  nyc: [
    ['Central Park Tower', '217 W 57th St'],
    ['One57', '157 W 57th St'],
    ['Steinway Tower (111 West 57th)', '111 W 57th St'],
    ['432 Park Avenue', '432 Park Ave'],
    ['220 Central Park South', '220 Central Park S'],
    ['53W53 (MoMA Tower)', '53 W 53rd St'],
    ['Citigroup Center', '601 Lexington Ave'],
  ],
};

export function nicknamesFor(cityId) {
  return NICKNAMES[cityId] ?? [];
}

/** Famous name for a street address, if it's one of the well-known towers. */
export function nicknameFor(address, nicknames) {
  const norm = normalizeAddress(address ?? '');
  return nicknames.find(([, a]) => normalizeAddress(a) === norm)?.[0].replace(/ \(.*\)$/, '') ?? null;
}

/**
 * @param entries [{label, key}] searchable things; key identifies a development (tax lot)
 */
export function createSearchIndex(entries, nicknames = []) {
  const byAddress = new Map();
  const items = entries.map((e) => {
    const norm = normalizeAddress(e.label);
    if (!byAddress.has(norm)) byAddress.set(norm, e.key);
    return { ...e, norm };
  });
  for (const [label, address] of nicknames) {
    const key = byAddress.get(normalizeAddress(address));
    if (key) items.unshift({ label, key, norm: normalizeAddress(label), hint: address });
  }

  return {
    /** Best local matches for partial input. */
    suggest(text, limit = 8) {
      const q = normalizeAddress(text);
      if (q.length < 2) return [];
      const starts = [];
      const contains = [];
      const seen = new Set();
      for (const item of items) {
        if (seen.has(item.key + item.label)) continue;
        if (item.norm.startsWith(q)) starts.push(item);
        else if (item.norm.includes(q)) contains.push(item);
        else continue;
        seen.add(item.key + item.label);
        if (starts.length >= limit) break;
      }
      return starts.concat(contains).slice(0, limit);
    },
  };
}

/**
 * Geocode free text inside a city's study area. Returns {label, bin, bbl, lat, lon} or null;
 * bin/bbl identify the building when the geocoder knows it (NYC BIN and tax lot, or OSM way id).
 */
export async function geocode(text, city) {
  return city.source === 'nyc' ? geocodeNYC(text) : geocodeOSM(text, city);
}

/** NYC Planning's GeoSearch: every NYC address, including ones in the middle of an address range. */
async function geocodeNYC(text) {
  const query = text.match(/manhattan|new york|ny\b/i) ? text : `${text}, Manhattan`;
  const url = `https://geosearch.planninglabs.nyc/v2/search?size=1&text=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GeoSearch HTTP ${res.status}`);
  const feature = (await res.json()).features?.[0];
  if (!feature) return null;
  const pad = feature.properties.addendum?.pad ?? {};
  const [lon, lat] = feature.geometry.coordinates;
  return { label: feature.properties.label, bin: pad.bin, bbl: pad.bbl, lat, lon };
}

/** OpenStreetMap Nominatim, limited to the study area. */
async function geocodeOSM(text, city) {
  const [south, west, north, east] = city.stats.bbox;
  const params = new URLSearchParams({ q: text, format: 'jsonv2', limit: '1', bounded: '1', viewbox: `${west},${north},${east},${south}` });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const hit = (await res.json())[0];
  if (!hit) return null;
  const key = `${hit.osm_type[0]}${hit.osm_id}`;
  return { label: hit.display_name, bin: key, bbl: key, lat: +hit.lat, lon: +hit.lon };
}
