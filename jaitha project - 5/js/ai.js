/**
 * Scout AI — a chat page for Secret Spots India.
 *
 * Engines:
 *  - local      : "Offline Scout" answers from the built-in spot data + your field log. No key, nothing leaves the device.
 *  - anthropic  : Claude, called straight from the browser with YOUR api key.
 *  - openai     : ChatGPT models, same idea.
 *  - gemini     : Gemini models, same idea.
 *
 * This is a static site with no backend, so keys live in this browser's localStorage only.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  let welcomeEl = null; // kept by reference: rendering messages detaches it from the DOM
  const NA = window.NavigationAlgorithms;

  /* ------------------------------------------------------------------ */
  /* Config                                                              */
  /* ------------------------------------------------------------------ */
  const PROVIDERS = {
    local:     { label: 'Offline Scout', dot: '#10b981', needsKey: false },
    anthropic: { label: 'Claude',        dot: '#f97316', needsKey: true,
                 model: 'claude-sonnet-4-5', models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'],
                 help: 'Get a key at console.anthropic.com → API keys.' },
    openai:    { label: 'ChatGPT',       dot: '#22c55e', needsKey: true,
                 model: 'gpt-4o-mini', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
                 help: 'Get a key at platform.openai.com → API keys.' },
    gemini:    { label: 'Gemini',        dot: '#3b82f6', needsKey: true,
                 model: 'gemini-2.0-flash', models: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
                 help: 'Get a free key at aistudio.google.com/apikey.' }
  };

  const SUGGESTIONS = [
    { t: 'Nearest', q: 'Which secret spot is closest to me, and is it worth going this weekend?' },
    { t: 'Quiet', q: 'Suggest the 3 quietest spots in my data and the best time to visit each.' },
    { t: 'Plan', q: 'Plan a peaceful 2-day escape from Chennai with sunrise views and minimal crowds.' },
    { t: 'Romantic', q: 'Where can a couple go for a calm, romantic evening away from tourists?' },
    { t: 'Safety', q: 'What should I carry and watch out for on a no-signal forest trail in the Western Ghats?' },
    { t: 'Anything', q: 'Explain how to read the sky and weather clouds before a monsoon trek.' }
  ];

  const PERSONAS = {
    balanced: 'Be warm, clear and practical. Use short paragraphs and tidy lists when helpful.',
    concise:  'Be brief and direct. Prefer 1-5 short sentences or a tight list. No filler.',
    detailed: 'Be thorough. Give structured plans with headings, timings, packing lists and alternatives.'
  };

  /* ------------------------------------------------------------------ */
  /* Storage (per signed-in user)                                        */
  /* ------------------------------------------------------------------ */
  const session = Auth.getSession() || { id: 'guest', name: 'Guest Scout', provider: 'guest' };
  LocalStorageManager.setScope(session.id);
  const scope = LocalStorageManager.scope;
  const K_CHATS = `secret_spots_ai_chats::${scope}`;
  const K_SET = `secret_spots_ai_settings::${scope}`;

  const read = (k, d) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

  const state = {
    chats: read(K_CHATS, []),
    settings: Object.assign({ provider: 'local', keys: {}, models: {}, persona: 'balanced', context: true }, read(K_SET, {})),
    activeId: null,
    busy: false,
    abort: null,
    pos: null,
    posTried: false,
    recog: null
  };
  const saveChats = () => {
    // keep the 40 most recent chats so we never blow the localStorage quota
    state.chats.sort((a, b) => b.updated - a.updated);
    state.chats = state.chats.slice(0, 40);
    write(K_CHATS, state.chats);
  };
  const saveSettings = () => write(K_SET, state.settings);
  const activeChat = () => state.chats.find(c => c.id === state.activeId) || null;

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  /* ------------------------------------------------------------------ */
  /* Markdown -> safe HTML (escape first, then format)                   */
  /* ------------------------------------------------------------------ */
  function inline(s) {
    s = esc(s);
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
         .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
         .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
         .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
         .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  }

  function markdown(src) {
    const lines = String(src).replace(/\r/g, '').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      // fenced code
      const fence = line.match(/^```\s*([\w+-]*)/);
      if (fence) {
        const buf = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push(`<pre><button class="copy-code" type="button">Copy</button><code>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }
      if (/^\s*$/.test(line)) { i++; continue; }
      let m;
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
      if (/^\s*([-*_])\1\1+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
        out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`); continue;
      }
      // table
      if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const head = cells(line); i += 2;
        const rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        out.push(`<div class="tbl"><table><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${
          rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      // lists
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        const items = [];
        while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
          items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${items.map(t => `<li>${inline(t)}</li>`).join('')}</${tag}>`); continue;
      }
      // paragraph
      const buf = [line]; i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(```|#{1,4}\s|>\s?|\s*([-*+]|\d+[.)])\s+)/.test(lines[i])) buf.push(lines[i++]);
      out.push(`<p>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`);
    }
    return out.join('');
  }

  /* ------------------------------------------------------------------ */
  /* Context: spots, log, position                                       */
  /* ------------------------------------------------------------------ */
  function allSpots() {
    const seed = (window.SEED_SPOTS || []).map(s => ({ ...s, source: 'curated' }));
    let log = [];
    try { log = LocalStorageManager.getLog().filter(e => (e.kind || 'destination') === 'destination').map(e => ({ ...e, source: 'your field log' })); } catch (e) {}
    return seed.concat(log);
  }

  function getPosition() {
    return new Promise(resolve => {
      if (state.pos) return resolve(state.pos);
      if (state.posTried || !navigator.geolocation) return resolve(null);
      state.posTried = true;
      navigator.geolocation.getCurrentPosition(
        p => { state.pos = { lat: p.coords.latitude, lng: p.coords.longitude }; resolve(state.pos); },
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 }
      );
    });
  }

  function spotLine(s, pos) {
    const q = window.quietInfo ? window.quietInfo(s.solitude ?? 50) : { label: '' };
    const d = pos ? `, ${NA.haversineDistance(pos.lat, pos.lng, s.lat, s.lng).toFixed(0)} km away` : '';
    const acc = (window.ACCESS_TYPES[s.access] || {}).label || s.access;
    const cau = (s.cautions || []).map(c => (window.CAUTIONS[c] || {}).label || c).join('/') || 'none';
    return `- ${s.name} (${s.city || 'n/a'}; ${s.mood}; access: ${acc}; quiet ${s.solitude}/100 ${q.label}; cautions: ${cau}; best: ${s.bestWindow || 'n/a'}; ${s.lat.toFixed(4)},${s.lng.toFixed(4)}${d}) ${s.description || s.notes || ''}`.trim();
  }

  async function buildSystemPrompt() {
    const ctxOn = state.settings.context;
    const pos = ctxOn ? await getPosition() : null;
    let p = `You are Scout AI, the built-in assistant of "Secret Spots India", a recon-style app for finding quiet, offbeat places in South India. You can also answer any general question like a normal capable AI assistant (travel, science, coding, writing, advice, everything).
${PERSONAS[state.settings.persona] || PERSONAS.balanced}
Rules: be honest about uncertainty; never invent facts about places; solitude scores and best windows in the app are illustrative and should be verified; for safety questions give practical, careful advice and mention India's emergency number 112 when relevant. Format with Markdown. Today is ${new Date().toDateString()}.
The user is ${session.name || 'a scout'}.`;
    if (ctxOn) {
      const spots = allSpots();
      p += `\n\nAPP DATA (use it when relevant):\nSpots in the app:\n${spots.map(s => spotLine(s, pos)).join('\n')}`;
      if (pos) p += `\n\nUser's current location: ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}.`;
      try {
        const bm = LocalStorageManager.getBookmarks();
        if (bm.length) p += `\nSaved/starred spot ids: ${bm.join(', ')}.`;
        const pp = LocalStorageManager.getPassport();
        const r = Passport.rank(pp.xp).cur;
        p += `\nScout Passport: ${r.name}, ${pp.xp} XP, ${Object.keys(pp.visits).length} stamped spots.`;
      } catch (e) {}
    } else {
      p += `\n\nThe user has switched app context off: do not assume anything about their location or saved data.`;
    }
    return p;
  }

  /* ------------------------------------------------------------------ */
  /* Streaming transport                                                 */
  /* ------------------------------------------------------------------ */
  async function readSSE(res, onData, signal) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      if (signal.aborted) { try { reader.cancel(); } catch (e) {} return; }
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
        const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
        if (data) onData(data);
      }
    }
  }

  async function httpError(res) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      msg = (j.error && (j.error.message || j.error)) || j.message || msg;
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
    } catch (e) {}
    if (res.status === 401 || res.status === 403) msg += ' — check that your API key is correct and has access to this model.';
    if (res.status === 429) msg += ' — rate limit or quota reached.';
    return new Error(msg);
  }

  function history(chat) {
    return chat.messages.filter(m => !m.error && m.content).slice(-24).map(m => ({ role: m.role, content: m.content }));
  }

  async function streamAnthropic(sys, msgs, model, key, onText, signal) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: {
        'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model, max_tokens: 2048, system: sys, messages: msgs, stream: true })
    });
    if (!res.ok) throw await httpError(res);
    await readSSE(res, d => {
      try {
        const j = JSON.parse(d);
        if (j.type === 'content_block_delta' && j.delta && j.delta.text) onText(j.delta.text);
        else if (j.type === 'error') throw new Error(j.error && j.error.message || 'Stream error');
      } catch (e) { if (e.message && !/JSON/.test(e.message)) throw e; }
    }, signal);
  }

  async function streamOpenAI(sys, msgs, model, key, onText, signal) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: sys }, ...msgs] })
    });
    if (!res.ok) throw await httpError(res);
    await readSSE(res, d => {
      if (d === '[DONE]') return;
      try { const t = JSON.parse(d).choices[0].delta.content; if (t) onText(t); } catch (e) {}
    }, signal);
  }

  async function streamGemini(sys, msgs, model, key, onText, signal) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const res = await fetch(url, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
      })
    });
    if (!res.ok) throw await httpError(res);
    await readSSE(res, d => {
      try {
        const parts = JSON.parse(d).candidates[0].content.parts || [];
        parts.forEach(p => p.text && onText(p.text));
      } catch (e) {}
    }, signal);
  }

  /* ------------------------------------------------------------------ */
  /* Offline Scout: rule-based answers from the app's own data           */
  /* ------------------------------------------------------------------ */
  async function offlineAnswer(question, chat) {
    const q = question.toLowerCase();
    const spots = allSpots();
    const useCtx = state.settings.context;
    const pos = useCtx ? await getPosition() : null;
    const ranked = pos ? NA.greedyBestFirstSearch(pos, spots) : spots.map(s => ({ ...s }));
    const dist = s => (s.distance != null ? ` · ${s.distance.toFixed(0)} km away` : '');
    const card = s => {
      const qi = window.quietInfo(s.solitude ?? 50);
      const acc = (window.ACCESS_TYPES[s.access] || {}).label || s.access || 'n/a';
      const cau = (s.cautions || []).map(c => (window.CAUTIONS[c] || {}).label).filter(Boolean).join(', ') || 'None listed';
      return `**${s.name}** — ${s.city || ''}${dist(s)}\n- Mood: ${(window.MOODS[s.mood] || {}).icon || ''} ${s.mood} · Quiet: ${qi.icon} ${qi.label} (${s.solitude}/100)\n- Access: ${acc} · Cautions: ${cau}\n- Best time: ${s.bestWindow || 'n/a'}\n- ${s.description || s.notes || ''}`;
    };
    const note = '\n\n> Offline Scout answers from the app\'s own data. Scores and timings are illustrative, so verify before you go. Connect Claude, ChatGPT or Gemini in **⚙️ Model & API key** for open-ended questions.';

    // 1. a specific spot named in the question
    const named = spots.find(s => q.includes(s.name.toLowerCase()) || (s.name.toLowerCase().split(/\s+/).filter(w => w.length > 4).filter(w => q.includes(w)).length >= 2));
    if (named) {
      const s = ranked.find(x => x.id === named.id) || named;
      return `Here is what I have on this spot:\n\n${card(s)}\n\n**Tips:** go at the listed time, carry water, tell someone your plan${(s.cautions || []).includes('nosignal') ? ', and download offline maps because there is no signal' : ''}.${note}`;
    }

    // 2. greetings / identity
    if (/^(hi|hello|hey|yo|namaste|vanakkam)\b/.test(q.trim()) || /who are you|what can you do|help me\b/.test(q)) {
      return `Hi ${esc(session.name || 'Scout')}! 👋 I'm **Scout AI**.\n\nRight now I'm in **Offline Scout** mode. I can:\n- find the **nearest** or **quietest** spots\n- filter by **mood** (relax, romantic, adventure) or **city**\n- explain a spot's **access, cautions and best time**\n- give **packing and safety** checklists\n- show your **passport progress**\n\nFor anything open-ended (itineraries, history, coding, general knowledge) add a key for Claude, ChatGPT or Gemini in **⚙️ Model & API key**.`;
    }

    // 3. safety / packing
    if (/\b(safe|safety|snakes?|leeches|leech|emergency|sos|danger|dangerous|no signal|network)\b/.test(q)) {
      return `### Field safety checklist\n- Tell someone your **route and return time** (use the 🆘 Safety Beacon on the map).\n- **Download offline maps** and charge a power bank; signal drops fast in forests and ghats.\n- Carry **2 L+ water**, salty snacks, a torch/headlamp and a basic first-aid kit.\n- Start at **sunrise** so you are out well before dark.\n- In monsoon: expect **mud and leeches**: wear grippy shoes and long socks.\n- Never cross swollen streams. Turn back if clouds close in on a peak.\n- Respect wildlife and local rules. Do not feed animals.\n\n🚨 In an emergency in India call **112**.`;
    }
    if (/\b(pack|packing|carry|bring|gear|kit)\b/.test(q)) {
      return `### Quick packing list\n- 💧 Water (2 L+) and electrolytes\n- 🥜 Snacks, plus a light meal for long trails\n- 🔦 Headlamp, power bank, offline maps\n- 🧢 Hat, sunscreen, sunglasses, light rain jacket\n- 🥾 Shoes with grip, spare socks\n- 🩹 First-aid kit, personal meds, insect repellent\n- 🗑️ A bag to carry **all** your trash out\n\nTell me the spot and season and I can tailor it (or connect an AI model for a full itinerary).`;
    }

    // 4. passport
    if (/\b(passport|xp|rank|badges?|stamps?)\b/.test(q)) {
      try {
        const p = LocalStorageManager.getPassport(); const r = Passport.rank(p.xp);
        return `${r.cur.icon} You are a **${r.cur.name}** with **${p.xp} XP**, **${Object.keys(p.visits).length}** location-verified stamps and **${p.badges.length}** badges.${r.next ? `\n\nNext rank: **${r.next.name}** at ${r.next.min} XP (${r.pct}% of the way).` : ''}\n\nStamps are earned automatically when you are within 250 m of a destination.`;
      } catch (e) {}
    }

    // 5. nearest
    if (/\b(nearest|near|closest|nearby|around me|close to me)\b/.test(q)) {
      if (!pos) return `I can't see your location (GPS is blocked or **📍 Context** is off). Turn context on and allow location, or name a city such as *Ooty* or *Chennai*.${note}`;
      const top = ranked.slice(0, 3);
      return `Closest to you right now:\n\n${top.map((s, i) => `**${i + 1}.** ${card(s)}`).join('\n\n')}${note}`;
    }

    // 6. filters: mood / city / difficulty / quiet
    let list = ranked.slice();
    let label = [];
    const moods = { relax: /\b(relax|relaxing|calm|peace|peaceful|chill|unwind)\b/, romantic: /\b(romantic|couples?|date|sunset|honeymoon)\b/, adventure: /\b(adventure|adventurous|trek|trekking|hike|hiking|fort|peak|thrill|rough)\b/ };
    Object.entries(moods).forEach(([m, re]) => { if (re.test(q)) { list = list.filter(s => s.mood === m); label.push(m); } });
    const cityHit = spots.map(s => (s.city || '').toLowerCase()).join('|');
    const places = ['chennai', 'hosur', 'bangalore', 'bengaluru', 'ooty', 'gudalur', 'kodaikanal', 'munnar', 'goa', 'pulicat', 'karnataka', 'tamil'];
    const place = places.find(p => q.includes(p) && cityHit.includes(p === 'bengaluru' ? 'blr' : p));
    if (place) { list = list.filter(s => ((s.city || '') + ' ' + s.name).toLowerCase().includes(place === 'bengaluru' ? 'bang' : place) || (place === 'bangalore' && /blr/i.test(s.city || ''))); label.push(place); }
    if (/\b(easy|simple|beginner|kids?|family|elderly)\b/.test(q)) { list = list.filter(s => s.difficulty === 'easy' || (s.terrain || 3) <= 2); label.push('easy'); }
    if (/\b(quiet|quietest|silent|solitude|crowds?|alone|empty|offbeat|hidden)\b/.test(q) || /best/.test(q)) { list.sort((a, b) => (b.solitude ?? 0) - (a.solitude ?? 0)); label.push('quietest first'); }

    if (label.length) {
      if (!list.length) return `I couldn't find a spot in the data matching **${label.join(' + ')}**. Try a different mood or city, or log your own find with ＋ Log on the map.`;
      return `Top matches for **${label.join(' + ')}**:\n\n${list.slice(0, 3).map((s, i) => `**${i + 1}.** ${card(s)}`).join('\n\n')}${note}`;
    }

    // 7. plan / itinerary
    if (/\b(plan|itinerary|trip|weekend|days?|escape)\b/.test(q)) {
      const picks = ranked.slice().sort((a, b) => (b.solitude ?? 0) - (a.solitude ?? 0)).filter(s => s.distance == null || s.distance < 400).slice(0, 2);
      return `Here is a simple starting plan from the app's data:\n\n${picks.map((s, i) => `### Day ${i + 1}: ${s.name}\n- Leave early and aim for: **${s.bestWindow || 'sunrise'}**\n- Access: ${(window.ACCESS_TYPES[s.access] || {}).label || s.access}\n- ${s.description || ''}`).join('\n\n')}\n\nFor a full hour-by-hour itinerary with food, stays and transport, connect an AI model in **⚙️ Model & API key**.`;
    }

    // 8. fallback
    const top = ranked.slice().sort((a, b) => (b.solitude ?? 0) - (a.solitude ?? 0)).slice(0, 2);
    return `I'm running in **Offline Scout** mode, so I can only answer questions about the spots in this app. That one needs a full AI model.\n\n👉 Open **⚙️ Model & API key** and add a Claude, ChatGPT or Gemini key to ask me *anything*.\n\nMeanwhile, two of the quietest spots in your data:\n\n${top.map(s => `- **${s.name}** (${s.city}): quiet ${s.solitude}/100`).join('\n')}\n\nTry: *"nearest spot"*, *"romantic spots in Ooty"*, *"easy quiet place"*, *"safety tips"*, or *"my passport"*.`;
  }

  async function streamLocal(text, onText, signal) {
    const parts = text.match(/\S+\s*|\n/g) || [text];
    for (const p of parts) {
      if (signal.aborted) return;
      onText(p);
      await sleep(14);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */
  function updateEngineBadge() {
    const s = state.settings, p = PROVIDERS[s.provider];
    const model = p.needsKey ? (s.models[s.provider] || p.model) : 'built-in data';
    const missing = p.needsKey && !s.keys[s.provider];
    $('engine-badge').innerHTML = `<span class="provider-dot" style="background:${missing ? '#f59e0b' : p.dot}"></span>${esc(p.label)} · ${esc(model)}${missing ? ' · <span class="text-amber-400">key needed</span>' : ''}`;
    $('ctx-toggle').classList.toggle('is-on', !!s.context);
  }

  function renderSuggestions() {
    $('suggestions').innerHTML = SUGGESTIONS.map((s, i) => `<button class="sug" data-i="${i}"><b>${esc(s.t)}</b>${esc(s.q)}</button>`).join('');
  }

  function renderChatList() {
    const list = state.chats.slice().sort((a, b) => b.updated - a.updated);
    $('chat-list').innerHTML = list.length ? list.map(c =>
      `<div class="chat-item ${c.id === state.activeId ? 'on' : ''}" data-id="${c.id}"><span>${esc(c.title)}</span><button data-del="${c.id}" title="Delete" aria-label="Delete chat">✕</button></div>`
    ).join('') : '<p class="text-[11px] text-slate-500 px-3 py-2">No chats yet.</p>';
  }

  function msgHTML(m, idx, last) {
    if (m.role === 'user') {
      return `<div class="msg user" data-idx="${idx}"><div class="av">${esc((session.name || '?').trim().charAt(0).toUpperCase())}</div><div class="body"><div class="text-[14px] leading-relaxed whitespace-pre-wrap" style="overflow-wrap:anywhere">${esc(m.content)}</div></div></div>`;
    }
    const body = m.error
      ? `<div class="err-box">⚠️ ${esc(m.error)}</div>`
      : `<div class="md">${markdown(m.content)}</div>`;
    return `<div class="msg bot" data-idx="${idx}"><div class="av">◎</div><div class="body">${body}<div class="actions"><button data-act="copy">⧉ Copy</button>${last ? '<button data-act="regen">↻ Regenerate</button>' : ''}</div></div></div>`;
  }

  function renderMessages() {
    const chat = activeChat();
    const box = $('messages');
    const w = welcomeEl;
    if (!chat || !chat.messages.length) {
      box.innerHTML = '';
      box.appendChild(w); w.style.display = '';
      $('chat-title').textContent = 'New chat';
      return;
    }
    w.style.display = 'none';
    box.innerHTML = chat.messages.map((m, i) => msgHTML(m, i, i === chat.messages.length - 1)).join('');
    $('chat-title').textContent = chat.title;
    box.scrollTop = box.scrollHeight;
  }

  function setBusy(b) {
    state.busy = b;
    const btn = $('send-btn');
    btn.classList.toggle('stop', b);
    btn.textContent = b ? '■' : '➤';
    btn.title = b ? 'Stop' : 'Send';
  }

  /* ------------------------------------------------------------------ */
  /* Sending                                                             */
  /* ------------------------------------------------------------------ */
  function newChat() {
    const c = { id: uid(), title: 'New chat', messages: [], created: Date.now(), updated: Date.now() };
    state.chats.push(c);
    state.activeId = c.id;
    return c;
  }

  async function generate(chat) {
    // chat.messages ends with the user message to answer
    const s = state.settings, prov = PROVIDERS[s.provider];
    const box = $('messages');
    const bot = { role: 'assistant', content: '' };
    chat.messages.push(bot);
    welcomeEl.style.display = 'none';

    // live node
    const node = document.createElement('div');
    node.className = 'msg bot';
    node.innerHTML = '<div class="av">◎</div><div class="body"><div class="md cursor"><span class="dots"><i></i><i></i><i></i></span></div></div>';
    box.appendChild(node);
    box.scrollTop = box.scrollHeight;
    const md = node.querySelector('.md');

    const ctrl = new AbortController();
    state.abort = ctrl;
    setBusy(true);

    let raf = 0;
    const paint = () => {
      raf = 0;
      md.innerHTML = markdown(bot.content);
      md.classList.add('cursor');
      const near = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
      if (near) box.scrollTop = box.scrollHeight;
    };
    const onText = t => { bot.content += t; if (!raf) raf = requestAnimationFrame(paint); };

    try {
      const question = chat.messages[chat.messages.length - 2].content;
      if (s.provider === 'local') {
        await streamLocal(await offlineAnswer(question, chat), onText, ctrl.signal);
      } else {
        const key = (s.keys[s.provider] || '').trim();
        if (!key) throw new Error(`Add your ${prov.label} API key in ⚙️ Model & API key, or switch to Offline Scout.`);
        const model = (s.models[s.provider] || prov.model).trim();
        const sys = await buildSystemPrompt();
        const msgs = history({ messages: chat.messages.slice(0, -1) });
        const fn = { anthropic: streamAnthropic, openai: streamOpenAI, gemini: streamGemini }[s.provider];
        await fn(sys, msgs, model, key, onText, ctrl.signal);
      }
      if (!bot.content.trim() && !ctrl.signal.aborted) throw new Error('The model returned an empty response. Try again or pick another model.');
    } catch (err) {
      if (err.name === 'AbortError' || ctrl.signal.aborted) {
        if (!bot.content.trim()) { chat.messages.pop(); }
      } else {
        const offline = !navigator.onLine || /Failed to fetch|NetworkError|Load failed/i.test(err.message);
        bot.error = offline ? 'Could not reach the AI service. Check your internet connection (some browsers also block direct calls on strict privacy settings).' : err.message;
        if (bot.content.trim()) bot.error = null; // keep partial text
      }
    } finally {
      if (raf) cancelAnimationFrame(raf);
      state.abort = null;
      setBusy(false);
      chat.updated = Date.now();
      saveChats();
      renderChatList();
      renderMessages();
    }
  }

  async function send(text) {
    text = (text || '').trim();
    if (!text || state.busy) return;
    let chat = activeChat() || newChat();
    chat.messages.push({ role: 'user', content: text });
    if (chat.messages.length === 1) chat.title = text.length > 44 ? text.slice(0, 44).trim() + '…' : text;
    chat.updated = Date.now();
    saveChats(); renderChatList();
    $('prompt').value = ''; autosize();
    const box = $('messages');
    welcomeEl.style.display = 'none';
    box.querySelectorAll('.msg').forEach(n => n.remove());
    chat.messages.forEach((m, i) => box.insertAdjacentHTML('beforeend', msgHTML(m, i, false)));
    $('chat-title').textContent = chat.title;
    await generate(chat);
  }

  async function regenerate() {
    const chat = activeChat();
    if (!chat || state.busy) return;
    while (chat.messages.length && chat.messages[chat.messages.length - 1].role === 'assistant') chat.messages.pop();
    if (!chat.messages.length) return;
    renderMessages();
    await generate(chat);
  }

  /* ------------------------------------------------------------------ */
  /* UI wiring                                                           */
  /* ------------------------------------------------------------------ */
  function autosize() {
    const t = $('prompt'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px';
  }

  function openSidebar(open) {
    $('ai-sidebar').classList.toggle('open', open);
    $('sidebar-scrim').classList.toggle('hidden', !open);
  }

  function selectChat(id) {
    if (state.busy) return;
    state.activeId = id; renderChatList(); renderMessages(); openSidebar(false);
  }

  function openSettings() {
    const s = state.settings;
    document.querySelectorAll('input[name="provider"]').forEach(r => { r.checked = r.value === s.provider; });
    $('persona').value = s.persona;
    syncSettingsFields(s.provider);
    $('settings-modal').classList.remove('hidden');
  }

  function syncSettingsFields(provider) {
    const p = PROVIDERS[provider], s = state.settings;
    $('key-wrap').style.display = p.needsKey ? '' : 'none';
    if (p.needsKey) {
      $('api-key').value = s.keys[provider] || '';
      $('model-name').value = s.models[provider] || p.model;
      $('model-list').innerHTML = p.models.map(m => `<option value="${m}">`).join('');
      $('key-help').textContent = p.help;
    }
  }

  function saveSettingsFromModal() {
    const s = state.settings;
    const provider = (document.querySelector('input[name="provider"]:checked') || {}).value || 'local';
    s.provider = provider;
    s.persona = $('persona').value;
    if (PROVIDERS[provider].needsKey) {
      s.keys[provider] = $('api-key').value.trim();
      s.models[provider] = $('model-name').value.trim() || PROVIDERS[provider].model;
    }
    saveSettings(); updateEngineBadge();
    $('settings-modal').classList.add('hidden');
    toast(PROVIDERS[provider].needsKey && !s.keys[provider] ? 'Saved. Add an API key to start chatting.' : `Using ${PROVIDERS[provider].label}`);
  }

  function initVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const btn = $('mic-btn'); btn.classList.remove('hidden');
    btn.addEventListener('click', () => {
      if (state.recog) { state.recog.stop(); return; }
      const r = new SR(); state.recog = r;
      r.lang = navigator.language || 'en-IN'; r.interimResults = true;
      const base = $('prompt').value;
      r.onresult = e => { $('prompt').value = (base ? base + ' ' : '') + Array.from(e.results).map(x => x[0].transcript).join(''); autosize(); };
      r.onend = () => { state.recog = null; btn.classList.remove('mic-on'); };
      r.onerror = () => { state.recog = null; btn.classList.remove('mic-on'); toast('Voice input unavailable'); };
      btn.classList.add('mic-on'); r.start();
    });
  }

  function init() {
    welcomeEl = $('welcome');
    renderSuggestions();
    renderChatList();
    renderMessages();
    updateEngineBadge();
    initVoice();

    $('suggestions').addEventListener('click', e => {
      const b = e.target.closest('.sug'); if (b) send(SUGGESTIONS[+b.dataset.i].q);
    });
    $('send-btn').addEventListener('click', () => { state.busy ? state.abort && state.abort.abort() : send($('prompt').value); });
    $('prompt').addEventListener('input', autosize);
    $('prompt').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!state.busy) send($('prompt').value); }
    });
    $('new-chat').addEventListener('click', () => {
      if (state.busy) return;
      state.activeId = null; renderChatList(); renderMessages(); openSidebar(false); $('prompt').focus();
    });
    $('chat-list').addEventListener('click', e => {
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        if (state.busy) return;
        state.chats = state.chats.filter(c => c.id !== del.dataset.del);
        if (state.activeId === del.dataset.del) state.activeId = null;
        saveChats(); renderChatList(); renderMessages(); return;
      }
      const it = e.target.closest('.chat-item'); if (it) selectChat(it.dataset.id);
    });
    $('clear-chat').addEventListener('click', () => {
      const c = activeChat(); if (!c || state.busy) return;
      if (!confirm('Delete this chat?')) return;
      state.chats = state.chats.filter(x => x.id !== c.id); state.activeId = null;
      saveChats(); renderChatList(); renderMessages();
    });
    $('messages').addEventListener('click', e => {
      const code = e.target.closest('.copy-code');
      if (code) { navigator.clipboard.writeText(code.parentElement.querySelector('code').textContent).then(() => { code.textContent = 'Copied'; setTimeout(() => code.textContent = 'Copy', 1400); }); return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'regen') return regenerate();
      if (b.dataset.act === 'copy') {
        const m = activeChat().messages[+b.closest('.msg').dataset.idx];
        navigator.clipboard.writeText(m.content || '').then(() => toast('Copied'));
      }
    });
    $('ctx-toggle').addEventListener('click', () => {
      state.settings.context = !state.settings.context; saveSettings(); updateEngineBadge();
      toast(state.settings.context ? 'Context on: AI can use your location, spots and log' : 'Context off: AI sees none of your app data');
    });

    // sidebar (mobile)
    $('open-sidebar').addEventListener('click', () => openSidebar(true));
    $('close-sidebar').addEventListener('click', () => openSidebar(false));
    $('sidebar-scrim').addEventListener('click', () => openSidebar(false));

    // settings
    $('open-settings').addEventListener('click', () => { openSidebar(false); openSettings(); });
    $('close-settings').addEventListener('click', () => $('settings-modal').classList.add('hidden'));
    $('save-settings').addEventListener('click', saveSettingsFromModal);
    $('provider-group').addEventListener('change', e => { if (e.target.name === 'provider') syncSettingsFields(e.target.value); });
    $('forget-key').addEventListener('click', () => {
      const p = (document.querySelector('input[name="provider"]:checked') || {}).value;
      if (p && PROVIDERS[p].needsKey) { delete state.settings.keys[p]; $('api-key').value = ''; saveSettings(); updateEngineBadge(); toast('Key removed from this browser'); }
      else toast('Nothing to forget for this provider');
    });

    // first-time nudge
    if (!chatsSeen()) { /* welcome screen already explains everything */ }
    $('prompt').focus();
  }
  function chatsSeen() { return state.chats.length > 0; }

  document.addEventListener('DOMContentLoaded', init);
})();
