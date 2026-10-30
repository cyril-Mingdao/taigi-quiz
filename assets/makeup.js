/*! 本土語線上測驗 — © 2026 詹宗龍（臺中明道中學）保留一切權利。 */
/* 口說補測驗區（makeup.html）：教師自訂補測驗項目，學生補繳錄音檔
   臺中明道中學 詹宗龍 製作（2026-10-30）
   - 教師管理：新增／修改／移除項目（名稱、年段、繳交期限、收件開關、測驗說明），只有建立者能改；
     所有教師都能聽繳交的錄音、下載繳交名單。
   - 學生：看到所有項目，點選後在網頁上登入錄音繳交（不開放上傳檔案，防代錄）；限本年段、收件中、期限內才能送出。 */

const MK_GRADES = ['國一', '國二', '高一', '技高二', '國際部'];   // 與收件程式 MK_GRADES 一致
const MK_MAX_BYTES = 20 * 1024 * 1024;   // 收件程式上限約 20 MB（10 分鐘的錄音遠低於此）
const MK_MAX_REC_SEC = 10 * 60;
const STATE_LABEL = { open: '🟢 收件中', closed: '⛔ 已關閉收件', expired: '⌛ 已超過期限' };

const mk = {
  tasks: [], grade: '', current: null, editing: null, mineOnly: false,
  rec: null, chunks: [], blob: null, mime: '', seconds: 0, timer: null, startAt: 0, url: ''
};

function gradeOfClass(cls) {
  cls = String(cls || '');
  if (cls === '教師') return '教師';
  if (/^國一/.test(cls)) return '國一';
  if (/^國二/.test(cls)) return '國二';
  if (/^高一/.test(cls)) return '高一';
  if (/^(商|餐|廣|美|英|訊|子|觀)二/.test(cls)) return '技高二';
  if (['701', '702', '1001', '1002'].includes(cls)) return '國際部';
  return '';
}

/** 測驗說明：保留換行，網址變成連結 */
function descHtml(s) {
  return escapeHtml(s).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
}

function stateBadge(t) {
  return `<span class="mk-state ${t.state}">${STATE_LABEL[t.state] || ''}</span>`;
}

function gradeBadges(t) {
  return t.grades.map(g => `<span class="mk-grade">${escapeHtml(g)}</span>`).join('');
}

function canSubmit(t) {
  if (t.state !== 'open') return false;
  return app.isTeacher || t.grades.includes(mk.grade);
}

async function loadTasks() {
  const d = await api({ action: 'mk_list' });
  mk.tasks = d.tasks || [];
  mk.grade = d.grade || gradeOfClass(app.profile && app.profile.cls);
  return d;
}

/* ===================== 教師：選模式 ===================== */

function showChoice() {
  document.getElementById('mk-choice-user').innerHTML = userBadgeHtml('<div class="hint" style="margin-left:auto">教師帳號</div>');
  showSection('mk-choice');
}

/* ===================== 學生：項目列表 ===================== */

async function showStudentList() {
  showSection('mk-student');
  document.getElementById('mk-user').innerHTML = userBadgeHtml(
    `<div class="hint" style="margin-left:auto">${app.isTeacher ? '教師以學生身分檢視（不限年段）'
      : escapeHtml((app.profile.cls || '') + ' ' + (app.profile.seat || '') + ' 號 ' + (app.profile.name || ''))}</div>`);
  document.getElementById('mk-back-admin').classList.toggle('hidden', !app.isTeacher);
  const box = document.getElementById('mk-task-list');
  box.innerHTML = '<div class="hint">⏳ 讀取中…</div>';
  try {
    await loadTasks();
    renderStudentList();
  } catch (err) {
    box.innerHTML = `<div class="warn">⚠️ ${escapeHtml(err.message || err)}</div>`;
  }
}

