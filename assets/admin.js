/* 本土語線上測驗：整合教師管理頁（朗讀測驗＋生份字＋選詞塌空＋咱來鬥句＋形音義）
   臺中明道中學 詹宗龍 製作
   教師名單由收件程式（CONFIG.TEACHERS）判定。朗讀測驗的錄音一律經收件程式轉送。
   CATALOG（assets/catalog.js）列出所有課次：{id, cat, book, title, refBase?, sentences?} */

const CATS = [
  { id: 'READ', icon: '🎤', name: '朗讀測驗' },
  { id: 'SIANN', icon: '📖', name: '咱來餾生份字' },
  { id: 'SUANSU', icon: '✏️', name: '選詞塌空' },
  { id: 'TAUKU', icon: '🧩', name: '咱來鬥句' },
  { id: 'HINGIM', icon: '🔤', name: '形音義' }
];
const BOOK_ORDER = ['真平第1冊', '康軒第2冊', '育達全1冊', '全華第3冊'];
const READ_SITE = 'https://cyril-mingdao.github.io/Voice-test/';

const admin = { attempts: [], selected: new Set(), audioCache: {}, cat: 'READ', book: '', dept: '' };
const CLASS_ORDER = DEPARTMENTS.flatMap(d => d.blocks.flat().flatMap(g => g.classes));
const TEACHER_DEPT = '教師';
const OTHER_DEPT = '其他';
const OTHER_BOOK = '其他';
const MOBILE = window.matchMedia('(max-width: 640px)');
const adminPlayer = new Audio();
const VERDICT_CLASS = { '通過': 'pass', '需重測': 'retest', '判定作弊': 'cheat' };
const catalogById = {};
CATALOG.forEach(c => { catalogById[c.id] = c; });

const isRead = () => admin.cat === 'READ';
const catOf = id => (catalogById[id] ? catalogById[id].cat : (String(id).split('-')[0] in KIND_SET ? String(id).split('-')[0] : 'READ'));
const KIND_SET = { SIANN: 1, SUANSU: 1, TAUKU: 1, HINGIM: 1 };
const lessonShort = id => (catalogById[id] ? catalogById[id].title : id);
const bookOf = id => (catalogById[id] ? catalogById[id].book : OTHER_BOOK);
const lessonLabel = id => (catalogById[id] ? `${catalogById[id].book} ${catalogById[id].title}` : id);
const catName = id => (CATS.find(c => c.id === id) || { name: id }).name;

/* 朗讀與題型測驗的紀錄都在同一個收件程式；題型測驗的作答ID 開頭是 Q- */
const isQuizId = id => String(id || '').indexOf('Q-') === 0;
const apiFor = (id, body) => api(body);

function catAttempts() {
  return admin.attempts.filter(a => (a.cat || 'READ') === admin.cat);
}

/* ---------- 篩選列 ---------- */

function renderCatChips() {
  const counts = {};
  admin.attempts.forEach(a => { counts[a.cat || 'READ'] = (counts[a.cat || 'READ'] || 0) + 1; });
  document.getElementById('ad-cats').innerHTML = CATS.map(c =>
    `<button type="button" class="chip cat${admin.cat === c.id ? ' on' : ''}" data-cat="${c.id}">${c.icon} ${escapeHtml(c.name)}` +
    `<span class="cnt">${counts[c.id] || 0}</span></button>`).join('');
}

function adminBooks() {
  const books = [...new Set(CATALOG.filter(c => c.cat === admin.cat).map(c => c.book))]
    .sort((x, y) => BOOK_ORDER.indexOf(x) - BOOK_ORDER.indexOf(y));
  if (catAttempts().some(a => bookOf(a.lesson) === OTHER_BOOK)) books.push(OTHER_BOOK);
  return books;
}

