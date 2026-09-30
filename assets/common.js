/* 本土語線上測驗：共用模組（登入、班級座號、呼叫收件程式、對話框）
   臺中明道中學 詹宗龍 製作
   2026-09-30 起所有成績（朗讀測驗＋題型測驗）都送到同一個收件程式「點讀筆測驗錄音」
   與同一份試算表「明道台語課線上測驗成績」，學生名單也只有一份。 */

const QUIZ_CONFIG = {
  clientId: '860391262336-pbgnjm4lrelkcc266evtnbpg7o84v8ik.apps.googleusercontent.com',
  endpoint: 'https://script.google.com/macros/s/AKfycbwdXwyAWKBqsWZLRQyonIrakb96rBV3SRx0NZ4urg4RgVaN8PrVhaDwwonXjIGFo31g/exec',
  domain: 'ms.mingdao.edu.tw',
  adminUrl: 'https://cyril-mingdao.github.io/taigi-quiz/admin.html'
};
// 登入憑證暫存在分頁的 sessionStorage：同一個 github.io 網域（朗讀測驗 ↔ 題型測驗 ↔ 管理頁）切換時不必重新登入
const TOKEN_KEY = 'mdQuizIdToken';

document.addEventListener('contextmenu', e => { e.preventDefault(); return false; });

const app = {
  user: null,            // {idToken, email, name, picture}
  isTeacher: false,
  profile: null,         // {cls, seat, name}
  reloginCallback: null,
  onReady: null          // 頁面設定：登入並確認身分後要做的事（profile 已讀好）
};

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ===================== 登入（Google Identity Services） ===================== */