function renderStudentList() {
  const box = document.getElementById('mk-task-list');
  if (!mk.tasks.length) {
    box.innerHTML = '<div class="hint">目前老師還沒有開設補測驗項目。</div>';
    return;
  }
  const order = { open: 0, expired: 1, closed: 2 };
  const list = mk.tasks.slice().sort((a, b) => (order[a.state] - order[b.state]) || (b.ts - a.ts));
  box.innerHTML = list.map(t => {
    const mine = app.isTeacher || t.grades.includes(mk.grade);
    return `<button type="button" class="mk-task${t.state !== 'open' ? ' dim' : ''}" data-id="${escapeHtml(t.id)}">
      <b class="mk-name">${escapeHtml(t.name)}</b>
      <span class="mk-meta">🧑‍🏫 ${escapeHtml(t.creatorName || t.creator)} 老師建立</span>
      <span class="mk-meta">${gradeBadges(t)}${mine ? '' : '<span class="mk-grade other">非本年段</span>'}</span>
      <span class="mk-meta">${stateBadge(t)}${t.deadline ? '　繳交期限：' + escapeHtml(t.deadline) : '　不限期限'}</span>
      <span class="mk-meta">${t.mine.length ? `✅ 已繳交 ${t.mine.length} 次（最近 ${escapeHtml(t.mine[t.mine.length - 1].time)}）` : '尚未繳交'}</span>
    </button>`;
  }).join('');
}

/* ===================== 學生：繳交錄音 ===================== */

function openTask(id) {
  const t = mk.tasks.find(x => x.id === id);
  if (!t) return;
  mk.current = t;
  resetRecording();
  document.getElementById('mk-t-name').textContent = t.name;
  document.getElementById('mk-t-meta').innerHTML =
    `🧑‍🏫 ${escapeHtml(t.creatorName || t.creator)} 老師建立　${gradeBadges(t)}<br>${stateBadge(t)}　` +
    (t.deadline ? `繳交期限：<b>${escapeHtml(t.deadline)}</b>` : '不限期限');
  document.getElementById('mk-t-desc').innerHTML = t.desc ? descHtml(t.desc) : '<span class="hint">（老師沒有填寫說明）</span>';
  const ok = canSubmit(t);
  let why = '';
  if (t.state === 'closed') why = '⛔ 老師已關閉收件，目前不能繳交。';
  else if (t.state === 'expired') why = '⌛ 已超過繳交期限，不能再繳交。';
  else if (!ok) why = `🚫 這個項目只開放給 ${t.grades.join('、')}，你的班級（${app.profile.cls}）不在其中。`;
  document.getElementById('mk-t-why').textContent = why;
  document.getElementById('mk-t-why').classList.toggle('hidden', !why);
  document.getElementById('mk-recorder').classList.toggle('hidden', !ok);
  renderMine();
  showSection('mk-task');
}

function renderMine() {
  const t = mk.current;
  const box = document.getElementById('mk-t-mine');
  box.innerHTML = t.mine.length
    ? '<table class="admin-table"><tr><th>第幾次</th><th>繳交時間</th><th>錄音長度</th></tr>' +
      t.mine.map(m => `<tr><td>${m.attempt}</td><td>${escapeHtml(m.time)}</td><td>${fmtSec(m.sec)}</td></tr>`).join('') + '</table>'
    : '<div class="hint">還沒有繳交紀錄。</div>';
}

function fmtSec(s) {
  s = Math.round(Number(s) || 0);
  return s ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : '—';
}

function resetRecording() {
  if (mk.rec && mk.rec.state !== 'inactive') { try { mk.rec.stop(); } catch (e) {} }
  clearInterval(mk.timer);
  if (mk.url) URL.revokeObjectURL(mk.url);
  Object.assign(mk, { rec: null, chunks: [], blob: null, mime: '', seconds: 0, url: '' });
  document.getElementById('mk-preview').classList.add('hidden');
  document.getElementById('mk-preview').removeAttribute('src');
  document.getElementById('mk-rec-btn').textContent = '🎙️ 開始錄音';
  document.getElementById('mk-rec-btn').classList.remove('danger');
  document.getElementById('mk-rec-time').textContent = '';
  document.getElementById('mk-submit').disabled = true;
  document.getElementById('mk-msg').textContent = '';
}

