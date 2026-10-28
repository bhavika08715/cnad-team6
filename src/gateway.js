// API Gateway: single entry point (security headers, rate limiting, auth, routing to services)
const express = require('express');
const { auth } = require('./auth');
const users = require('./users');
const surplus = require('./surplus');
const matching = require('./matching');
const prediction = require('./prediction');
const notif = require('./notifications');
const analytics = require('./analytics');
const { db } = require('./db');
const { err, FOOD_TYPES } = require('./util');

const router = express.Router();

// --- simple in-memory rate limiter (per IP) ---
function rateLimit(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const rec = hits.get(key) || { n: 0, reset: now + windowMs };
    if (now > rec.reset) { rec.n = 0; rec.reset = now + windowMs; }
    rec.n++;
    hits.set(key, rec);
    if (rec.n > max) return next(err(429, 'Too many requests, slow down'));
    next();
  };
}
setInterval(() => {}, 1 << 30).unref();

router.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
router.use(rateLimit(600, 60 * 1000));

const wrap = (fn) => (req, res, next) => {
  try {
    res.json(fn(req));
  } catch (e) {
    next(e);
  }
};

router.get('/health', wrap(() => ({
  status: 'ok',
  services: ['user', 'surplus', 'prediction', 'matching', 'notification', 'tracking', 'analytics'],
  time: new Date().toISOString(),
})));
router.get('/meta', wrap(() => ({ foodTypes: FOOD_TYPES, center: { lat: 17.4, lng: 78.43 } })));

// --- User Service ---
const strict = rateLimit(30, 60 * 1000);
router.post('/auth/register', strict, wrap((r) => users.register(r.body)));
router.post('/auth/login', strict, wrap((r) => users.login(r.body)));
router.get('/me', auth(), wrap((r) => ({ user: users.pub(r.user), unread: notif.unreadCount(r.user.id) })));
router.get('/admin/receivers/pending', auth(['admin']), wrap(() => users.pendingReceivers()));
router.post('/admin/receivers/:id/verify', auth(['admin']), wrap((r) => users.verifyReceiver(r.params.id, true)));
router.post('/admin/receivers/:id/reject', auth(['admin']), wrap((r) => users.verifyReceiver(r.params.id, false)));

// --- Surplus Registration + Tracking ---
router.post('/surplus', auth(['donor']), wrap((r) => surplus.create(r.user, r.body)));
router.get('/surplus', auth(), wrap((r) => surplus.list(r.user, r.query.status)));
router.post('/surplus/:id/:action', auth(), wrap((r) => surplus.action(r.user, r.params.id, r.params.action)));
router.get('/surplus/:id/timeline', auth(), wrap((r) => surplus.timeline(r.user, r.params.id)));

// --- Matching (preview before posting) ---
router.post('/match/preview', auth(['donor']), wrap((r) => {
  const b = r.body;
  const item = {
    lat: Number(b.lat ?? r.user.lat), lng: Number(b.lng ?? r.user.lng), foodType: b.foodType,
    quantityKg: Number(b.quantityKg), expiryAt: new Date(Date.now() + Number(b.hoursValid) * 36e5).toISOString(),
  };
  if (!FOOD_TYPES.includes(item.foodType) || !(item.quantityKg > 0) || !(Number(b.hoursValid) > 0)) throw err(400, 'Invalid input');
  return matching.rank(item);
}));

// --- Prediction ---
router.get('/predictions/upcoming', auth(['receiver', 'admin']), wrap((r) => prediction.upcoming(r.user)));
router.get('/predictions/:donorId?', auth(['donor', 'admin']), wrap((r) => {
  const donorId = r.user.role === 'donor' ? r.user.id : r.params.donorId;
  if (!donorId || !db.users.some((u) => u.id === donorId && u.role === 'donor')) throw err(404, 'Donor not found');
  return prediction.forecastForDonor(donorId, 7);
}));
router.get('/donors', auth(['admin']), wrap(() => db.users.filter((u) => u.role === 'donor').map((u) => ({ id: u.id, name: u.name }))));

// --- Notifications ---
router.get('/notifications', auth(), wrap((r) => notif.list(r.user.id)));
router.post('/notifications/read', auth(), wrap((r) => { notif.markAllRead(r.user.id); return { ok: true }; }));

// --- Analytics + map ---
router.get('/analytics', auth(), wrap((r) => analytics.summary(r.user)));
router.get('/map', auth(), wrap((r) => ({ ...users.mapPoints(), surplus: surplus.list(r.user, 'active') })));

router.use((req, res, next) => next(err(404, 'Not found')));
router.use((e, req, res, next) => {
  const status = e.status || 500;
  if (status === 500) console.error(e);
  res.status(status).json({ error: status === 500 ? 'Server error' : e.message });
});

module.exports = router;
