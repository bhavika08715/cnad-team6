// Prediction Engine (ML): ensemble time-series forecaster, pure JavaScript (no external ML libs).
//   Model A: recency-weighted day-of-week mean   (captures weekly demand patterns)
//   Model B: exponential moving average          (captures recent level / trend)
//   Ensemble = 0.7 * A + 0.3 * B
// Accuracy is measured by rolling-origin back-testing on the last 14 days and compared to a naive
// "same as yesterday" baseline. Real surplus posted on the platform is appended to history, so the
// model keeps learning.
const { db } = require('./db');
const matching = require('./matching');
const notif = require('./notifications');
const { haversineKm, dayKey } = require('./util');

const DAY = 864e5;
const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dailySeries(donorId) {
  const recs = db.history.filter((h) => h.donorId === donorId);
  const daily = {};
  recs.forEach((r) => (daily[r.date] = (daily[r.date] || 0) + r.quantityKg));
  const dates = Object.keys(daily).sort();
  if (!dates.length) return { daily, recs };
  // fill gaps with 0 up to yesterday
  const start = new Date(dates[0] + 'T00:00:00Z');
  const yest = new Date(dayKey(Date.now() - DAY) + 'T00:00:00Z');
  for (let d = start; d <= yest; d = new Date(d.getTime() + DAY)) {
    const k = dayKey(d);
    if (daily[k] == null) daily[k] = 0;
  }
  return { daily, recs };
}

function forecast(daily, target) {
  const tk = dayKey(target);
  const dates = Object.keys(daily).filter((k) => k < tk).sort();
  if (dates.length < 14) return null;
  const dow = target.getUTCDay();
  let num = 0, den = 0;
  const vals = [];
  for (const k of dates) {
    const d = new Date(k + 'T00:00:00Z');
    if (d.getUTCDay() !== dow) continue;
    const weeksAgo = Math.max(1, Math.round((target - d) / (7 * DAY)));
    const w = Math.pow(0.85, weeksAgo - 1);
    num += w * daily[k];
    den += w;
    vals.push(daily[k]);
  }
  const dowMean = den ? num / den : null;
  let ema = daily[dates[0]];
  for (const k of dates.slice(1)) ema = 0.3 * daily[k] + 0.7 * ema;
  const pred = dowMean == null ? ema : 0.7 * dowMean + 0.3 * ema;
  let conf = 0.5;
  if (vals.length >= 3 && dowMean) {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    conf = Math.max(0.2, Math.min(0.95, 1 - sd / (mean || 1)));
  }
  return { predicted: Math.max(0, pred), confidence: conf, prevDay: daily[dayKey(target.getTime() - DAY)] };
}

function evaluate(daily) {
  const today = new Date(dayKey(Date.now()) + 'T00:00:00Z');
  let apeSum = 0, apeN = 0, mae = 0, n = 0, bApe = 0, bN = 0;
  for (let i = 1; i <= 14; i++) {
    const target = new Date(today.getTime() - i * DAY);
    const actual = daily[dayKey(target)];
    const f = forecast(daily, target);
    if (actual == null || !f) continue;
    mae += Math.abs(f.predicted - actual);
    n++;
    if (actual > 0) {
      apeSum += Math.abs(f.predicted - actual) / actual;
      apeN++;
      if (f.prevDay != null) {
        bApe += Math.abs(f.prevDay - actual) / actual;
        bN++;
      }
    }
  }
  if (!apeN) return { accuracyPct: null, baselineAccuracyPct: null, maeKg: null, days: 0 };
  const acc = Math.max(0, 100 - (apeSum / apeN) * 100);
  const base = bN ? Math.max(0, 100 - (bApe / bN) * 100) : null;
  return {
    accuracyPct: Math.round(acc * 10) / 10,
    baselineAccuracyPct: base == null ? null : Math.round(base * 10) / 10,
    maeKg: Math.round((mae / n) * 10) / 10,
    days: n,
  };
}

