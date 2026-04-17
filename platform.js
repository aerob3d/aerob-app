// ═══════════════════════════════════════════════════════════════════
// platform.js — AeroB Unified Platform Layer
//
// Single file loaded by every AeroB app page. Provides:
//   • Supabase client (_sb) shared across the origin
//   • Auth, Plans, AnalysisStore, uploadFitFile modules
//   • Unified auth overlay UI (injected into DOM)
//   • Unified password-reset overlay (injected into DOM)
//   • Cross-tool navigation bar
//   • Global auth handler functions called by overlay onclick attributes
//   • AeroBPlatform.init(appId, { onReady }) — call from DOMContentLoaded
//
// Session sharing works automatically because all tools live under the
// same origin (app.aerob.be), so localStorage is shared between paths.
// ═══════════════════════════════════════════════════════════════════

// ── Supabase client ──────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://yobvrleuwmchsxkpcshv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tOLuYgic96IH1vg9QHLfVw_BV1hPMAv';
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Auth module ──────────────────────────────────────────────────────────────
const Auth = (() => {
  function _mapUser(session) {
    if (!session) return null;
    const u = session.user;
    return {
      id:          u.id,
      username:    u.email,
      displayName: (u.user_metadata && u.user_metadata.display_name) || u.email.split('@')[0],
      email:       u.email,
    };
  }

  async function getSession() {
    const { data: { session } } = await _sb.auth.getSession();
    return _mapUser(session);
  }

  async function login(email, password) {
    const { data, error } = await _sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return _mapUser(data.session);
  }

  async function register(email, password, displayName) {
    const name = (displayName && displayName.trim()) || email.split('@')[0];
    const { data, error } = await _sb.auth.signUp({
      email, password,
      options: { data: { display_name: name } },
    });
    if (error) throw new Error(error.message);
    if (!data.session) throw new Error('Account created! Check your inbox to confirm your email, then sign in.');
    return _mapUser(data.session);
  }

  async function logout() {
    await _sb.auth.signOut();
  }

  async function loadSetups(userId) {
    const { data, error } = await _sb
      .from('setups')
      .select('id, name, color, data_points, created_at')
      .order('created_at', { ascending: true });
    if (error) { console.warn('Auth.loadSetups:', error.message); return []; }
    return (data || []).map(row => ({
      id:         row.id,
      name:       row.name,
      color:      row.color,
      dataPoints: row.data_points,
    }));
  }

  async function saveSetups(userId, setupsArray) {
    const { error: delErr } = await _sb.from('setups').delete().eq('user_id', userId);
    if (delErr) { console.warn('Auth.saveSetups delete:', delErr.message); return; }
    if (!setupsArray.length) return;
    const rows = setupsArray.map(s => ({
      id: s.id, user_id: userId, name: s.name, color: s.color, data_points: s.dataPoints,
    }));
    const { error: insErr } = await _sb.from('setups').insert(rows);
    if (insErr) console.warn('Auth.saveSetups insert:', insErr.message);
  }

  async function resetPassword(email) {
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await _sb.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw new Error(error.message);
  }

  async function updatePassword(newPassword) {
    const { error } = await _sb.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
  }

  return { getSession, login, register, logout, loadSetups, saveSetups, resetPassword, updatePassword };
})();

