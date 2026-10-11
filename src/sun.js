// Solar position + local (city) time helpers.
// Sun math follows the formulas used by SunCalc (https://github.com/mourner/suncalc),
// which are accurate to a fraction of a degree — plenty for shadow casting.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

/**
 * Sun position for an instant and place.
 * @returns {{altitude: number, azimuth: number}} radians; altitude above the horizon,
 *   azimuth as a compass bearing (0 = north, π/2 = east).
 */
export function sunPosition(date, lat, lon) {
  const d = date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
  const M = RAD * (357.5291 + 0.98560028 * d); // solar mean anomaly
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI; // ecliptic longitude
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L));
  const H = RAD * (280.16 + 360.9856235 * d) + RAD * lon - ra; // hour angle
  const phi = RAD * lat;

  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const fromSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  const azimuth = (fromSouth + Math.PI) % (2 * Math.PI);
  return { altitude, azimuth };
}

/** Unit vector pointing toward the sun, in local east/north/up components. */
export function sunDirection({ altitude, azimuth }) {
  const h = Math.cos(altitude);
  return { east: h * Math.sin(azimuth), north: h * Math.cos(azimuth), up: Math.sin(altitude) };
}

/**
 * Where the top of a `height`-meter object lands on the ground, relative to its base,
 * as [dx east, dy north] meters. null when the sun is down (no direct-sun shadow).
 */
export function shadowOffset(height, { altitude, azimuth }) {
  if (altitude <= 0) return null;
  const length = height / Math.tan(altitude);
  return [-length * Math.sin(azimuth), -length * Math.cos(azimuth)];
}

const formatters = new Map();

function partsFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
  }
  return formatters.get(timeZone);
}

function offsetMs(date, timeZone) {
  const p = Object.fromEntries(partsFormatter(timeZone).formatToParts(date).map((x) => [x.type, x.value]));
  const wallAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return wallAsUtc - Math.floor(date.valueOf() / 60000) * 60000;
}

/** The instant when clocks in `timeZone` read `dateStr` ('YYYY-MM-DD') at `minutes` past midnight. */
export function localTime(dateStr, minutes, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  let t = wall - offsetMs(new Date(wall), timeZone);
  t = wall - offsetMs(new Date(t), timeZone); // second pass settles DST-change days
  return new Date(t);
}

// Official sunrise/sunset: the sun's upper edge touches the horizon, after refraction.
const HORIZON = RAD * -0.833;

/**
 * Sun positions sampled across one local calendar day, plus sunrise/sunset
 * in minutes after local midnight (null if the sun never crosses the horizon).
 */
export function solarDay(dateStr, lat, lon, timeZone, stepMinutes = 5) {
  const samples = [];
  for (let m = 0; m <= 1440; m += stepMinutes) {
    samples.push({ minutes: m, ...sunPosition(localTime(dateStr, m, timeZone), lat, lon) });
  }
  let sunrise = null;
  let sunset = null;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const cross = a.minutes + (stepMinutes * (a.altitude - HORIZON)) / (a.altitude - b.altitude);
    if (a.altitude <= HORIZON && b.altitude > HORIZON) sunrise = cross;
    if (a.altitude > HORIZON && b.altitude <= HORIZON) sunset = cross;
  }
  const noon = samples.reduce((best, s) => (s.altitude > best.altitude ? s : best));
  return { samples, sunrise, sunset, noon };
}
