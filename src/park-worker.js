// Computes park sunlight lost to towers off the main thread.
import { computeLostSunlight } from './parks.js';

self.onmessage = ({ data }) => {
  const result = computeLostSunlight(data, (progress) => self.postMessage({ progress }));
  self.postMessage({ result }, [result.lost.buffer, result.towerPark.buffer]);
};
