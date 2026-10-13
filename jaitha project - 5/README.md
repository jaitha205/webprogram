# Secret Spots India — Exploration Recon (with login)

## Run
Serve the folder over http (service workers, Google sign-in and secure hashing need http://localhost or https://, not file://):

    python3 -m http.server 8080      # open http://localhost:8080  -> redirects to login.html

## Sign-in options
| Method | Works out of the box? | Notes |
|---|---|---|
| Email + password | Yes | Account is stored **in this browser only** (PBKDF2-hashed). Not synced across devices. |
| Guest | Yes | Data stays on this device. |
| Google | After 1 setup step | Needs your own OAuth Client ID (below). |

### Enable "Continue with Google"
1. Go to https://console.cloud.google.com/apis/credentials -> Create credentials -> OAuth client ID -> **Web application**.
2. Under **Authorized JavaScript origins** add your origin, e.g. `http://localhost:8080` and your deployed `https://...` URL.
3. Paste the client ID into `js/config.js` (`GOOGLE_CLIENT_ID`).
Google's button then appears automatically. Apple / GitHub / phone-OTP login are not included: they need a server (secrets or SMS provider) and can't be done safely in a static site.

**Security note:** with no backend, sign-in personalises the app and separates each user's data on the device. It is not server-verified auth, so don't use it to protect anything sensitive.

## Features
Recon UI: full-screen dark map, top radar bar, bottom spot drawer, compass & scout ring.
- Solitude & Crowd Meter (Quiet Index, 0-100 score, best visit windows)
- Terrain & hazard badges (Paved / Dirt / Footpath / 4x4; Steps / Mud / No signal)
- Radar Proximity mode (5 / 15 / 30 km animated rings + sweep)
- Field Log (private pins, exact coordinates by GPS or map tap, parking & entry points, A* route via them)
- **New:** Scout Passport: XP, 5 ranks, 7 badges, and location-verified stamps (auto when within 250 m of a spot)
- **New:** Sunrise / sunset per spot, computed offline for today's date in your device's timezone
- **New:** Safety Beacon: builds a check-in message with your live coordinates and expected return time; Share/Copy or WhatsApp
- **New:** Share any spot (popup button), JSON export/import backup of log, saves and passport
- **New:** Per-account data (each login has its own log, saves and passport); Leaflet is bundled locally for offline use

## Scout AI (separate page: `ai.html`)
Tap **✨ Ask AI** in the map's top bar. It opens a full-screen ChatGPT / Gemini / Claude-style chat on its own page.
- Streaming answers, Markdown (lists, tables, code with copy button), stop, regenerate, copy, voice input, chat history per account.
- **Providers:** Offline Scout (works instantly, no key, answers from the app's spots, field log and passport), or **Claude / ChatGPT / Gemini** with your own API key (⚙️ Model & API key). Any model name your key can use works.
- **📍 Context toggle:** when on, the AI is told your location, the spot dataset, saved spots and passport rank so it can give personal answers; switch off to keep it generic.
- **Key safety:** there is no backend, so the key is stored only in this browser's localStorage and requests go directly from your device to the provider. Use a restricted/low-limit key and never on a shared device. For a public site, put a small proxy server in front instead of shipping keys.

## Discover + Trail Tracker (what makes it different from Google Maps)
- **🔭 Discover:** tap the chip to scan a 30 km radius of OpenStreetMap for named waterfalls, viewpoints, peaks, caves, springs, beaches, forts, ruins and picnic sites. Each result is tagged "Off the tourist radar" when it has no Wikipedia/Wikidata/website entry (a heuristic, not proof). Results are cached for 7 days; pan the map and tap "Scan map centre" to look elsewhere. "＋ Log" turns any find into a Field Log pin with your own solitude/terrain notes.
- **Compass tracking, not road turn-by-turn:** "Scout Route" locks the compass ring onto your next waypoint (parking -> entry -> spot). It shows live distance, bearing, and turns amber with OFF COURSE when your heading drifts. Waypoints advance automatically as you reach them.
- **👣 Trail Tracker:** records a glowing breadcrumb trail (distance, time, speed), survives a page reload, saves up to 8 trails, exports GPX. **↩ Backtrack** guides you back along your own path crumb by crumb; it needs no internet.
- Passport: +2 badges (Trail Recorder, Scout Eye) and XP for recorded distance.

## Honest notes
- Browsers pause GPS when the screen is off or the tab is in the background, so keep the screen on while recording (the app requests a screen wake-lock where supported).
- OpenStreetMap coverage of remote India is uneven; a missing place may simply be untagged.
- Discover needs internet on first scan of an area (uses the public Overpass API).

- Solitude scores, best windows, cautions and seeded parking/entry coordinates are illustrative; verify them and correct via the Field Log.
- Routes are terrain-weighted straight-line estimates, not turn-by-turn. The route card links out to a maps app.
- The Safety Beacon can't contact anyone by itself and needs signal. In an emergency in India call 112.
- Tailwind is still loaded from its CDN (cached by the service worker after first visit); map tiles are OpenStreetMap, and recently viewed tiles are cached for offline.