function renderBookChips() {
  document.getElementById('ad-books').innerHTML = [['', '全部版本'], ...adminBooks().map(b => [b, b])].map(([v, label]) =>
    `<button type="button" class="chip${admin.book === v ? ' on' : ''}" data-book="${escapeHtml(v)}">${escapeHtml(label)}</button>`).join('');
}

function fillLessonSelect() {
  const sel = document.getElementById('ad-lesson');
  const cur = sel.value;
  const order = id => { const i = CATALOG.findIndex(c => c.id === id); return i < 0 ? 9999 : i; };
  const lessons = [...new Set([...CATALOG.filter(c => c.cat === admin.cat).map(c => c.id), ...catAttempts().map(a => a.lesson)])]
    .filter(id => !admin.book || bookOf(id) === admin.book)
    .sort((x, y) => order(x) - order(y));
  sel.innerHTML = `<option value="">${admin.book ? escapeHtml(admin.book) + ' 全部課次' : '全部版本、全部課次'}</option>` +
    lessons.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(admin.book ? lessonShort(id) : lessonLabel(id))}</option>`).join('');
  if (lessons.includes(cur)) sel.value = cur;
  return lessons;
}

function deptOfAttempt(a) {
  return deptOfClass(a.cls) || (a.cls === TEACHER_DEPT ? TEACHER_DEPT : OTHER_DEPT);
}

function classRank(cls) {
  const i = CLASS_ORDER.indexOf(cls);
  return i < 0 ? CLASS_ORDER.length + (cls === TEACHER_DEPT ? 1 : 0) : i;
}

function lessonScope() {
  const lesson = document.getElementById('ad-lesson').value;
  return catAttempts().filter(a => lesson ? a.lesson === lesson : (!admin.book || bookOf(a.lesson) === admin.book));
}

function renderDeptChips() {
  const present = new Set(admin.attempts.map(deptOfAttempt));
  const depts = [...DEPARTMENTS.map(d => d.name), ...[TEACHER_DEPT, OTHER_DEPT].filter(d => present.has(d))];
  document.getElementById('ad-depts').innerHTML = [['', '全部部別'], ...depts.map(d => [d, d])].map(([v, label]) =>
    `<button type="button" class="chip${admin.dept === v ? ' on' : ''}" data-dept-filter="${escapeHtml(v)}">${escapeHtml(label)}</button>`).join('');
}

function fillClassSelect() {
  const sel = document.getElementById('ad-cls');
  const cur = sel.value;
  const counts = {};
  lessonScope().forEach(a => { counts[a.cls] = (counts[a.cls] || 0) + 1; });
  const dept = DEPARTMENTS.find(d => d.name === admin.dept);
  let classes = dept
    ? dept.blocks.flat().flatMap(g => g.classes)
    : [...new Set(admin.attempts.filter(a => !admin.dept || deptOfAttempt(a) === admin.dept).map(a => a.cls).filter(Boolean))];
  classes = classes.sort((x, y) => classRank(x) - classRank(y) || String(x).localeCompare(String(y)));
  sel.innerHTML = `<option value="">${admin.dept ? escapeHtml(admin.dept) + ' 全部班級' : '全部班級'}</option>` +
    classes.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}（${counts[c] || 0} 筆）</option>`).join('');
  if (classes.includes(cur)) sel.value = cur;
}

function fillStatusSelect() {
  const sel = document.getElementById('ad-status');
  const cur = sel.value;
  const opts = [['', '全部紀錄']];
  if (isRead()) opts.push(['suspected', '可疑音檔'], ['unreviewed', '可疑音檔且未審查']);
  opts.push(['cheat', '判定作弊'], ['retest', '需重測']);
  if (!isRead()) opts.push(['low', '低於 60 分'], ['hidden', '有離開頁面']);
  sel.innerHTML = opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  if (opts.some(o => o[0] === cur)) sel.value = cur;
}

function refreshFilters() {
  renderCatChips();
  renderBookChips();
  fillLessonSelect();
  renderDeptChips();
  fillClassSelect();
  fillStatusSelect();
}

