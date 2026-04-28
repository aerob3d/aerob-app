// ═══════════════════════════════════════════════════════════════════
// edu.js — AeroB Edu Platform Layer
//
// Shares the Supabase backend with the main AeroB platform.
// Provides Dutch-language auth overlay, platform nav, and module
// routing for the AeroB Edu educational platform.
//
// Usage in every edu page:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
//   <script src="/edu/edu.js"></script>
//   ...
//   EduPlatform.init('my-app-id', { onReady: user => { ... } });
// ═══════════════════════════════════════════════════════════════════

const SUPABASE_URL      = 'https://yobvrleuwmchsxkpcshv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tOLuYgic96IH1vg9QHLfVw_BV1hPMAv';
const _eduSb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Auth module ───────────────────────────────────────────────────────────────
const EduAuth = (() => {
  function _mapUser(session) {
    if (!session) return null;
    const u = session.user;
    return {
      id:          u.id,
      email:       u.email,
      displayName: (u.user_metadata && u.user_metadata.display_name) || u.email.split('@')[0],
    };
  }

  async function getSession() {
    const { data: { session } } = await _eduSb.auth.getSession();
    return _mapUser(session);
  }

  async function login(email, password) {
    const { data, error } = await _eduSb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return _mapUser(data.session);
  }

  async function register(email, password, displayName) {
    const name = (displayName && displayName.trim()) || email.split('@')[0];
    const { data, error } = await _eduSb.auth.signUp({
      email, password,
      options: { data: { display_name: name } },
    });
    if (error) throw new Error(error.message);
    if (!data.session) throw new Error('Account aangemaakt! Controleer je inbox om je e-mailadres te bevestigen, meld je daarna aan.');
    return _mapUser(data.session);
  }

  async function logout() {
    await _eduSb.auth.signOut();
  }

  async function resetPassword(email) {
    const redirectTo = window.location.origin + '/edu/';
    const { error } = await _eduSb.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw new Error(error.message);
  }

  async function updatePassword(newPassword) {
    const { error } = await _eduSb.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
  }

  return { getSession, login, register, logout, resetPassword, updatePassword };
})();