function pickMime() {
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return window.MediaRecorder && MediaRecorder.isTypeSupported ? cands.find(m => MediaRecorder.isTypeSupported(m)) || '' : '';
}

async function toggleRecord() {
  const btn = document.getElementById('mk-rec-btn');
  if (mk.rec && mk.rec.state === 'recording') { mk.rec.stop(); return; }
  if (!window.MediaRecorder || !navigator.mediaDevices) {
    toast('這個瀏覽器不能錄音，請改用電腦版 Chrome 或 Edge');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    toast('無法使用麥克風，請允許瀏覽器使用麥克風');
    return;
  }
  resetRecording();
  const mime = pickMime();
  const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  mk.rec = rec;
  rec.ondataavailable = e => { if (e.data && e.data.size) mk.chunks.push(e.data); };
  rec.onstop = () => {
    stream.getTracks().forEach(tr => tr.stop());
    clearInterval(mk.timer);
    mk.seconds = (Date.now() - mk.startAt) / 1000;
    mk.mime = (rec.mimeType || mime || 'audio/webm');
    setAudio(new Blob(mk.chunks, { type: mk.mime }), mk.seconds);
    btn.textContent = '🎙️ 重新錄音';
    btn.classList.remove('danger');
  };
  mk.startAt = Date.now();
  rec.start(1000);
  btn.textContent = '⏹️ 停止錄音';
  btn.classList.add('danger');
  mk.timer = setInterval(() => {
    const s = (Date.now() - mk.startAt) / 1000;
    document.getElementById('mk-rec-time').textContent = '🔴 錄音中 ' + fmtSec(s);
    if (s >= MK_MAX_REC_SEC) rec.stop();
  }, 300);
}

