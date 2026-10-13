/**
 * LocalStorage manager. Data is scoped per signed-in user (Auth session id).
 */
class LocalStorageManager {
  static BASE = {
    LOG: 'secret_spots_fieldlog',
    BOOKMARKS: 'secret_spots_bookmarks',
    SETTINGS: 'secret_spots_settings',
    PASSPORT: 'secret_spots_passport',
    TRACKS: 'secret_spots_tracks',
    ACTIVE: 'secret_spots_active_track'
  };
  static OSM_CACHE = 'secret_spots_osm_cache';
  static LEGACY_CUSTOM = 'secret_spots_custom';
  static scope = 'guest';

  static setScope(id) {
    this.scope = String(id || 'guest').replace(/[^a-zA-Z0-9:_.@-]/g, '_');
    // One-time: adopt data saved before accounts existed into the first account that opens the app
    try {
      Object.values(this.BASE).forEach(base => {
        const raw = localStorage.getItem(base);
        if (raw !== null) {
          if (localStorage.getItem(`${base}::${this.scope}`) === null) localStorage.setItem(`${base}::${this.scope}`, raw);
          localStorage.removeItem(base);
        }
      });
    } catch (e) {}
  }

  static key(name) { return `${this.BASE[name]}::${this.scope}`; }

  static read(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  static write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.error('Storage write failed', e); return false; }
  }

  /* ---- Field log ---- */
  static getLog() {
    const log = this.read(this.key('LOG'), null);
    if (log) return log;
    const legacy = this.read(this.LEGACY_CUSTOM, []).map(s => ({
      kind: 'destination', access: 'paved', terrain: 3, cautions: [], solitude: 55, bestWindow: '', notes: '', ...s, isLog: true
    }));
    if (legacy.length) { this.write(this.key('LOG'), legacy); try { localStorage.removeItem(this.LEGACY_CUSTOM); } catch (e) {} }
    return legacy;
  }
  static saveLogEntry(entry) { const l = this.getLog(); l.push(entry); return this.write(this.key('LOG'), l); }
  static replaceLog(list) { return this.write(this.key('LOG'), list); }
  static deleteLogEntry(id) {
    this.write(this.key('LOG'), this.getLog().filter(e => e.id !== id));
    this.write(this.key('BOOKMARKS'), this.getBookmarks().filter(b => b !== id));
  }

  /* ---- Bookmarks ---- */
  static getBookmarks() { return this.read(this.key('BOOKMARKS'), []); }
  static setBookmarks(list) { return this.write(this.key('BOOKMARKS'), list); }
  static toggleBookmark(id) {
    let b = this.getBookmarks();
    b = b.includes(id) ? b.filter(x => x !== id) : [...b, id];
    this.setBookmarks(b);
    return b;
  }
  static isBookmarked(id) { return this.getBookmarks().includes(id); }

  /* ---- Settings ---- */
  static getSettings() { return { radar: false, ...this.read(this.key('SETTINGS'), {}) }; }
  static updateSettings(patch) {
    const s = { ...this.getSettings(), ...patch };
    this.write(this.key('SETTINGS'), s);
    return s;
  }

  /* ---- Passport ---- */
  static defaultPassport() {
    return { xp: 0, visits: {}, badges: [], stats: { logs: 0, entries: 0, silent: 0, rough: 0, radar: false, trackKm: 0, discovered: false } };
  }
  static getPassport() {
    const p = this.read(this.key('PASSPORT'), null) || {};
    const d = this.defaultPassport();
    return { ...d, ...p, stats: { ...d.stats, ...(p.stats || {}) } };
  }
  static savePassport(p) { return this.write(this.key('PASSPORT'), p); }

  /* ---- Trail tracks ---- */
  static getTracks() { return this.read(this.key('TRACKS'), []); }
  static saveTrack(t) {
    const list = [t, ...this.getTracks().filter(x => x.id !== t.id)].slice(0, 8);
    return this.write(this.key('TRACKS'), list);
  }
  static deleteTrack(id) { this.write(this.key('TRACKS'), this.getTracks().filter(t => t.id !== id)); }
  static getActiveTrack() { return this.read(this.key('ACTIVE'), null); }
  static setActiveTrack(t) { return this.write(this.key('ACTIVE'), t); }
  static clearActiveTrack() { try { localStorage.removeItem(this.key('ACTIVE')); } catch (e) {} }

  /* ---- OpenStreetMap discovery cache (public data, not per-user) ---- */
  static getOsmCache(k) { const c = this.read(this.OSM_CACHE, {}); return c[k] || null; }
  static setOsmCache(k, items) {
    const c = this.read(this.OSM_CACHE, {});
    c[k] = { t: Date.now(), items };
    const keys = Object.keys(c).sort((a, b) => c[b].t - c[a].t).slice(0, 4);
    const trimmed = {}; keys.forEach(x => trimmed[x] = c[x]);
    this.write(this.OSM_CACHE, trimmed);
  }
}
window.LocalStorageManager = LocalStorageManager;
