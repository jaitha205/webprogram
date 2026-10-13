(function () {
  const $ = id => document.getElementById(id);
  if (Auth.getSession()) { location.replace('index.html'); return; }

  let mode = 'signin';
  const go = () => location.replace('index.html');
  const msg = (t, ok) => { const m = $('msg'); m.textContent = t || ''; m.className = 'text-xs mt-1 text-center min-h-[1rem] ' + (ok ? 'text-emerald-400' : 'text-rose-400'); };

  function setMode(m) {
    mode = m;
    $('tab-signin').classList.toggle('on', m === 'signin');
    $('tab-signup').classList.toggle('on', m === 'signup');
    $('name-wrap').classList.toggle('hidden', m !== 'signup');
    $('submit-btn').textContent = m === 'signup' ? 'Create Account' : 'Sign In';
    $('password').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    msg('');
  }
  $('tab-signin').addEventListener('click', () => setMode('signin'));
  $('tab-signup').addEventListener('click', () => setMode('signup'));

  $('auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('submit-btn'); btn.disabled = true;
    try {
      if (mode === 'signup') await Auth.signUp($('name').value, $('email').value, $('password').value);
      else await Auth.signIn($('email').value, $('password').value);
      msg('Access granted. Loading radar…', true);
      go();
    } catch (err) { msg(err.message); }
    btn.disabled = false;
  });

  $('guest-btn').addEventListener('click', () => { Auth.guest(); go(); });

  /* ---- Google ---- */
  const clientId = (window.APP_CONFIG || {}).GOOGLE_CLIENT_ID;
  if (location.protocol === 'file:') msg('Serve this folder over http://localhost (not file://) for sign-in to work.');

  if (!clientId) {
    $('g-fallback').addEventListener('click', () => msg('Google sign-in is not set up yet. Add your OAuth Client ID in js/config.js (see README).'));
  } else {
    let tries = 0;
    const timer = setInterval(() => {
      if (window.google && google.accounts && google.accounts.id) {
        clearInterval(timer);
        google.accounts.id.initialize({
          client_id: clientId,
          callback: r => { try { Auth.fromGoogle(r.credential); go(); } catch (err) { msg(err.message); } }
        });
        google.accounts.id.renderButton($('g-host'), { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 320 });
        $('g-fallback').classList.add('hidden');
      } else if (++tries > 60) {
        clearInterval(timer);
        $('g-fallback').addEventListener('click', () => msg('Could not load Google sign-in (offline or blocked). Use email or guest.'));
      }
    }, 100);
  }
})();
