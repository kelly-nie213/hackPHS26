// Building search: instant local matches on addresses/names, NYC GeoSearch as a fallback.

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

// Well-known towers people search by name; resolved through their street address.
const NICKNAMES = [
  ['Central Park Tower', '217 W 57th St'],
  ['One57', '157 W 57th St'],
  ['Steinway Tower (111 West 57th)', '111 W 57th St'],
  ['432 Park Avenue', '432 Park Ave'],
  ['220 Central Park South', '220 Central Park S'],
  ['53W53 (MoMA Tower)', '53 W 53rd St'],
  ['Citigroup Center', '601 Lexington Ave'],
];

/** Famous name for a street address, if it's one of the well-known towers. */
export function nicknameFor(address) {
  const norm = normalizeAddress(address ?? '');
  return NICKNAMES.find(([, a]) => normalizeAddress(a) === norm)?.[0].replace(/ \(.*\)$/, '') ?? null;
}

/**
 * @param entries [{label, key}] searchable things; key identifies a development (tax lot)
 */
export function createSearchIndex(entries) {
  const byAddress = new Map();
  const items = entries.map((e) => {
    const norm = normalizeAddress(e.label);
    if (!byAddress.has(norm)) byAddress.set(norm, e.key);
    return { ...e, norm };
  });
  for (const [label, address] of NICKNAMES) {
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
 * Geocode free text with NYC Planning's GeoSearch (covers every NYC address, including
 * ones in the middle of an address range). Returns {label, bin, bbl} or null.
 */
export async function geocode(text) {
  const url = `https://geosearch.planninglabs.nyc/v2/search?size=1&text=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GeoSearch HTTP ${res.status}`);
  const feature = (await res.json()).features?.[0];
  if (!feature) return null;
  const pad = feature.properties.addendum?.pad ?? {};
  return { label: feature.properties.label, bin: pad.bin, bbl: pad.bbl };
}