function adminFilter(opts) {
  const lesson = document.getElementById('ad-lesson').value;
  const cls = document.getElementById('ad-cls').value;
  const status = opts && opts.ignoreStatus ? '' : document.getElementById('ad-status').value;
  const q = opts && opts.ignoreStatus ? '' : document.getElementById('ad-search').value.trim().toLowerCase();
  const deptOk = a => cls ? a.cls === cls : (!admin.dept || deptOfAttempt(a) === admin.dept);
  return catAttempts().filter(a =>
    (lesson ? a.lesson === lesson : (!admin.book || bookOf(a.lesson) === admin.book)) &&
    deptOk(a) &&
    (!status ||
      (status === 'suspected' && a.suspected > 0) ||
      (status === 'unreviewed' && a.suspected > 0 && !a.verdict) ||
      (status === 'cheat' && a.verdict === '判定作弊') ||
      (status === 'retest' && a.verdict === '需重測') ||
      (status === 'low' && Number(a.total) < 60) ||
      (status === 'hidden' && Number(a.hidden) > 0)) &&
    (!q || (a.name + ' ' + a.email).toLowerCase().includes(q)));
}

function byClassSeat(a, b) {
  return classRank(a.cls) - classRank(b.cls) ||
    String(a.cls).localeCompare(String(b.cls), 'zh-Hant', { numeric: true }) ||
    (Number(a.seat) || 0) - (Number(b.seat) || 0) || (b.ts || 0) - (a.ts || 0);
}

function adminSorter() {
  switch (document.getElementById('ad-sort').value) {
    case 'time-desc': return (a, b) => b.ts - a.ts;
    case 'time-asc': return (a, b) => a.ts - b.ts;
    case 'score-desc': return (a, b) => (Number(b.total) || 0) - (Number(a.total) || 0) || byClassSeat(a, b);
    default: return byClassSeat;
  }
}

function verdictHtml(v) {
  return v ? `<span class="verdict ${VERDICT_CLASS[v] || ''}">${escapeHtml(v)}</span>` : '<span class="hint">未審查</span>';
}

/* ---------- 列表 ---------- */