function decodeJwt(token) {
  const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

let gsiInitialized = false;
let gsiWaitTries = 0;
function initGoogleLogin() {
  const msg = document.getElementById('gate-msg');
  if (!(window.google && google.accounts && google.accounts.id)) {
    if (++gsiWaitTries < 50) setTimeout(initGoogleLogin, 200);
    else msg.innerHTML = '<span class="warn">⚠️ 無法載入 Google 登入元件，請確認網路後重新整理。</span>';
    return;
  }
  if (gsiInitialized) return;
  gsiInitialized = true;
  google.accounts.id.initialize({
    client_id: QUIZ_CONFIG.clientId,
    callback: onCredential,
    hd: QUIZ_CONFIG.domain,
    ux_mode: 'popup',
    auto_select: false,
    cancel_on_tap_outside: true
  });
  renderGsiButton(document.getElementById('gsi-btn'));
}

function renderGsiButton(el) {
  el.innerHTML = '';
  google.accounts.id.renderButton(el, {
    theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'zh-TW'
  });
}

/** 分頁裡還有沒過期的登入憑證（例如剛從朗讀測驗或管理頁切過來）就直接沿用 */
function tryStoredLogin() {
  let token = '';
  try { token = sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  if (!token) return false;
  try {
    const p = decodeJwt(token);
    if (!p.exp || p.exp * 1000 < Date.now() + 5 * 60 * 1000) return false;   // 剩不到 5 分鐘就重新登入
    return useCredential(token, p);
  } catch (e) {
    return false;
  }
}

function onCredential(resp) {
  let payload;
  try { payload = decodeJwt(resp.credential); } catch (e) { toast('登入資料解析失敗，請再試一次'); return; }
  useCredential(resp.credential, payload);
}

function useCredential(token, payload) {
  const email = String(payload.email || '').toLowerCase();
  if (payload.hd !== QUIZ_CONFIG.domain || !email.endsWith('@' + QUIZ_CONFIG.domain)) {
    document.getElementById('gate-msg').innerHTML =
      `<span class="warn">⚠️ ${escapeHtml(email)} 不是學校帳號，請改用 @${QUIZ_CONFIG.domain} 登入。</span>`;
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
    return false;
  }
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) {}
  const sameUser = app.user && app.user.email === email;
  app.user = { idToken: token, email: email, name: payload.name || email, picture: payload.picture || '' };
  if (app.reloginCallback && sameUser) {   // 登入過期 → 重新登入後接著做剛才的事（例如補送成績）
    const cb = app.reloginCallback;
    app.reloginCallback = null;
    closeModal();
    cb();
    return true;
  }
  app.reloginCallback = null;
  afterLogin();
  return true;
}

function signOut() {
  if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
  app.user = null;
  app.profile = null;
  app.isTeacher = false;
  showSection('quiz-gate');
}

/* 同一時間只顯示一個主要區塊 */
function showSection(id) {
  document.querySelectorAll('[data-section]').forEach(s => s.classList.toggle('hidden', s.id !== id));
  document.body.classList.toggle('admin-mode', id === 'admin-panel');
  window.scrollTo({ top: 0 });
}

function userBadgeHtml(extra) {
  const u = app.user;
  return (u.picture ? `<img src="${escapeHtml(u.picture)}" alt="" referrerpolicy="no-referrer">` : '') +
    `<div><b>${escapeHtml(u.name)}</b><br><span class="hint">${escapeHtml(u.email)}</span></div>` + (extra || '');
}

async function afterLogin() {
  const msg = document.getElementById('gate-msg');
  msg.textContent = '⏳ 讀取資料中…';
  try {
    const d = await api({ action: 'profile_get' });
    app.isTeacher = !!d.isTeacher;
    app.profile = d.profile;
    msg.textContent = '';
    if (app.onReady) app.onReady();
  } catch (err) {
    msg.innerHTML = `<span class="warn">⚠️ ${escapeHtml(String(err.message || err))}</span>`;
  }
}

function goAdmin() {
  try { sessionStorage.setItem(TOKEN_KEY, app.user.idToken); } catch (e) {}
  location.href = QUIZ_CONFIG.adminUrl + (window.LESSON ? '?lesson=' + encodeURIComponent(LESSON.id) : '');
}

/* ===================== 部別、班級、座號（與收件程式的名單一致） ===================== */

const range = (prefix, n) => Array.from({ length: n }, (_, i) => prefix + (i + 1));
const DEPARTMENTS = [
  { name: '高中部', blocks: [[{ classes: range('高一', 12), perRow: 6 }]] },
  { name: '技高部', blocks: [[
    { classes: range('商二', 4), row: true }, { classes: range('餐二', 3), row: true }, { classes: range('廣二', 3), row: true },
    { classes: range('美二', 2), row: true }, { classes: range('英二', 2), row: true }, { classes: range('訊二', 2), row: true },
    { classes: range('子二', 2), row: true }, { classes: range('觀二', 1), row: true }]] },
  { name: '國中部', blocks: [[{ classes: range('國一', 20) }], [{ classes: range('國二', 20) }]] },
  { name: '國際部', blocks: [[{ classes: ['701', '702'] }, { classes: ['1001', '1002'] }]] }
];
const SEAT_MAX = 50;
const pf = { dept: '', cls: '', seat: '', done: null };
const NARROW = window.matchMedia('(max-width: 820px)');
const gridCols = () => (NARROW.matches ? 5 : 10);

function deptOfClass(cls) {
  const d = DEPARTMENTS.find(d => d.blocks.some(b => b.some(g => g.classes.includes(cls))));
  return d ? d.name : '';
}

function renderProfileChips() {
  const cols = gridCols();
  document.getElementById('pf-dept').innerHTML = DEPARTMENTS.map(d =>
    `<button type="button" class="chip${pf.dept === d.name ? ' on' : ''}" data-dept="${d.name}">${d.name}</button>`).join('');
  const dept = DEPARTMENTS.find(d => d.name === pf.dept);
  let tint = 0;
  document.getElementById('pf-classes').innerHTML = dept
    ? dept.blocks.map(block => `<div class="pick-grid" style="--cols:${cols}">` +
        block.map(g => {
          const t = tint++;
          const per = g.perRow ? Math.min(g.perRow, cols) : 0;
          return g.classes.map((c, i) =>
            `<button type="button" class="chip pick tint-${t}${pf.cls === c ? ' on' : ''}" data-cls="${c}"` +
            ((per && i % per === 0) || (g.row && i === 0) ? ' style="grid-column-start:1"' : '') + `>${c}</button>`).join('');
        }).join('') + '</div>').join('')
    : '<span class="hint">請先點選部別</span>';
  const seats = document.getElementById('pf-seats');
  seats.className = 'pick-grid';
  seats.style.setProperty('--cols', cols);
  seats.innerHTML = Array.from({ length: SEAT_MAX }, (_, i) => String(i + 1)).map(n =>
    `<button type="button" class="chip pick${pf.seat === n ? ' on' : ''}" data-seat="${n}">${n}</button>`).join('');
  document.getElementById('pf-picked').textContent =
    pf.cls || pf.seat ? `已選：${pf.cls || '（未選班級）'}　${pf.seat ? pf.seat + ' 號' : '（未選座號）'}` : '';
}

function onProfileChipClick(e) {
  const b = e.target.closest('button.chip');
  if (!b) return;
  if (b.dataset.dept) {
    if (pf.dept !== b.dataset.dept) pf.cls = '';
    pf.dept = b.dataset.dept;
  } else if (b.dataset.cls) {
    pf.cls = b.dataset.cls;
  } else if (b.dataset.seat) {
    pf.seat = b.dataset.seat;
  }
  document.getElementById('pf-msg').textContent = '';
  renderProfileChips();
}

/** 顯示基本資料表單；done：存好後要做的事，cancel：按取消要做的事（null＝不能取消）。
    教師帳號進學生模式也會看到這一頁（預覽學生的畫面、人工檢查），但教師的選擇不送出、不儲存，
    成績一律記在班級「教師」（收件程式決定）。 */
function showProfileForm(done, cancel) {
  const p = app.profile || {};
  pf.cls = p.cls && deptOfClass(p.cls) ? p.cls : '';
  pf.dept = deptOfClass(pf.cls);
  pf.seat = Number(p.seat) >= 1 && Number(p.seat) <= SEAT_MAX ? String(Number(p.seat)) : '';
  pf.done = done;
  pf.cancel = cancel || null;
  renderProfileChips();
  document.getElementById('pf-name').value = p.name || app.user.name || '';
  document.getElementById('pf-email').value = app.user.email;
  document.getElementById('pf-msg').textContent = '';
  const note = document.getElementById('pf-teacher');
  if (note) note.classList.toggle('hidden', !app.isTeacher);
  const cancelBtn = document.getElementById('pf-cancel');
  cancelBtn.textContent = app.isTeacher ? '略過，直接看測驗說明' : '取消';
  cancelBtn.classList.toggle('hidden', !cancel);
  showSection('quiz-profile');
}

async function saveProfile(e) {
  e.preventDefault();
  const btn = document.getElementById('pf-save');
  const msg = document.getElementById('pf-msg');
  const body = { action: 'profile_save', cls: pf.cls, seat: pf.seat, name: document.getElementById('pf-name').value.trim() };
  if (!body.cls) { msg.textContent = '請點選部別與班級。'; return; }
  if (!body.seat) { msg.textContent = '請點選座號。'; return; }
  if (!body.name) { msg.textContent = '請輸入姓名。'; return; }
  if (app.isTeacher) {   // 教師預覽：檢查流程跟學生一樣，但不送出
    toast(`教師預覽：${body.cls} ${body.seat} 號 ${body.name} 檢查通過（不儲存，成績記在「教師」）`);
    if (pf.done) pf.done();
    return;
  }
  btn.disabled = true;
  msg.textContent = '';
  try {
    const d = await api(body);
    app.profile = d.profile;
    if (pf.done) pf.done();
  } catch (err) {
    msg.textContent = '⚠️ ' + (err.message || err);
  } finally {
    btn.disabled = false;
  }
}

function bindProfileForm() {
  const form = document.getElementById('profile-form');
  if (!form) return;
  form.addEventListener('submit', saveProfile);
  form.addEventListener('click', onProfileChipClick);
  document.getElementById('pf-cancel').addEventListener('click', () => { if (pf.cancel) pf.cancel(); });
  NARROW.addEventListener('change', () => {
    if (!document.getElementById('quiz-profile').classList.contains('hidden')) renderProfileChips();
  });
}

/* ===================== 收件程式 ===================== */

function postToServer(body, url) {
  return fetch(url || QUIZ_CONFIG.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // text/plain 不會觸發 CORS 預檢，Apps Script 才收得到
    body: JSON.stringify(body)
  }).then(res => {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  });
}

/* 呼叫收件程式；登入過期時跳出重新登入，登入後自動重試同一個動作。url 省略＝QUIZ_CONFIG.endpoint */
function api(body, url) {
  return postToServer(Object.assign({}, body, { idToken: app.user.idToken }), url).then(data => {
    if (data.ok) return data;
    if (data.error === 'auth') {
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
      return new Promise((resolve, reject) => {
        app.reloginCallback = () => api(body, url).then(resolve, reject);
        openModal(`<h3>🔑 登入已過期</h3><div>請用同一個帳號（${escapeHtml(app.user.email)}）再登入一次，登入後會自動繼續剛才的動作。</div><div id="gsi-relogin"></div>`);
        renderGsiButton(document.getElementById('gsi-relogin'));
      });
    }
    const err = new Error(data.message || data.error);
    err.code = data.error;
    throw err;
  });
}

function openModal(html, wide) {
  const body = document.getElementById('quiz-modal-body');
  body.classList.toggle('wide', !!wide);
  body.innerHTML = html;
  document.getElementById('quiz-modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('quiz-modal').classList.add('hidden');
}
