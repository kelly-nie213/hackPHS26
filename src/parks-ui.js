// "Sunlight lost in parks": runs the yearly calculation in a worker, then shows a ranked
// park list, a heatmap of lost sun-hours, and per-park details with the towers responsible.

import { rasterizeParks, prepareBuildings, summarizeParks } from './parks.js';
import { sunshineSamples } from './shade.js';

const $ = (id) => document.getElementById(id);
const HEAT_MAX = 600; // sun-hours lost where the color scale tops out

const HEAT_STOPS = [
  [0, [253, 224, 71, 60]],
  [0.3, [251, 146, 60, 170]],
  [0.6, [225, 29, 72, 200]],
  [1, [88, 28, 135, 225]],
];

function heatColor(hours, out, i) {
  const t = Math.min(1, hours / HEAT_MAX);
  let k = 1;
  while (k < HEAT_STOPS.length - 1 && t > HEAT_STOPS[k][0]) k++;
  const [t0, c0] = HEAT_STOPS[k - 1];
  const [t1, c1] = HEAT_STOPS[k];
  const f = (t - t0) / (t1 - t0);
  for (let j = 0; j < 4; j++) out[i + j] = c0[j] + (c1[j] - c0[j]) * f;
}

export function setupParks({ city, parks, buildings, devs, grid, weather, lat, lon, onSelectPark, onSelectDev }) {
  const parkId = rasterizeParks(parks, grid);
  const { samples, sunnyHours } = sunshineSamples(weather, lat, lon, 1); // every actual sunny hour
  const prepared = prepareBuildings(buildings, () => -1);
  const cache = new Map(); // threshold -> {stats, towers, towerPark, rgba}
  let worker = null;
  let current = null;
  let selected = -1;

  $('parks-year').textContent = weather.year;
  $('sunny-hours').textContent = Math.round(sunnyHours).toLocaleString();

  function run(threshold) {
    worker?.terminate();
    worker = null;
    if (cache.has(threshold)) return show(cache.get(threshold));

    // Each development with a footprint at/above the threshold is one "tower".
    const towerKeys = [];
    const towerIndex = new Map();
    for (const b of buildings) {
      if (b.height >= threshold && !towerIndex.has(b.dev)) {
        towerIndex.set(b.dev, towerKeys.length);
        towerKeys.push(b.dev);
      }
    }
    const input = prepared.map((p, i) => ({ ...p, tower: buildings[i].height >= threshold ? towerIndex.get(buildings[i].dev) : -1 }));

    $('parks-status').textContent = `Calculating ${weather.year} sunlight… 0%`;
    $('park-list').replaceChildren();
    worker = new Worker(new URL('./park-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.progress != null) {
        $('parks-status').textContent = `Calculating ${weather.year} sunlight… ${Math.round(data.progress * 100)}%`;
        return;
      }
      worker.terminate();
      worker = null;
      const { lost, towerPark } = data.result;
      const stats = summarizeParks(parkId, parks.length, lost, grid.cell ** 2);
      const rgba = new Uint8Array(grid.W * grid.H * 4);
      for (let k = 0; k < lost.length; k++) if (lost[k] >= 1) heatColor(lost[k], rgba, k * 4);
      const entry = { threshold, stats, towerKeys, towerPark, rgba };
      cache.set(threshold, entry);
      show(entry);
    };
    worker.postMessage({ grid, parkId, parkCount: parks.length, buildings: input, towerCount: towerKeys.length, samples });
  }

  function show(entry) {
    current = entry;
    $('parks-status').textContent = '';
    city.setHeatmap(entry.rgba, grid.W, grid.H, { minX: grid.minX, maxY: grid.maxY, width: grid.W * grid.cell, height: grid.H * grid.cell });
    city.showHeatmap($('show-heatmap').checked);
    renderList();
    if (selected >= 0) renderPark(selected);
  }

  function renderList() {
    const ranked = current.stats
      .map((st, i) => ({ i, ...st }))
      .filter((p) => p.avgLost >= 0.5)
      .sort((a, b) => b.avgLost - a.avgLost);
    const max = ranked[0]?.avgLost || 1;
    $('park-list').replaceChildren(
      ...ranked.map((p) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="name"></span><span class="bar"><span style="width:${(100 * p.avgLost) / max}%"></span></span><span class="value">${fmtHours(p.avgLost)}</span>`;
        li.querySelector('.name').textContent = parks[p.i].name;
        li.classList.toggle('active', p.i === selected);
        li.addEventListener('click', () => select(p.i, { fly: true }));
        return li;
      }),
    );
    if (!ranked.length) $('parks-status').textContent = 'No park loses sun to towers this tall.';
  }

  function renderPark(i) {
    const park = parks[i];
    $('park-name').textContent = park.name;
    $('park-meta').textContent = [park.acres ? `${park.acres.toLocaleString(undefined, { maximumFractionDigits: 1 })} acres` : null, park.type].filter(Boolean).join(' · ');
    if (!current) {
      $('park-lost').textContent = '…';
      $('park-share').textContent = 'Calculating…';
      return;
    }
    const st = current.stats[i];
    $('park-lost').textContent = fmtHours(st.avgLost);
    $('park-share').textContent = `${((100 * st.avgLost) / sunnyHours).toFixed(1)}% of ${weather.year}'s ${Math.round(sunnyHours).toLocaleString()} hours of sunshine, for the average spot`;
    $('park-worst').textContent = fmtHours(st.maxLost);
    $('park-total').textContent = `${(st.lostM2h / 4046.86).toLocaleString(undefined, { maximumFractionDigits: 0 })} acre·h`;
    $('park-threshold').textContent = `${current.threshold} m`;

    // Towers ranked by how many hours they take from the average spot in this park.
    const cells = st.area / grid.cell ** 2;
    const towers = current.towerKeys
      .map((key, t) => ({ key, hours: current.towerPark[t * parks.length + i] / Math.max(1, cells) }))
      .filter((t) => t.hours >= 0.1)
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 6);
    $('park-towers').replaceChildren(
      ...towers.map((t) => {
        const li = document.createElement('li');
        const dev = devs.get(t.key);
        li.innerHTML = `<div class="row"><button class="link"></button><span>${fmtHours(t.hours)}</span></div>`;
        li.querySelector('button').textContent = `${dev.name} (${Math.round(dev.height)} m)`;
        li.querySelector('button').addEventListener('click', () => onSelectDev(t.key));
        return li;
      }),
    );
    $('park-towers-empty').hidden = towers.length > 0;
  }

  function select(i, { fly = false } = {}) {
    selected = parks[i] ? i : -1;
    $('park-card').hidden = selected < 0;
    city.setParkOutline(selected >= 0 ? parks[selected].polygons : []);
    document.querySelectorAll('#park-list li').forEach((li) => li.classList.remove('active'));
    if (selected < 0) return;
    onSelectPark();
    renderPark(selected);
    if (current) renderList();
    if (fly) {
      const ring = parks[selected].polygons[0][0];
      const xs = ring.map((p) => p[0]);
      const ys = ring.map((p) => p[1]);
      // At least 500 m out, so small plazas aren't viewed from inside the surrounding towers.
      const size = Math.max(500, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
      const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      city.lookAt(cx, cy, [-0.3 * size - 150, 0.9 * size + 250, 0.9 * size + 300]);
    }
  }

  /** Park under a ground point [east, north], or -1. */
  function parkAt([x, y]) {
    const c = Math.floor((x - grid.minX) / grid.cell);
    const r = Math.floor((grid.maxY - y) / grid.cell);
    if (c < 0 || r < 0 || c >= grid.W || r >= grid.H) return -1;
    return parkId[r * grid.W + c] - 1;
  }

  $('tall-threshold').addEventListener('change', (e) => run(+e.target.value));
  $('show-heatmap').addEventListener('change', (e) => city.showHeatmap(e.target.checked));
  $('park-close').addEventListener('click', () => select(-1));
  run(+$('tall-threshold').value);

  return { select, parkAt, clear: () => select(-1) };
}

function fmtHours(h) {
  return `${h < 10 ? h.toFixed(1) : Math.round(h).toLocaleString()} h`;
}