// ═══════════════════════════════════════════════════════════════════
// EduPlatform — shared UI layer
// ═══════════════════════════════════════════════════════════════════
const EduPlatform = (() => {

  // All edu modules — extend this list to add new tools
  const MODULES = [
    { id: 'portal',       label: '⌂ Dashboard',        path: '/edu/' },
    { id: 'gauss-jordan', label: '🔢 Gauss-Jordan',     path: '/edu/wiskunde/gauss-jordan.html' },
  ];

  let _currentUser = null;
  let _appId       = null;
  let _onReady     = null;

  // ── CSS ────────────────────────────────────────────────────────────────────
  const PLATFORM_CSS = `
/* ── Edu platform nav ─────────────────────────────── */
.edu-nav{display:flex;align-items:center;gap:4px;margin-left:10px;flex-wrap:wrap}
.edu-nav-link{font-size:12px;color:rgba(255,255,255,.75);text-decoration:none;padding:4px 10px;border-radius:10px;transition:all .2s;white-space:nowrap}
.edu-nav-link:hover{background:rgba(255,255,255,.14);color:#fff}
.edu-nav-sep{color:rgba(255,255,255,.25);font-size:11px;margin:0 2px}

/* ── Auth overlay ─────────────────────────────────── */
.edu-auth-overlay{position:fixed;inset:0;background:#0a1432;z-index:2000;display:flex;align-items:stretch}
.edu-auth-overlay.hidden{display:none!important}
.edu-auth-hero{flex:0 0 52%;display:flex;flex-direction:column;justify-content:center;padding:60px 56px;position:relative;overflow:hidden;background:linear-gradient(150deg,#071020 0%,#0f2460 45%,#1f3b88 100%)}
.edu-auth-hero::before{content:'';position:absolute;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(255,165,0,.12) 0%,transparent 70%);top:-160px;right:-160px;pointer-events:none}
.edu-auth-hero::after{content:'';position:absolute;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.05) 0%,transparent 70%);bottom:-120px;left:-80px;pointer-events:none}
.edu-auth-logo{display:flex;align-items:center;gap:18px;margin-bottom:44px;position:relative;z-index:1}
.edu-auth-logo img{width:72px;height:auto;flex-shrink:0;filter:brightness(0) invert(1)}
.edu-auth-logo-text h1{font-size:24px;font-weight:800;color:#fff;line-height:1.1}
.edu-auth-logo-text h1 .orange{color:#ffa500}
.edu-auth-logo-text p{font-size:11px;color:rgba(255,255,255,.5);margin-top:4px;letter-spacing:.5px;text-transform:uppercase}
.edu-auth-headline{font-size:30px;font-weight:800;color:#fff;line-height:1.3;margin-bottom:14px;position:relative;z-index:1}
.edu-auth-headline em{color:#ffa500;font-style:normal}
.edu-auth-sub{font-size:14px;color:rgba(255,255,255,.65);line-height:1.7;margin-bottom:36px;max-width:380px;position:relative;z-index:1}
.edu-features{list-style:none;display:flex;flex-direction:column;gap:16px;position:relative;z-index:1}
.edu-feature{display:flex;align-items:flex-start;gap:12px}
.edu-feature-icon{font-size:20px;flex-shrink:0;margin-top:1px;width:34px;height:34px;background:rgba(255,255,255,.08);border-radius:8px;display:flex;align-items:center;justify-content:center}
.edu-feature-text h4{font-size:13px;font-weight:700;color:#fff;margin-bottom:2px}
.edu-feature-text p{font-size:12px;color:rgba(255,255,255,.5);line-height:1.5}
.edu-auth-divider{border:none;border-top:1px solid rgba(255,255,255,.1);margin:32px 0 24px;position:relative;z-index:1}
.edu-auth-tagline{font-size:11px;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.8px;position:relative;z-index:1}
.edu-form-panel{flex:1;display:flex;align-items:center;justify-content:center;background:#fff;padding:48px 40px;overflow-y:auto}
.edu-card{width:100%;max-width:340px}
.edu-card-title{margin-bottom:26px}
.edu-card-title h2{font-size:21px;font-weight:800;color:#1f3b88}
.edu-card-title h2 .orange{color:#ffa500}
.edu-card-title p{font-size:13px;color:#5a6880;margin-top:5px;line-height:1.5}
.edu-tabs{display:flex;margin-bottom:22px;border-bottom:2px solid #d0d7e3}
.edu-tab{flex:1;text-align:center;padding:10px;font-size:14px;font-weight:600;color:#5a6880;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px;transition:all .2s}
.edu-tab.active{color:#1f3b88;border-bottom-color:#1f3b88}
.edu-form{display:none}
.edu-form.active{display:block}
.edu-field{margin-bottom:13px}
.edu-field label{font-size:12px;font-weight:600;color:#5a6880;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;display:block}
.edu-field input{width:100%;padding:10px 12px;border:1.5px solid #d0d7e3;border-radius:8px;font-size:14px;transition:border .2s;box-sizing:border-box}
.edu-field input:focus{outline:none;border-color:#1f3b88;box-shadow:0 0 0 3px rgba(31,59,136,.1)}
.edu-btn{width:100%;padding:12px;border:none;border-radius:8px;background:#1f3b88;color:#fff;font-size:15px;font-weight:700;cursor:pointer;transition:all .2s;margin-top:4px;display:block}
.edu-btn:hover{background:#2a4fad}
.edu-btn:disabled{opacity:.6;cursor:not-allowed}
.edu-err{font-size:13px;color:#dc2626;background:#fee2e2;border:1px solid #fecaca;border-radius:6px;padding:8px 12px;margin-bottom:13px;display:none}
.edu-err.show{display:block}
.edu-note{font-size:11px;color:#5a6880;text-align:center;margin-top:14px;line-height:1.5}
.edu-fp-link{font-size:12px;color:#1f3b88;cursor:pointer;text-align:right;display:block;margin-top:6px;margin-bottom:2px;text-decoration:underline;opacity:.8}
.edu-fp-link:hover{opacity:1}
.edu-fp-panel{display:none;margin-top:14px;padding-top:14px;border-top:1px solid #d0d7e3}
.edu-fp-panel.show{display:block}
.edu-fp-success{font-size:13px;color:#166534;background:#dcfce7;border:1px solid #bbf7d0;border-radius:6px;padding:8px 12px;margin-bottom:10px;display:none}
.edu-fp-success.show{display:block}
@media(max-width:820px){
  .edu-auth-overlay{flex-direction:column}
  .edu-auth-hero{flex:none;padding:24px 20px 18px}
  .edu-auth-headline{font-size:20px}
  .edu-auth-sub,.edu-features,.edu-auth-divider,.edu-auth-tagline{display:none}
  .edu-form-panel{padding:28px 20px}
}
/* ── Password reset overlay ───────────────────────── */
.edu-reset-overlay{position:fixed;inset:0;background:#0a1432;z-index:3000;display:none;align-items:center;justify-content:center}
.edu-reset-overlay.show{display:flex}
.edu-reset-card{background:#fff;border-radius:16px;padding:36px 32px;width:100%;max-width:360px;margin:20px;box-shadow:0 24px 60px rgba(0,0,0,.35)}
.edu-reset-card h2{font-size:20px;font-weight:800;color:#1f3b88;margin-bottom:6px}
.edu-reset-card p{font-size:13px;color:#5a6880;margin-bottom:22px;line-height:1.5}
`;

  // ── Auth overlay HTML ──────────────────────────────────────────────────────
  const AUTH_OVERLAY_HTML = `
<div id="eduAuthOverlay" class="edu-auth-overlay hidden">
  <div class="edu-auth-hero">
    <div class="edu-auth-logo">
      <img src="/Logo.png" alt="AeroB Edu logo">
      <div class="edu-auth-logo-text">
        <h1>Aero<span class="orange">B</span> Edu</h1>
        <p>Vlaams Middelbaar Onderwijs</p>
      </div>
    </div>
    <div class="edu-auth-headline">Leer stap voor stap.<br><em>Interactief en visueel.</em></div>
    <p class="edu-auth-sub">Meld je aan om toegang te krijgen tot interactieve tools, stap-voor-stap oefeningen en uitleg — afgestemd op het Vlaams middelbaar onderwijs.</p>
    <ul class="edu-features">
      <li class="edu-feature">
        <span class="edu-feature-icon">📐</span>
        <div class="edu-feature-text"><h4>Wiskunde</h4><p>Gauss-Jordan eliminatie, matrices en meer — elke stap uitgelegd.</p></div>
      </li>
      <li class="edu-feature">
        <span class="edu-feature-icon">⚛️</span>
        <div class="edu-feature-text"><h4>Meer vakken binnenkort</h4><p>Fysica, chemie en andere vakken worden toegevoegd.</p></div>
      </li>
      <li class="edu-feature">
        <span class="edu-feature-icon">🎓</span>
        <div class="edu-feature-text"><h4>Afgestemd op de eindtermen</h4><p>Terminologie en werkwijze conform het Vlaams leerplan.</p></div>
      </li>
    </ul>
    <hr class="edu-auth-divider">
    <p class="edu-auth-tagline">AeroB Edu · aerob.be</p>
  </div>
  <div class="edu-form-panel">
    <div class="edu-card">
      <div class="edu-card-title">
        <h2>Welkom bij Aero<span class="orange">B</span> Edu</h2>
        <p>Meld je aan of maak een gratis account aan om verder te gaan.</p>
      </div>
      <div class="edu-tabs">
        <div class="edu-tab active" id="eduTabLogin" onclick="eduShowTab('login')">Aanmelden</div>
        <div class="edu-tab" id="eduTabRegister" onclick="eduShowTab('register')">Account aanmaken</div>
      </div>
      <div class="edu-form active" id="eduFormLogin">
        <div class="edu-err" id="eduLoginErr"></div>
        <div class="edu-field"><label>E-mailadres</label><input type="email" id="eduLoginEmail" placeholder="jij@voorbeeld.com" autocomplete="email"></div>
        <div class="edu-field"><label>Wachtwoord</label><input type="password" id="eduLoginPass" placeholder="••••••••" autocomplete="current-password"></div>
        <span class="edu-fp-link" onclick="eduToggleForgot()">Wachtwoord vergeten?</span>
        <div class="edu-fp-panel" id="eduFpPanel">
          <div class="edu-err" id="eduFpErr"></div>
          <div class="edu-fp-success" id="eduFpSuccess">Controleer je inbox — een herstelkoppeling is verstuurd.</div>
          <div class="edu-field"><label>Jouw e-mailadres</label><input type="email" id="eduFpEmail" placeholder="jij@voorbeeld.com" autocomplete="email"></div>
          <button class="edu-btn" id="eduFpBtn" onclick="eduDoForgot()" style="margin-top:0">Herstelkoppeling versturen</button>
          <span class="edu-fp-link" onclick="eduToggleForgot()" style="text-align:center;margin-top:8px">← Terug naar aanmelden</span>
        </div>
        <button class="edu-btn" id="eduLoginBtn" onclick="eduDoLogin()">Aanmelden</button>
        <p class="edu-note">Jouw gegevens worden veilig opgeslagen in de cloud.</p>
      </div>
      <div class="edu-form" id="eduFormRegister">
        <div class="edu-err" id="eduRegErr"></div>
        <div class="edu-field"><label>E-mailadres</label><input type="email" id="eduRegEmail" placeholder="jij@voorbeeld.com" autocomplete="email"></div>
        <div class="edu-field"><label>Naam <span style="font-weight:400;text-transform:none">(optioneel)</span></label><input type="text" id="eduRegName" placeholder="Jouw naam" autocomplete="name"></div>
        <div class="edu-field"><label>Wachtwoord</label><input type="password" id="eduRegPass" placeholder="minimaal 6 tekens" autocomplete="new-password"></div>
        <div class="edu-field"><label>Wachtwoord herhalen</label><input type="password" id="eduRegPass2" placeholder="herhaal wachtwoord" autocomplete="new-password"></div>
        <button class="edu-btn" id="eduRegBtn" onclick="eduDoRegister()">Account aanmaken</button>
        <p class="edu-note">Gratis account — gegevens beveiligd met rijniveau beveiliging.</p>
      </div>
    </div>
  </div>
</div>

<div id="eduResetOverlay" class="edu-reset-overlay">
  <div class="edu-reset-card">
    <h2>Nieuw wachtwoord instellen</h2>
    <p>Kies een sterk wachtwoord voor jouw AeroB Edu account.</p>
    <div class="edu-err" id="eduResetErr"></div>
    <div class="edu-fp-success" id="eduResetSuccess">Wachtwoord bijgewerkt! Je wordt aangemeld…</div>
    <div class="edu-field"><label>Nieuw wachtwoord</label><input type="password" id="eduResetPass" placeholder="minimaal 6 tekens" autocomplete="new-password"></div>
    <div class="edu-field"><label>Wachtwoord herhalen</label><input type="password" id="eduResetPass2" placeholder="herhaal wachtwoord" autocomplete="new-password"></div>
    <button class="edu-btn" id="eduResetBtn" onclick="eduDoPasswordUpdate()">Wachtwoord bijwerken</button>
  </div>
</div>
`;

  // ── Internal helpers ───────────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('aerob-edu-css')) return;
    const el = document.createElement('style');
    el.id = 'aerob-edu-css';
    el.textContent = PLATFORM_CSS;
    document.head.appendChild(el);
  }

  function _injectOverlays() {
    if (document.getElementById('eduAuthOverlay')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = AUTH_OVERLAY_HTML;
    while (wrap.firstChild) document.body.insertBefore(wrap.firstChild, document.body.firstChild);
  }

  function _injectNav(appId) {
    const header = document.querySelector('.edu-header');
    if (!header || header.querySelector('.edu-nav')) return;
    const nav = document.createElement('nav');
    nav.className = 'edu-nav';
    nav.setAttribute('aria-label', 'AeroB Edu navigatie');
    const links = MODULES.filter(m => m.id !== appId);
    links.forEach((m, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'edu-nav-sep';
        sep.textContent = '·';
        nav.appendChild(sep);
      }
      const a = document.createElement('a');
      a.href = m.path;
      a.className = 'edu-nav-link';
      a.textContent = m.label;
      nav.appendChild(a);
    });
    const h1 = header.querySelector('h1');
    header.insertBefore(nav, h1 ? h1.nextSibling : null);
  }

  function _showOverlay() {
    document.getElementById('eduAuthOverlay')?.classList.remove('hidden');
  }

  function _hideOverlay() {
    document.getElementById('eduAuthOverlay')?.classList.add('hidden');
  }

  // ── Public init ────────────────────────────────────────────────────────────
  async function init(appId, { onReady } = {}) {
    _appId   = appId;
    _onReady = onReady;

    _injectCSS();
    _injectOverlays();
    _injectNav(appId);

    // Enter key shortcuts for auth overlay
    document.addEventListener('keydown', e => {
      const overlay = document.getElementById('eduAuthOverlay');
      if (!overlay || overlay.classList.contains('hidden')) return;
      if (e.key === 'Enter') {
        const active = document.querySelector('#eduFormLogin.active, #eduFormRegister.active');
        if (active?.id === 'eduFormLogin') eduDoLogin();
        else if (active?.id === 'eduFormRegister') eduDoRegister();
      }
    });
    document.getElementById('eduResetPass')?.addEventListener('keydown',  e => { if (e.key === 'Enter') eduDoPasswordUpdate(); });
    document.getElementById('eduResetPass2')?.addEventListener('keydown', e => { if (e.key === 'Enter') eduDoPasswordUpdate(); });

    // Restore existing session
    const user = await EduAuth.getSession();
    if (user) {
      _currentUser = user;
      _hideOverlay();
      if (_onReady) _onReady(user);
    } else {
      _showOverlay();
    }

    // Handle password recovery link
    _eduSb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        _hideOverlay();
        document.getElementById('eduResetOverlay')?.classList.add('show');
      }
    });
  }

  function _onAuthSuccess(user) {
    _currentUser = user;
    _hideOverlay();
    if (_onReady) _onReady(user);
  }

  return {
    init,
    get currentUser() { return _currentUser; },
    MODULES,
    _onAuthSuccess,
    _showOverlay,
    _hideOverlay,
  };
})();