function peakHour(recs, dow) {
  const sameDow = recs.filter((r) => new Date(r.date + 'T00:00:00Z').getUTCDay() === dow);
  const use = sameDow.length >= 3 ? sameDow : recs;
  if (!use.length) return 20;
  const tot = use.reduce((a, r) => a + r.quantityKg, 0) || 1;
  return Math.round(use.reduce((a, r) => a + r.hour * r.quantityKg, 0) / tot);
}

function dominantType(recs) {
  const c = {};
  recs.slice(-60).forEach((r) => (c[r.foodType] = (c[r.foodType] || 0) + r.quantityKg));
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || 'cooked';
}

function forecastForDonor(donorId, days = 7) {
  const { daily, recs } = dailySeries(donorId);
  const today = new Date(dayKey(Date.now()) + 'T00:00:00Z');
  const type = dominantType(recs);
  const out = [];
  for (let i = 0; i < days; i++) {
    const target = new Date(today.getTime() + i * DAY);
    const f = forecast(daily, target);
    if (!f) continue;
    const ph = peakHour(recs, target.getUTCDay());
    const kg = Math.round(f.predicted * 10) / 10;
    out.push({
      date: dayKey(target),
      day: NAMES[target.getUTCDay()],
      predictedKg: kg,
      confidence: Math.round(f.confidence * 100),
      peakHour: ph,
      windowFrom: Math.max(0, ph - 1),
      windowTo: Math.min(23, ph + 1),
      foodType: type,
      level: kg >= 25 ? 'high' : kg >= 10 ? 'medium' : 'low',
    });
  }
  const last14 = Object.keys(daily).sort().slice(-14).map((k) => ({ date: k, kg: Math.round(daily[k] * 10) / 10 }));
  return { donorId, forecasts: out, accuracy: evaluate(daily), recent: last14 };
}

// Surplus expected tomorrow near a receiver (or everywhere for admin)
function upcoming(user) {
  const tomorrow = dayKey(Date.now() + DAY);
  const rows = [];
  for (const d of db.users.filter((u) => u.role === 'donor')) {
    const dist = user.role === 'receiver' ? haversineKm(d.lat, d.lng, user.lat, user.lng) : null;
    if (user.role === 'receiver' && dist > (user.radiusKm || 10)) continue;
    const f = forecastForDonor(d.id, 2).forecasts.find((x) => x.date === tomorrow);
    if (!f || f.predictedKg < 3) continue;
    if (user.role === 'receiver' && !user.acceptedTypes.includes(f.foodType)) continue;
    rows.push({ donorId: d.id, donorName: d.name, orgType: d.orgType, distanceKm: dist == null ? null : Math.round(dist * 10) / 10, ...f });
  }
  return rows.sort((a, b) => b.predictedKg - a.predictedKg);
}

// Early warning: tell nearby receivers about big expected surplus (once per donor per day)
function runPredictionAlerts() {
  const tomorrow = dayKey(Date.now() + DAY);
  for (const d of db.users.filter((u) => u.role === 'donor')) {
    const f = forecastForDonor(d.id, 2).forecasts.find((x) => x.date === tomorrow);
    const key = `${d.id}:${tomorrow}`;
    if (!f || f.predictedKg < 10 || db.alerts[key]) continue;
    const fake = { lat: d.lat, lng: d.lng, foodType: f.foodType, quantityKg: f.predictedKg, expiryAt: new Date(Date.now() + 30 * 36e5).toISOString() };
    const targets = matching.rank(fake).slice(0, 3);
    targets.forEach((m) =>
      notif.notify(m.receiverId, 'Surplus expected tomorrow', `${d.name} is likely to have ~${f.predictedKg} kg of ${f.foodType} food around ${f.peakHour}:00 (${m.distanceKm} km away).`)
    );
    db.alerts[key] = true;
  }
}

module.exports = { forecastForDonor, upcoming, runPredictionAlerts };
