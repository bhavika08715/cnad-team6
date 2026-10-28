// Demo data: donors, verified receivers, 90 days of surplus history, and sample listings.
// All demo accounts use the password:  password123
const store = require('./db');
const auth = require('./auth');
const matching = require('./matching');
const { dayKey } = require('./util');

function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PW = 'password123';

const DONORS = [
  { name: 'Spice Garden Restaurant', email: 'restaurant@demo.com', orgType: 'restaurant', lat: 17.4435, lng: 78.3772, base: 14, wk: 1.5, hour: 22, type: 'cooked' },
  { name: 'Grand Orchid Hotel', email: 'hotel@demo.com', orgType: 'hotel', lat: 17.4239, lng: 78.4738, base: 28, wk: 1.3, hour: 23, type: 'cooked' },
  { name: 'Daily Bread Bakery', email: 'bakery@demo.com', orgType: 'bakery', lat: 17.4065, lng: 78.4691, base: 9, wk: 1.2, hour: 20, type: 'bakery' },
  { name: 'FreshMart Supermarket', email: 'market@demo.com', orgType: 'supermarket', lat: 17.4486, lng: 78.3908, base: 35, wk: 1.1, hour: 21, type: 'produce' },
  { name: 'Campus Cafeteria', email: 'cafeteria@demo.com', orgType: 'cafeteria', lat: 17.3944, lng: 78.44, base: 20, wk: 0.3, hour: 15, type: 'cooked' },
  { name: 'Celebrations Catering', email: 'catering@demo.com', orgType: 'event', lat: 17.4, lng: 78.42, base: 18, wk: 2.2, hour: 22, type: 'cooked' },
];

const RECEIVERS = [
  { name: 'Hope Foundation NGO', email: 'ngo@demo.com', orgType: 'ngo', lat: 17.43, lng: 78.44, cap: 80, radius: 15, types: ['cooked', 'bakery', 'packaged'] },
  { name: 'Annapurna Community Kitchen', email: 'kitchen@demo.com', orgType: 'community kitchen', lat: 17.41, lng: 78.46, cap: 120, radius: 12, types: ['cooked', 'produce', 'bakery'] },
  { name: 'Sunrise Shelter', email: 'shelter@demo.com', orgType: 'shelter', lat: 17.445, lng: 78.385, cap: 60, radius: 12, types: ['cooked', 'bakery', 'dairy'] },
  { name: 'City Food Bank', email: 'foodbank@demo.com', orgType: 'food bank', lat: 17.395, lng: 78.48, cap: 300, radius: 20, types: ['packaged', 'produce', 'dairy', 'bakery'] },
  { name: 'Seva Orphanage', email: 'orphanage@demo.com', orgType: 'orphanage', lat: 17.38, lng: 78.43, cap: 40, radius: 12, types: ['cooked', 'bakery'] },
  { name: 'Green Plate Kitchen', email: 'greenplate@demo.com', orgType: 'community kitchen', lat: 17.42, lng: 78.4, cap: 90, radius: 12, types: ['produce', 'cooked'] },
];