function renderAdminTable() {
  const list = adminFilter().sort(adminSorter());
  const visible = new Set(list.map(a => a.id));
  [...admin.selected].forEach(id => { if (!visible.has(id)) admin.selected.delete(id); });

  const read = isRead();
  const allChecked = list.length && admin.selected.size === list.length ? 'checked' : '';
  const chk = a => `<input type="checkbox" class="ad-chk" data-id="${escapeHtml(a.id)}" ${admin.selected.has(a.id) ? 'checked' : ''} aria-label="勾選">`;
  const rowCls = a => a.verdict === '判定作弊' ? 'cheat' : (read && a.suspected > 0) ? 'suspect' : '';
  const reviewBtn = a => `<button class="qbtn small" data-review="${escapeHtml(a.id)}">${read ? '🎧 檢核' : '🔍 檢核'}</button>`;
  let html;
  if (MOBILE.matches) {
    html = (list.length ? `<label class="ad-all-line"><input type="checkbox" id="ad-all" ${allChecked}> 全選目前顯示的 ${list.length} 筆</label>` : '') +
      (list.map(a => `
        <div class="ad-card ${rowCls(a)}">
          ${chk(a)}
          <div>
            <div><b>${escapeHtml(a.cls)}${a.seat ? '-' + escapeHtml(a.seat) : ''} ${escapeHtml(a.name)}</b> <span class="hint">第 ${a.attempt} 次</span></div>
            <div class="hint">${escapeHtml(a.time)}｜${escapeHtml(lessonShort(a.lesson))}</div>
            <div>${read ? (a.suspected > 0 ? `<b>⚠️ 可疑音檔 ${a.suspected} 句</b>　` : '') : `答對 ${a.correct}/${a.count}　`}${verdictHtml(a.verdict)}</div>
          </div>
          <div class="ad-card-side"><div class="ad-card-score">${a.total}</div>${reviewBtn(a)}</div>
        </div>`).join('') || '<div class="hint">沒有符合條件的紀錄</div>');
  } else {
    const head = read
      ? '<th>可疑音檔</th><th>聽範例</th><th>離開頁面</th>'
      : '<th>答對</th><th>作答秒數</th><th>離開頁面</th>';
    const rows = list.map(a => `<tr class="${rowCls(a)}">
      <td>${chk(a)}</td>
      <td>${escapeHtml(a.time)}</td><td>${escapeHtml(a.cls)}</td><td>${escapeHtml(a.seat)}</td>
      <td title="${escapeHtml(a.email)}">${escapeHtml(a.name)}</td><td title="${escapeHtml(lessonLabel(a.lesson))}">${escapeHtml(lessonShort(a.lesson))}</td>
      <td>${a.attempt}</td><td><b>${a.total}</b></td>
      ${read
        ? `<td>${a.suspected > 0 ? '⚠️ ' + a.suspected : ''}</td><td>${a.listens}</td><td>${a.hidden || ''}</td>`
        : `<td>${a.correct} / ${a.count}</td><td>${a.seconds || ''}</td><td>${a.hidden || ''}</td>`}
      <td>${verdictHtml(a.verdict)}</td>
      <td>${reviewBtn(a)}</td>
    </tr>`).join('');
    html = `<table class="admin-table">
      <tr><th><input type="checkbox" id="ad-all" ${allChecked}></th>
        <th>時間</th><th>班級</th><th>座號</th><th>姓名</th><th>課次</th><th>次</th><th>總分</th>${head}<th>審查</th><th></th></tr>` +
      (rows || '<tr><td colspan="13">沒有符合條件的紀錄</td></tr>') + '</table>';
  }
  document.getElementById('ad-list').innerHTML = html;
  document.getElementById('ad-count').textContent =
    `${catName(admin.cat)}：顯示 ${list.length} 筆（此類別全部 ${catAttempts().length} 筆）` + (admin.selected.size ? `｜已勾選 ${admin.selected.size} 筆` : '');
  document.getElementById('ad-delete').disabled = !admin.selected.size;
}

async function loadAdmin() {
  document.getElementById('ad-count').textContent = '⏳ 讀取中…';
  try {
    const data = await api({ action: 'admin_list' });
    admin.attempts = data.attempts.map(a => Object.assign(a, { cat: a.cat || 'READ' }));
    admin.selected.clear();
    refreshFilters();
    if (admin.presetLesson && !admin.presetApplied) {
      admin.presetApplied = true;
      const sel = document.getElementById('ad-lesson');
      if ([...sel.options].some(o => o.value === admin.presetLesson)) sel.value = admin.presetLesson;
      fillClassSelect();
    }
    renderAdminTable();
  } catch (err) {
    document.getElementById('ad-count').textContent = '⚠️ 讀取失敗：' + (err.message || err);
  }
}

/* ---------- 檢核 ---------- */

function reviewFooter(a) {
  const radios = ['', '通過', '需重測', '判定作弊'].map(v =>
    `<label><input type="radio" name="rv-verdict" value="${v}" ${(a.verdict || '') === v ? 'checked' : ''}> ${v || '未審查'}</label>`).join('');
  return `
    <div><b>審查結果</b>（「判定作弊」的那次不計入最高分）</div>
    <div class="verdict-choices">${radios}</div>
    <textarea class="review-note" id="rv-note" rows="2" maxlength="500" placeholder="備註（選填）">${escapeHtml(a.note || '')}</textarea>
    <div class="quiz-actions">
      <button class="qbtn" id="rv-save">💾 儲存審查</button>
      <button class="qbtn danger" id="rv-delete">🗑️ 刪除這筆</button>
      <button class="qbtn light" id="rv-close">關閉</button>
    </div>`;
}

