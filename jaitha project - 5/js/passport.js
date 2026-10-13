/**
 * Scout Passport: XP, ranks, badges and location-verified stamps.
 */
class Passport {
  static RANKS = [
    { min: 0,    name: 'Rookie Scout',       icon: '🥾' },
    { min: 100,  name: 'Tracker',            icon: '🧭' },
    { min: 250,  name: 'Pathfinder',         icon: '🗺️' },
    { min: 500,  name: 'Trailblazer',        icon: '🔥' },
    { min: 1000, name: 'Ghost of the Ghats', icon: '👻' }
  ];

  static BADGES = [
    { id: 'first-log',  icon: '📓', name: 'First Entry',     desc: 'Save your first field log pin',       test: p => p.stats.logs >= 1 },
    { id: 'first-stamp',icon: '📍', name: 'First Stamp',     desc: 'Check in at a spot (within 250 m)',   test: p => Object.keys(p.visits).length >= 1 },
    { id: 'silence',    icon: '🌿', name: 'Silence Seeker',  desc: 'Stamp 3 Silent spots',                test: p => p.stats.silent >= 3 },
    { id: 'trail',      icon: '🥾', name: 'Trail Walker',    desc: 'Stamp 3 footpath / 4x4 spots',        test: p => p.stats.rough >= 3 },
    { id: 'explorer',   icon: '🧭', name: 'Explorer',        desc: 'Collect 5 stamps',                    test: p => Object.keys(p.visits).length >= 5 },
    { id: 'radar',      icon: '📡', name: 'Radar Operator',  desc: 'Switch on Radar mode',                test: p => p.stats.radar },
    { id: 'tracker',   icon: '👣', name: 'Trail Recorder',  desc: 'Record 5 km of trails',               test: p => p.stats.trackKm >= 5 },
    { id: 'eye',       icon: '🔭', name: 'Scout Eye',       desc: 'Scan the map for hidden places',      test: p => p.stats.discovered },
    { id: 'cartog',     icon: '🗺️', name: 'Cartographer',    desc: 'Log 3 parking / entry pins',          test: p => p.stats.entries >= 3 }
  ];

  static rank(xp) {
    let idx = 0;
    this.RANKS.forEach((r, i) => { if (xp >= r.min) idx = i; });
    const cur = this.RANKS[idx], next = this.RANKS[idx + 1] || null;
    const pct = next ? Math.round(((xp - cur.min) / (next.min - cur.min)) * 100) : 100;
    return { cur, next, pct };
  }

  /** kind: 'log' | 'checkin' | 'radar'. Returns { gain, badges }. */
  static award(kind, ctx = {}) {
    const p = LocalStorageManager.getPassport();
    let gain = 0;
    if (kind === 'log') {
      const isDest = ctx.kind === 'destination';
      gain = isDest ? 20 : 10;
      p.stats.logs++;
      if (!isDest) p.stats.entries++;
    } else if (kind === 'checkin') {
      if (p.visits[ctx.id]) return { gain: 0, badges: [] };
      p.visits[ctx.id] = Date.now();
      gain = 50;
      if (ctx.solitude >= 70) { gain += 25; p.stats.silent++; }
      if (ctx.access === 'footpath' || ctx.access === 'fourx4') { gain += 15; p.stats.rough++; }
    } else if (kind === 'track') {
      const km = ctx.km || 0;
      if (km < 0.3) return { gain: 0, badges: [] };
      p.stats.trackKm = +(p.stats.trackKm + km).toFixed(2);
      gain = Math.min(60, Math.round(km * 10));
    } else if (kind === 'discover') {
      if (p.stats.discovered) return { gain: 0, badges: [] };
      p.stats.discovered = true; gain = 10;
    } else if (kind === 'radar') {
      if (p.stats.radar) return { gain: 0, badges: [] };
      p.stats.radar = true; gain = 10;
    }
    p.xp += gain;
    const badges = this.BADGES.filter(b => !p.badges.includes(b.id) && b.test(p));
    badges.forEach(b => { p.badges.push(b.id); p.xp += 25; });
    LocalStorageManager.savePassport(p);
    return { gain, badges };
  }
}
window.Passport = Passport;
