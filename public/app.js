/* FoodBridge front-end (vanilla JS + Leaflet). Talks to the API gateway at /api */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { token: localStorage.getItem('fb_token'), user: null, meta: { foodTypes: [], center: { lat: 17.4, lng: 78.43 } }, tab: null, maps: {}, poll: null };

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && S.token) logout();
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), 2800);
}
const fmtTime = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const left = (iso) => {
  const m = Math.round((new Date(iso) - Date.now()) / 60000);
  if (m <= 0) return 'expired';
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`;
};
const pill = (s) => `<span class="pill ${s}">${s.replace('_', ' ')}</span>`;

/* ---------------- AUTH ---------------- */
let regMap, regMarker;
function setRegLoc(lat, lng) {
  const f = $('#regForm');
  f.lat.value = lat;
  f.lng.value = lng;
  if (regMarker) regMarker.setLatLng([lat, lng]);
  else regMarker = L.marker([lat, lng]).addTo(regMap);
}
function initRegMap() {
  if (regMap) return setTimeout(() => regMap.invalidateSize(), 50);
  regMap = L.map('regMap').setView([S.meta.center.lat, S.meta.center.lng], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(regMap);
  regMap.on('click', (e) => setRegLoc(e.latlng.lat, e.latlng.lng));
  setRegLoc(S.meta.center.lat, S.meta.center.lng);
}

$('#tabLogin').onclick = () => { $('#loginForm').classList.remove('hidden'); $('#regForm').classList.add('hidden'); $('#tabLogin').classList.add('active'); $('#tabReg').classList.remove('active'); };
$('#tabReg').onclick = () => { $('#loginForm').classList.add('hidden'); $('#regForm').classList.remove('hidden'); $('#tabReg').classList.add('active'); $('#tabLogin').classList.remove('active'); initRegMap(); };
$('#regRole').onchange = (e) => $('#receiverFields').classList.toggle('hidden', e.target.value !== 'receiver');
$('#gpsBtn').onclick = () => {
  if (!navigator.geolocation) return toast('GPS not available');
  navigator.geolocation.getCurrentPosition((p) => { setRegLoc(p.coords.latitude, p.coords.longitude); regMap.setView([p.coords.latitude, p.coords.longitude], 14); }, () => toast('Could not get location'));
};
document.querySelectorAll('[data-demo]').forEach((b) => (b.onclick = () => doLogin(b.dataset.demo, 'password123')));

async function doLogin(email, password) {
  try {
    const r = await api('/auth/login', { method: 'POST', body: { email, password } });
    S.token = r.token;
    localStorage.setItem('fb_token', r.token);
    await boot();
  } catch (e) { $('#authMsg').textContent = e.message; }
}
$('#loginForm').onsubmit = (e) => { e.preventDefault(); doLogin(e.target.email.value, e.target.password.value); };
$('#regForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = Object.fromEntries(new FormData(f).entries());
  body.acceptedTypes = [...f.querySelectorAll('#typeBoxes input:checked')].map((i) => i.value);
  try {
    const r = await api('/auth/register', { method: 'POST', body });
    S.token = r.token;
    localStorage.setItem('fb_token', r.token);
    await boot();
    if (r.user.role === 'receiver') toast('Registered! An admin must verify your organisation before you get matches.');
  } catch (err) { $('#authMsg').textContent = err.message; }
};

function logout() {
  S.token = null; S.user = null;
  localStorage.removeItem('fb_token');
  clearInterval(S.poll);
  $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden'); $('#userbox').classList.add('hidden');
}

/* ---------------- APP SHELL ---------------- */
const TABS = {
  donor: [['dash', 'Dashboard'], ['post', 'Post Surplus'], ['listings', 'My Listings'], ['predict', 'Predictions'], ['map', 'Map'], ['notes', 'Notifications']],
  receiver: [['dash', 'Dashboard'], ['nearby', 'Available Food'], ['pickups', 'My Pickups'], ['upcoming', 'Predicted Surplus'], ['map', 'Map'], ['notes', 'Notifications']],
  admin: [['dash', 'Analytics'], ['verify', 'Verify Receivers'], ['all', 'All Listings'], ['predict', 'Predictions'], ['upcoming', 'Tomorrow\'s Surplus'], ['map', 'Map']],
};

async function boot() {
  try {
    S.meta = await api('/meta');
    if (!S.token) return;
    const me = await api('/me');
    S.user = me.user;
  } catch (e) { return; }
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#userbox').classList.remove('hidden');
  S.tab = TABS[S.user.role][0][0];
  renderNav();
  go(S.tab);
  clearInterval(S.poll);
  S.poll = setInterval(refreshBadge, 15000);
  refreshBadge();
}

async function refreshBadge() {
  try {
    const me = await api('/me');
    S.unread = me.unread;
    $('#userbox').innerHTML = `<span>${esc(S.user.name)} · <b>${S.user.role}</b>${S.user.role === 'receiver' && !S.user.verified ? ' · ⏳ unverified' : ''}</span><button id="logoutBtn">Logout</button>`;
    $('#logoutBtn').onclick = logout;
    renderNav();
  } catch (_) {}
}

function renderNav() {
  $('#nav').innerHTML = TABS[S.user.role]
    .map(([k, label]) => `<button data-tab="${k}" class="${S.tab === k ? 'active' : ''}">${label}${k === 'notes' && S.unread ? `<span class="badge">${S.unread}</span>` : ''}</button>`)
    .join('');
  $('#nav').querySelectorAll('button').forEach((b) => (b.onclick = () => go(b.dataset.tab)));
}

async function go(tab) {
  S.tab = tab;
  renderNav();
  Object.values(S.maps).forEach((m) => m.remove());
  S.maps = {};
  const v = $('#view');
  v.innerHTML = '<p class="empty">Loading…</p>';
  try {
    await VIEWS[tab](v);
  } catch (e) { v.innerHTML = `<p class="empty">⚠️ ${esc(e.message)}</p>`; }
}

/* ---------------- VIEWS ---------------- */
const VIEWS = {
  async dash(v) {
    const a = await api('/analytics');
    const max = Math.max(1, ...a.byDay.map((d) => d.listedKg));
    const stat = (n, l) => `<div class="stat"><b>${n ?? '–'}</b><span>${l}</span></div>`;
    v.innerHTML = `
      <h2>${S.user.role === 'admin' ? 'Platform analytics' : S.user.role === 'donor' ? 'Your impact' : 'Your pickups & impact'}</h2>
      <div class="grid">
        ${stat(a.kgDelivered + ' kg', 'Food redistributed')}
        ${stat(a.mealsServed, 'Meals served (est.)')}
        ${stat(a.co2eAvoidedKg + ' kg', 'CO₂e avoided (est.)')}
        ${stat(a.activeListings, 'Active requests')}
        ${stat(a.successRatePct == null ? '–' : a.successRatePct + '%', 'Successful redistributions')}
        ${stat(a.avgListingToPickupMin == null ? '–' : a.avgListingToPickupMin + ' min', 'Avg. listing → pickup')}
        ${stat(a.kgWasted + ' kg', 'Expired / wasted')}
        ${S.user.role === 'admin' ? stat(a.donors + ' / ' + a.receivers, 'Donors / verified receivers') : stat(a.totalListings, 'Total listings')}
      </div>
      <div class="two" style="margin-top:16px">
        <div class="card"><h3>Last 14 days (kg)</h3>
          <div class="bars">${a.byDay.map((d) => `<div class="bar" title="${d.date}"><i class="alt" style="height:${(d.listedKg / max) * 100}%"></i><span>${d.date.slice(8)}</span></div>`).join('')}</div>
          <div class="legend"><b style="background:var(--orange)"></b>Surplus listed</div></div>
        <div class="card"><h3>Redistributed by food type</h3>
          ${a.byType.length ? `<table>${a.byType.map((t) => `<tr><td>${esc(t.type)}</td><td><b>${t.kg} kg</b></td></tr>`).join('')}</table>` : '<p class="empty">No deliveries yet</p>'}</div>
      </div>`;
  },

  async post(v) {
    v.innerHTML = `
      <div class="two">
        <div class="card"><h2>Register surplus food</h2>
          <form id="postForm">
            <label>Food type<select name="foodType">${S.meta.foodTypes.map((t) => `<option>${t}</option>`).join('')}</select></label>
            <label>Quantity (kg)<input name="quantityKg" type="number" min="0.5" step="0.5" value="10" required /></label>
            <label>Safe to eat for (hours)<input name="hoursValid" type="number" min="0.5" max="72" step="0.5" value="4" required /></label>
            <label>Description<textarea name="description" rows="2" placeholder="e.g. veg biryani, sealed containers"></textarea></label>
            <p class="meta">Pickup location: your registered address (${esc(S.user.address || 'saved location')}).</p>
            <button class="btn" type="button" id="previewBtn">Preview matches</button>
            <button class="btn" type="submit">Post & notify receivers</button>
          </form></div>
        <div class="card"><h2>Matched receivers</h2><div id="matchBox"><p class="empty">Preview or post to see ranked nearby receivers.</p></div></div>
      </div>`;
    const form = $('#postForm');
    const body = () => ({ ...Object.fromEntries(new FormData(form).entries()) });
    const showMatches = (ms) => ($('#matchBox').innerHTML = ms.length
      ? ms.map((m, i) => `<div class="match"><span>${i + 1}. <b>${esc(m.receiverName)}</b><br><small>${m.distanceKm} km · ~${m.etaMin} min${m.inPickupWindow ? '' : ' · outside pickup hours'}</small></span><span class="score">${m.score}</span></div>`).join('')
      : '<p class="empty">No eligible receiver nearby right now (type, capacity, radius or time constraints).</p>');
    $('#previewBtn').onclick = async () => { try { showMatches(await api('/match/preview', { method: 'POST', body: body() })); } catch (e) { toast(e.message); } };
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const s = await api('/surplus', { method: 'POST', body: body() });
        showMatches(s.matches);
        toast(s.matches.length ? `Posted! ${s.matches.length} receivers matched & notified.` : 'Posted, but no receiver matched yet.');
      } catch (err) { toast(err.message); }
    };
  },

  async listings(v) { await listView(v, '/surplus', 'My listings'); },
  async nearby(v) { await listView(v, '/surplus?status=matched', 'Available food near you'); },
  async pickups(v) {
    const all = await api('/surplus');
    const mine = all.filter((s) => s.receiverId === S.user.id);
    renderItems(v, 'My pickups', mine);
  },
  async all(v) { await listView(v, '/surplus', 'All listings'); },

  async predict(v) {
    let donorId = '';
    let picker = '';
    if (S.user.role === 'admin') {
      const ds = await api('/donors');
      donorId = ds[0].id;
      picker = `<label>Donor<select id="donorPick">${ds.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label>`;
    }
    v.innerHTML = `<h2>Surplus prediction</h2>${picker}<div id="predBox"></div>`;
    const load = async (id) => {
      const p = await api('/predictions/' + (id || ''));
      const max = Math.max(1, ...p.forecasts.map((f) => f.predictedKg), ...p.recent.map((r) => r.kg));
      $('#predBox').innerHTML = `
        <div class="grid" style="margin-bottom:14px">
          <div class="stat"><b>${p.accuracy.accuracyPct ?? '–'}%</b><span>Model accuracy (14-day back-test)</span></div>
          <div class="stat"><b>${p.accuracy.baselineAccuracyPct ?? '–'}%</b><span>Naive baseline ("same as yesterday")</span></div>
          <div class="stat"><b>${p.accuracy.maeKg ?? '–'} kg</b><span>Mean absolute error</span></div>
        </div>
        <div class="card"><h3>Actual (last 14 days) and predicted (next 7 days), kg</h3>
          <div class="bars">
            ${p.recent.map((r) => `<div class="bar" title="${r.date}"><i style="height:${(r.kg / max) * 100}%"></i><span>${r.date.slice(8)}</span></div>`).join('')}
            ${p.forecasts.map((f) => `<div class="bar" title="${f.date}"><i class="pred" style="height:${(f.predictedKg / max) * 100}%"></i><span>${f.date.slice(8)}</span></div>`).join('')}
          </div>
          <div class="legend"><b style="background:var(--green)"></b>Actual<b style="background:#7cc99b"></b>Predicted</div></div>
        <div class="card" style="margin-top:14px"><h3>Next 7 days</h3>
          <table><tr><th>Day</th><th>Expected surplus</th><th>Likely window</th><th>Food</th><th>Level</th><th>Confidence</th></tr>
          ${p.forecasts.map((f) => `<tr><td>${f.day} ${f.date.slice(5)}</td><td><b>${f.predictedKg} kg</b></td><td>${f.windowFrom}:00 – ${f.windowTo}:59</td><td>${esc(f.foodType)}</td><td><span class="pill ${f.level}">${f.level}</span></td><td>${f.confidence}%</td></tr>`).join('')}</table></div>`;
    };
    if ($('#donorPick')) $('#donorPick').onchange = (e) => load(e.target.value);
    await load(donorId);
  },

  async upcoming(v) {
    const rows = await api('/predictions/upcoming');
    v.innerHTML = `<h2>Predicted surplus tomorrow</h2><p class="meta">Forecasts from the prediction engine so you can plan pickups before food is even listed.</p>
      <div class="card">${rows.length ? `<table><tr><th>Donor</th>${S.user.role === 'receiver' ? '<th>Distance</th>' : ''}<th>Expected</th><th>Window</th><th>Food</th><th>Confidence</th></tr>
      ${rows.map((r) => `<tr><td>${esc(r.donorName)}<br><small>${esc(r.orgType)}</small></td>${S.user.role === 'receiver' ? `<td>${r.distanceKm} km</td>` : ''}<td><b>${r.predictedKg} kg</b></td><td>${r.windowFrom}:00 – ${r.windowTo}:59</td><td>${esc(r.foodType)}</td><td>${r.confidence}%</td></tr>`).join('')}</table>` : '<p class="empty">No significant surplus predicted nearby.</p>'}</div>`;
  },

  async verify(v) {
    const pend = await api('/admin/receivers/pending');
    v.innerHTML = `<h2>Receivers awaiting verification</h2>` + (pend.length
      ? `<div class="list">${pend.map((u) => `<div class="item"><h4>${esc(u.name)} <span class="pill">${esc(u.orgType)}</span></h4><div class="meta">${esc(u.email)} · ${esc(u.phone || 'no phone')} · capacity ${u.capacityKg} kg · radius ${u.radiusKm} km<br>Accepts: ${u.acceptedTypes.join(', ')}</div>
        <div class="actions"><button class="btn small" data-verify="${u.id}">✓ Verify</button><button class="btn small danger" data-reject="${u.id}">Reject</button></div></div>`).join('')}</div>`
      : '<p class="empty">No receivers pending 🎉</p>');
  },

  async notes(v) {
    const ns = await api('/notifications');
    await api('/notifications/read', { method: 'POST' });
    S.unread = 0; renderNav();
    v.innerHTML = '<h2>Notifications</h2>' + (ns.length
      ? `<div class="list">${ns.map((n) => `<div class="item" style="${n.read ? '' : 'border-left:4px solid var(--green)'}"><h4>${esc(n.title)}<small class="meta">${fmtTime(n.at)}</small></h4><div>${esc(n.message)}</div></div>`).join('')}</div>`
      : '<p class="empty">No notifications yet.</p>');
  },

  async map(v) {
    const m = await api('/map');
    v.innerHTML = `<h2>Hyperlocal map</h2><div id="bigMap" class="map"></div>
      <div class="legend"><b style="background:#e8833a"></b>Donors<b style="background:#1f8a4c"></b>Verified receivers<b style="background:#d64545"></b>Active surplus</div>`;
    const map = L.map('bigMap').setView([S.meta.center.lat, S.meta.center.lng], 12);
    S.maps.big = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    const dot = (p, color, html, r = 8) => L.circleMarker([p.lat, p.lng], { radius: r, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.95 }).addTo(map).bindPopup(html);
    m.donors.forEach((d) => dot(d, '#e8833a', `<b>${esc(d.name)}</b><br>${esc(d.orgType)}`));
    m.receivers.forEach((r) => { dot(r, '#1f8a4c', `<b>${esc(r.name)}</b><br>${esc(r.orgType)}<br>radius ${r.radiusKm} km`); });
    m.surplus.forEach((s) => dot(s, '#d64545', `<b>${s.quantityKg} kg ${esc(s.foodType)}</b><br>${esc(s.donorName)}<br>${left(s.expiryAt)}`, 11));
    setTimeout(() => map.invalidateSize(), 80);
  },
};

async function listView(v, path, title) {
  renderItems(v, title, await api(path));
}

function renderItems(v, title, items) {
  const role = S.user.role;
  v.innerHTML = `<h2>${title}</h2>` + (items.length ? `<div class="list">${items.map(itemCard).join('')}</div>` : '<p class="empty">Nothing here yet.</p>');
}

function itemCard(s) {
  const role = S.user.role;
  const mine = s.receiverId === S.user.id;
  let acts = '';
  if (role === 'receiver') {
    if (['listed', 'matched'].includes(s.status)) acts += `<button class="btn small" data-act="accept" data-id="${s.id}">Accept pickup</button>`;
    if (mine && s.status === 'accepted') acts += `<button class="btn small" data-act="pickup" data-id="${s.id}">Mark picked up</button><button class="btn small ghost" data-act="release" data-id="${s.id}">Release</button>`;
    if (mine && s.status === 'picked_up') acts += `<button class="btn small" data-act="deliver" data-id="${s.id}">Mark delivered</button>`;
  }
  if ((role === 'donor' || role === 'admin') && ['listed', 'matched', 'accepted'].includes(s.status))
    acts += `<button class="btn small danger" data-act="cancel" data-id="${s.id}">Cancel</button>`;
  acts += `<button class="btn small ghost" data-timeline="${s.id}">Tracking</button>`;

  let extra = '';
  if (role === 'receiver' && s.myMatch) extra = `<div class="meta">📍 ${s.myMatch.distanceKm} km · ~${s.myMatch.etaMin} min · match score <span class="score">${s.myMatch.score}</span></div>`;
  if (role !== 'receiver' && s.matches && s.matches.length && ['listed', 'matched'].includes(s.status))
    extra = `<div class="meta">Matched: ${s.matches.slice(0, 3).map((m) => `${esc(m.receiverName)} (${m.score})`).join(', ')}${s.matches.length > 3 ? ` +${s.matches.length - 3} more` : ''}</div>`;
  return `<div class="item" id="item-${s.id}">
    <h4><span>${s.quantityKg} kg ${esc(s.foodType)} <small class="meta">· ${esc(s.donorName)}</small></span>${pill(s.status)}</h4>
    <div class="meta">${esc(s.description || '')} · posted ${fmtTime(s.createdAt)} · ${['expired', 'delivered', 'cancelled'].includes(s.status) ? '' : left(s.expiryAt)}${s.receiverName ? ` · receiver: ${esc(s.receiverName)}` : ''}</div>
    ${extra}<div class="actions">${acts}</div><div class="tlbox"></div></div>`;
}

/* ---------------- global click handling ---------------- */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  try {
    if (t.dataset.act) {
      await api(`/surplus/${t.dataset.id}/${t.dataset.act}`, { method: 'POST' });
      toast('Updated ✓');
      go(S.tab);
    } else if (t.dataset.timeline) {
      const box = $(`#item-${t.dataset.timeline} .tlbox`);
      if (box.innerHTML) return (box.innerHTML = '');
      const tl = await api(`/surplus/${t.dataset.timeline}/timeline`);
      box.innerHTML = `<div class="tl">${tl.map((x) => `<div><b>${x.status.replace('_', ' ')}</b> · ${fmtTime(x.at)}<br><small>${esc(x.by)} ${esc(x.note)}</small></div>`).join('')}</div>`;
    } else if (t.dataset.verify) {
      await api(`/admin/receivers/${t.dataset.verify}/verify`, { method: 'POST' }); toast('Receiver verified'); go('verify');
    } else if (t.dataset.reject) {
      await api(`/admin/receivers/${t.dataset.reject}/reject`, { method: 'POST' }); toast('Receiver rejected'); go('verify');
    }
  } catch (err) { toast(err.message); }
});

/* ---------------- start ---------------- */
(async () => {
  try { S.meta = await api('/meta'); } catch (_) {}
  $('#typeBoxes').insertAdjacentHTML('beforeend', S.meta.foodTypes.map((t) => `<label><input type="checkbox" value="${t}" checked /> ${t}</label>`).join(''));
  if (S.token) await boot();
})();
