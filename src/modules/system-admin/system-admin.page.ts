export const SYSTEM_ADMIN_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SMARTS System Admin</title>
  <style>
    :root { color-scheme: dark; --bg:#0e1117; --surface:#171c26; --surface-2:#202735; --line:#2d3748; --text:#eef2f8; --muted:#9aa8bb; --primary:#8b7cff; --primary-2:#6f5cf1; --green:#46d39a; --red:#ff7180; --amber:#f2bd68; }
    * { box-sizing:border-box; }
    body { margin:0; background:radial-gradient(circle at 75% -10%,#29315a 0,#141926 31%,var(--bg) 65%); color:var(--text); font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; min-height:100vh; }
    button,input,select { font:inherit; }
    button { border:0; cursor:pointer; }
    .hidden { display:none !important; }
    .login-shell { min-height:100vh; display:grid; place-items:center; padding:24px; }
    .login-card { width:min(430px,100%); background:rgba(23,28,38,.88); border:1px solid var(--line); border-radius:24px; padding:38px; box-shadow:0 24px 80px #0007; backdrop-filter:blur(16px); }
    .brand { display:flex; align-items:center; gap:13px; margin-bottom:30px; }
    .brand-mark { width:44px; height:44px; border-radius:14px; display:grid; place-items:center; color:white; font-weight:800; background:linear-gradient(135deg,var(--primary),#3fc1ff); box-shadow:0 8px 24px #7767ff55; }
    h1,h2,h3,p { margin-top:0; }
    h1 { font-size:27px; letter-spacing:-.03em; margin-bottom:8px; }
    h2 { font-size:21px; letter-spacing:-.02em; margin-bottom:5px; }
    .muted { color:var(--muted); }
    .field { display:grid; gap:7px; margin:17px 0; }
    label { color:#cbd4e2; font-weight:600; font-size:13px; }
    input,select { width:100%; color:var(--text); background:#10151e; border:1px solid var(--line); border-radius:10px; padding:12px 13px; outline:none; transition:.2s; }
    input:focus,select:focus { border-color:var(--primary); box-shadow:0 0 0 3px #8b7cff22; }
    .primary { color:white; background:linear-gradient(135deg,var(--primary),var(--primary-2)); border-radius:10px; padding:12px 17px; font-weight:700; box-shadow:0 8px 18px #6f5cf133; }
    .primary:hover { filter:brightness(1.1); }
    .secondary { color:#dce3ef; background:var(--surface-2); border:1px solid var(--line); border-radius:10px; padding:10px 14px; font-weight:650; }
    .danger { color:#ffadb5; background:#451d29; border:1px solid #74303d; border-radius:9px; padding:8px 11px; font-weight:650; }
    .link-button { background:none; color:#a99fff; padding:0; }
    .error { color:#ff9da8; background:#3c1c28; border:1px solid #6b2e3d; padding:10px 12px; border-radius:9px; margin:15px 0; }
    .app-shell { display:grid; grid-template-columns:246px 1fr; min-height:100vh; }
    .sidebar { padding:25px 17px; border-right:1px solid #263040; background:#11161fbb; }
    .side-brand { padding:6px 13px 34px; }
    .side-nav { display:grid; gap:7px; }
    .nav-item { color:#aab6c8; padding:12px 14px; border-radius:11px; text-align:left; background:none; }
    .nav-item.active,.nav-item:hover { color:#fff; background:#292549; }
    .side-foot { position:fixed; bottom:24px; width:210px; color:#768398; font-size:12px; }
    .main { padding:28px clamp(20px,4vw,52px) 50px; max-width:1500px; width:100%; }
    .topbar { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-bottom:30px; }
    .topbar-right { display:flex; align-items:center; gap:15px; }
    .avatar { width:35px; height:35px; border-radius:50%; display:grid; place-items:center; background:#332e64; color:#cfcaff; font-weight:800; }
    .stats { display:grid; grid-template-columns:repeat(4,minmax(150px,1fr)); gap:15px; margin:25px 0 30px; }
    .stat { background:linear-gradient(145deg,#1b2230,#161b25); border:1px solid var(--line); border-radius:15px; padding:19px; }
    .stat-label { color:var(--muted); font-size:12px; font-weight:650; text-transform:uppercase; letter-spacing:.08em; }
    .stat-value { font-size:29px; font-weight:750; margin-top:7px; letter-spacing:-.04em; }
    .stat-accent { color:#a99fff; }
    .panel { background:rgba(23,28,38,.82); border:1px solid var(--line); border-radius:17px; overflow:hidden; }
    .panel-head { display:flex; justify-content:space-between; align-items:center; gap:18px; padding:21px 22px; border-bottom:1px solid var(--line); }
    .toolbar { display:flex; gap:10px; align-items:center; }
    .toolbar input { width:245px; }
    .table-wrap { overflow:auto; }
    table { border-collapse:collapse; min-width:890px; width:100%; }
    th { color:#8795a9; font-size:11px; text-align:left; text-transform:uppercase; letter-spacing:.08em; font-weight:700; padding:14px 22px; background:#141a24; }
    td { padding:16px 22px; border-top:1px solid #27303e; white-space:nowrap; }
    tr:hover td { background:#20273555; }
    .user-cell { display:flex; align-items:center; gap:11px; }
    .user-avatar { width:34px; height:34px; border-radius:10px; display:grid; place-items:center; background:#27345a; color:#bfc7ff; font-size:12px; font-weight:800; }
    .user-name { font-weight:700; }
    .user-email { color:#8896a9; font-size:12px; margin-top:1px; }
    .badge { display:inline-flex; align-items:center; gap:6px; border-radius:999px; padding:5px 9px; font-size:11px; font-weight:750; }
    .badge:before { content:""; width:6px; height:6px; border-radius:50%; background:currentColor; }
    .badge.active { color:var(--green); background:#173b35; }
    .badge.inactive { color:var(--amber); background:#44351e; }
    .badge.banned { color:var(--red); background:#481e2b; }
    .admin-chip { color:#b9b0ff; background:#302a5a; border-radius:6px; padding:4px 7px; font-size:10px; font-weight:750; }
    .actions { display:flex; justify-content:flex-end; gap:7px; }
    .icon-button { color:#abb7c9; background:#252d3a; border:1px solid #344052; border-radius:8px; padding:7px 10px; }
    .icon-button:hover { color:#fff; border-color:#6877a0; }
    .empty { color:var(--muted); text-align:center; padding:48px; }
    .modal-backdrop { position:fixed; inset:0; display:grid; place-items:center; padding:20px; background:#060910bb; backdrop-filter:blur(5px); z-index:5; }
    .modal { width:min(620px,100%); max-height:92vh; overflow:auto; background:#1a202b; border:1px solid #3b4659; border-radius:18px; padding:25px; box-shadow:0 25px 90px #0009; }
    .modal.wide { width:min(920px,100%); }
    .detail-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin:18px 0; }
    .detail-card { background:#141a24; border:1px solid var(--line); border-radius:11px; padding:12px; }
    .detail-card strong { display:block; font-size:18px; margin-top:3px; }
    .detail-label { color:#8795a9; font-size:10px; text-transform:uppercase; letter-spacing:.08em; font-weight:700; }
    .session-list { display:grid; gap:8px; margin-top:10px; }
    .session-row { display:flex; justify-content:space-between; gap:12px; padding:10px 12px; background:#141a24; border:1px solid #27303e; border-radius:9px; }
    .session-row small { color:var(--muted); display:block; }
    .section-title { margin:22px 0 8px; font-size:14px; }
    .modal-title { display:flex; justify-content:space-between; align-items:center; }
    .close { color:#aab5c5; background:none; font-size:24px; }
    .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:0 15px; }
    .form-grid .full { grid-column:1/-1; }
    .modal-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:20px; }
    @media (max-width:800px) { .app-shell { grid-template-columns:1fr; } .sidebar { display:none; } .stats { grid-template-columns:1fr 1fr; } .topbar { align-items:flex-start; } .toolbar { flex-wrap:wrap; } .toolbar input { width:100%; } }
    @media (max-width:500px) { .login-card { padding:25px; } .main { padding:20px 13px; } .stats { gap:9px; } .stat { padding:13px; } .stat-value { font-size:23px; } .form-grid { grid-template-columns:1fr; } .form-grid .full { grid-column:auto; } }
  </style>
</head>
<body>
  <section id="login-screen" class="login-shell">
    <div class="login-card">
      <div class="brand"><div class="brand-mark">S</div><div><strong>SMARTS</strong><div class="muted" style="font-size:12px">System administration</div></div></div>
      <h1>Welcome back</h1>
      <p class="muted">Sign in with a system administrator account to manage player access.</p>
      <div id="login-error" class="error hidden"></div>
      <form id="login-form">
        <div class="field"><label for="identifier">Username or email</label><input id="identifier" name="identifier" autocomplete="username" required></div>
        <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
        <button class="primary" style="width:100%;margin-top:8px" type="submit">Sign in to console</button>
      </form>
    </div>
  </section>

  <section id="app-screen" class="app-shell hidden">
    <aside class="sidebar">
      <div class="side-brand"><div class="brand"><div class="brand-mark">S</div><div><strong>SMARTS</strong><div class="muted" style="font-size:11px">Admin console</div></div></div></div>
      <nav class="side-nav"><button class="nav-item active">Overview</button><button class="nav-item" onclick="document.getElementById('users-panel').scrollIntoView({behavior:'smooth'})">Users</button></nav>
      <div class="side-foot">UUID authentication · Phase 1<br>Protected system-admin workspace</div>
    </aside>
    <main class="main">
      <header class="topbar"><div><div class="muted" style="font-size:12px;margin-bottom:4px">SYSTEM ADMINISTRATION</div><h2>Overview</h2></div><div class="topbar-right"><div><div id="admin-name" style="font-weight:700;text-align:right"></div><div class="muted" style="font-size:12px;text-align:right">Administrator</div></div><div id="admin-avatar" class="avatar">A</div><button class="secondary" onclick="logout()">Sign out</button></div></header>
      <div id="app-error" class="error hidden"></div>
      <section class="stats"><div class="stat"><div class="stat-label">Total users</div><div id="total-users" class="stat-value">—</div></div><div class="stat"><div class="stat-label">Active users</div><div id="active-users" class="stat-value stat-accent">—</div></div><div class="stat"><div class="stat-label">Banned users</div><div id="banned-users" class="stat-value">—</div></div><div class="stat"><div class="stat-label">Live sessions</div><div id="active-sessions" class="stat-value">—</div></div></section>
      <section id="users-panel" class="panel"><div class="panel-head"><div><h2 style="font-size:18px;margin:0">User accounts</h2><div class="muted" style="font-size:12px;margin-top:4px">Manage registration, access status, and player accounts</div></div><div class="toolbar"><input id="search" placeholder="Search users..." oninput="debouncedLoadUsers()"><select id="status-filter" onchange="loadUsers()"><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="BANNED">Banned</option></select><button class="primary" onclick="openModal()">+ Register user</button></div></div><div class="table-wrap"><table><thead><tr><th>User</th><th>Player</th><th>Status</th><th>Sessions</th><th>Created</th><th style="text-align:right">Actions</th></tr></thead><tbody id="users-body"></tbody></table></div><div id="pagination" class="panel-head hidden"></div></section>
    </main>
  </section>

  <div id="modal-backdrop" class="modal-backdrop hidden"><div class="modal"><div class="modal-title"><div><h2>Register user</h2><p class="muted">Creates the account, player profile, stats, wallet, and default balances atomically.</p></div><button class="close" onclick="closeModal()">×</button></div><div id="modal-error" class="error hidden"></div><form id="create-form"><div class="form-grid"><div class="field"><label>Username</label><input name="username" minlength="3" maxlength="50" required></div><div class="field"><label>Email</label><input name="email" type="email" required></div><div class="field"><label>Password</label><input name="password" type="password" minlength="6" required></div><div class="field"><label>Display name</label><input name="displayName" minlength="2" maxlength="50" required></div><div class="field"><label>First name</label><input name="firstName" maxlength="100"></div><div class="field"><label>Last name</label><input name="lastName" maxlength="100"></div><div class="field"><label>Country code</label><input name="countryCode" placeholder="IQ" maxlength="2"></div></div><div class="modal-actions"><button type="button" class="secondary" onclick="closeModal()">Cancel</button><button type="submit" class="primary">Create account</button></div></form></div></div>
  <div id="profile-backdrop" class="modal-backdrop hidden"><div class="modal wide"><div class="modal-title"><div><h2 id="profile-title">Player profile</h2><p id="profile-subtitle" class="muted">Account details and player settings</p></div><button class="close" onclick="closeProfileModal()">×</button></div><div id="profile-error" class="error hidden"></div><div id="profile-summary"></div><h3 class="section-title">Edit account and profile settings</h3><form id="profile-form"><input type="hidden" name="userId"><div class="form-grid"><div class="field"><label>Username</label><input name="username" minlength="3" maxlength="50" required></div><div class="field"><label>Email</label><input name="email" type="email"></div><div class="field"><label>Display name</label><input name="displayName" minlength="2" maxlength="50" required></div><div class="field"><label>Country code</label><input name="countryCode" placeholder="IQ" maxlength="2"></div><div class="field"><label>First name</label><input name="firstName" maxlength="100"></div><div class="field"><label>Last name</label><input name="lastName" maxlength="100"></div><div class="field full"><label>Avatar URL</label><input name="avatarUrl" type="url"></div><div class="field full"><label>Bio</label><input name="bio" maxlength="250"></div></div><div class="modal-actions"><button type="button" class="secondary" onclick="closeProfileModal()">Close</button><button type="submit" class="primary">Save profile</button></div></form><h3 class="section-title">Force password reset</h3><form id="password-reset-form"><div class="form-grid"><div class="field"><label>New password</label><input name="password" type="password" minlength="6" maxlength="128" required></div></div><div class="modal-actions"><button type="submit" class="danger">Reset password and sign out sessions</button></div></form><h3 class="section-title">Recent sessions</h3><div id="profile-sessions" class="session-list"></div></div></div>
  <script>
    var tokenKey = 'smarts-system-admin-token';
    var refreshKey = 'smarts-system-admin-refresh-token';
    var token = localStorage.getItem(tokenKey);
    var refreshToken = localStorage.getItem(refreshKey);
    var searchTimer;
    var el = function(id) { return document.getElementById(id); };
    var escapeHtml = function(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function(c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[c]; }); };
    var initials = function(value) { return String(value || 'U').split(/\s+/).map(function(part) { return part[0]; }).join('').slice(0,2).toUpperCase(); };
    var saveAuth = function(body) { token = body.token.accessToken; refreshToken = body.token.refreshToken; localStorage.setItem(tokenKey, token); localStorage.setItem(refreshKey, refreshToken); };
    var refreshAuth = function() { return fetch('/auth/refresh', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:refreshToken})}).then(function(response) { return response.json().then(function(body) { if (!response.ok) throw new Error(body.message || 'Session expired'); saveAuth(body); return body; }); }); };
    var api = function(path, options, retried) { options = options || {}; options.headers = Object.assign({'Content-Type':'application/json'}, options.headers || {}); if (token) options.headers.Authorization = 'Bearer ' + token; return fetch('/system-admin/api' + path, options).then(function(response) { return response.json().catch(function() { return {}; }).then(function(body) { if (!response.ok && response.status === 401 && refreshToken && !retried) return refreshAuth().then(function() { return api(path, options, true); }); if (!response.ok) { if (response.status === 401 || response.status === 403) logout(); throw new Error(body.message || 'Request failed'); } return body; }); }); };
    function showError(target, message) { el(target).textContent = message; el(target).classList.remove('hidden'); }
    function hideError(target) { el(target).classList.add('hidden'); }
    function showApp() { el('login-screen').classList.add('hidden'); el('app-screen').classList.remove('hidden'); loadDashboard(); loadUsers(); }
    function logout() { token = null; refreshToken = null; localStorage.removeItem(tokenKey); localStorage.removeItem(refreshKey); el('app-screen').classList.add('hidden'); el('login-screen').classList.remove('hidden'); }
    el('login-form').addEventListener('submit', function(event) { event.preventDefault(); hideError('login-error'); var form = new FormData(event.target); fetch('/system-admin/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:form.get('identifier'),password:form.get('password')})}).then(function(response) { return response.json().then(function(body) { if (!response.ok) throw new Error(body.message || 'Sign in failed'); return body; }); }).then(function(body) { saveAuth(body); el('admin-name').textContent = body.user.firstName || body.user.username; el('admin-avatar').textContent = initials(body.user.firstName || body.user.username); showApp(); }).catch(function(error) { showError('login-error', error.message); }); });
    function loadDashboard() { api('/overview').then(function(data) { el('total-users').textContent = data.totalUsers; el('active-users').textContent = data.activeUsers; el('banned-users').textContent = data.bannedUsers; el('active-sessions').textContent = data.activeSessions; }).catch(function(error) { showError('app-error', error.message); }); }
    function debouncedLoadUsers() { clearTimeout(searchTimer); searchTimer = setTimeout(loadUsers, 250); }
    function loadUsers() { var search = encodeURIComponent(el('search').value.trim()); var status = encodeURIComponent(el('status-filter').value); var statusQuery = status ? '&status=' + status : ''; api('/users?limit=100&search=' + search + statusQuery).then(function(data) { var body = el('users-body'); if (!data.items.length) { body.innerHTML = '<tr><td colspan="6" class="empty">No users found.</td></tr>'; return; } body.innerHTML = data.items.map(function(user) { var profile = user.profile || {}; var stats = user.stats || {}; var statusClass = user.status.toLowerCase(); var nextStatus = user.status === 'ACTIVE' ? 'BANNED' : 'ACTIVE'; return '<tr><td><div class="user-cell"><div class="user-avatar">' + escapeHtml(initials(profile.displayName || user.username)) + '</div><div><div class="user-name">' + escapeHtml(profile.displayName || user.username) + (user.isSystemAdmin ? ' <span class="admin-chip">ADMIN</span>' : '') + '</div><div class="user-email">' + escapeHtml(user.email || user.username) + '</div></div></div></td><td><div>' + escapeHtml(user.username) + '</div><div class="muted" style="font-size:12px">Lv ' + escapeHtml(profile.level || 1) + ' · ' + escapeHtml(stats.gamesPlayed || 0) + ' games</div></td><td><span class="badge ' + statusClass + '">' + escapeHtml(user.status) + '</span></td><td>' + escapeHtml(user._count.sessions) + '</td><td class="muted">' + escapeHtml(new Date(user.createdAt).toLocaleDateString()) + '</td><td><div class="actions"><button class="icon-button" onclick="openUserProfile(\'' + user.id + '\')">View</button><button class="icon-button" onclick="changeStatus(\'' + user.id + '\',\'' + nextStatus + '\')">' + (user.status === 'ACTIVE' ? 'Ban' : 'Activate') + '</button><button class="danger" onclick="deleteUser(\'' + user.id + '\')">Delete</button></div></td></tr>'; }).join(''); }).catch(function(error) { showError('app-error', error.message); }); }
    function setProfileField(name, value) { el('profile-form').elements[name].value = value == null ? '' : value; }
    function renderUserProfile(user) { var profile = user.profile || {}; var stats = user.stats || {}; var wallet = user.wallet || {}; var balances = wallet.balances || []; el('profile-title').textContent = profile.displayName || user.username; el('profile-subtitle').textContent = user.email || user.username; setProfileField('userId', user.id); setProfileField('username', user.username); setProfileField('email', user.email); setProfileField('displayName', profile.displayName); setProfileField('countryCode', profile.countryCode); setProfileField('firstName', user.firstName); setProfileField('lastName', user.lastName); setProfileField('avatarUrl', profile.avatarUrl); setProfileField('bio', profile.bio); el('profile-summary').innerHTML = '<div class="detail-grid"><div class="detail-card"><span class="detail-label">Status</span><strong>' + escapeHtml(user.status) + '</strong></div><div class="detail-card"><span class="detail-label">Level</span><strong>' + escapeHtml(profile.level || 1) + '</strong></div><div class="detail-card"><span class="detail-label">XP</span><strong>' + escapeHtml(profile.xp || '0') + '</strong></div><div class="detail-card"><span class="detail-label">ELO</span><strong>' + escapeHtml(profile.elo || 1000) + '</strong></div><div class="detail-card"><span class="detail-label">Games</span><strong>' + escapeHtml(stats.gamesPlayed || 0) + '</strong></div><div class="detail-card"><span class="detail-label">Wins / losses</span><strong>' + escapeHtml(stats.wins || 0) + ' / ' + escapeHtml(stats.losses || 0) + '</strong></div><div class="detail-card"><span class="detail-label">Win streak</span><strong>' + escapeHtml(stats.currentWinStreak || 0) + ' / ' + escapeHtml(stats.highestWinStreak || 0) + '</strong><small>Current / highest</small></div><div class="detail-card"><span class="detail-label">Total score</span><strong>' + escapeHtml(stats.totalScore || '0') + '</strong></div><div class="detail-card"><span class="detail-label">Wallet</span><strong>' + escapeHtml(wallet.status || '—') + '</strong><small>' + escapeHtml(balances.map(function(balance) { return balance.currency.code + ': ' + balance.amount; }).join(' · ') || 'No balances') + '</small></div></div><div class="muted" style="font-size:12px">UUID: ' + escapeHtml(user.id) + ' · Created: ' + escapeHtml(new Date(user.createdAt).toLocaleString()) + ' · Last online: ' + escapeHtml(user.lastOnline ? new Date(user.lastOnline).toLocaleString() : 'Never') + (user.isSystemAdmin ? ' · System administrator' : '') + '</div>'; var sessions = user.sessions || []; el('profile-sessions').innerHTML = sessions.length ? sessions.map(function(session) { return '<div class="session-row"><div><strong>' + escapeHtml(session.deviceName || (session.isMobileSession ? 'Mobile device' : 'Browser')) + '</strong><small>' + escapeHtml(session.deviceInfo || 'Unknown client') + ' · ' + escapeHtml(session.ipAddress || 'Unknown IP') + '</small></div><div style="text-align:right"><span class="badge ' + (session.sessionStatus === 'ACTIVE' ? 'active' : 'inactive') + '">' + escapeHtml(session.sessionStatus) + '</span><small>Last active ' + escapeHtml(new Date(session.lastActiveTimestamp).toLocaleString()) + '</small></div></div>'; }).join('') : '<div class="empty" style="padding:20px">No sessions found.</div>'; }
    function openUserProfile(id) { hideError('profile-error'); el('profile-summary').innerHTML = '<div class="muted">Loading player profile…</div>'; el('profile-sessions').innerHTML = ''; el('profile-backdrop').classList.remove('hidden'); api('/users/' + id).then(function(user) { renderUserProfile(user); }).catch(function(error) { showError('profile-error', error.message); }); }
    function closeProfileModal() { el('profile-backdrop').classList.add('hidden'); el('profile-form').reset(); el('password-reset-form').reset(); }
    function profilePayload(form) { var value = function(name) { var raw = String(form.elements[name].value || '').trim(); return raw || null; }; return {username: String(form.elements.username.value).trim(), email: value('email'), displayName: String(form.elements.displayName.value).trim(), countryCode: value('countryCode'), firstName: value('firstName'), lastName: value('lastName'), avatarUrl: value('avatarUrl'), bio: value('bio')}; }
    el('profile-form').addEventListener('submit', function(event) { event.preventDefault(); hideError('profile-error'); var form = event.target; var id = form.elements.userId.value; api('/users/' + id + '/profile', {method:'PATCH',body:JSON.stringify(profilePayload(form))}).then(function(user) { renderUserProfile(user); loadUsers(); showError('profile-error', 'Profile saved successfully.'); }).catch(function(error) { showError('profile-error', error.message); }); });
    el('password-reset-form').addEventListener('submit', function(event) { event.preventDefault(); hideError('profile-error'); var form = new FormData(event.target); var id = el('profile-form').elements.userId.value; api('/users/' + id + '/reset-password', {method:'POST',body:JSON.stringify({password:form.get('password')})}).then(function(body) { event.target.reset(); showError('profile-error', body.message); loadUsers(); }).catch(function(error) { showError('profile-error', error.message); }); });
    function changeStatus(id, status) { var action = status === 'BANNED' ? 'ban' : 'activate'; if (!confirm('Are you sure you want to ' + action + ' this account?')) return; api('/users/' + id + '/status', {method:'PATCH',body:JSON.stringify({status:status})}).then(function() { loadDashboard(); loadUsers(); }).catch(function(error) { showError('app-error', error.message); }); }
    function deleteUser(id) { if (!confirm('Permanently delete this user? This cannot be undone.')) return; api('/users/' + id, {method:'DELETE'}).then(function() { loadDashboard(); loadUsers(); }).catch(function(error) { showError('app-error', error.message); }); }
    function openModal() { hideError('modal-error'); el('modal-backdrop').classList.remove('hidden'); }
    function closeModal() { el('modal-backdrop').classList.add('hidden'); el('create-form').reset(); }
    el('create-form').addEventListener('submit', function(event) { event.preventDefault(); hideError('modal-error'); var form = new FormData(event.target); var data = {}; form.forEach(function(value,key) { if (String(value).trim()) data[key] = String(value).trim(); }); api('/users', {method:'POST',body:JSON.stringify(data)}).then(function() { closeModal(); loadDashboard(); loadUsers(); }).catch(function(error) { showError('modal-error', error.message); }); });
    if (token) showApp();
  </script>
</body>
</html>`
