/**
 * Client-side auth: Google Identity Services, local email/password accounts, guest.
 * IMPORTANT: with no backend, this personalises the app per user and keeps their data
 * separate on this device. It is NOT server-verified authentication.
 */
class Auth {
  static SESSION_KEY = 'secret_spots_session';
  static ACCOUNTS_KEY = 'secret_spots_accounts';

  static getSession() {
    try { return JSON.parse(localStorage.getItem(this.SESSION_KEY) || 'null'); } catch (e) { return null; }
  }
  static setSession(s) {
    const session = { ...s, at: Date.now() };
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
    return session;
  }
  static logout() {
    localStorage.removeItem(this.SESSION_KEY);
    try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (e) {}
  }

  /* ---------- local email accounts (PBKDF2-hashed, stored on this device) ---------- */
  static accounts() {
    try { return JSON.parse(localStorage.getItem(this.ACCOUNTS_KEY) || '{}'); } catch (e) { return {}; }
  }
  static b64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
  static async hash(password, saltB64) {
    if (!window.crypto || !crypto.subtle) throw new Error('Secure sign-in needs https:// or localhost.');
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
    return this.b64(bits);
  }
  static validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

  static async signUp(name, email, password) {
    email = String(email).trim().toLowerCase();
    name = String(name).trim();
    if (!name) throw new Error('Enter your name.');
    if (!this.validEmail(email)) throw new Error('Enter a valid email address.');
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');
    const accounts = this.accounts();
    if (accounts[email]) throw new Error('An account with this email already exists on this device.');
    const salt = this.b64(crypto.getRandomValues(new Uint8Array(16)));
    accounts[email] = { name, salt, hash: await this.hash(password, salt), created: Date.now() };
    localStorage.setItem(this.ACCOUNTS_KEY, JSON.stringify(accounts));
    return this.setSession({ id: 'e:' + email, name, email, provider: 'email' });
  }

  static async signIn(email, password) {
    email = String(email).trim().toLowerCase();
    const acc = this.accounts()[email];
    if (!acc) throw new Error('No account found for this email on this device. Create one first.');
    if ((await this.hash(password, acc.salt)) !== acc.hash) throw new Error('Incorrect password.');
    return this.setSession({ id: 'e:' + email, name: acc.name, email, provider: 'email' });
  }

  static guest() { return this.setSession({ id: 'guest', name: 'Guest Scout', provider: 'guest' }); }

  /* ---------- Google Identity Services ---------- */
  static decodeJwt(token) {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(part.padEnd(part.length + (4 - part.length % 4) % 4, '=')), c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  static fromGoogle(credential) {
    const p = this.decodeJwt(credential);
    const okIss = p.iss === 'accounts.google.com' || p.iss === 'https://accounts.google.com';
    if (!okIss || p.aud !== (window.APP_CONFIG || {}).GOOGLE_CLIENT_ID || p.exp * 1000 < Date.now()) {
      throw new Error('Google sign-in could not be validated.');
    }
    return this.setSession({ id: 'g:' + p.sub, name: p.name || p.email, email: p.email, picture: p.picture, provider: 'google' });
  }
}
window.Auth = Auth;