// ── AnalysisStore module ─────────────────────────────────────────────────────
const AnalysisStore = (() => {
  const SCHEMA_VERSION = 1;

  function buildRecord({ username, fileName, config, weather, windStats, lapResults, summary }) {
    return {
      id:            'ar_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      schemaVersion: SCHEMA_VERSION,
      createdAt:     Date.now(),
      source:        { fileName },
      config: {
        massTotal:          config.massTotal,
        crr:                config.crr,
        drivetrainLossFrac: config.drivetrainLossFrac,
        rho:                config.rho,
        windMode:           config.windMode,
        windSpeedMs:        config.windSpeedMs,
        windFromDeg:        config.windFromDeg,
        elevationMode:      config.elevationMode,
      },
      weather: weather ? {
        source:      weather.source,
        tempC:       weather.meanTemp,
        pressureHpa: weather.meanP,
        humidityPct: weather.meanRh,
        rho:         weather.rho,
        windSpeedMs: weather.meanWs,
        windFromDeg: weather.meanWd,
      } : null,
      windStats: windStats || null,
      laps: lapResults.map(l => ({
        lapId:           l.lapId,
        cda:             l.cda,
        rmse:            l.rmse,
        nrmse:           l.nrmse ?? null,
        durationS:       l.durationS,
        avgSpeedKmh:     l.avgSpeedKmh,
        avgPowerW:       l.avgPowerW,
        avgHeartRateBpm: l.avgHeartRateBpm,
        quality:         l.quality,
      })),
      summary: summary ? {
        avgCda:      summary.avgCda,
        stddev:      summary.stddevCda,
        minCda:      summary.minCda,
        maxCda:      summary.maxCda,
        avgRmse:     summary.avgRmse,
        avgNrmse:    summary.avgNrmse ?? null,
        avgSpeedKmh: summary.avgSpd,
        validLaps:   summary.validCount,
        totalLaps:   summary.totalCount,
      } : null,
    };
  }

  async function save(userId, record) {
    const { error } = await _sb.from('analyses').insert({
      id:         record.id,
      user_id:    userId,
      file_name:  record.source && record.source.fileName,
      config:     record.config,
      weather:    record.weather,
      wind_stats: record.windStats,
      laps:       record.laps,
      summary:    record.summary,
    });
    if (error) { console.warn('AnalysisStore.save:', error.message); throw new Error(error.message); }
    return record;
  }

  async function loadAll(userId) {
    const { data, error } = await _sb
      .from('analyses')
      .select('id, created_at, file_name, config, weather, wind_stats, laps, summary')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) { console.warn('AnalysisStore.loadAll:', error.message); return []; }
    return (data || []).map(row => ({
      id:            row.id,
      schemaVersion: SCHEMA_VERSION,
      createdAt:     new Date(row.created_at).getTime(),
      source:        { fileName: row.file_name },
      config:        row.config,
      weather:       row.weather,
      windStats:     row.wind_stats,
      laps:          row.laps,
      summary:       row.summary,
    }));
  }

  async function deleteRecord(id) {
    const { error } = await _sb.from('analyses').delete().eq('id', id);
    if (error) { console.warn('AnalysisStore.deleteRecord:', error.message); return false; }
    return true;
  }

  return { buildRecord, save, loadAll, deleteRecord };
})();

