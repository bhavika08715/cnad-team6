// Surplus Registration Service + Tracking Service
const { db, id, save } = require('./db');
const matching = require('./matching');
const notif = require('./notifications');
const { err, dayKey, FOOD_TYPES } = require('./util');

const ACTIVE = ['listed', 'matched', 'accepted', 'picked_up'];

function addEvent(item, status, by, note = '') {
  db.events.push({ id: id('e'), surplusId: item.id, status, at: new Date().toISOString(), by, note });
}

function create(user, b) {
  if (user.role !== 'donor') throw err(403, 'Only donors can register surplus');
  if (!FOOD_TYPES.includes(b.foodType)) throw err(400, 'Invalid food type');
  const q = Number(b.quantityKg);
  if (!(q > 0 && q <= 2000)) throw err(400, 'Quantity must be between 0 and 2000 kg');
  const hrs = Number(b.hoursValid);
  if (!(hrs > 0 && hrs <= 72)) throw err(400, 'Safe-to-eat hours must be between 0 and 72');
  const lat = b.lat !== undefined && b.lat !== '' ? Number(b.lat) : user.lat;
  const lng = b.lng !== undefined && b.lng !== '' ? Number(b.lng) : user.lng;
  if (!isFinite(lat) || !isFinite(lng)) throw err(400, 'Invalid location');

  const now = new Date();
  const item = {
    id: id('s'),
    donorId: user.id,
    donorName: user.name,
    foodType: b.foodType,
    description: String(b.description || '').slice(0, 300),
    quantityKg: q,
    lat,
    lng,
    preparedAt: b.preparedAt || now.toISOString(),
    expiryAt: new Date(now.getTime() + hrs * 36e5).toISOString(),
    status: 'listed',
    receiverId: null,
    receiverName: null,
    matches: [],
    createdAt: now.toISOString(),
  };
  item.matches = matching.rank(item);
  item.status = item.matches.length ? 'matched' : 'listed';
  db.surplus.push(item);
  addEvent(item, 'listed', user.name, `${q} kg of ${item.foodType} registered`);
  if (item.matches.length) addEvent(item, 'matched', 'system', `${item.matches.length} nearby receivers matched`);

  // learning: feed real data back to the prediction engine
  db.history.push({ donorId: user.id, date: dayKey(now), hour: now.getHours(), quantityKg: q, foodType: item.foodType });

  item.matches.slice(0, 5).forEach((m) =>
    notif.notify(m.receiverId, 'New surplus food nearby', `${user.name}: ${q} kg ${item.foodType}, ${m.distanceKm} km away. Expires in ${hrs}h.`, item.id)
  );
  save();
  return view(item, user);
}

function view(item, user) {
  const v = { ...item };
  if (user.role === 'receiver') {
    v.myMatch = item.matches.find((m) => m.receiverId === user.id) || null;
    delete v.matches;
  }
  return v;
}

function list(user, status) {
  let items = db.surplus;
  if (user.role === 'donor') items = items.filter((s) => s.donorId === user.id);
  else if (user.role === 'receiver')
    items = items.filter(
      (s) => s.receiverId === user.id || (['listed', 'matched'].includes(s.status) && s.matches.some((m) => m.receiverId === user.id))
    );
  if (status === 'active') items = items.filter((s) => ACTIVE.includes(s.status));
  else if (status) items = items.filter((s) => s.status === status);
  return items.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((s) => view(s, user));
}

function find(sid) {
  const item = db.surplus.find((s) => s.id === sid);
  if (!item) throw err(404, 'Listing not found');
  return item;
}

