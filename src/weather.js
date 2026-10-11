// Hourly weather lookup from data/weather.json (Open-Meteo archive, the city's local time).
// The file holds 24 entries per local calendar day starting at `start`.

export function weatherAt(weather, dateStr, minutes) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [sy, sm, sd] = weather.start.slice(0, 10).split('-').map(Number);
  const day = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(sy, sm - 1, sd)) / 86400000);
  // Radiation values are the mean over the hour *ending* at the timestamp, so 1:30 PM -> 2 PM entry.
  const i = day * 24 + Math.floor(minutes / 60) + 1;
  if (day < 0 || i >= weather.cloud_cover.length) return null;
  return {
    cloudCover: weather.cloud_cover[i], // %
    direct: weather.direct_radiation[i], // W/m², the beam sunlight shadows block
    total: weather.shortwave_radiation[i], // W/m², direct + diffuse
  };
}
