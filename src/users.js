// User Service: registration, login, role-based accounts, receiver verification
const { db, id, save } = require('./db');
const auth = require('./auth');
const notif = require('./notifications');
const { err, FOOD_TYPES } = require('./util');

const pub = (u) => {
  const { passwordHash, ...rest } = u;
  return rest;
};

function register(b) {
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw err(400, 'Valid email required');
  if (String(b.password || '').length < 6) throw err(400, 'Password must be at least 6 characters');
  if (!b.name || String(b.name).trim().length < 2) throw err(400, 'Name is required');
  if (!['donor', 'receiver'].includes(b.role)) throw err(400, 'Role must be donor or receiver');
  if (db.users.some((u) => u.email === email)) throw err(409, 'Email already registered');
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    throw err(400, 'Please pick a valid location on the map');

  const u = {
    id: id('u'),
    email,
    name: String(b.name).trim().slice(0, 80),
    role: b.role,
    passwordHash: auth.hashPassword(String(b.password)),
    lat,
    lng,
    address: String(b.address || '').slice(0, 200),
    phone: String(b.phone || '').slice(0, 20),
    orgType: String(b.orgType || (b.role === 'donor' ? 'restaurant' : 'ngo')).slice(0, 40),
    verified: b.role === 'donor',
    createdAt: new Date().toISOString(),
  };
  if (u.role === 'receiver') {
    u.capacityKg = Math.max(1, Number(b.capacityKg) || 50);
    const types = Array.isArray(b.acceptedTypes) ? b.acceptedTypes.filter((t) => FOOD_TYPES.includes(t)) : [];
    u.acceptedTypes = types.length ? types : [...FOOD_TYPES];
    u.radiusKm = Math.min(50, Math.max(1, Number(b.radiusKm) || 10));
    u.pickupFrom = b.pickupFrom != null && b.pickupFrom !== '' ? Number(b.pickupFrom) : 8;
    u.pickupTo = b.pickupTo != null && b.pickupTo !== '' ? Number(b.pickupTo) : 22;
  }
  db.users.push(u);
  if (u.role === 'receiver') {
    db.users
      .filter((x) => x.role === 'admin')
      .forEach((a) => notif.notify(a.id, 'New receiver awaiting verification', `${u.name} registered as a receiver.`));
  }
  save();
  return { token: auth.createToken(u), user: pub(u) };
}

function login(b) {
  const email = String(b.email || '').trim().toLowerCase();
  const u = db.users.find((x) => x.email === email);
  if (!u || !auth.verifyPassword(String(b.password || ''), u.passwordHash)) throw err(401, 'Invalid email or password');
  return { token: auth.createToken(u), user: pub(u) };
}

function pendingReceivers() {
  return db.users.filter((u) => u.role === 'receiver' && !u.verified).map(pub);
}

function verifyReceiver(userId, approve = true) {
  const u = db.users.find((x) => x.id === userId && x.role === 'receiver');
  if (!u) throw err(404, 'Receiver not found');
  if (approve) {
    u.verified = true;
    notif.notify(u.id, 'Account verified', 'Your organisation is verified. You can now receive food matches.');
  } else {
    db.users.splice(db.users.indexOf(u), 1);
  }
  save();
  return pub(u);
}

const mapPoints = () => ({
  donors: db.users.filter((u) => u.role === 'donor').map((u) => ({ id: u.id, name: u.name, lat: u.lat, lng: u.lng, orgType: u.orgType })),
  receivers: db.users
    .filter((u) => u.role === 'receiver' && u.verified)
    .map((u) => ({ id: u.id, name: u.name, lat: u.lat, lng: u.lng, orgType: u.orgType, radiusKm: u.radiusKm })),
});

module.exports = { register, login, pub, pendingReceivers, verifyReceiver, mapPoints };
