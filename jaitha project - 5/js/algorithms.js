/**
 * Geo math + Greedy Best-First ranking + genuine A* over a tiny per-trip graph
 * (you -> entry/parking points -> destination). Costs are terrain-weighted
 * straight-line estimates, NOT road-network routing.
 */
class NavigationAlgorithms {

  static haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Initial bearing in degrees (0 = North, clockwise). */
  static bearing(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const y = Math.sin((lon2 - lon1) * rad) * Math.cos(lat2 * rad);
    const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) -
              Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon2 - lon1) * rad);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }

  static cardinal(deg) {
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
  }

  /** Radar ring band for a distance in km. */
  static ring(km) {
    const rings = window.RADAR_RINGS || [5, 15, 30];
    const names = ['INNER', 'MID', 'OUTER'];
    for (let i = 0; i < rings.length; i++) if (km <= rings[i]) return names[i];
    return 'FAR';
  }

  /** Greedy Best-First: rank by straight-line distance from the user. */
  static greedyBestFirstSearch(pos, items) {
    if (!pos) return items;
    return items
      .map(it => ({
        ...it,
        distance: this.haversineDistance(pos.lat, pos.lng, it.lat, it.lng),
        bearing: this.bearing(pos.lat, pos.lng, it.lat, it.lng)
      }))
      .sort((a, b) => a.distance - b.distance);
  }

  /** Generic A* on an adjacency map: { id: { lat, lng, edges: [{to, cost, mode}] } } */
  static aStar(graph, startId, goalId) {
    const h = id => this.haversineDistance(graph[id].lat, graph[id].lng, graph[goalId].lat, graph[goalId].lng);
    const open = new Set([startId]);
    const g = { [startId]: 0 }, f = { [startId]: h(startId) }, came = {};
    let evaluated = 0;
    while (open.size) {
      let cur = null;
      open.forEach(id => { if (cur === null || f[id] < f[cur]) cur = id; });
      evaluated++;
      if (cur === goalId) {
        const path = [cur];
        while (came[cur]) { cur = came[cur].from; path.unshift(cur); }
        return { path, cost: g[goalId], evaluated, came };
      }
      open.delete(cur);
      for (const e of graph[cur].edges) {
        const t = g[cur] + e.cost;
        if (g[e.to] === undefined || t < g[e.to]) {
          came[e.to] = { from: cur, mode: e.mode };
          g[e.to] = t;
          f[e.to] = t + h(e.to);
          open.add(e.to);
        }
      }
    }
    return null;
  }

  /**
   * Plan: you -> (best parking/entry point, if any) -> destination.
   * Entry points force the last stretch onto foot so the approach reflects real access.
   */
  static planRoute(start, spot, entries = []) {
    const access = (window.ACCESS_TYPES && window.ACCESS_TYPES[spot.access]) || { factor: 1.3, label: 'Mixed' };
    const D = (a, b) => this.haversineDistance(a.lat, a.lng, b.lat, b.lng);

    const graph = {
      start: { lat: start.lat, lng: start.lng, edges: [] },
      goal:  { lat: spot.lat,  lng: spot.lng,  edges: [] }
    };

    if (entries.length) {
      entries.forEach((en, i) => {
        const id = 'e' + i;
        graph[id] = { lat: en.lat, lng: en.lng, edges: [{ to: 'goal', cost: D(en, spot) * Math.max(1.3, access.factor), mode: 'foot' }], ref: en };
        graph.start.edges.push({ to: id, cost: D(start, en) * 1.15, mode: 'road' });
      });
    } else {
      graph.start.edges.push({ to: 'goal', cost: D(start, spot) * access.factor, mode: 'road' });
    }

    const res = this.aStar(graph, 'start', 'goal');
    const nodes = res.path.map(id => ({ id, lat: graph[id].lat, lng: graph[id].lng, ref: graph[id].ref }));
    const legs = [];
    for (let i = 1; i < res.path.length; i++) {
      const a = nodes[i - 1], b = nodes[i];
      const mode = res.came[res.path[i]].mode;
      const factor = mode === 'foot' ? Math.max(1.3, access.factor) : (entries.length ? 1.15 : access.factor);
      legs.push({ from: a, to: b, mode, km: D(a, b) * factor, bearing: this.bearing(a.lat, a.lng, b.lat, b.lng) });
    }

    const directions = legs.map((leg, i) => {
      const dir = this.cardinal(leg.bearing);
      const label = leg.to.id === 'goal' ? spot.name : (leg.to.ref ? leg.to.ref.name : 'waypoint');
      return leg.mode === 'foot'
        ? `Continue on foot ${dir} for ~${leg.km.toFixed(1)} km to ${label}.`
        : `Head ${dir} for ~${leg.km.toFixed(1)} km toward ${label}${i === 0 && spot.city ? ` (${spot.city} area)` : ''}.`;
    });
    if (spot.access) directions.push(`Access: ${access.label}. Check cautions before you commit.`);

    return {
      path: nodes.map(n => [n.lat, n.lng]),
      legs,
      distance: legs.reduce((s, l) => s + l.km, 0),
      nodesEvaluated: res.evaluated,
      directions
    };
  }

  /** Moon illumination 0-100 (offline, synodic-cycle approximation). */
  static moonIllumination(date) {
    const d = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
    const ph = (((d / 29.530588853) % 1) + 1) % 1;
    return Math.round(((1 - Math.cos(2 * Math.PI * ph)) / 2) * 100);
  }

  /**
   * Sunrise / sunset for a date and place (classic almanac algorithm, offline).
   * Returns { sunrise: Date|null, sunset: Date|null }.
   */
  static sunTimes(date, lat, lng) {
    const rad = Math.PI / 180;
    const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    const N = Math.floor((Date.UTC(y, m, d) - Date.UTC(y, 0, 0)) / 86400000);
    const calc = isRise => {
      const lngHour = lng / 15;
      const t = N + ((isRise ? 6 : 18) - lngHour) / 24;
      const M = 0.9856 * t - 3.289;
      let L = M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634;
      L = ((L % 360) + 360) % 360;
      let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
      RA = ((RA % 360) + 360) % 360;
      RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
      RA /= 15;
      const sinDec = 0.39782 * Math.sin(L * rad), cosDec = Math.cos(Math.asin(sinDec));
      const cosH = (Math.cos(90.833 * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
      if (cosH > 1 || cosH < -1) return null;
      const H = (isRise ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad) / 15;
      const T = H + RA - 0.06571 * t - 6.622;
      const UT = (((T - lngHour) % 24) + 24) % 24;
      return new Date(Date.UTC(y, m, d) + UT * 3600000);
    };
    return { sunrise: calc(true), sunset: calc(false) };
  }
}

window.RADAR_RINGS = [5, 15, 30];
window.NavigationAlgorithms = NavigationAlgorithms;
