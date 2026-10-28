class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const err = (status, message) => new HttpError(status, message);

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const FOOD_TYPES = ['cooked', 'bakery', 'produce', 'packaged', 'dairy'];

module.exports = { HttpError, err, haversineKm, clamp, dayKey, FOOD_TYPES };
