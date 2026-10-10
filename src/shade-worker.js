// Scores every development off the main thread so the 3D view stays smooth.
import { developmentShade } from './shade.js';

self.onmessage = ({ data: { grid, samples, developments } }) => {
  const results = [];
  developments.forEach(({ key, footprints }, i) => {
    results.push({ key, ...developmentShade(footprints, grid, samples) });
    if (i % 250 === 0) self.postMessage({ progress: i / developments.length });
  });
  self.postMessage({ results });
};