// ── Plans module ─────────────────────────────────────────────────────────────
const Plans = (() => {
  const FREE_MONTHLY_LIMIT = 3;

  async function getUserPlan() {
    const { data: { user } } = await _sb.auth.getUser();
    if (!user) return { plan: 'free', status: 'none', periodEnd: null, cancelAtEnd: false, customerId: null };
    try {
      const { data: rows, error: rpcErr } = await _sb.rpc('get_my_internal_access');
      if (!rpcErr && rows && rows.length > 0 && rows[0].pro_override) {
        return { plan: 'pro', status: 'internal', periodEnd: null, cancelAtEnd: false, customerId: null,
          isInternal: true, internalRole: rows[0].role };
      }
    } catch (e) {
      console.warn('Plans.getUserPlan: get_my_internal_access() unavailable:', e.message);
    }
    const { data, error } = await _sb
      .from('user_entitlements')
      .select('plan, subscription_status, current_period_end, cancel_at_period_end, stripe_customer_id')
      .eq('user_id', user.id)
      .single();
    if (error || !data) return { plan: 'free', status: 'none', periodEnd: null, cancelAtEnd: false, customerId: null };
    return {
      plan:        data.plan,
      status:      data.subscription_status,
      periodEnd:   data.current_period_end,
      cancelAtEnd: data.cancel_at_period_end,
      customerId:  data.stripe_customer_id,
    };
  }

  async function getMonthlyAnalysisCount() {
    const { data: { user } } = await _sb.auth.getUser();
    if (!user) return 0;
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { count, error } = await _sb.from('analyses').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('created_at', startOfMonth);
    if (error) { console.warn('Plans.getMonthlyAnalysisCount:', error.message); return 0; }
    return count ?? 0;
  }

  async function canRunAnalysis() {
    const plan = await getUserPlan();
    if (plan.plan === 'pro') return { allowed: true, count: null, limit: null, plan };
    const count = await getMonthlyAnalysisCount();
    return { allowed: count < FREE_MONTHLY_LIMIT, count, limit: FREE_MONTHLY_LIMIT, plan };
  }

  async function startCheckout() {
    const { data: { session } } = await _sb.auth.getSession();
    if (!session) throw new Error('Not logged in');
    const { data, error } = await _sb.functions.invoke('create-checkout-session', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (error) throw new Error(error.message || 'Checkout failed');
    if (!data?.url) throw new Error('No checkout URL returned');
    return data.url;
  }

  async function openPortal() {
    const { data: { session } } = await _sb.auth.getSession();
    if (!session) throw new Error('Not logged in');
    const { data, error } = await _sb.functions.invoke('create-portal-session', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (error) throw new Error(error.message || 'Portal session failed');
    if (!data?.url) throw new Error('No portal URL returned');
    return data.url;
  }

  return { getUserPlan, getMonthlyAnalysisCount, canRunAnalysis, startCheckout, openPortal, FREE_MONTHLY_LIMIT };
})();

// ── uploadFitFile ─────────────────────────────────────────────────────────────
async function uploadFitFile(userId, file) {
  const MAX_BYTES = 25 * 1024 * 1024;
  if (file.size > MAX_BYTES) { console.warn('uploadFitFile: file exceeds 25 MB'); return null; }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${userId}/${Date.now()}_${safeName}`;
  const { data, error } = await _sb.storage.from('fit-files')
    .upload(path, file, { contentType: 'application/octet-stream', upsert: false });
  if (error) { console.warn('uploadFitFile:', error.message); return null; }
  return data.path;
}

// ═══════════════════════════════════════════════════════════════════
// AeroBPlatform — shared UI layer
// ═══════════════════════════════════════════════════════════════════
const AeroBPlatform = (() => {

  const TOOLS = [
    { id: 'portal',     label: '⌂ Dashboard',      path: '/' },
    { id: 'estimation', label: '📐 CdA Estimator',  path: '/estimation' },
    { id: 'raceview',   label: '🏔️ RaceView',        path: '/raceview' },
  ];

  let _currentUser = null;
  let _appId = null;
  let _onReady = null;

  // ── CSS ────────────────────────────────────────────────────────────────────
  const PLATFORM_CSS = `
/* ── Platform nav ─────────────────────────────────── */
.platform-nav{display:flex;align-items:center;gap:4px;margin-left:10px}
.platform-nav-link{font-size:12px;color:rgba(255,255,255,.75);text-decoration:none;padding:4px 10px;border-radius:10px;transition:all .2s;white-space:nowrap}
.platform-nav-link:hover{background:rgba(255,255,255,.14);color:#fff}
.platform-nav-sep{color:rgba(255,255,255,.25);font-size:11px;margin:0 2px}

/* ── Auth overlay ─────────────────────────────────── */
.auth-overlay{position:fixed;inset:0;background:#0a1432;z-index:2000;display:flex;align-items:stretch}
.auth-overlay.hidden{display:none!important}
.auth-hero{flex:0 0 56%;display:flex;flex-direction:column;justify-content:center;padding:60px 64px;position:relative;overflow:hidden;background:linear-gradient(150deg,#071020 0%,#0f2460 45%,#1f3b88 100%)}
.auth-hero::before{content:'';position:absolute;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(255,165,0,.12) 0%,transparent 70%);top:-160px;right:-160px;pointer-events:none}
.auth-hero::after{content:'';position:absolute;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.05) 0%,transparent 70%);bottom:-120px;left:-80px;pointer-events:none}
.auth-hero-deco{position:absolute;top:0;right:0;bottom:0;width:140px;opacity:.06;pointer-events:none;overflow:hidden}
.auth-hero-deco span{display:block;height:2px;background:#fff;margin:22px 0;transform-origin:right center}
.auth-hero-deco span:nth-child(odd){margin-left:30px}
.auth-hero-deco span:nth-child(3n){background:#ffa500;opacity:.6}
.auth-hero-logo{display:flex;align-items:center;gap:18px;margin-bottom:44px;position:relative;z-index:1}
.auth-hero-logo img{width:80px;height:auto;flex-shrink:0;filter:brightness(0) invert(1)}
.auth-hero-logo-text h1{font-size:26px;font-weight:800;color:#fff;line-height:1.1}
.auth-hero-logo-text h1 span{color:#ffa500}
.auth-hero-logo-text p{font-size:12px;color:rgba(255,255,255,.5);margin-top:4px;letter-spacing:.5px;text-transform:uppercase}
.auth-hero-headline{font-size:34px;font-weight:800;color:#fff;line-height:1.25;margin-bottom:14px;position:relative;z-index:1}
.auth-hero-headline em{color:#ffa500;font-style:normal}
.auth-hero-sub{font-size:14px;color:rgba(255,255,255,.65);line-height:1.7;margin-bottom:40px;max-width:420px;position:relative;z-index:1}
.auth-features{list-style:none;display:flex;flex-direction:column;gap:18px;position:relative;z-index:1}
.auth-feature{display:flex;align-items:flex-start;gap:14px}
.auth-feature-icon{font-size:22px;flex-shrink:0;margin-top:1px;width:36px;height:36px;background:rgba(255,255,255,.08);border-radius:8px;display:flex;align-items:center;justify-content:center}
.auth-feature-text h4{font-size:13px;font-weight:700;color:#fff;margin-bottom:3px}
.auth-feature-text p{font-size:12px;color:rgba(255,255,255,.55);line-height:1.5}
.auth-hero-divider{border:none;border-top:1px solid rgba(255,255,255,.1);margin:36px 0 28px;position:relative;z-index:1}
.auth-hero-tagline{font-size:11px;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.8px;position:relative;z-index:1}
.auth-form-panel{flex:1;display:flex;align-items:center;justify-content:center;background:#fff;padding:48px 40px;overflow-y:auto}
.auth-card{width:100%;max-width:360px}
.auth-card-title{margin-bottom:28px}
.auth-card-title h2{font-size:22px;font-weight:800;color:#1f3b88}
.auth-card-title h2 span{color:#ffa500}
.auth-card-title p{font-size:13px;color:#5a6880;margin-top:5px;line-height:1.5}
.auth-tabs{display:flex;margin-bottom:24px;border-bottom:2px solid #d0d7e3}
.auth-tab{flex:1;text-align:center;padding:10px;font-size:14px;font-weight:600;color:#5a6880;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px;transition:all .2s}
.auth-tab.active{color:#1f3b88;border-bottom-color:#1f3b88}
.auth-form{display:none}
.auth-form.active{display:block}
.auth-field{margin-bottom:14px}
.auth-field label{font-size:12px;font-weight:600;color:#5a6880;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;display:block}
.auth-field input{width:100%;padding:10px 12px;border:1.5px solid #d0d7e3;border-radius:8px;font-size:14px;transition:border .2s;box-sizing:border-box}
.auth-field input:focus{outline:none;border-color:#1f3b88;box-shadow:0 0 0 3px rgba(31,59,136,.1)}
.auth-btn{width:100%;padding:12px;border:none;border-radius:8px;background:#1f3b88;color:#fff;font-size:15px;font-weight:700;cursor:pointer;transition:all .2s;margin-top:4px;display:block}
.auth-btn:hover{background:#2a4fad}
.auth-btn:disabled{opacity:.6;cursor:not-allowed}
.auth-err{font-size:13px;color:#dc2626;background:#fee2e2;border:1px solid #fecaca;border-radius:6px;padding:8px 12px;margin-bottom:14px;display:none}
.auth-err.show{display:block}
.auth-note{font-size:11px;color:#5a6880;text-align:center;margin-top:16px;line-height:1.5}
.auth-fp-link{font-size:12px;color:#1f3b88;cursor:pointer;text-align:right;display:block;margin-top:6px;margin-bottom:2px;text-decoration:underline;opacity:.8}
.auth-fp-link:hover{opacity:1}
.auth-fp-panel{display:none;margin-top:14px;padding-top:14px;border-top:1px solid #d0d7e3}
.auth-fp-panel.show{display:block}
.auth-fp-success{font-size:13px;color:#166534;background:#dcfce7;border:1px solid #bbf7d0;border-radius:6px;padding:8px 12px;margin-bottom:10px;display:none}
.auth-fp-success.show{display:block}
@media(max-width:820px){
  .auth-overlay{flex-direction:column}
  .auth-hero{flex:none;padding:28px 24px 20px}
  .auth-hero-headline{font-size:22px}
  .auth-hero-sub,.auth-features,.auth-hero-divider,.auth-hero-tagline{display:none}
  .auth-form-panel{padding:28px 20px}
}

/* ── Password reset overlay ───────────────────────── */
.auth-reset-overlay{position:fixed;inset:0;background:#0a1432;z-index:3000;display:none;align-items:center;justify-content:center}
.auth-reset-overlay.show{display:flex}
.auth-reset-card{background:#fff;border-radius:16px;padding:36px 32px;width:100%;max-width:360px;margin:20px;box-shadow:0 24px 60px rgba(0,0,0,.35)}
.auth-reset-card h2{font-size:20px;font-weight:800;color:#1f3b88;margin-bottom:6px}
.auth-reset-card p{font-size:13px;color:#5a6880;margin-bottom:22px;line-height:1.5}
`;

  // ── Auth overlay HTML ──────────────────────────────────────────────────────
  const AUTH_OVERLAY_HTML = `
<div id="authOverlay" class="auth-overlay hidden">
  <div class="auth-hero">
    <div class="auth-hero-deco">
      <span style="width:80%"></span><span style="width:60%"></span><span style="width:95%"></span>
      <span style="width:50%"></span><span style="width:75%"></span><span style="width:40%"></span>
      <span style="width:90%"></span><span style="width:65%"></span><span style="width:55%"></span>
      <span style="width:85%"></span><span style="width:45%"></span><span style="width:70%"></span>
    </div>
    <div class="auth-hero-logo">
      <img src="/Logo.png" alt="AeroB logo">
      <div class="auth-hero-logo-text">
        <h1>Aero<span>B</span></h1>
        <p>Performance Analysis Platform</p>
      </div>
    </div>
    <div class="auth-hero-headline">One account.<br><em>All AeroB tools.</em></div>
    <p class="auth-hero-sub">Sign in once to access the CdA Estimator, RaceView course preview, and every future tool — all under one account.</p>
    <ul class="auth-features">
      <li class="auth-feature">
        <span class="auth-feature-icon">📐</span>
        <div class="auth-feature-text"><h4>CdA Estimator</h4><p>Physics-based aerodynamic drag calculation from field-test ride data.</p></div>
      </li>
      <li class="auth-feature">
        <span class="auth-feature-icon">🏔️</span>
        <div class="auth-feature-text"><h4>RaceView</h4><p>GPX course preview with Street View ride-through and elevation overlay.</p></div>
      </li>
      <li class="auth-feature">
        <span class="auth-feature-icon">☁️</span>
        <div class="auth-feature-text"><h4>Cloud sync</h4><p>All analyses and setups saved securely — accessible from any device.</p></div>
      </li>
    </ul>
    <hr class="auth-hero-divider">
    <p class="auth-hero-tagline">AeroB · aerob.be</p>
  </div>
  <div class="auth-form-panel">
    <div class="auth-card">
      <div class="auth-card-title">
        <h2>Welcome to Aero<span>B</span></h2>
        <p>Sign in to your account or create a new one to get started.</p>
      </div>
      <div class="auth-tabs">
        <div class="auth-tab active" id="tabLogin" onclick="showAuthTab('login')">Sign In</div>
        <div class="auth-tab" id="tabRegister" onclick="showAuthTab('register')">Create Account</div>
      </div>
      <div class="auth-form active" id="formLogin">
        <div class="auth-err" id="loginErr"></div>
        <div class="auth-field"><label>Email</label><input type="email" id="loginUser" placeholder="you@example.com" autocomplete="email"></div>
        <div class="auth-field"><label>Password</label><input type="password" id="loginPass" placeholder="••••••••" autocomplete="current-password"></div>
        <span class="auth-fp-link" onclick="toggleForgotPassword()">Forgot password?</span>
        <div class="auth-fp-panel" id="fpPanel">
          <div class="auth-err" id="fpErr"></div>
          <div class="auth-fp-success" id="fpSuccess">Check your inbox — a reset link has been sent.</div>
          <div class="auth-field"><label>Your email</label><input type="email" id="fpEmail" placeholder="you@example.com" autocomplete="email"></div>
          <button class="auth-btn" id="fpBtn" onclick="doForgotPassword()" style="margin-top:0">Send Reset Link</button>
          <span class="auth-fp-link" onclick="toggleForgotPassword()" style="text-align:center;margin-top:8px">← Back to sign in</span>
        </div>
        <button class="auth-btn" id="loginBtn" onclick="doLogin()">Sign In</button>
        <p class="auth-note">Your analyses and setups sync to your account across all AeroB tools.</p>
      </div>
      <div class="auth-form" id="formRegister">
        <div class="auth-err" id="regErr"></div>
        <div class="auth-field"><label>Email</label><input type="email" id="regUser" placeholder="you@example.com" autocomplete="email"></div>
        <div class="auth-field"><label>Display Name <span style="font-weight:400;text-transform:none">(optional)</span></label><input type="text" id="regName" placeholder="Your name" autocomplete="name"></div>
        <div class="auth-field"><label>Password</label><input type="password" id="regPass" placeholder="at least 6 characters" autocomplete="new-password"></div>
        <div class="auth-field"><label>Confirm Password</label><input type="password" id="regPass2" placeholder="repeat password" autocomplete="new-password"></div>
        <button class="auth-btn" id="regBtn" onclick="doRegister()">Create Account</button>
        <p class="auth-note">Data stored securely in the cloud with Row Level Security.</p>
      </div>
    </div>
  </div>
</div>

<div id="resetOverlay" class="auth-reset-overlay">
  <div class="auth-reset-card">
    <h2>Set New Password</h2>
    <p>Choose a strong password for your AeroB account.</p>
    <div class="auth-err" id="resetErr"></div>
    <div class="auth-fp-success" id="resetSuccess">Password updated! Signing you in…</div>
    <div class="auth-field"><label>New Password</label><input type="password" id="resetPass" placeholder="at least 6 characters" autocomplete="new-password"></div>
    <div class="auth-field"><label>Confirm Password</label><input type="password" id="resetPass2" placeholder="repeat password" autocomplete="new-password"></div>
    <button class="auth-btn" id="resetBtn" onclick="doPasswordUpdate()">Update Password</button>
  </div>
</div>
`;

  // ── Internal helpers ───────────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('aerob-platform-css')) return;
    const el = document.createElement('style');
    el.id = 'aerob-platform-css';
    el.textContent = PLATFORM_CSS;
    document.head.appendChild(el);
  }

  function _injectOverlays() {
    if (document.getElementById('authOverlay')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = AUTH_OVERLAY_HTML;
    while (wrap.firstChild) document.body.insertBefore(wrap.firstChild, document.body.firstChild);
  }

  function _injectPlatformNav(appId) {
    const header = document.querySelector('.header');
    if (!header || header.querySelector('.platform-nav')) return;

    const nav = document.createElement('nav');
    nav.className = 'platform-nav';
    nav.setAttribute('aria-label', 'AeroB tools');

    const links = TOOLS.filter(t => t.id !== appId);
    links.forEach((t, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'platform-nav-sep';
        sep.textContent = '·';
        nav.appendChild(sep);
      }
      const a = document.createElement('a');
      a.href = t.path;
      a.className = 'platform-nav-link';
      a.textContent = t.label;
      nav.appendChild(a);
    });

    const h1 = header.querySelector('h1');
    const ref = h1 ? h1.nextSibling : null;
    header.insertBefore(nav, ref);
  }

  function _showAuthOverlay() {
    const el = document.getElementById('authOverlay');
    if (el) el.classList.remove('hidden');
  }

  function _hideAuthOverlay() {
    const el = document.getElementById('authOverlay');
    if (el) el.classList.add('hidden');
  }

  // ── Public init ────────────────────────────────────────────────────────────
  async function init(appId, { onReady } = {}) {
    _appId  = appId;
    _onReady = onReady;

    _injectCSS();
    _injectOverlays();
    _injectPlatformNav(appId);

    // Keyboard shortcuts for auth overlay
    document.addEventListener('keydown', e => {
      const overlay = document.getElementById('authOverlay');
      if (!overlay || overlay.classList.contains('hidden')) return;
      if (e.key === 'Enter') {
        const active = document.querySelector('#formLogin.active, #formRegister.active');
        if (active?.id === 'formLogin') doLogin();
        else if (active?.id === 'formRegister') doRegister();
      }
    });

    document.getElementById('resetPass')?.addEventListener('keydown',  e => { if (e.key === 'Enter') doPasswordUpdate(); });
    document.getElementById('resetPass2')?.addEventListener('keydown', e => { if (e.key === 'Enter') doPasswordUpdate(); });

    // Restore session
    const user = await Auth.getSession();
    if (user) {
      _currentUser = user;
      _hideAuthOverlay();
      if (_onReady) _onReady(user);
    } else {
      _showAuthOverlay();
    }

    // Auth state listener: PASSWORD_RECOVERY only — sign-out is handled per-app
    _sb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        _hideAuthOverlay();
        document.getElementById('resetOverlay')?.classList.add('show');
      }
    });
  }

  // Called after successful login/register from global auth functions below
  function _onAuthSuccess(user) {
    _currentUser = user;
    _hideAuthOverlay();
    if (_onReady) _onReady(user);
  }

  return {
    init,
    get currentUser() { return _currentUser; },
    TOOLS,
    _onAuthSuccess, // used by global doLogin / doRegister below
    _showAuthOverlay,
    _hideAuthOverlay,
  };
})();

// ═══════════════════════════════════════════════════════════════════
// Global auth handler functions
// Called from onclick attributes in the injected auth overlay HTML.
// Apps may override window.doLogout to add app-specific cleanup,
// but should call the original (AeroBPlatform version) to handle
// Auth.logout() and showing the overlay again.
// ═══════════════════════════════════════════════════════════════════

function showAuthTab(tab) {
  document.getElementById('formLogin')?.classList.toggle('active', tab === 'login');
  document.getElementById('formRegister')?.classList.toggle('active', tab === 'register');
  document.getElementById('tabLogin')?.classList.toggle('active', tab === 'login');
  document.getElementById('tabRegister')?.classList.toggle('active', tab === 'register');
  document.getElementById('loginErr')?.classList.remove('show');
  document.getElementById('regErr')?.classList.remove('show');
}

async function doLogin() {
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginErr');
  if (!btn || !err) return;
  err.classList.remove('show');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const user = await Auth.login(
      document.getElementById('loginUser').value,
      document.getElementById('loginPass').value
    );
    AeroBPlatform._onAuthSuccess(user);
  } catch (e) {
    err.textContent = e.message;
    err.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In';
  }
}

async function doRegister() {
  const btn = document.getElementById('regBtn');
  const err = document.getElementById('regErr');
  if (!btn || !err) return;
  err.classList.remove('show');
  const p1 = document.getElementById('regPass').value;
  const p2 = document.getElementById('regPass2').value;
  if (p1 !== p2) { err.textContent = 'Passwords do not match'; err.classList.add('show'); return; }
  btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    const user = await Auth.register(
      document.getElementById('regUser').value, p1,
      document.getElementById('regName').value
    );
    AeroBPlatform._onAuthSuccess(user);
  } catch (e) {
    err.textContent = e.message;
    err.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Create Account';
  }
}

// Base doLogout — apps can chain this by saving a reference before overriding.
// Handles Auth.logout() + shows auth overlay. App-specific cleanup should happen
// in the overriding function before (or after) calling this.
async function doLogout() {
  await Auth.logout();
  AeroBPlatform._showAuthOverlay();
}

function toggleForgotPassword() {
  const panel = document.getElementById('fpPanel');
  panel?.classList.toggle('show');
  if (panel?.classList.contains('show')) {
    const emailVal = document.getElementById('loginUser')?.value;
    if (emailVal) document.getElementById('fpEmail').value = emailVal;
  }
}

async function doForgotPassword() {
  const btn  = document.getElementById('fpBtn');
  const err  = document.getElementById('fpErr');
  const succ = document.getElementById('fpSuccess');
  if (!btn) return;
  err?.classList.remove('show'); succ?.classList.remove('show');
  const email = document.getElementById('fpEmail')?.value;
  if (!email) { if (err) { err.textContent = 'Enter your email above'; err.classList.add('show'); } return; }
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await Auth.resetPassword(email);
    succ?.classList.add('show');
    btn.textContent = 'Link Sent';
  } catch (e) {
    if (err) { err.textContent = e.message; err.classList.add('show'); }
    btn.disabled = false; btn.textContent = 'Send Reset Link';
  }
}

async function doPasswordUpdate() {
  const btn  = document.getElementById('resetBtn');
  const err  = document.getElementById('resetErr');
  const succ = document.getElementById('resetSuccess');
  if (!btn) return;
  err?.classList.remove('show');
  const p1 = document.getElementById('resetPass')?.value;
  const p2 = document.getElementById('resetPass2')?.value;
  if (p1 !== p2) { if (err) { err.textContent = 'Passwords do not match'; err.classList.add('show'); } return; }
  if (!p1 || p1.length < 6) { if (err) { err.textContent = 'Password must be at least 6 characters'; err.classList.add('show'); } return; }
  btn.disabled = true; btn.textContent = 'Updating…';
  try {
    await Auth.updatePassword(p1);
    succ?.classList.add('show');
    setTimeout(async () => {
      document.getElementById('resetOverlay')?.classList.remove('show');
      const user = await Auth.getSession();
      if (user) AeroBPlatform._onAuthSuccess(user);
    }, 1800);
  } catch (e) {
    if (err) { err.textContent = e.message; err.classList.add('show'); }
    btn.disabled = false; btn.textContent = 'Update Password';
  }
}