function seed() {
  const { db, id } = store;
  const rand = rng(42);
  const gauss = () => {
    const u = Math.max(rand(), 1e-9), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const iso = (ms) => new Date(ms).toISOString();
  const base = {
    passwordHash: null,
    createdAt: new Date().toISOString(),
    address: 'Hyderabad, Telangana',
    phone: '9000000000',
  };

  db.users.push({ ...base, id: id('u'), role: 'admin', name: 'Platform Admin', email: 'admin@demo.com', passwordHash: auth.hashPassword(PW), lat: 17.385, lng: 78.4867, orgType: 'admin', verified: true });

  const donors = DONORS.map((d) => {
    const u = { ...base, id: id('u'), role: 'donor', name: d.name, email: d.email, passwordHash: auth.hashPassword(PW), lat: d.lat, lng: d.lng, orgType: d.orgType, verified: true };
    db.users.push(u);
    return { u, d };
  });

  const receivers = RECEIVERS.map((r) => {
    const u = {
      ...base, id: id('u'), role: 'receiver', name: r.name, email: r.email, passwordHash: auth.hashPassword(PW),
      lat: r.lat, lng: r.lng, orgType: r.orgType, verified: true,
      capacityKg: r.cap, radiusKm: r.radius, acceptedTypes: r.types, pickupFrom: 6, pickupTo: 23,
    };
    db.users.push(u);
    return u;
  });

  // one receiver waiting for admin verification
  db.users.push({
    ...base, id: id('u'), role: 'receiver', name: 'New Hope Trust', email: 'pending@demo.com', passwordHash: auth.hashPassword(PW),
    lat: 17.41, lng: 78.45, orgType: 'ngo', verified: false, capacityKg: 50, radiusKm: 10,
    acceptedTypes: ['cooked', 'bakery'], pickupFrom: 8, pickupTo: 22,
  });

  // 90 days of surplus history per donor (this is the ML training data)
  const today = new Date(dayKey(Date.now()) + 'T00:00:00Z').getTime();
  for (const { u, d } of donors) {
    for (let i = 90; i >= 1; i--) {
      const t = today - i * 864e5;
      const dow = new Date(t).getUTCDay();
      const weekend = dow === 0 || dow === 6;
      const mult = weekend ? d.wk : 1;
      const trend = 1 + 0.1 * Math.sin(i / 14);
      let kg = d.base * mult * trend + gauss() * d.base * 0.12;
      if (rand() < 0.04) kg *= 1.8; // occasional spike
      if (rand() < 0.03) kg = 0; // closed day
      kg = Math.max(0, Math.round(kg * 10) / 10);
      if (kg === 0) continue;
      db.history.push({ donorId: u.id, date: dayKey(t), hour: Math.round(d.hour + gauss() * 0.7), quantityKg: kg, foodType: d.type });
    }
  }

  // sample listings so analytics/map are not empty
  const mk = (donor, d, recv, kg, hoursAgo, status) => {
    const created = Date.now() - hoursAgo * 36e5;
    const s = {
      id: id('s'), donorId: donor.id, donorName: donor.name, foodType: d.type, description: 'Fresh surplus from today\'s service',
      quantityKg: kg, lat: donor.lat, lng: donor.lng, preparedAt: iso(created - 2 * 36e5), expiryAt: iso(created + 5 * 36e5),
      status, receiverId: recv ? recv.id : null, receiverName: recv ? recv.name : null, matches: [], createdAt: iso(created),
    };
    const ev = (st, offMin, by, note = '') => db.events.push({ id: id('e'), surplusId: s.id, status: st, at: iso(created + offMin * 60000), by, note });
    ev('listed', 0, donor.name, `${kg} kg of ${d.type} registered`);
    if (recv) {
      s.acceptedAt = iso(created + 9 * 60000);
      ev('matched', 1, 'system', 'nearby receivers matched');
      ev('accepted', 9, recv.name, 'Receiver confirmed pickup');
    }
    if (['picked_up', 'delivered'].includes(status)) { s.pickedUpAt = iso(created + 35 * 60000); ev('picked_up', 35, recv.name, 'Food collected'); }
    if (status === 'delivered') { s.deliveredAt = iso(created + 70 * 60000); ev('delivered', 70, recv.name, 'Food reached beneficiaries'); }
    if (status === 'expired') ev('expired', 300, 'system', 'Food passed its safe-to-eat time');
    db.surplus.push(s);
    return s;
  };

  for (let i = 0; i < 16; i++) {
    const { u, d } = donors[i % donors.length];
    const compatible = receivers.filter((r) => r.acceptedTypes.includes(d.type));
    const recv = compatible[Math.floor(rand() * compatible.length)];
    mk(u, d, recv, Math.round((5 + rand() * 25) * 10) / 10, 20 + i * 14 + rand() * 6, 'delivered');
  }
  mk(donors[0].u, donors[0].d, null, 12, 30, 'expired');
  mk(donors[3].u, donors[3].d, null, 22, 70, 'expired');

  // live listings (matched with the real engine)
  const live = [
    [donors[1], 24, 4],
    [donors[2], 8, 3],
    [donors[4], 15, 5],
  ];
  for (const [{ u, d }, kg, hrs] of live) {
    const created = Date.now();
    const s = {
      id: id('s'), donorId: u.id, donorName: u.name, foodType: d.type, description: 'Ready for pickup today',
      quantityKg: kg, lat: u.lat, lng: u.lng, preparedAt: iso(created), expiryAt: iso(created + hrs * 36e5),
      status: 'listed', receiverId: null, receiverName: null, matches: [], createdAt: iso(created),
    };
    s.matches = matching.rank(s);
    s.status = s.matches.length ? 'matched' : 'listed';
    db.events.push({ id: id('e'), surplusId: s.id, status: 'listed', at: s.createdAt, by: u.name, note: `${kg} kg of ${d.type} registered` });
    if (s.matches.length) db.events.push({ id: id('e'), surplusId: s.id, status: 'matched', at: s.createdAt, by: 'system', note: `${s.matches.length} nearby receivers matched` });
    db.surplus.push(s);
  }
  store.flush();
}

function seedIfEmpty() {
  if (!store.db.users.length) {
    seed();
    console.log('Seeded demo data (password for all demo accounts: ' + PW + ')');
  }
}

if (require.main === module) {
  store.load();
  if (process.argv.includes('--reset')) store.reset();
  seedIfEmpty();
  console.log('Done. DB file:', store.FILE);
}

module.exports = { seedIfEmpty };