function bindReviewFooter(a) {
  const body = document.getElementById('quiz-modal-body');
  document.getElementById('rv-close').addEventListener('click', () => { adminPlayer.pause(); closeModal(); });
  document.getElementById('rv-delete').addEventListener('click', () => { adminPlayer.pause(); confirmDelete([a.id]); });
  document.getElementById('rv-save').addEventListener('click', async () => {
    const btn = document.getElementById('rv-save');
    const verdict = (body.querySelector('input[name=rv-verdict]:checked') || {}).value || '';
    const note = document.getElementById('rv-note').value.trim();
    btn.disabled = true;
    try {
      await apiFor(a.id, { action: 'admin_review', attemptId: a.id, verdict: verdict, note: note });
      a.verdict = verdict;
      a.note = note;
      adminPlayer.pause();
      closeModal();
      renderAdminTable();
      toast('已儲存審查結果');
    } catch (err) {
      toast('儲存失敗：' + (err.message || err));
      btn.disabled = false;
    }
  });
}

async function openReview(id) {
  const a = admin.attempts.find(x => x.id === id);
  if (!a) return;
  openModal('<h3>讀取中…</h3>', true);
  let d;
  try {
    d = (await apiFor(id, { action: 'admin_attempt', attemptId: id })).attempt;
  } catch (err) {
    openModal(`<h3>讀取失敗</h3><div>${escapeHtml(String(err.message || err))}</div>
      <div class="quiz-actions"><button class="qbtn light" id="rv-x">關閉</button></div>`, true);
    document.getElementById('rv-x').addEventListener('click', closeModal);
    return;
  }
  if (a.cat === 'READ') openReadReview(a, d);
  else openQuizReview(a, d);
}

/* 題型測驗：逐題列出題目、學生作答、參考答案與得分 */
function openQuizReview(a, d) {
  const rows = (d.detail || []).map((r, i) => {
    const full = Number(r.pts) >= 4 - 1e-6;
    return MOBILE.matches
      ? `<div class="rv-item ${full ? '' : 'suspect'}"><div class="rv-head"><span><b>#${i + 1}</b> ${escapeHtml(r.q)}</span><b>${r.pts}</b></div>
          <div>作答：${escapeHtml(r.a || '（未作答）')}</div><div>正解：<b>${escapeHtml(r.c)}</b></div></div>`
      : `<tr class="${full ? '' : 'suspect'}"><td>${i + 1}</td><td>${escapeHtml(r.q)}</td><td>${escapeHtml(r.a || '（未作答）')}</td>
          <td><b>${escapeHtml(r.c)}</b></td><td>${full ? '✔' : Number(r.pts) > 0 ? '△' : '✘'} ${r.pts}${r.steps ? ` <span class="hint">(${r.steps})</span>` : ''}</td></tr>`;
  }).join('');
  const listHtml = MOBILE.matches ? `<div>${rows}</div>`
    : `<table class="review-list"><tr><th>#</th><th>題目</th><th>學生作答</th><th>參考答案</th><th>得分</th></tr>${rows}</table>`;
  openModal(`
    <h3>🔍 檢核：${escapeHtml(a.cls)} 班 ${escapeHtml(a.seat)} 號 ${escapeHtml(a.name)}</h3>
    <div class="hint">${escapeHtml(a.email)}｜${escapeHtml(catName(a.cat))}｜${escapeHtml(lessonLabel(a.lesson))} 第 ${a.attempt} 次｜${escapeHtml(a.time)}｜
      總分 <b>${a.total}</b>｜答對 ${a.correct}/${a.count}｜作答 ${a.seconds || 0} 秒｜離開頁面 ${a.hidden || 0} 次</div>
    ${listHtml}${reviewFooter(a)}`, true);
  bindReviewFooter(a);
}

