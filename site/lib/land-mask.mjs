import data from './geo/city-land.json' with { type: 'json' };

export const LAND_MASK_REVISION = data.revision;
export const LAND_MASK_SOURCE = data.source;

// Conservative precomputed 100m land cells. Unknown cities and points outside
// coverage fail closed. No runtime geocoder or polygon scan on Worker polls.
export function cityLandAllows(country, city, lat, lng) {
  const mask = data.cities[`${country}/${city}`];
  if (!mask || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const [originLat, originLng] = mask.origin;
  const x = (lng - originLng) * 111_320 * Math.max(.2, Math.cos(originLat * Math.PI / 180));
  const y = (lat - originLat) * 111_320;
  if (Math.abs(x) > 10_000.01 || Math.abs(y) > 10_000.01) return false;
  if (mask.bands === true) return true;
  const col = Math.max(0, Math.min(199, Math.floor((x + 10_000) / 100)));
  const row = Math.max(0, Math.min(199, Math.floor((y + 10_000) / 100)));
  let low = 0, high = mask.bands.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1, [first, last, ranges] = mask.bands[mid];
    if (row < first) high = mid - 1;
    else if (row > last) low = mid + 1;
    else {
      for (let i = 0; i < ranges.length; i += 2)
        if (col >= ranges[i] && col <= ranges[i + 1]) return true;
      return false;
    }
  }
  return false;
}
