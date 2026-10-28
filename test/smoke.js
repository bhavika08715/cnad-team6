// End-to-end smoke test: starts the server on a temp DB and walks the full redistribution flow.
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.DB_FILE = path.join(os.tmpdir(), `fsn-test-${Date.now()}.json`);

const assert = require('assert');
const { start } = require('../server');

(async () => {
  const server = start(0);
  await new Promise((r) => setTimeout(r, 300));
  const base = `http://localhost:${server.address().port}/api`;
  const call = async (p, { method = 'GET', body, token } = {}) => {
    const r = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  const ok = (name) => console.log('  ✓', name);

  assert.equal((await call('/health')).data.status, 'ok'); ok('health');
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: 'hotel@demo.com', password: 'wrong' } })).status, 401); ok('bad login rejected');
  assert.equal((await call('/surplus')).status, 401); ok('auth required');

  const donor = (await call('/auth/login', { method: 'POST', body: { email: 'hotel@demo.com', password: 'password123' } })).data;
  const recv = (await call('/auth/login', { method: 'POST', body: { email: 'kitchen@demo.com', password: 'password123' } })).data;
  const admin = (await call('/auth/login', { method: 'POST', body: { email: 'admin@demo.com', password: 'password123' } })).data;
  ok('login donor / receiver / admin');

  assert.equal((await call('/surplus', { method: 'POST', token: recv.token, body: { foodType: 'cooked', quantityKg: 5, hoursValid: 4 } })).status, 403); ok('receiver cannot post surplus');

  const pred = (await call('/predictions', { token: donor.token })).data;
  assert.equal(pred.forecasts.length, 7);
  assert(pred.accuracy.accuracyPct > 50);
  ok(`prediction: 7-day forecast, accuracy ${pred.accuracy.accuracyPct}% (naive baseline ${pred.accuracy.baselineAccuracyPct}%)`);

  const created = (await call('/surplus', { method: 'POST', token: donor.token, body: { foodType: 'cooked', quantityKg: 20, hoursValid: 4, description: 'test' } })).data;
  assert.equal(created.status, 'matched');
  assert(created.matches.length > 0);
  ok(`surplus posted and matched with ${created.matches.length} receivers (best: ${created.matches[0].receiverName}, score ${created.matches[0].score})`);

  const myList = (await call('/surplus', { token: recv.token })).data;
  assert(myList.some((s) => s.id === created.id)); ok('receiver sees the listing');
  assert.equal((await call(`/surplus/${created.id}/pickup`, { method: 'POST', token: recv.token })).status, 403); ok('cannot pick up before accepting');

  assert.equal((await call(`/surplus/${created.id}/accept`, { method: 'POST', token: recv.token })).data.status, 'accepted');
  assert.equal((await call(`/surplus/${created.id}/pickup`, { method: 'POST', token: recv.token })).data.status, 'picked_up');
  assert.equal((await call(`/surplus/${created.id}/deliver`, { method: 'POST', token: recv.token })).data.status, 'delivered');
  ok('accept → picked_up → delivered');

  const tl = (await call(`/surplus/${created.id}/timeline`, { token: donor.token })).data;
  assert(tl.length >= 5); ok(`tracking timeline has ${tl.length} events`);

  const notes = (await call('/notifications', { token: donor.token })).data;
  assert(notes.some((n) => n.title.startsWith('Food delivered'))); ok('donor notified on delivery');

  const stats = (await call('/analytics', { token: admin.token })).data;
  assert(stats.kgDelivered > 0); ok(`analytics: ${stats.kgDelivered} kg delivered, ${stats.mealsServed} meals`);

  const reg = (await call('/auth/register', { method: 'POST', body: { name: 'Test NGO', email: 'x@y.com', password: 'secret1', role: 'receiver', lat: 17.4, lng: 78.45, capacityKg: 60 } })).data;
  assert.equal(reg.user.verified, false);
  assert.equal((await call(`/surplus/${created.id}/accept`, { method: 'POST', token: reg.token })).status, 403);
  const pending = (await call('/admin/receivers/pending', { token: admin.token })).data;
  assert(pending.some((u) => u.id === reg.user.id));
  await call(`/admin/receivers/${reg.user.id}/verify`, { method: 'POST', token: admin.token });
  ok('new receiver registers → admin verifies');

  const up = (await call('/predictions/upcoming', { token: recv.token })).data;
  ok(`receiver sees ${up.length} predicted surplus sources for tomorrow`);

  console.log('\nALL TESTS PASSED');
  server.close();
  fs.rmSync(process.env.DB_FILE, { force: true });
  process.exit(0);
})().catch((e) => {
  console.error('\nTEST FAILED:', e.message);
  process.exit(1);
});