/* 朗讀測驗：聽學生錄音與範例音、看播放偵測數值 */
function openReadReview(a, d) {
  const cat = catalogById[a.lesson] || {};
  const refBase = cat.refBase || `https://cyril-mingdao.github.io/pen/${a.lesson}/`;
  const items = d.detail.slice().sort((x, y) => x.seq - y.seq).map(det => {
    const pad = 's' + String(det.seq + 1).padStart(2, '0') + '_';
    const f = (d.files || []).find(ff => ff.name.indexOf(pad) === 0);
    const rp = det.replay || {};
    const sent = cat.sentences && cat.sentences[det.seq];
    const text = sent ? escapeHtml(sent.slice(0, 20)) + (sent.length > 20 ? '…' : '') : `第 ${det.seq + 1} 句`;
    const metrics = `<div class="metrics">包絡 ${rp.envCorr ?? '—'}｜音高差 ${rp.pitchDiff ?? '—'}｜長度比 ${rp.durRatio ?? '—'}</div>`;
    const btns = (f ? `<button class="qbtn small" data-play="${escapeHtml(f.name)}">▶ 學生</button>` : '<span class="hint">無檔案</span>') +
      ` <button class="qbtn small light" data-ref="${det.seq}">▶ 範例</button>`;
    if (MOBILE.matches) {
      return `<div class="rv-item ${rp.suspected ? 'suspect' : ''}">
        <div class="rv-head"><span><b>#${det.seq + 1}</b> ${text}</span><b>${det.total} 分</b></div>
        <div>${rp.suspected ? '<b>⚠️ 可疑音檔</b>　' : ''}<span class="hint">聽範例 ${det.listens || 0}</span></div>
        ${metrics}<div class="rv-btns">${btns}</div></div>`;
    }
    return `<tr class="${rp.suspected ? 'suspect' : ''}">
      <td>${det.seq + 1}</td><td>${text}</td><td><b>${det.total}</b></td>
      <td>${rp.suspected ? '<b>⚠️ 可疑音檔</b>' : ''}${metrics}</td>
      <td>聽範例 ${det.listens || 0}</td><td>${btns}</td></tr>`;
  }).join('');
  const listHtml = MOBILE.matches ? `<div>${items}</div>` : `<table class="review-list">
      <tr><th>#</th><th>句子</th><th>分數</th><th>播放偵測</th><th></th><th>聽</th></tr>${items}</table>`;
  openModal(`
    <h3>🎧 檢核：${escapeHtml(a.cls)} 班 ${escapeHtml(a.seat)} 號 ${escapeHtml(a.name)}</h3>
    <div class="hint">${escapeHtml(a.email)}｜朗讀測驗｜${escapeHtml(lessonLabel(a.lesson))} 第 ${a.attempt} 次｜${escapeHtml(a.time)}｜總分 <b>${a.total}</b>｜離開頁面 ${a.hidden || 0} 次</div>
    ${listHtml}${reviewFooter(a)}`, true);
  const body = document.getElementById('quiz-modal-body');
  body.querySelectorAll('[data-play]').forEach(btn => btn.addEventListener('click', () => playStudentAudio(a.id, btn.dataset.play, btn)));
  body.querySelectorAll('[data-ref]').forEach(btn => btn.addEventListener('click', () => {
    adminPlayer.src = `${refBase}s${btn.dataset.ref}.mp3`;
    adminPlayer.play().catch(() => toast('範例音播放失敗'));
  }));
  bindReviewFooter(a);
}