function setAudio(blob, seconds) {
  if (mk.url) URL.revokeObjectURL(mk.url);
  mk.blob = blob;
  mk.url = URL.createObjectURL(blob);
  const a = document.getElementById('mk-preview');
  a.src = mk.url;
  a.classList.remove('hidden');
  mk.seconds = seconds || 0;
  document.getElementById('mk-rec-time').textContent =
    `✅ 已備妥錄音${mk.seconds ? '（' + fmtSec(mk.seconds) + '）' : ''}，請先試聽再送出`;
  if (blob.size > MK_MAX_BYTES) {
    document.getElementById('mk-msg').textContent = '⚠️ 檔案超過 20 MB，請縮短或壓縮後再傳。';
    document.getElementById('mk-submit').disabled = true;
    return;
  }
  document.getElementById('mk-msg').textContent = '';
  document.getElementById('mk-submit').disabled = false;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function submitAudio() {
  const t = mk.current;
  if (!t || !mk.blob) return;
  const btn = document.getElementById('mk-submit');
  const msg = document.getElementById('mk-msg');
  btn.disabled = true;
  msg.textContent = '⏳ 上傳中，請不要關閉網頁…';
  try {
    const audio = await blobToBase64(mk.blob);
    const d = await api({ action: 'mk_submit', taskId: t.id, audio: audio, mime: mk.mime, seconds: Math.round(mk.seconds), ip: await getClientIp() });
    msg.textContent = '';
    t.mine.push({ attempt: d.attempt, time: d.time, sec: Math.round(mk.seconds) });
    renderMine();
    openModal(`<h3>✅ 繳交成功</h3><div>「${escapeHtml(t.name)}」第 ${d.attempt} 次繳交已送給老師（${escapeHtml(d.time)}）。</div>
      <div class="quiz-actions"><button class="qbtn" onclick="closeModal()">好</button></div>`);
    resetRecording();
  } catch (err) {
    msg.textContent = '⚠️ ' + (err.message || err) + '（錄音還在，可以再按一次送出）';
    btn.disabled = false;
  }
}

/* ===================== 教師管理 ===================== */

async function showAdmin() {
  showSection('mk-admin');
  document.getElementById('mk-admin-user').innerHTML = userBadgeHtml('<div class="hint" style="margin-left:auto">教師帳號</div>');
  await refreshAdmin();
}

async function refreshAdmin() {
  const box = document.getElementById('mk-admin-list');
  box.innerHTML = '<div class="hint">⏳ 讀取中…</div>';
  try {
    await loadTasks();
    renderAdminList();
  } catch (err) {
    box.innerHTML = `<div class="warn">⚠️ ${escapeHtml(err.message || err)}</div>`;
  }
}

function renderAdminList() {
  const box = document.getElementById('mk-admin-list');
  const list = mk.tasks.filter(t => !mk.mineOnly || t.creator === app.user.email);
  document.getElementById('mk-admin-count').textContent = `共 ${list.length} 個項目`;
  if (!list.length) {
    box.innerHTML = '<div class="hint">還沒有補測驗項目，按「➕ 新增補測驗項目」建立。</div>';
    return;
  }
  box.innerHTML = '<table class="admin-table mk-table"><thead><tr><th>名稱</th><th>建立者</th><th>年段</th><th>繳交期限</th><th>收件</th><th>繳交</th><th>操作</th></tr></thead><tbody>' +
    list.map(t => {
      const own = t.creator === app.user.email;
      const id = escapeHtml(t.id);
      return `<tr>
        <td class="mk-td-name"><b>${escapeHtml(t.name)}</b>${t.desc ? `<div class="hint mk-desc-short">${escapeHtml(t.desc.slice(0, 60))}${t.desc.length > 60 ? '…' : ''}</div>` : ''}</td>
        <td>${escapeHtml(t.creatorName || t.creator)}<div class="hint">${escapeHtml(t.created)}</div>${t.modified ? `<div class="hint">修改：${escapeHtml(t.modifierName)} ${escapeHtml(t.modified)}</div>` : ''}</td>
        <td>${gradeBadges(t)}</td>
        <td>${t.deadline ? escapeHtml(t.deadline) : '不限'}</td>
        <td>${stateBadge(t)}${own ? `<div><button class="qbtn small ${t.open ? 'light' : ''}" data-act="state" data-id="${id}" data-open="${t.open ? '0' : '1'}">${t.open ? '關閉收件' : '開啟收件'}</button></div>` : ''}</td>
        <td>${t.studentCount || 0} 人／${t.subCount || 0} 件<div><button class="qbtn small light" data-act="subs" data-id="${id}">🎧 查看</button></div></td>
        <td class="mk-ops">${own
          ? `<button class="qbtn small light" data-act="edit" data-id="${id}">✏️ 修改</button> <button class="qbtn small danger" data-act="del" data-id="${id}">🗑️ 移除</button>`
          : '<span class="hint">只有建立者可修改</span>'}</td>
      </tr>`;
    }).join('') + '</tbody></table>';
}

function openEditor(t) {
  mk.editing = t || null;
  document.getElementById('mk-form-title').textContent = t ? '✏️ 修改補測驗項目' : '➕ 新增補測驗項目';
  document.getElementById('mk-f-name').value = t ? t.name : '';
  document.getElementById('mk-f-grades').innerHTML = MK_GRADES.map(g =>
    `<button type="button" class="chip${t && t.grades.includes(g) ? ' on' : ''}" data-grade="${g}">${g}</button>`).join('');
  document.getElementById('mk-f-deadline').value = t ? t.deadlineInput : '';
  document.getElementById('mk-f-open').checked = t ? t.open : true;
  document.getElementById('mk-f-desc').value = t ? t.desc : '';
  document.getElementById('mk-f-creator').textContent = t
    ? `建立者：${t.creatorName || t.creator}（${t.creator}）　${t.created}`
    : `建立者：${app.user.name}（${app.user.email}）`;
  document.getElementById('mk-f-msg').textContent = '';
  showSection('mk-form');
}

async function saveEditor(e) {
  e.preventDefault();
  const msg = document.getElementById('mk-f-msg');
  const task = {
    id: mk.editing ? mk.editing.id : '',
    name: document.getElementById('mk-f-name').value.trim(),
    grades: [...document.querySelectorAll('#mk-f-grades .chip.on')].map(b => b.dataset.grade),
    deadline: document.getElementById('mk-f-deadline').value,
    open: document.getElementById('mk-f-open').checked,
    desc: document.getElementById('mk-f-desc').value
  };
  if (!task.name) { msg.textContent = '請填寫名稱。'; return; }
  if (!task.grades.length) { msg.textContent = '請至少選擇一個年段。'; return; }
  const btn = document.getElementById('mk-f-save');
  btn.disabled = true;
  msg.textContent = '⏳ 儲存中…';
  try {
    await api({ action: 'admin_mk_save', task: task });
    toast(mk.editing ? '已儲存修改' : '已新增補測驗項目');
    await showAdmin();
  } catch (err) {
    msg.textContent = '⚠️ ' + (err.message || err);
  } finally {
    btn.disabled = false;
  }
}

async function setState(id, open) {
  try {
    await api({ action: 'admin_mk_state', id: id, open: open });
    toast(open ? '已開啟收件' : '已關閉收件');
    await refreshAdmin();
  } catch (err) { toast('⚠️ ' + (err.message || err)); }
}

function confirmDelete(t) {
  openModal(`<h3>🗑️ 移除補測驗項目</h3>
    <div>確定移除「<b>${escapeHtml(t.name)}</b>」？學生將看不到這個項目。</div>
    <div class="hint">已繳交的 ${t.subCount || 0} 件錄音檔與紀錄會保留在老師的雲端硬碟（點讀筆測驗錄音／口說補測驗）與試算表「口說補測驗繳交」。</div>
    <div class="quiz-actions"><button class="qbtn danger" id="mk-del-ok">確定移除</button><button class="qbtn light" onclick="closeModal()">取消</button></div>`);
  document.getElementById('mk-del-ok').addEventListener('click', async () => {
    try {
      await api({ action: 'admin_mk_delete', id: t.id });
      closeModal();
      toast('已移除');
      await refreshAdmin();
    } catch (err) { toast('⚠️ ' + (err.message || err)); }
  });
}

let subsCache = [];
async function showSubs(t) {
  openModal(`<h3>🎧 ${escapeHtml(t.name)}：繳交紀錄</h3><div class="hint">⏳ 讀取中…</div>`, true);
  try {
    const d = await api({ action: 'admin_mk_subs', id: t.id });
    subsCache = (d.subs || []).sort((a, b) => String(a.cls).localeCompare(String(b.cls)) ||
      (Number(a.seat) || 0) - (Number(b.seat) || 0) || a.ts - b.ts);
    const rows = subsCache.map((s, i) => `<tr>
      <td>${escapeHtml(s.cls)}</td><td>${escapeHtml(s.seat)}</td><td>${escapeHtml(s.name)}<div class="hint">${escapeHtml(s.email)}</div></td>
      <td>${s.attempt}</td><td>${escapeHtml(s.time)}</td><td>${fmtSec(s.sec)}</td>
      <td><button class="qbtn small" data-play="${i}">▶ 播放</button> <a class="hint" href="${escapeHtml(s.fileUrl)}" target="_blank" rel="noopener">雲端</a><div class="mk-player" id="mk-player-${i}"></div></td>
    </tr>`).join('');
    openModal(`<h3>🎧 ${escapeHtml(t.name)}：繳交紀錄</h3>
      <div class="hint">${escapeHtml(t.creatorName)} 老師建立｜年段 ${escapeHtml(t.grades.join('、'))}｜共 ${subsCache.length} 件</div>
      ${subsCache.length ? `<div class="admin-table-wrap"><table class="admin-table"><tr><th>班級</th><th>座號</th><th>姓名</th><th>第幾次</th><th>繳交時間</th><th>長度</th><th>錄音</th></tr>${rows}</table></div>` : '<div class="hint">還沒有學生繳交。</div>'}
      <div class="quiz-actions">${subsCache.length ? '<button class="qbtn light" id="mk-subs-csv">⬇️ 下載繳交名單 CSV</button>' : ''}<button class="qbtn light" onclick="closeModal()">關閉</button></div>`, true);
    const csvBtn = document.getElementById('mk-subs-csv');
    if (csvBtn) csvBtn.addEventListener('click', () => downloadSubsCsv(t));
  } catch (err) {
    openModal(`<h3>🎧 繳交紀錄</h3><div class="warn">⚠️ ${escapeHtml(err.message || err)}</div><div class="quiz-actions"><button class="qbtn light" onclick="closeModal()">關閉</button></div>`);
  }
}

async function playSub(i, btn) {
  const s = subsCache[i];
  const box = document.getElementById('mk-player-' + i);
  btn.disabled = true;
  btn.textContent = '⏳ 載入中';
  try {
    const d = await api({ action: 'admin_mk_audio', subId: s.id });
    const bin = atob(d.data);
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    const url = URL.createObjectURL(new Blob([bytes], { type: d.mime }));
    box.innerHTML = `<audio controls autoplay src="${url}"></audio>`;
    btn.classList.add('hidden');
  } catch (err) {
    toast('⚠️ ' + (err.message || err));
    btn.disabled = false;
    btn.textContent = '▶ 播放';
  }
}

function downloadSubsCsv(t) {
  const head = ['項目', '建立者', '班級', '座號', '姓名', 'Email', '第幾次', '繳交時間', '錄音秒數', '雲端檔案'];
  const lines = [head].concat(subsCache.map(s => [t.name, t.creatorName, s.cls, s.seat, s.name, s.email, s.attempt, s.time, s.sec, s.fileUrl]))
    .map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `口說補測驗_${t.name}.csv`;
  a.click();
}

/* ===================== 事件 ===================== */

app.onReady = () => {
  if (app.isTeacher) showChoice();
  else if (!app.profile) showProfileForm(showStudentList, null);
  else showStudentList();
};

bindProfileForm();
document.getElementById('mk-mode-student').addEventListener('click', () => showProfileForm(showStudentList, showStudentList));
document.getElementById('mk-mode-admin').addEventListener('click', showAdmin);
document.getElementById('mk-task-list').addEventListener('click', e => {
  const b = e.target.closest('.mk-task');
  if (b) openTask(b.dataset.id);
});
document.getElementById('mk-edit-profile').addEventListener('click', () => showProfileForm(showStudentList, showStudentList));
document.getElementById('mk-signout').addEventListener('click', signOut);
document.getElementById('mk-back-admin').addEventListener('click', showAdmin);
document.getElementById('mk-t-back').addEventListener('click', () => { resetRecording(); showStudentList(); });
document.getElementById('mk-rec-btn').addEventListener('click', toggleRecord);
document.getElementById('mk-submit').addEventListener('click', submitAudio);

document.getElementById('mk-new').addEventListener('click', () => openEditor(null));
document.getElementById('mk-refresh').addEventListener('click', refreshAdmin);
document.getElementById('mk-to-student').addEventListener('click', () => showProfileForm(showStudentList, showStudentList));
document.getElementById('mk-admin-signout').addEventListener('click', signOut);
document.getElementById('mk-mine-only').addEventListener('change', e => { mk.mineOnly = e.target.checked; renderAdminList(); });
document.getElementById('mk-admin-list').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const t = mk.tasks.find(x => x.id === b.dataset.id);
  if (!t) return;
  if (b.dataset.act === 'edit') openEditor(t);
  else if (b.dataset.act === 'del') confirmDelete(t);
  else if (b.dataset.act === 'state') setState(t.id, b.dataset.open === '1');
  else if (b.dataset.act === 'subs') showSubs(t);
});
document.getElementById('quiz-modal').addEventListener('click', e => {
  const b = e.target.closest('button[data-play]');
  if (b) playSub(Number(b.dataset.play), b);
});
document.getElementById('mk-f-grades').addEventListener('click', e => {
  const b = e.target.closest('[data-grade]');
  if (b) b.classList.toggle('on');
});
document.getElementById('mk-form-el').addEventListener('submit', saveEditor);
document.getElementById('mk-f-cancel').addEventListener('click', showAdmin);
