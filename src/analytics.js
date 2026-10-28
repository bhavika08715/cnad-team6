// Analytics Dashboard Service
const { db } = require('./db');
const { dayKey } = require('./util');

const MEALS_PER_KG = 2.5; // rough estimate: ~400 g per meal
const CO2E_PER_KG = 2.5; // rough estimate of kg CO2e avoided per kg food diverted from waste

function summary(user) {
  let items = db.surplus;
  if (user.role === 'donor') items = items.filter((s) => s.donorId === user.id);
  if (user.role === 'receiver') items = items.filter((s) => s.receiverId === user.id);

  const sum = (arr) => Math.round(arr.reduce((a, s) => a + s.quantityKg, 0) * 10) / 10;
  const delivered = items.filter((s) => s.status === 'delivered');
  const expired = items.filter((s) => s.status === 'expired');
  const active = items.filter((s) => ['listed', 'matched', 'accepted', 'picked_up'].includes(s.status));
  const closed = delivered.length + expired.length;

  const pickupTimes = items.filter((s) => s.pickedUpAt).map((s) => (new Date(s.pickedUpAt) - new Date(s.createdAt)) / 60000);
  const avgPickupMin = pickupTimes.length ? Math.round(pickupTimes.reduce((a, b) => a + b, 0) / pickupTimes.length) : null;

  const byType = {};
  delivered.forEach((s) => (byType[s.foodType] = (byType[s.foodType] || 0) + s.quantityKg));

  const byDay = [];
  for (let i = 13; i >= 0; i--) {
    const k = dayKey(Date.now() - i * 864e5);
    const day = items.filter((s) => dayKey(s.createdAt) === k);
    byDay.push({
      date: k,
      listedKg: sum(day),
      deliveredKg: sum(day.filter((s) => s.status === 'delivered')),
    });
  }

  const out = {
    totalListings: items.length,
    activeListings: active.length,
    deliveredCount: delivered.length,
    expiredCount: expired.length,
    kgListed: sum(items),
    kgDelivered: sum(delivered),
    kgWasted: sum(expired),
    successRatePct: closed ? Math.round((delivered.length / closed) * 100) : null,
    avgListingToPickupMin: avgPickupMin,
    mealsServed: Math.round(sum(delivered) * MEALS_PER_KG),
    co2eAvoidedKg: Math.round(sum(delivered) * CO2E_PER_KG),
    byType: Object.entries(byType).map(([type, kg]) => ({ type, kg: Math.round(kg * 10) / 10 })),
    byDay,
  };
  if (user.role === 'admin') {
    out.donors = db.users.filter((u) => u.role === 'donor').length;
    out.receivers = db.users.filter((u) => u.role === 'receiver' && u.verified).length;
    out.pendingReceivers = db.users.filter((u) => u.role === 'receiver' && !u.verified).length;
  }
  return out;
}

module.exports = { summary };