// ═══════════════════════════════════════════════════════════════════
// Global auth handler functions (Dutch)
// Called from onclick attributes in the injected auth overlay HTML.
// ═══════════════════════════════════════════════════════════════════

function eduShowTab(tab) {
  document.getElementById('eduFormLogin')?.classList.toggle('active', tab === 'login');
  document.getElementById('eduFormRegister')?.classList.toggle('active', tab === 'register');
  document.getElementById('eduTabLogin')?.classList.toggle('active', tab === 'login');
  document.getElementById('eduTabRegister')?.classList.toggle('active', tab === 'register');
  document.getElementById('eduLoginErr')?.classList.remove('show');
  document.getElementById('eduRegErr')?.classList.remove('show');
}

async function eduDoLogin() {
  const btn = document.getElementById('eduLoginBtn');
  const err = document.getElementById('eduLoginErr');
  if (!btn || !err) return;
  err.classList.remove('show');
  btn.disabled = true; btn.textContent = 'Aanmelden…';
  try {
    const user = await EduAuth.login(
      document.getElementById('eduLoginEmail').value,
      document.getElementById('eduLoginPass').value
    );
    EduPlatform._onAuthSuccess(user);
  } catch (e) {
    err.textContent = e.message; err.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Aanmelden';
  }
}

