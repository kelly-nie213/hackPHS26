// Polar sun-path diagram: center = straight overhead, edge = horizon, north up.

const SIZE = 160;
const C = SIZE / 2;
const R = 66;
const NS = 'http://www.w3.org/2000/svg';

function project(altitude, azimuth) {
  const r = R * (1 - Math.max(0, altitude) / (Math.PI / 2));
  return [C + r * Math.sin(azimuth), C - r * Math.cos(azimuth)];
}

function el(tag, attrs, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.appendChild(node);
  return node;
}

export function createSunPath(container) {
  const svg = el('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'sunpath', role: 'img', 'aria-label': 'Sun path diagram' }, container);
  for (const alt of [0, 30, 60]) {
    el('circle', { cx: C, cy: C, r: R * (1 - alt / 90), class: alt ? 'ring' : 'horizon' }, svg);
  }
  for (const [label, deg] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
    const az = (deg * Math.PI) / 180;
    el('text', { x: C + (R + 9) * Math.sin(az), y: C - (R + 9) * Math.cos(az), class: 'compass' }, svg).textContent = label;
  }
  const path = el('polyline', { class: 'path' }, svg);
  const dot = el('circle', { r: 6, class: 'sun' }, svg);

  return {
    setDay(samples) {
      path.setAttribute('points', samples.filter((s) => s.altitude > 0).map((s) => project(s.altitude, s.azimuth).join(',')).join(' '));
    },
    setSun({ altitude, azimuth }) {
      const [x, y] = project(altitude, azimuth);
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', y);
      dot.classList.toggle('down', altitude <= 0);
    },
  };
}