async function playStudentAudio(attemptId, fileName, btn) {
  const key = attemptId + '/' + fileName;
  try {
    if (!admin.audioCache[key]) {
      btn.disabled = true;
      btn.textContent = '⏳';
      const d = await apiFor(attemptId, { action: 'admin_audio', attemptId: attemptId, file: fileName });
      const bin = atob(d.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      admin.audioCache[key] = URL.createObjectURL(new Blob([bytes], { type: d.mime }));
    }
    adminPlayer.src = admin.audioCache[key];
    await adminPlayer.play();
  } catch (err) {
    toast('錄音播放失敗：' + (err.message || err));
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ 學生';
  }
}

/* ---------- 刪除 ---------- */

function confirmDelete(ids) {
  const list = admin.attempts.filter(a => ids.includes(a.id));
  if (!list.length) return;
  const names = [...new Set(list.map(a => `${a.cls}-${a.seat} ${a.name}`))];
  const hasRead = list.some(a => a.cat === 'READ');
  openModal(`
    <h3>🗑️ 確定刪除 ${list.length} 筆作答紀錄？</h3>
    <div>${names.slice(0, 12).map(escapeHtml).join('、')}${names.length > 12 ? ` 等 ${names.length} 位` : ''}</div>
    <ul>
      <li>成績列會從試算表刪除，成績總表自動重算。</li>
      ${hasRead ? '<li>朗讀錄音資料夾會移到擁有者（cyril）雲端硬碟的垃圾桶，30 天內可還原，之後永久刪除。</li>' : ''}
    </ul>
    <label><input type="checkbox" id="del-roster"> 一併刪除這些學生的班級、座號資料（學生下次登入需重新填寫）</label>
    <div class="quiz-actions">
      <button class="qbtn danger" id="del-ok">確定刪除</button>
      <button class="qbtn light" id="del-cancel">取消</button>
    </div>`, true);
  document.getElementById('del-cancel').addEventListener('click', closeModal);
  document.getElementById('del-ok').addEventListener('click', async () => {
    const btn = document.getElementById('del-ok');
    btn.disabled = true;
    btn.textContent = '刪除中…';
    try {
      const purgeRoster = document.getElementById('del-roster').checked;
      const deleted = (await api({ action: 'admin_delete', attemptIds: ids, purgeRoster: purgeRoster })).deleted;
      closeModal();
      toast(`已刪除 ${deleted} 筆`);
      loadAdmin();
    } catch (err) {
      toast('刪除失敗：' + (err.message || err));
      btn.disabled = false;
      btn.textContent = '確定刪除';
    }
  });
}

/* ---------- 成績 CSV（每人每課一列，判定作弊的那次不計入最高分） ---------- */

function downloadCsv() {
  const map = {};
  adminFilter({ ignoreStatus: true }).slice().sort((a, b) => a.ts - b.ts).forEach(a => {
    const k = a.email + '|' + a.lesson;
    const m = map[k] || (map[k] = { cls: a.cls, seat: a.seat, name: a.name, email: a.email, lesson: a.lesson, count: 0, best: '', latest: '', time: '', flag: 0, cheat: 0 });
    m.count++;
    if (a.verdict === '判定作弊') m.cheat++;
    else m.best = Math.max(Number(m.best) || 0, Number(a.total) || 0);
    m.latest = a.total;
    m.time = a.time;
    if (a.suspected > 0) m.flag++;
    m.cls = a.cls; m.seat = a.seat; m.name = a.name;
  });
  const read = isRead();
  const head = ['班級', '座號', '姓名', 'Email', '類別', '版本', '課次', '作答次數', '最高分', '最近一次分數', '最近作答時間']
    .concat(read ? ['可疑音檔次數'] : [], ['判定作弊次數']);
  const rows = Object.values(map).sort(byClassSeat).map(m =>
    [m.cls, m.seat, m.name, m.email, catName(admin.cat), bookOf(m.lesson), lessonShort(m.lesson), m.count, m.best, m.latest, m.time]
      .concat(read ? [m.flag] : [], [m.cheat]));
  const esc = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const csv = '﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const lesson = document.getElementById('ad-lesson').value;
  const cls = document.getElementById('ad-cls').value || admin.dept || '全部班級';
  link.download = `${catName(admin.cat)}成績_${lesson ? lessonShort(lesson) : admin.book || '全部版本'}_${cls}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/* ---------- 啟動 ---------- */

function showAdmin() {
  document.getElementById('admin-user').innerHTML = userBadgeHtml('<div class="hint" style="margin-left:auto">教師帳號</div>');
  showSection('admin-panel');
  loadAdmin();
}

/* 從某一課的測驗頁切過來（?lesson=課次）：預設顯示那一課 */
(function presetFromUrl() {
  const id = new URLSearchParams(location.search).get('lesson');
  if (!id) return;
  admin.cat = catOf(id);
  admin.book = catalogById[id] ? catalogById[id].book : '';
  admin.presetLesson = id;
})();

app.onReady = () => {
  if (!app.isTeacher) {
    document.getElementById('gate-msg').innerHTML =
      `<span class="warn">⚠️ ${escapeHtml(app.user.email)} 不是教師帳號，無法使用管理頁。</span><br><a href="index.html">回測驗列表</a>`;
    showSection('quiz-gate');
    return;
  }
  showAdmin();
};

function studentModeUrl() {
  const id = admin.presetLesson || document.getElementById('ad-lesson').value;
  if (!id) return 'index.html';
  return catOf(id) === 'READ' ? READ_SITE + id + '.html' : id + '.html';
}

document.getElementById('ad-cats').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  admin.cat = b.dataset.cat;
  admin.book = '';
  admin.presetLesson = null;
  document.getElementById('ad-lesson').value = '';
  admin.selected.clear();
  refreshFilters();
  renderAdminTable();
});
document.getElementById('ad-books').addEventListener('click', e => {
  const b = e.target.closest('[data-book]');
  if (!b) return;
  admin.book = b.dataset.book;
  renderBookChips();
  fillLessonSelect();
  document.getElementById('ad-lesson').value = '';
  fillClassSelect();
  renderAdminTable();
});
document.getElementById('ad-depts').addEventListener('click', e => {
  const b = e.target.closest('[data-dept-filter]');
  if (!b) return;
  admin.dept = b.dataset.deptFilter;
  renderDeptChips();
  document.getElementById('ad-cls').value = '';
  fillClassSelect();
  renderAdminTable();
});
['ad-cls', 'ad-status', 'ad-sort'].forEach(id => document.getElementById(id).addEventListener('change', renderAdminTable));
document.getElementById('ad-lesson').addEventListener('change', () => { fillClassSelect(); renderAdminTable(); });
document.getElementById('ad-search').addEventListener('input', renderAdminTable);
document.getElementById('ad-refresh').addEventListener('click', loadAdmin);
document.getElementById('ad-csv').addEventListener('click', downloadCsv);
document.getElementById('ad-delete').addEventListener('click', () => confirmDelete([...admin.selected]));
document.getElementById('ad-student').addEventListener('click', () => {
  try { sessionStorage.setItem(TOKEN_KEY, app.user.idToken); } catch (e) {}
  location.href = studentModeUrl();
});
document.getElementById('ad-signout').addEventListener('click', signOut);
MOBILE.addEventListener('change', () => { if (admin.attempts.length) renderAdminTable(); });

const table = document.getElementById('ad-list');
table.addEventListener('change', e => {
  if (e.target.id === 'ad-all') {
    adminFilter().forEach(a => { if (e.target.checked) admin.selected.add(a.id); else admin.selected.delete(a.id); });
    renderAdminTable();
  } else if (e.target.classList.contains('ad-chk')) {
    if (e.target.checked) admin.selected.add(e.target.dataset.id); else admin.selected.delete(e.target.dataset.id);
    renderAdminTable();
  }
});
table.addEventListener('click', e => {
  const btn = e.target.closest('[data-review]');
  if (btn) openReview(btn.dataset.review);
});

showSection('quiz-gate');
tryStoredLogin();
