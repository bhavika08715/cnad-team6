// Matching & Allocation Service (hyperlocal)
// Hard filters: verified, accepts food type, enough capacity, inside receiver radius, reachable before expiry.
// Soft score (0-100): proximity, capacity fit, pickup-window availability, time slack.
// Weights shift toward proximity & time slack as the food gets more urgent.
const { db } = require('./db');
const { haversineKm, clamp } = require('./util');

const URBAN_SPEED_KMH = 25;
const PREP_MIN = 10;

function rank(item, opts = {}) {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const hoursLeft = (new Date(item.expiryAt).getTime() - now) / 36e5;
  if (hoursLeft <= 0) return [];
  const urgency = clamp(1 - hoursLeft / 12, 0, 1); // 1 = very urgent

  const out = [];
  for (const r of db.users) {
    if (r.role !== 'receiver' || !r.verified) continue;
    if (!r.acceptedTypes.includes(item.foodType)) continue;
    if (item.quantityKg > r.capacityKg) continue;
    const d = haversineKm(item.lat, item.lng, r.lat, r.lng);
    const radius = r.radiusKm || 10;
    if (d > radius) continue;
    const travelMin = (d / URBAN_SPEED_KMH) * 60 + PREP_MIN;
    const minutesLeft = hoursLeft * 60;
    if (minutesLeft < travelMin + 15) continue; // cannot reach it in time

    const proximity = 1 - d / radius;
    const capacity = 1 - 0.5 * ((r.capacityKg - item.quantityKg) / r.capacityKg);
    const arrival = new Date(now + travelMin * 60000);
    const hr = arrival.getHours() + arrival.getMinutes() / 60;
    const inWindow = r.pickupFrom <= r.pickupTo ? hr >= r.pickupFrom && hr <= r.pickupTo : hr >= r.pickupFrom || hr <= r.pickupTo;
    const pickup = inWindow ? 1 : 0.2;
    const slack = clamp(1 - travelMin / minutesLeft, 0, 1);

    const w = { p: 0.3 + 0.2 * urgency, c: 0.2, a: 0.2, t: 0.15 + 0.2 * urgency };
    const sum = w.p + w.c + w.a + w.t;
    const score = (100 * (w.p * proximity + w.c * capacity + w.a * pickup + w.t * slack)) / sum;

    out.push({
      receiverId: r.id,
      receiverName: r.name,
      score: Math.round(score * 10) / 10,
      distanceKm: Math.round(d * 10) / 10,
      etaMin: Math.round(travelMin),
      inPickupWindow: inWindow,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 10);
}

module.exports = { rank };
