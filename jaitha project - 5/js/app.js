/**
 * Secret Spots — Exploration Recon controller
 */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);

const MAP_STYLES = {
  dark:      { name: 'Recon Dark',  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, attr: '&copy; OpenStreetMap contributors' },
  standard:  { name: 'Standard',    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, attr: '&copy; OpenStreetMap contributors' },
  terrain:   { name: 'Terrain & contours', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', max: 17, attr: 'Map data &copy; OpenStreetMap contributors, SRTM | Style &copy; OpenTopoMap (CC-BY-SA)' },
  satellite: { name: 'Satellite',   url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', max: 18, attr: 'Tiles &copy; Esri, Maxar, Earthstar Geographics' }
};

const OSM_CATS = {
  waterfall:           { label: 'Waterfall',   icon: '💧', mood: 'adventure' },
  viewpoint:           { label: 'Viewpoint',   icon: '👁️', mood: 'romantic' },
  peak:                { label: 'Peak',        icon: '⛰️', mood: 'adventure' },
  cave_entrance:       { label: 'Cave',        icon: '🕳️', mood: 'adventure' },
  spring:              { label: 'Spring',      icon: '💦', mood: 'relax' },
  hot_spring:          { label: 'Hot spring',  icon: '♨️', mood: 'relax' },
  beach:               { label: 'Beach',       icon: '🏖️', mood: 'relax' },
  fort:                { label: 'Fort',        icon: '🏰', mood: 'adventure' },
  ruins:               { label: 'Ruins',       icon: '🏛️', mood: 'adventure' },
  archaeological_site: { label: 'Heritage site', icon: '🗿', mood: 'adventure' },
  picnic_site:         { label: 'Picnic site', icon: '🧺', mood: 'relax' }
};

class SecretSpotsApp {
  constructor() {
    const session = Auth.getSession();
    this.session = session || { id: 'guest', name: 'Guest Scout', provider: 'guest' };
    LocalStorageManager.setScope(this.session.id);
    this.map = null;
    this.userMarker = null;
    this.sweepMarker = null;
    this.spotLayer = null;
    this.radarLayer = null;
    this.routeLayer = null;
    this.markers = {};

    this.currentPosition = { lat: 13.0827, lng: 80.2707 }; // Chennai fallback
    this.hasFix = false;
    this.activeFilter = 'all';
    this.heading = null;
    this.nearest = null;
    this.compassOn = false;
    this.pickMode = false;
    this.drawerState = 'open';
    this.settings = LocalStorageManager.getSettings();
    this.lastRoute = null;
    this.osmItems = [];
    this.target = null;        // compass-guided target: { kind, points, idx }
    this.tracking = null;      // active trail recording
    this.trackTimer = null;
    this.wakeLock = null;

    this.initMap();
    this.initAuth();
    this.buildLogFormOptions();
    this.initEventListeners();
    this.setDrawer('collapsed');
    this.setRadar(this.settings.radar, true);
    this.startLocationWatch();
    this.resumeTracking();
    this.renderAll();
  }

  /* ---------------- Map ---------------- */
  initMap() {
    this.map = L.map('map', { zoomControl: false }).setView([13.0827, 80.2707], 10);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    this.spotLayer = L.layerGroup().addTo(this.map);
    this.radarLayer = L.layerGroup().addTo(this.map);
    this.routeLayer = L.layerGroup().addTo(this.map);
    this.trackLayer = L.layerGroup().addTo(this.map);
    this.setMapStyle(this.settings.mapStyle || 'dark');

    this.map.on('click', e => {
      if (!this.pickMode) return;
      this.pickMode = false;
      document.body.classList.remove('picking');
      $('log-lat').value = e.latlng.lat.toFixed(6);
      $('log-lng').value = e.latlng.lng.toFixed(6);
      $('log-modal').classList.remove('hidden');
      this.toast('Coordinates locked from map');
    });
  }

  /* ---------------- Session ---------------- */
  initAuth() { this.updateUserUI(); }

  avatarHtml() {
    const u = this.session;
    return u.picture
      ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">`
      : esc((u.name || '?').charAt(0).toUpperCase());
  }

  updateUserUI() {
    $('avatar').innerHTML = this.avatarHtml();
    this.refreshXpChip();
  }

  refreshXpChip() { $('profile-xp').textContent = `${LocalStorageManager.getPassport().xp} XP`; }

  /* ---------------- GPS & compass ---------------- */
  startLocationWatch() {
    if (!('geolocation' in navigator)) {
      this.updateGpsStatus('Geolocation unsupported · default centre', false);
      this.updateUserLocationMarker();
      return;
    }
    navigator.geolocation.watchPosition(
      pos => {
        const { latitude, longitude, heading } = pos.coords;
        this.currentPosition = { lat: latitude, lng: longitude };
        if (!this.compassOn && typeof heading === 'number' && !isNaN(heading)) this.heading = heading;
        const first = !this.hasFix;
        this.hasFix = true;
        this.updateUserLocationMarker();
        this.updateGpsStatus(`GPS lock · ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`, true);
        if (first) this.map.setView([latitude, longitude], 11);
        this.renderAll();
        this.checkProximity();
        this.onFix(pos.coords);
      },
      () => {
        this.updateGpsStatus('No GPS · using Chennai centre', false);
        this.updateUserLocationMarker();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 1000 }
    );
  }

  updateGpsStatus(text, active) {
    $('gps-status').innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}"></span> ${esc(text)}`;
  }

  updateUserLocationMarker() {
    const { lat, lng } = this.currentPosition;
    if (!this.userMarker) {
      const icon = L.divIcon({ className: 'user-location-marker', html: '<div class="user-location-pin"></div>', iconSize: [24, 24], iconAnchor: [12, 12] });
      this.userMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000, interactive: false }).addTo(this.map);
    } else {
      this.userMarker.setLatLng([lat, lng]);
    }
    if (this.settings.radar) this.drawRadar();
  }

  async enableCompass() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') { this.toast('Compass permission denied'); return; }
      }
    } catch (e) { this.toast('Compass unavailable'); return; }
    if (this.compassOn) return;
    const handler = e => {
      let h = null;
      if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
      else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;
      if (h !== null) { this.heading = h; this.updateCompass(); }
    };
    window.addEventListener('deviceorientationabsolute', handler, true);
    window.addEventListener('deviceorientation', handler, true);
    this.compassOn = true;
    this.toast('Compass enabled');
  }

  currentWaypoint() {
    const t = this.target;
    if (t && t.points[t.idx]) {
      const w = t.points[t.idx];
      return { lat: w.lat, lng: w.lng, name: w.name, prefix: t.kind === 'backtrack' ? '↩ ' : '🎯 ' };
    }
    if (this.nearest) return { lat: this.nearest.lat, lng: this.nearest.lng, name: this.nearest.name, prefix: '◎ ' };
    return null;
  }

  updateCompass() {
    const wp = this.currentWaypoint();
    if (!wp) return;
    const { lat, lng } = this.currentPosition;
    const dist = NavigationAlgorithms.haversineDistance(lat, lng, wp.lat, wp.lng);
    const brg = NavigationAlgorithms.bearing(lat, lng, wp.lat, wp.lng);
    const rel = (brg - (this.heading || 0) + 360) % 360;
    const off = this.heading !== null && rel > 60 && rel < 300;
    $('compass-arrow').style.transform = `rotate(${rel}deg)`;
    $('compass-arrow').classList.toggle('off', off);
    $('compass-dist').textContent = dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`;
    $('compass-bearing').textContent = off ? 'OFF COURSE' : `${Math.round(brg)}° ${NavigationAlgorithms.cardinal(brg)}${this.heading === null ? ' · N-up' : ''}`;
    $('compass-name').textContent = wp.prefix + wp.name;
  }

  /* ---------------- Data ---------------- */
  getLog() { return LocalStorageManager.getLog(); }

  getCurated() {
    return [...window.SEED_SPOTS, ...this.getLog().filter(e => e.kind === 'destination')];
  }

  getDestinations() { return [...this.getCurated(), ...this.osmItems]; }

  getEntriesFor(spot) {
    const seeded = (spot.entries || []).map(e => ({ ...e, parentId: spot.id }));
    const logged = this.getLog().filter(e => e.kind !== 'destination' && e.parentId === spot.id);
    return [...seeded, ...logged];
  }

  getVisibleItems() {
    const f = this.activeFilter;
    let items;
    if (f === 'log') items = this.getLog();
    else if (f === 'discover') items = this.osmItems;
    else if (f === 'bookmarked') { const b = LocalStorageManager.getBookmarks(); items = this.getDestinations().filter(s => b.includes(s.id)); }
    else {
      items = this.getCurated();
      if (f !== 'all') items = items.filter(s => s.mood === f);
    }
    return NavigationAlgorithms.greedyBestFirstSearch(this.currentPosition, items);
  }

  emptyHint() {
    if (this.activeFilter === 'log') return ' yet. Tap ＋ Log to drop your first pin.';
    if (this.activeFilter === 'discover') return ': no named hidden places found in range. Pan the map and tap ↻ Scan map centre.';
    return '.';
  }

  /* ---------------- Render ---------------- */
  renderAll() {
    const items = this.getVisibleItems();
    const dests = items.filter(i => i.kind === undefined || i.kind === 'destination');
    this.nearest = dests[0] || null;
    $('spot-count').textContent = items.length;
    this.renderCards(items);
    this.renderMarkers(items);
    this.updateCompass();
    if (!this.nearest) {
      $('compass-dist').textContent = '--'; $('compass-bearing').textContent = '--'; $('compass-name').textContent = 'No spots';
    }
  }

  solitudeHtml(spot) {
    if (typeof spot.solitude !== 'number') return '';
    const q = quietInfo(spot.solitude);
    return `<div class="solitude" title="Solitude score">
      <span style="color:${q.color}" class="font-semibold whitespace-nowrap">${q.icon} ${q.label}</span>
      <span class="solitude-bar"><i style="width:${spot.solitude}%;background:${q.color};box-shadow:0 0 6px ${q.color}"></i></span>
      <span class="text-slate-300 font-bold">${spot.solitude}</span></div>`;
  }

  terrainTags(spot) {
    const a = ACCESS_TYPES[spot.access];
    const parts = [];
    if (spot.isOsm) {
      parts.push(`<span class="tag tag--osm">${spot.icon} ${esc(spot.category)}</span>`);
      if (spot.offRadar) parts.push('<span class="tag tag--osm" title="No Wikipedia/Wikidata/website tag on OpenStreetMap (a heuristic, not proof)">🕵️ Off the tourist radar</span>');
    }
    if (a) parts.push(`<span class="tag tag--access">${a.icon} ${a.label}</span>`);
    (spot.cautions || []).forEach(c => { if (CAUTIONS[c]) parts.push(`<span class="tag tag--warn">${CAUTIONS[c].icon} ${CAUTIONS[c].label}</span>`); });
    return parts.join('');
  }

  difficultyOf(spot) {
    if (spot.difficulty) return spot.difficulty;
    if (typeof spot.terrain !== 'number') return null;
    return spot.terrain <= 2 ? 'easy' : (spot.terrain === 3 ? 'moderate' : 'hard');
  }

  renderCards(items) {
    const box = $('spots-list');
    box.innerHTML = '';
    if (!items.length) {
      box.innerHTML = `<p class="text-xs text-slate-500 py-6 px-2">No spots match this filter${this.emptyHint()}</p>`;
      return;
    }
    items.forEach((s, idx) => {
      const isDest = !s.kind || s.kind === 'destination';
      const kindMeta = KIND_META[s.kind || 'destination'];
      const diff = this.difficultyOf(s);
      const diffLabel = { easy: '🟢 Easy', moderate: '🟡 Moderate', hard: '🔴 Hard' }[diff];
      const saved = LocalStorageManager.isBookmarked(s.id);
      const card = document.createElement('div');
      card.className = 'spot-card' + (isDest && this.nearest && s.id === this.nearest.id ? ' is-nearest' : '');
      card.innerHTML = `
        <div class="space-y-2">
          <div class="flex justify-between items-start gap-2">
            <div class="min-w-0">
              <h4 class="font-semibold text-sm text-slate-100 leading-tight">${esc(s.name)}</h4>
              <p class="text-[10px] text-emerald-400 font-medium">${esc(s.city || (s.isLog ? 'Field Log' : 'India'))}</p>
            </div>
            ${isDest ? `<button class="bookmark-btn text-sm text-slate-400 hover:text-amber-400">${saved ? '⭐' : '☆'}</button>` : `<span class="tag tag--log">${kindMeta.icon} ${kindMeta.label}</span>`}
          </div>
          ${s.description ? `<p class="text-[11px] text-slate-400 line-clamp-2">${esc(s.description)}</p>` : ''}
          ${this.solitudeHtml(s)}
          ${s.isOsm ? '<p class="text-[10px] text-teal-300">🔭 Unrated · visit it, then log the real solitude</p>' : ''}
          ${s.bestWindow ? `<p class="text-[10px] text-slate-300">🕕 <span class="text-slate-400">${esc(s.bestWindow)}</span></p>` : ''}
          ${isDest ? this.sunHtml(s) : ''}
          <div class="flex flex-wrap gap-1">
            ${diff ? `<span class="tag tag--${diff}">${diffLabel}</span>` : ''}
            ${this.terrainTags(s)}
            ${s.isLog ? '<span class="tag tag--log">📓 Private</span>' : ''}
            ${isDest && this.isVisited(s.id) ? '<span class="tag tag--easy">✅ Stamped</span>' : ''}
          </div>
          ${s.notes ? `<p class="text-[10px] text-violet-300 line-clamp-2">📝 ${esc(s.notes)}</p>` : ''}
        </div>
        <div class="flex items-center justify-between text-[11px] pt-2 border-t border-slate-700/40">
          <span class="text-emerald-400 font-medium">◎ ${s.distance !== undefined ? s.distance.toFixed(1) + ' km · ' + NavigationAlgorithms.ring(s.distance) : '--'}</span>
          <span class="flex gap-1.5">
            ${s.isLog ? '<button class="del-btn hud-btn">🗑</button>' : ''}
            ${s.isOsm ? '<button class="osmlog-btn hud-btn">＋ Log</button>' : ''}
            ${isDest ? '<button class="route-btn hud-btn hud-btn--primary">Scout Route</button>' : ''}
          </span>
        </div>`;

      card.addEventListener('click', () => this.focusItem(s));
      const bm = card.querySelector('.bookmark-btn');
      if (bm) bm.addEventListener('click', e => { e.stopPropagation(); LocalStorageManager.toggleBookmark(s.id); this.renderAll(); });
      const rb = card.querySelector('.route-btn');
      if (rb) rb.addEventListener('click', e => { e.stopPropagation(); this.routeTo(s.id); });
      const ob = card.querySelector('.osmlog-btn');
      if (ob) ob.addEventListener('click', e => { e.stopPropagation(); this.logFromOsm(s.id); });
      const db = card.querySelector('.del-btn');
      if (db) db.addEventListener('click', e => { e.stopPropagation(); this.deleteLog(s.id); });
      box.appendChild(card);
    });
  }

  pinIcon(item, isNearest) {
    if (item.isOsm) {
      return L.divIcon({ className: '', html: `<div class="recon-pin recon-pin--small recon-pin--osm"><span>${item.icon}</span></div>`, iconSize: [26, 26], iconAnchor: [4, 26], popupAnchor: [10, -26] });
    }
    const kind = item.kind || 'destination';
    if (kind !== 'destination') {
      return L.divIcon({ className: '', html: `<div class="recon-pin recon-pin--small"><span>${KIND_META[kind].icon}</span></div>`, iconSize: [26, 26], iconAnchor: [4, 26], popupAnchor: [10, -26] });
    }
    const cls = item.isLog ? 'log' : item.mood;
    const icon = item.isLog ? '📓' : (MOODS[item.mood]?.icon || '📍');
    return L.divIcon({ className: '', html: `<div class="recon-pin recon-pin--${cls}${isNearest ? ' recon-pin--nearest' : ''}"><span>${icon}</span></div>`, iconSize: [34, 34], iconAnchor: [6, 34], popupAnchor: [12, -34] });
  }

  popupHtml(s) {
    const isDest = !s.kind || s.kind === 'destination';
    const m = MOODS[s.mood];
    return `<div class="space-y-1.5" style="max-width:250px">
      <div class="font-bold text-sm text-slate-100">${esc(s.name)}</div>
      <div class="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">${isDest ? (m ? m.icon + ' ' + m.label : '') : KIND_META[s.kind].icon + ' ' + KIND_META[s.kind].label} · ${esc(s.city || 'Field Log')}</div>
      ${s.description ? `<div class="text-[11px] text-slate-300">${esc(s.description)}</div>` : ''}
      ${this.solitudeHtml(s)}
      ${s.bestWindow ? `<div class="text-[10px] text-slate-400">🕕 ${esc(s.bestWindow)}</div>` : ''}
      <div class="flex flex-wrap gap-1">${this.terrainTags(s)}</div>
      ${s.notes ? `<div class="text-[10px] text-violet-300">📝 ${esc(s.notes)}</div>` : ''}
      <div class="text-[10px] text-slate-500">${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</div>
      ${isDest ? this.sunHtml(s) : ''}
      <div class="flex gap-1.5">
        ${isDest ? `<button class="hud-btn hud-btn--primary" onclick="app.routeTo('${esc(s.id)}')">Scout Route</button>` : ''}
        ${s.isOsm ? `<button class="hud-btn" onclick="app.logFromOsm('${esc(s.id)}')">＋ Log</button>` : ''}
        <button class="hud-btn" onclick="app.shareSpot('${esc(s.id)}')">Share</button>
      </div>
      ${s.isOsm ? `<a href="${esc(s.osmUrl)}" target="_blank" rel="noopener" class="text-[10px] text-teal-300 hover:underline">View on OpenStreetMap ↗</a>` : ''}
    </div>`;
  }

  renderMarkers(items) {
    this.spotLayer.clearLayers();
    this.markers = {};
    const shownEntryIds = new Set();

    items.forEach(s => {
      const isNearest = this.nearest && s.id === this.nearest.id;
      const m = L.marker([s.lat, s.lng], { icon: this.pinIcon(s, isNearest) }).bindPopup(this.popupHtml(s));
      m.addTo(this.spotLayer);
      this.markers[s.id] = m;

      if (!s.kind || s.kind === 'destination') {
        this.getEntriesFor(s).forEach(en => {
          if (shownEntryIds.has(en.id)) return;
          shownEntryIds.add(en.id);
          L.polyline([[en.lat, en.lng], [s.lat, s.lng]], { color: '#38bdf8', weight: 2, dashArray: '2 6', opacity: .8 }).addTo(this.spotLayer);
          if (!this.markers[en.id]) {
            const em = L.marker([en.lat, en.lng], { icon: this.pinIcon(en) }).bindPopup(this.popupHtml({ ...en, city: s.name }));
            em.addTo(this.spotLayer);
            this.markers[en.id] = em;
          }
        });
      }
    });
  }

  focusItem(s) {
    this.map.flyTo([s.lat, s.lng], Math.max(this.map.getZoom(), 13), { duration: .8 });
    const m = this.markers[s.id];
    if (m) setTimeout(() => m.openPopup(), 850);
    if (this.drawerState === 'expanded') this.setDrawer('open');
  }

  /* ---------------- Routing ---------------- */
  routeTo(id) {
    const spot = this.getDestinations().find(s => s.id === id);
    if (!spot) return;
    const entries = this.getEntriesFor(spot);
    const plan = NavigationAlgorithms.planRoute(this.currentPosition, spot, entries);
    this.lastRoute = plan;
    this.routeLayer.clearLayers();

    plan.legs.forEach(leg => {
      L.polyline([[leg.from.lat, leg.from.lng], [leg.to.lat, leg.to.lng]],
        leg.mode === 'foot'
          ? { color: '#f59e0b', weight: 4, dashArray: '2 8', lineCap: 'round' }
          : { color: '#10b981', weight: 4, dashArray: '10 8' }).addTo(this.routeLayer);
    });
    const bounds = L.latLngBounds(plan.path);
    this.map.closePopup();
    this.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });

    $('route-card').classList.remove('hidden');
    $('route-dist').textContent = `${plan.distance.toFixed(1)} km`;
    $('route-nodes').textContent = plan.nodesEvaluated;
    $('route-directions').innerHTML = plan.directions.map((d, i) =>
      `<div class="flex gap-1.5"><span class="text-emerald-400 font-bold">${i + 1}.</span><span>${esc(d)}</span></div>`).join('');
    const dest = entries.length ? plan.path[1] : plan.path[plan.path.length - 1];
    $('route-external').href = `https://www.google.com/maps/dir/?api=1&destination=${dest[0]},${dest[1]}`;
    this.target = {
      kind: 'route', idx: 0,
      points: plan.legs.map(leg => ({
        lat: leg.to.lat, lng: leg.to.lng, final: leg.to.id === 'goal',
        name: leg.to.id === 'goal' ? spot.name : (leg.to.ref ? leg.to.ref.name : 'Waypoint')
      }))
    };
    this.updateCompass();
    this.routeIntel(spot, plan);
    this.setDrawer('collapsed');
  }

  clearRoute() {
    this.routeLayer.clearLayers();
    $('route-card').classList.add('hidden');
    this.target = null;
    this.updateCompass();
  }

  /* ---------------- Radar ---------------- */
  setRadar(on, silent) {
    this.settings = LocalStorageManager.updateSettings({ radar: !!on });
    $('radar-toggle').classList.toggle('is-on', !!on);
    if (on) this.drawRadar(); else this.radarLayer.clearLayers();
    if (!silent) {
      let text = on ? 'Radar mode: rings at 5 / 15 / 30 km' : 'Radar mode off';
      if (on) { const r = Passport.award('radar'); text = this.awardText(text, r); this.refreshXpChip(); }
      this.toast(text);
    }
  }

  drawRadar() {
    this.radarLayer.clearLayers();
    const { lat, lng } = this.currentPosition;
    const names = ['5 KM', '15 KM', '30 KM'];
    RADAR_RINGS.forEach((km, i) => {
      L.circle([lat, lng], {
        radius: km * 1000, color: '#10b981', weight: 1.5, opacity: .85 - i * .15,
        fillColor: '#10b981', fillOpacity: .04, dashArray: '6 8', className: 'radar-ring', interactive: false
      }).addTo(this.radarLayer);
      L.marker([lat + km / 111.32, lng], {
        icon: L.divIcon({ className: '', html: `<div class="radar-label">${names[i]}</div>`, iconSize: [50, 14], iconAnchor: [25, 7] }),
        interactive: false
      }).addTo(this.radarLayer);
    });
    // rotating sweep, sized to the inner ring in pixels
    const px = this.metersToPixels(RADAR_RINGS[0] * 1000);
    const size = Math.max(60, Math.min(px * 2, 900));
    L.marker([lat, lng], {
      icon: L.divIcon({ className: 'radar-sweep-wrap', html: '<div class="radar-sweep"></div>', iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
      interactive: false, zIndexOffset: -500
    }).addTo(this.radarLayer);
  }

  metersToPixels(m) {
    const { lat, lng } = this.currentPosition;
    const p1 = this.map.latLngToContainerPoint([lat, lng]);
    const p2 = this.map.latLngToContainerPoint([lat, lng + m / (111320 * Math.cos(lat * Math.PI / 180))]);
    return Math.abs(p2.x - p1.x);
  }

  /* ---------------- Field log ---------------- */
  buildLogFormOptions() {
    $('log-access').innerHTML = Object.entries(ACCESS_TYPES).map(([k, v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join('');
    $('log-cautions').innerHTML = Object.entries(CAUTIONS).map(([k, v]) =>
      `<button type="button" class="caution-opt" data-c="${k}">${v.icon} ${v.label}</button>`).join('');
    $('log-cautions').querySelectorAll('.caution-opt').forEach(b => b.addEventListener('click', () => b.classList.toggle('on')));
  }

  openLogModal(prefill) {
    $('log-parent').innerHTML = '<option value="">— none (standalone pin) —</option>' +
      this.getDestinations().map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
    if (prefill) {
      document.querySelector('input[name="log-kind"][value="destination"]').checked = true;
      $('log-name').value = prefill.name; $('log-mood').value = prefill.mood;
      $('log-lat').value = prefill.lat.toFixed(6); $('log-lng').value = prefill.lng.toFixed(6);
      $('log-notes').value = prefill.notes || '';
    }
    this.syncKindFields();
    $('log-modal').classList.remove('hidden');
    if (!$('log-lat').value && this.hasFix) this.fillGps();
  }

  syncKindFields() {
    const kind = document.querySelector('input[name="log-kind"]:checked').value;
    const dest = kind === 'destination';
    document.querySelectorAll('[data-dest-only]').forEach(el => el.classList.toggle('hidden', !dest));
    $('log-parent-wrap').classList.toggle('hidden', dest);
  }

  fillGps() {
    $('log-lat').value = this.currentPosition.lat.toFixed(6);
    $('log-lng').value = this.currentPosition.lng.toFixed(6);
    if (!this.hasFix) this.toast('No GPS fix yet, using default centre');
  }

  submitLog(e) {
    e.preventDefault();
    const kind = document.querySelector('input[name="log-kind"]:checked').value;
    const lat = parseFloat($('log-lat').value), lng = parseFloat($('log-lng').value);
    if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { this.toast('Enter valid coordinates'); return; }
    const entry = {
      id: `log-${Date.now()}`,
      isLog: true, kind,
      name: $('log-name').value.trim(),
      city: 'Field Log',
      lat, lng,
      access: $('log-access').value,
      terrain: parseInt($('log-terrain').value, 10),
      cautions: [...$('log-cautions').querySelectorAll('.caution-opt.on')].map(b => b.dataset.c),
      notes: $('log-notes').value.trim(),
      createdAt: new Date().toISOString()
    };
    if (kind === 'destination') {
      entry.mood = $('log-mood').value;
      entry.solitude = parseInt($('log-quiet').value, 10);
      entry.bestWindow = $('log-window').value.trim();
      entry.description = entry.notes ? '' : 'Private field log pin.';
    } else {
      entry.parentId = $('log-parent').value || null;
    }
    if (!LocalStorageManager.saveLogEntry(entry)) { this.toast('Could not save (storage full or blocked)'); return; }
    $('log-modal').classList.add('hidden');
    $('log-form').reset();
    $('log-cautions').querySelectorAll('.on').forEach(b => b.classList.remove('on'));
    const award = Passport.award('log', { kind });
    this.toast(this.awardText('Saved to Field Log', award));
    this.refreshXpChip();
    this.renderAll();
  }

  deleteLog(id) {
    if (!confirm('Delete this field log entry?')) return;
    LocalStorageManager.deleteLogEntry(id);
    this.renderAll();
  }

  /* ---------------- Map styles, clean mode, route intelligence ---------------- */
  setMapStyle(key, announce) {
    const k = MAP_STYLES[key] ? key : 'dark', st = MAP_STYLES[k];
    if (this.baseLayer) this.map.removeLayer(this.baseLayer);
    this.baseLayer = L.tileLayer(st.url, { attribution: st.attr, maxZoom: st.max }).addTo(this.map);
    this.baseLayer.bringToBack();
    $('map').classList.toggle('style-dark', k === 'dark');
    this.mapStyle = k;
    LocalStorageManager.updateSettings({ mapStyle: k });
    if (announce) this.toast('🗺️ ' + st.name);
  }

  cycleStyle() {
    const keys = Object.keys(MAP_STYLES);
    this.setMapStyle(keys[(keys.indexOf(this.mapStyle) + 1) % keys.length], true);
  }

  toggleClean() {
    const on = document.body.classList.toggle('clean');
    if (on) document.documentElement.style.setProperty('--drawer-h', '0px'); else this.setDrawer(this.drawerState);
    $('clean-btn').textContent = on ? '◱' : '⛶';
  }

  routeIntel(spot, plan) {
    const walkKmh = { easy: 4, moderate: 3.2, hard: 2.4 }[this.difficultyOf(spot)] || 3.2;
    let drive = 0, walk = 0;
    plan.legs.forEach(l => {
      const foot = l.mode === 'foot' || spot.access === 'footpath';
      if (foot) walk += l.km / walkKmh; else drive += l.km / 35;
    });
    const hrs = drive + walk;
    const fmt = h => h >= 1 ? `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m` : `${Math.max(1, Math.round(h * 60))} min`;
    $('route-eta').textContent = fmt(hrs);
    const arrive = new Date(Date.now() + hrs * 3600000);
    const sun = NavigationAlgorithms.sunTimes(new Date(), spot.lat, spot.lng);
    let msg = '';
    if (sun.sunset) {
      if (arrive > sun.sunset) msg = `<div class="text-rose-400">⚠️ You'd arrive ${this.fmtTime(arrive)}, after sunset (${this.fmtTime(sun.sunset)}). Carry a torch or go tomorrow.</div>`;
      else { const spare = Math.round((sun.sunset - arrive) / 60000); msg = `<div class="${spare < 60 ? 'text-amber-400' : 'text-emerald-400'}">🌇 Arrive ~${this.fmtTime(arrive)} · ${spare} min of daylight to spare</div>`; }
    }
    $('route-daylight').innerHTML = `${msg}<div class="text-slate-400">${drive ? '🚗 ' + fmt(drive) + ' ' : ''}${walk ? '🥾 ' + fmt(walk) : ''}</div><div id="route-weather" class="text-slate-400">Checking live conditions…</div>`;
    this.fetchConditions(spot);
  }

  async fetchConditions(spot) {
    this._wxFor = spot.id;
    const show = t => { const el = $('route-weather'); if (el && this._wxFor === spot.id) el.textContent = t; };
    try {
      this._wx = this._wx || {};
      let w = this._wx[spot.id];
      if (!w || Date.now() - w.t > 1800000) {
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${spot.lat}&longitude=${spot.lng}&current=temperature_2m,wind_speed_10m&daily=precipitation_probability_max&timezone=auto&forecast_days=1`);
        if (!r.ok) throw new Error('http');
        const j = await r.json();
        w = { t: Date.now(), temp: j.current.temperature_2m, wind: j.current.wind_speed_10m, rain: j.daily.precipitation_probability_max[0], elev: j.elevation };
        this._wx[spot.id] = w;
      }
      const mud = (spot.cautions || []).includes('mud');
      const verdict = w.rain >= 60 ? (mud ? '⛔ Skip: heavy rain chance on a muddy trail' : '⚠️ Rain likely, carry cover') : (w.rain >= 30 ? '🌦 Possible showers' : '✅ Good conditions');
      show(`${verdict} · ${Math.round(w.temp)}°C · ${w.rain}% rain · wind ${Math.round(w.wind)} km/h · ⛰️ ${Math.round(w.elev)} m`);
    } catch (e) { show('Live conditions unavailable (offline?).'); }
  }

  /* ---------------- Discover: hidden places from OpenStreetMap ---------------- */
  osmCategory(t) {
    if (t.waterway === 'waterfall') return 'waterfall';
    if (t.tourism === 'viewpoint') return 'viewpoint';
    if (['peak', 'cave_entrance', 'spring', 'hot_spring', 'beach'].includes(t.natural)) return t.natural;
    if (['fort', 'castle', 'ruins', 'archaeological_site'].includes(t.historic)) return t.historic === 'castle' ? 'fort' : t.historic;
    if (t.tourism === 'picnic_site') return 'picnic_site';
    return null;
  }

  osmFromElement(el) {
    const t = el.tags || {};
    const name = t['name:en'] || t.name;
    const lat = el.lat !== undefined ? el.lat : (el.center && el.center.lat);
    const lng = el.lon !== undefined ? el.lon : (el.center && el.center.lon);
    const cat = this.osmCategory(t);
    if (!name || !cat || lat === undefined || lng === undefined) return null;
    const meta = OSM_CATS[cat];
    return {
      id: `osm-${el.type}-${el.id}`, isOsm: true, name, lat, lng,
      city: t['addr:city'] || 'OpenStreetMap', mood: meta.mood, icon: meta.icon, category: meta.label, cautions: [],
      offRadar: !(t.wikipedia || t.wikidata || t.website || t['contact:website']),
      description: (t.description || `${meta.label} tagged on OpenStreetMap.`).slice(0, 140),
      osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`
    };
  }

  async fetchOsm(c) {
    const key = `${c.lat.toFixed(1)},${c.lng.toFixed(1)}`;
    const cached = LocalStorageManager.getOsmCache(key);
    if (cached && Date.now() - cached.t < 7 * 86400000) return cached.items;

    const R = Math.round(RADAR_RINGS[RADAR_RINGS.length - 1] * 1000);
    const ar = `(around:${R},${c.lat},${c.lng})`;
    const q = `[out:json][timeout:25];(` +
      `nwr["waterway"="waterfall"]["name"]${ar};` +
      `nwr["tourism"~"^(viewpoint|picnic_site)$"]["name"]${ar};` +
      `nwr["natural"~"^(peak|cave_entrance|spring|hot_spring|beach)$"]["name"]${ar};` +
      `nwr["historic"~"^(fort|castle|ruins|archaeological_site)$"]["name"]${ar};` +
      `);out center 300;`;
    let lastErr;
    for (const url of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 30000);
        const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const seen = new Set();
        const items = (data.elements || []).map(e => this.osmFromElement(e)).filter(Boolean).filter(i => {
          const k = `${i.name}|${i.lat.toFixed(3)}|${i.lng.toFixed(3)}`;
          if (seen.has(k)) return false; seen.add(k); return true;
        }).map(i => ({ ...i, _d: NavigationAlgorithms.haversineDistance(c.lat, c.lng, i.lat, i.lng) }))
          .sort((a, b) => a._d - b._d).slice(0, 150).map(({ _d, ...rest }) => rest);
        LocalStorageManager.setOsmCache(key, items);
        return items;
      } catch (e) { lastErr = e; }
    }
    if (cached) return cached.items;   // stale is better than nothing
    throw lastErr;
  }

  async discover(center) {
    const c = center ? { lat: center.lat, lng: center.lng } : (this.hasFix ? this.currentPosition : this.map.getCenter());
    this.toast('🔭 Scanning OpenStreetMap within 30 km…');
    try {
      this.osmItems = await this.fetchOsm({ lat: c.lat, lng: c.lng });
      if (this.osmItems.length) {
        const r = Passport.award('discover');
        this.toast(this.awardText(`🔭 Found ${this.osmItems.length} named places`, r));
        this.refreshXpChip();
      } else this.toast('No named hidden places found here');
    } catch (e) {
      this.toast('Could not reach OpenStreetMap. Check your connection.');
    }
    this.renderAll();
  }

  logFromOsm(id) {
    const o = this.osmItems.find(x => x.id === id);
    if (!o) return;
    this.map.closePopup();
    this.openLogModal({ name: o.name, mood: o.mood, lat: o.lat, lng: o.lng, notes: `Found via OpenStreetMap (${o.category}). ` });
  }

  /* ---------------- Trail tracker: breadcrumbs, backtrack, GPX ---------------- */
  onFix(coords) {
    this.addTrackPoint(coords);
    this.advanceTarget();
  }

  advanceTarget() {
    const t = this.target;
    if (!t) return;
    const w = t.points[t.idx];
    const { lat, lng } = this.currentPosition;
    const m = NavigationAlgorithms.haversineDistance(lat, lng, w.lat, w.lng) * 1000;
    const threshold = t.kind === 'backtrack' ? 30 : (w.final ? 40 : 100);
    if (m > threshold) return;
    if (t.idx >= t.points.length - 1) {
      this.toast(t.kind === 'backtrack' ? '↩ Back at your start point' : `🎯 Arrived: ${w.name}`);
      if (t.kind === 'backtrack') this.routeLayer.clearLayers();
      this.target = null;
    } else {
      this.toast(`Waypoint reached: ${w.name}`);
      t.idx++;
    }
    this.updateCompass();
  }

  async requestWakeLock() {
    try { if ('wakeLock' in navigator) this.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  }

  fmtDuration(ms) {
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    const pad = n => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
  }

  startTracking() {
    if (this.tracking) return;
    if (!this.hasFix) { this.toast('Waiting for a GPS fix first'); return; }
    const now = Date.now();
    const label = new Date(now).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    this.tracking = { id: `trk-${now}`, name: `Trail ${label}`, start: now, distance: 0,
      points: [[+this.currentPosition.lat.toFixed(6), +this.currentPosition.lng.toFixed(6), now]] };
    LocalStorageManager.setActiveTrack(this.tracking);
    this.trackLayer.clearLayers();
    this.startTrackUi();
    this.toast('👣 Recording trail. Keep this screen on.');
  }

  startTrackUi() {
    $('tracker-hud').classList.remove('hidden');
    $('track-btn').classList.add('is-on');
    this.requestWakeLock();
    clearInterval(this.trackTimer);
    this.trackTimer = setInterval(() => this.updateTrackHud(), 1000);
    this.drawTrackLine(this.tracking.points);
    this.updateTrackHud();
  }

  resumeTracking() {
    const t = LocalStorageManager.getActiveTrack();
    if (!t || !Array.isArray(t.points) || Date.now() - t.start > 12 * 3600000) { LocalStorageManager.clearActiveTrack(); return; }
    this.tracking = t;
    this.startTrackUi();
    this.toast('👣 Resumed trail recording');
  }

  addTrackPoint(c) {
    const t = this.tracking;
    if (!t) return;
    if (c.accuracy && c.accuracy > 50) return;
    const last = t.points[t.points.length - 1], now = Date.now();
    const d = NavigationAlgorithms.haversineDistance(last[0], last[1], c.latitude, c.longitude);
    if (d * 1000 < 10) return;
    if ((d * 1000) / Math.max(1, (now - last[2]) / 1000) > 50) return;   // GPS jump (> 50 m/s)
    t.points.push([+c.latitude.toFixed(6), +c.longitude.toFixed(6), now]);
    t.distance += d;
    if (t.points.length >= 4000) { this.stopTracking(); this.toast('Track limit reached and saved'); return; }
    if (t.points.length % 5 === 0) LocalStorageManager.setActiveTrack(t);
    this.drawTrackLine(t.points);
    this.updateTrackHud();
  }

  drawTrackLine(points) {
    this.trackLayer.clearLayers();
    if (!points || points.length < 2) return;
    const ll = points.map(p => [p[0], p[1]]);
    L.polyline(ll, { color: '#22d3ee', weight: 9, opacity: .18, interactive: false }).addTo(this.trackLayer);
    L.polyline(ll, { color: '#67e8f9', weight: 3, className: 'track-glow', interactive: false }).addTo(this.trackLayer);
    L.circleMarker(ll[0], { radius: 5, color: '#22d3ee', fillColor: '#020617', fillOpacity: 1, weight: 2, interactive: false }).addTo(this.trackLayer);
  }

  updateTrackHud() {
    const t = this.tracking;
    if (!t) return;
    const ms = Date.now() - t.start;
    const kmh = ms > 5000 ? t.distance / (ms / 3600000) : 0;
    $('trk-dist').textContent = `${t.distance.toFixed(2)} km`;
    $('trk-meta').textContent = `${this.fmtDuration(ms)} · ${kmh.toFixed(1)} km/h`;
  }

  stopTracking() {
    const t = this.tracking;
    if (!t) return;
    clearInterval(this.trackTimer);
    try { if (this.wakeLock) this.wakeLock.release(); } catch (e) {}
    this.wakeLock = null;
    this.tracking = null;
    LocalStorageManager.clearActiveTrack();
    $('tracker-hud').classList.add('hidden');
    $('track-btn').classList.remove('is-on');
    if (t.points.length < 2 || t.distance < 0.02) { this.trackLayer.clearLayers(); this.toast('Trail too short, discarded'); return; }
    t.end = Date.now();
    LocalStorageManager.saveTrack(t);
    const r = Passport.award('track', { km: t.distance });
    this.toast(this.awardText(`👣 Saved ${t.distance.toFixed(2)} km trail`, r));
    this.refreshXpChip();
  }

  /** Breadcrumb retrace: compass-guides you back along your own path. Works with no signal. */
  backtrack(points) {
    if (!points || points.length < 2) { this.toast('Not enough trail to retrace yet'); return; }
    const crumbs = [points[0]];
    points.forEach(p => {
      const l = crumbs[crumbs.length - 1];
      if (NavigationAlgorithms.haversineDistance(l[0], l[1], p[0], p[1]) * 1000 >= 80) crumbs.push(p);
    });
    const lastP = points[points.length - 1];
    if (crumbs[crumbs.length - 1] !== lastP) crumbs.push(lastP);

    const { lat, lng } = this.currentPosition;
    let ni = 0, nd = Infinity;
    crumbs.forEach((c, i) => {
      const d = NavigationAlgorithms.haversineDistance(lat, lng, c[0], c[1]);
      if (d < nd) { nd = d; ni = i; }
    });
    const seq = crumbs.slice(0, ni + 1).reverse();
    // drop crumbs you are already standing on
    while (seq.length > 1 && NavigationAlgorithms.haversineDistance(lat, lng, seq[0][0], seq[0][1]) * 1000 < 30) seq.shift();
    if (seq.length < 1 || (seq.length === 1 && nd * 1000 < 30)) { this.toast('You are already at the start of this trail'); return; }
    this.target = {
      kind: 'backtrack', idx: 0,
      points: seq.map((c, i) => ({ lat: c[0], lng: c[1], name: i === seq.length - 1 ? 'Start' : `Crumb ${i + 1}/${seq.length}` }))
    };
    this.routeLayer.clearLayers();
    L.polyline([[lat, lng], ...seq.map(c => [c[0], c[1]])], { color: '#f59e0b', weight: 3, dashArray: '4 8' }).addTo(this.routeLayer);
    this.updateCompass();
    this.toast('↩ Backtrack armed. Follow the compass ring to your start.');
  }

  showTrack(t) {
    this.trackLayer.clearLayers();
    this.drawTrackLine(t.points);
    this.map.fitBounds(L.latLngBounds(t.points.map(p => [p[0], p[1]])), { padding: [50, 50] });
  }

  renderTrackList() {
    const list = LocalStorageManager.getTracks();
    $('pf-track-count').textContent = list.length;
    $('pf-tracks').innerHTML = list.length ? list.map(t => `
      <div class="flex items-center gap-2 text-[11px] bg-slate-900/70 border border-slate-800 rounded-lg px-2 py-1.5">
        <div class="flex-1 min-w-0"><div class="truncate text-slate-200">${esc(t.name)}</div>
          <div class="text-slate-500">${t.distance.toFixed(2)} km · ${this.fmtDuration((t.end || t.start) - t.start)}</div></div>
        <button class="hud-btn" data-act="show" data-id="${esc(t.id)}">Show</button>
        <button class="hud-btn" data-act="retrace" data-id="${esc(t.id)}">↩</button>
        <button class="hud-btn" data-act="gpx" data-id="${esc(t.id)}">GPX</button>
        <button class="hud-btn" data-act="del" data-id="${esc(t.id)}">🗑</button>
      </div>`).join('') : '<span class="text-[11px] text-slate-500">No trails recorded yet.</span>';
  }

  exportGpx(t) {
    const pts = t.points.map(p => `<trkpt lat="${p[0]}" lon="${p[1]}"><time>${new Date(p[2]).toISOString()}</time></trkpt>`).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Secret Spots" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(t.name)}</name><trkseg>${pts}</trkseg></trk></gpx>`;
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/gpx+xml' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${t.id}.gpx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------------- Passport, sun, share ---------------- */
  isVisited(id) { return !!LocalStorageManager.getPassport().visits[id]; }

  fmtTime(d) { return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '--'; }

  sunHtml(s) {
    const t = NavigationAlgorithms.sunTimes(new Date(), s.lat, s.lng);
    const moon = NavigationAlgorithms.moonIllumination(new Date());
    const stars = moon < 25 && s.solitude >= 70 ? ' <span class="text-indigo-300">⭐ stargazing night</span>' : '';
    return `<p class="text-[10px] text-slate-400">🌅 ${this.fmtTime(t.sunrise)} · 🌇 ${this.fmtTime(t.sunset)} · 🌙 ${moon}%${stars}</p>`;
  }

  awardText(base, r) {
    let t = base;
    if (r && r.gain) t += ` · +${r.gain} XP`;
    if (r && r.badges && r.badges.length) t += ` · 🏅 ${r.badges.map(b => b.name).join(', ')}`;
    return t;
  }

  checkProximity() {
    if (!this.hasFix) return;
    const { lat, lng } = this.currentPosition;
    this.getDestinations().forEach(s => {
      if (this.isVisited(s.id)) return;
      if (NavigationAlgorithms.haversineDistance(lat, lng, s.lat, s.lng) <= 0.25) {
        const r = Passport.award('checkin', s);
        this.toast(this.awardText(`📍 Stamped: ${s.name}`, r));
        this.refreshXpChip();
        this.renderAll();
      }
    });
  }

  openProfile() {
    const u = this.session, p = LocalStorageManager.getPassport(), r = Passport.rank(p.xp);
    $('pf-avatar').innerHTML = this.avatarHtml();
    $('pf-name').textContent = u.name;
    $('pf-meta').textContent = u.provider === 'google' ? `Google · ${u.email}` : (u.provider === 'email' ? `Email · ${u.email}` : 'Guest · data stays on this device');
    $('pf-rank').textContent = `${r.cur.icon} ${r.cur.name}`;
    $('pf-xp').textContent = `${p.xp} XP`;
    $('pf-bar').style.width = r.pct + '%';
    $('pf-next').textContent = r.next ? `${r.next.min - p.xp} XP to ${r.next.icon} ${r.next.name}` : 'Top rank reached';
    $('pf-badges').innerHTML = Passport.BADGES.map(b =>
      `<div class="badge-tile ${p.badges.includes(b.id) ? 'on' : ''}" title="${esc(b.desc)}"><div class="ic">${b.icon}</div><div class="nm">${esc(b.name)}</div></div>`).join('');
    const dests = this.getDestinations();
    const stamped = Object.keys(p.visits).map(id => dests.find(d => d.id === id)).filter(Boolean);
    $('pf-stamp-count').textContent = stamped.length;
    $('pf-stamps').innerHTML = stamped.length
      ? stamped.map(d => `<span class="tag tag--easy">✅ ${esc(d.name)}</span>`).join('')
      : '<span class="text-[11px] text-slate-500">No stamps yet. Visit a spot with GPS on.</span>';
    this.renderTrackList();
    $('profile-modal').classList.remove('hidden');
  }

  mapsLink(lat, lng) { return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`; }

  async shareText(text, title) {
    try {
      if (navigator.share) { await navigator.share({ title, text }); return; }
      await navigator.clipboard.writeText(text);
      this.toast('Copied to clipboard');
    } catch (e) { if (e && e.name !== 'AbortError') this.toast('Could not share'); }
  }

  shareSpot(id) {
    const s = [...this.getDestinations(), ...this.getLog()].find(x => x.id === id);
    if (!s) return;
    const q = typeof s.solitude === 'number' ? ` · ${quietInfo(s.solitude).label} (${s.solitude})` : '';
    this.shareText(`📍 ${s.name}${q}\n${s.bestWindow ? '🕕 ' + s.bestWindow + '\n' : ''}${this.mapsLink(s.lat, s.lng)}`, s.name);
  }

  beaconText() {
    if (!this.hasFix) return null;
    const { lat, lng } = this.currentPosition;
    const back = $('sos-return').value, note = $('sos-note').value.trim();
    const near = this.nearest ? `Near: ${this.nearest.name} (${this.nearest.distance.toFixed(1)} km)\n` : '';
    return `🆘 Secret Spots safety check-in\n${this.session.name}\nMy location: ${this.mapsLink(lat, lng)}\n${near}` +
      `${back ? 'Expected back by: ' + back + '\n' : ''}${note ? 'Note: ' + note + '\n' : ''}Sent: ${new Date().toLocaleString()}`;
  }

  updateBeacon() {
    const t = this.beaconText();
    $('sos-preview').textContent = t || 'Waiting for a GPS fix… allow location access and try again.';
    $('sos-wa').href = t ? `https://wa.me/?text=${encodeURIComponent(t)}` : '#';
  }

  openBeacon() { this.updateBeacon(); $('sos-modal').classList.remove('hidden'); }

  shareBeacon() {
    const t = this.beaconText();
    if (!t) { this.toast('No GPS fix yet, location not available'); return; }
    this.shareText(t, 'Safety check-in');
  }

  exportData() {
    const data = {
      app: 'secret-spots', version: 1, exportedAt: new Date().toISOString(),
      log: this.getLog(), bookmarks: LocalStorageManager.getBookmarks(), passport: LocalStorageManager.getPassport()
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `secret-spots-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.toast('Backup downloaded');
  }

  async importData(file, input) {
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (d.app !== 'secret-spots' || !Array.isArray(d.log)) throw new Error('bad');
      const log = this.getLog(), ids = new Set(log.map(e => e.id));
      const fresh = d.log.filter(e => e && e.id && typeof e.lat === 'number' && typeof e.lng === 'number' && !ids.has(e.id));
      LocalStorageManager.replaceLog([...log, ...fresh.map(e => ({ ...e, isLog: true }))]);
      LocalStorageManager.setBookmarks([...new Set([...LocalStorageManager.getBookmarks(), ...(Array.isArray(d.bookmarks) ? d.bookmarks : [])])]);
      if (d.passport && typeof d.passport === 'object') {
        const a = LocalStorageManager.getPassport(), b = { ...LocalStorageManager.defaultPassport(), ...d.passport };
        const stats = {};
        Object.keys(a.stats).forEach(k => { stats[k] = typeof a.stats[k] === 'boolean' ? (a.stats[k] || !!(b.stats || {})[k]) : Math.max(a.stats[k], Number((b.stats || {})[k]) || 0); });
        LocalStorageManager.savePassport({
          xp: Math.max(a.xp, Number(b.xp) || 0), visits: { ...(b.visits || {}), ...a.visits },
          badges: [...new Set([...a.badges, ...(b.badges || [])])], stats
        });
      }
      this.toast(`Imported ${fresh.length} new log entries`);
      this.refreshXpChip(); this.renderAll(); this.openProfile();
    } catch (e) { this.toast('That file is not a valid Secret Spots backup'); }
    input.value = '';
  }

  /* ---------------- UI helpers ---------------- */
  setDrawer(state) {
    this.drawerState = state;
    $('drawer').dataset.state = state;
    const h = { collapsed: '64px', open: '250px', expanded: '72vh' }[state];
    document.documentElement.style.setProperty('--drawer-h', h);
    $('drawer-toggle').textContent = state === 'expanded' ? 'Collapse ▼' : 'Expand ▲';
  }

  cycleDrawer() {
    this.setDrawer({ collapsed: 'open', open: 'expanded', expanded: 'collapsed' }[this.drawerState]);
  }

  toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  initEventListeners() {
    document.querySelectorAll('.filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active-chip'));
        btn.classList.add('active-chip');
        this.activeFilter = btn.dataset.filter;
        $('scan-btn').classList.toggle('hidden', this.activeFilter !== 'discover');
        if (this.activeFilter === 'discover') this.discover();
        this.renderAll();
      });
    });

    $('recenter-btn').addEventListener('click', () => this.map.flyTo([this.currentPosition.lat, this.currentPosition.lng], 12));
    $('radar-toggle').addEventListener('click', () => this.setRadar(!this.settings.radar));
    this.map.on('zoomend', () => { if (this.settings.radar) this.drawRadar(); });

    $('compass-widget').addEventListener('click', async () => {
      await this.enableCompass();
      if (this.nearest) this.focusItem(this.nearest);
    });

    $('clear-route-btn').addEventListener('click', () => this.clearRoute());
    $('drawer-handle').addEventListener('click', () => this.cycleDrawer());
    $('drawer-toggle').addEventListener('click', () => this.setDrawer(this.drawerState === 'expanded' ? 'open' : 'expanded'));

    // Field log modal
    $('add-log-btn').addEventListener('click', () => this.openLogModal());
    const closeLog = () => $('log-modal').classList.add('hidden');
    $('close-log-btn').addEventListener('click', closeLog);
    $('cancel-log-btn').addEventListener('click', closeLog);
    $('log-use-gps').addEventListener('click', () => this.fillGps());
    $('log-pick-map').addEventListener('click', () => {
      closeLog();
      this.pickMode = true;
      document.body.classList.add('picking');
      this.setDrawer('collapsed');
      this.toast('Tap the map to drop the pin');
    });
    document.querySelectorAll('input[name="log-kind"]').forEach(r => r.addEventListener('change', () => this.syncKindFields()));
    $('log-form').addEventListener('submit', e => this.submitLog(e));

    // Profile / passport
    $('profile-btn').addEventListener('click', () => this.openProfile());
    $('close-profile-btn').addEventListener('click', () => $('profile-modal').classList.add('hidden'));
    $('logout-btn').addEventListener('click', () => { Auth.logout(); location.replace('login.html'); });
    $('export-btn').addEventListener('click', () => this.exportData());
    $('import-input').addEventListener('change', e => this.importData(e.target.files[0], e.target));

    // Safety beacon
    $('sos-btn').addEventListener('click', () => this.openBeacon());
    $('close-sos-btn').addEventListener('click', () => $('sos-modal').classList.add('hidden'));
    $('sos-return').addEventListener('input', () => this.updateBeacon());
    $('sos-note').addEventListener('input', () => this.updateBeacon());
    $('sos-share').addEventListener('click', () => this.shareBeacon());
    $('style-btn').addEventListener('click', () => this.cycleStyle());
    $('clean-btn').addEventListener('click', () => this.toggleClean());
    $('route-toggle').addEventListener('click', () => $('route-details').classList.toggle('hidden'));

    // Discovery & trail tracker
    $('scan-btn').addEventListener('click', () => this.discover(this.map.getCenter()));
    $('track-btn').addEventListener('click', () => (this.tracking ? this.stopTracking() : this.startTracking()));
    $('trk-stop').addEventListener('click', () => this.stopTracking());
    $('trk-back').addEventListener('click', () => this.tracking && this.backtrack(this.tracking.points));
    $('pf-tracks').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const t = LocalStorageManager.getTracks().find(x => x.id === b.dataset.id);
      if (!t) return;
      if (b.dataset.act === 'gpx') this.exportGpx(t);
      if (b.dataset.act === 'del') { LocalStorageManager.deleteTrack(t.id); this.renderTrackList(); }
      if (b.dataset.act === 'show') { $('profile-modal').classList.add('hidden'); this.showTrack(t); }
      if (b.dataset.act === 'retrace') { $('profile-modal').classList.add('hidden'); this.backtrack(t.points); }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.tracking) this.requestWakeLock(); });
  }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new SecretSpotsApp(); });