function action(user, sid, act) {
  const item = find(sid);
  const ts = new Date().toISOString();
  const donor = db.users.find((u) => u.id === item.donorId);
  switch (act) {
    case 'accept': {
      if (user.role !== 'receiver') throw err(403, 'Only receivers can accept');
      if (!user.verified) throw err(403, 'Your organisation is not verified yet');
      if (!['listed', 'matched'].includes(item.status)) throw err(409, 'This food is no longer available');
      if (new Date(item.expiryAt) < new Date()) throw err(409, 'This food has expired');
      if (!item.matches.some((m) => m.receiverId === user.id)) throw err(403, 'You are not an eligible match for this listing');
      item.status = 'accepted';
      item.receiverId = user.id;
      item.receiverName = user.name;
      item.acceptedAt = ts;
      addEvent(item, 'accepted', user.name, 'Receiver confirmed pickup');
      notif.notify(donor.id, 'Pickup accepted', `${user.name} will collect your ${item.quantityKg} kg of ${item.foodType}.`, item.id);
      break;
    }
    case 'pickup':
      if (item.receiverId !== user.id) throw err(403, 'Not your pickup');
      if (item.status !== 'accepted') throw err(409, 'Pickup must be accepted first');
      item.status = 'picked_up';
      item.pickedUpAt = ts;
      addEvent(item, 'picked_up', user.name, 'Food collected from donor');
      notif.notify(donor.id, 'Food collected', `${user.name} collected your food.`, item.id);
      break;
    case 'deliver':
      if (item.receiverId !== user.id) throw err(403, 'Not your pickup');
      if (item.status !== 'picked_up') throw err(409, 'Food must be picked up first');
      item.status = 'delivered';
      item.deliveredAt = ts;
      addEvent(item, 'delivered', user.name, 'Food reached beneficiaries');
      notif.notify(donor.id, 'Food delivered 🎉', `Your ${item.quantityKg} kg of food was distributed by ${user.name}.`, item.id);
      break;
    case 'release':
      if (item.receiverId !== user.id) throw err(403, 'Not your pickup');
      if (item.status !== 'accepted') throw err(409, 'Can only release before pickup');
      item.status = 'matched';
      item.receiverId = null;
      item.receiverName = null;
      addEvent(item, 'matched', user.name, 'Receiver released the pickup');
      notif.notify(donor.id, 'Pickup released', `${user.name} can no longer collect. Your listing is open again.`, item.id);
      break;
    case 'cancel':
      if (!(user.role === 'admin' || item.donorId === user.id)) throw err(403, 'Not your listing');
      if (!['listed', 'matched', 'accepted'].includes(item.status)) throw err(409, 'Cannot cancel at this stage');
      if (item.receiverId) notif.notify(item.receiverId, 'Listing cancelled', `${item.donorName} cancelled the ${item.foodType} listing.`, item.id);
      item.status = 'cancelled';
      addEvent(item, 'cancelled', user.name);
      break;
    default:
      throw err(400, 'Unknown action');
  }
  save();
  return view(item, user);
}

function timeline(user, sid) {
  const item = find(sid);
  const allowed = user.role === 'admin' || item.donorId === user.id || item.receiverId === user.id || item.matches.some((m) => m.receiverId === user.id);
  if (!allowed) throw err(403, 'Not allowed');
  return db.events.filter((e) => e.surplusId === sid).sort((a, b) => a.at.localeCompare(b.at));
}

function expireSweep() {
  const now = Date.now();
  let n = 0;
  for (const s of db.surplus) {
    if (['listed', 'matched', 'accepted'].includes(s.status) && new Date(s.expiryAt).getTime() < now) {
      s.status = 'expired';
      addEvent(s, 'expired', 'system', 'Food passed its safe-to-eat time');
      notif.notify(s.donorId, 'Listing expired', `Your ${s.quantityKg} kg of ${s.foodType} expired before pickup.`, s.id);
      if (s.receiverId) notif.notify(s.receiverId, 'Pickup expired', 'The food you accepted has expired.', s.id);
      n++;
    }
  }
  if (n) save();
  return n;
}

module.exports = { create, list, action, timeline, expireSweep, ACTIVE };