async function eduDoRegister() {
  const btn = document.getElementById('eduRegBtn');
  const err = document.getElementById('eduRegErr');
  if (!btn || !err) return;
  err.classList.remove('show');
  const p1 = document.getElementById('eduRegPass').value;
  const p2 = document.getElementById('eduRegPass2').value;
  if (p1 !== p2) { err.textContent = 'Wachtwoorden komen niet overeen'; err.classList.add('show'); return; }
  btn.disabled = true; btn.textContent = 'Account aanmaken…';
  try {
    const user = await EduAuth.register(
      document.getElementById('eduRegEmail').value, p1,
      document.getElementById('eduRegName').value
    );
    EduPlatform._onAuthSuccess(user);
  } catch (e) {
    err.textContent = e.message; err.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Account aanmaken';
  }
}

async function eduDoLogout() {
  await EduAuth.logout();
  EduPlatform._showOverlay();
}

function eduToggleForgot() {
  const panel = document.getElementById('eduFpPanel');
  panel?.classList.toggle('show');
  if (panel?.classList.contains('show')) {
    const emailVal = document.getElementById('eduLoginEmail')?.value;
    if (emailVal) document.getElementById('eduFpEmail').value = emailVal;
  }
}

async function eduDoForgot() {
  const btn  = document.getElementById('eduFpBtn');
  const err  = document.getElementById('eduFpErr');
  const succ = document.getElementById('eduFpSuccess');
  if (!btn) return;
  err?.classList.remove('show'); succ?.classList.remove('show');
  const email = document.getElementById('eduFpEmail')?.value;
  if (!email) { if (err) { err.textContent = 'Vul je e-mailadres in'; err.classList.add('show'); } return; }
  btn.disabled = true; btn.textContent = 'Versturen…';
  try {
    await EduAuth.resetPassword(email);
    succ?.classList.add('show');
    btn.textContent = 'Koppeling verstuurd';
  } catch (e) {
    if (err) { err.textContent = e.message; err.classList.add('show'); }
    btn.disabled = false; btn.textContent = 'Herstelkoppeling versturen';
  }
}

async function eduDoPasswordUpdate() {
  const btn  = document.getElementById('eduResetBtn');
  const err  = document.getElementById('eduResetErr');
  const succ = document.getElementById('eduResetSuccess');
  if (!btn) return;
  err?.classList.remove('show');
  const p1 = document.getElementById('eduResetPass')?.value;
  const p2 = document.getElementById('eduResetPass2')?.value;
  if (p1 !== p2) { if (err) { err.textContent = 'Wachtwoorden komen niet overeen'; err.classList.add('show'); } return; }
  if (!p1 || p1.length < 6) { if (err) { err.textContent = 'Wachtwoord moet minimaal 6 tekens zijn'; err.classList.add('show'); } return; }
  btn.disabled = true; btn.textContent = 'Bijwerken…';
  try {
    await EduAuth.updatePassword(p1);
    succ?.classList.add('show');
    setTimeout(async () => {
      document.getElementById('eduResetOverlay')?.classList.remove('show');
      const user = await EduAuth.getSession();
      if (user) EduPlatform._onAuthSuccess(user);
    }, 1800);
  } catch (e) {
    if (err) { err.textContent = e.message; err.classList.add('show'); }
    btn.disabled = false; btn.textContent = 'Wachtwoord bijwerken';
  }
}
