/* 本土語線上測驗：題型測驗引擎（生份字／選詞塌空／咱來鬥句／形音義）
   臺中明道中學 詹宗龍 製作

   規則：每次 25 題、每題 4 分（滿分 100）。每題作答後立即鎖定並跳下一題，不能回頭修改。
   形音義每題要依序選「聲母／韻母／聲調／變調」（每個音節 4 格），依答對格數按比例給分。
   交卷後顯示分數與每題參考答案，成績送到收件程式；可以重複測驗，每次都會記錄。
   題庫（LESSON.items）由 build.py 從練習版網頁擷取後寫在各課頁面裡。 */

const QUIZ_COUNT = 25;
const PER_Q = 100 / QUIZ_COUNT;   // 每題 4 分
const LABELS = ['A', 'B', 'C', 'D'];

const quiz = {
  started: false,
  finished: false,
  submitted: false,
  submitting: false,
  questions: [],
  idx: 0,
  records: [],
  hiddenCount: 0,
  startedAt: 0,
  locked: false
};

/* ===================== 出題 ===================== */

/** 取 25 題：題庫洗牌後依序取；題庫不足 25 題時重洗再補（同一題會換成另一種出題方式） */
function pickItems(items, n) {
  const out = [];
  while (out.length < n) {
    let batch = shuffle(items);
    if (out.length && batch.length > 1 && batch[0] === out[out.length - 1]) batch.push(batch.shift());
    out.push(...batch.slice(0, n - out.length));
  }
  return out;
}

/** 各種出題方式平均分配到 25 題；同一題目重複出現時盡量換一種方式 */
function assignModes(picked, modes) {
  let pool = [];
  const used = new Map();
  return picked.map(item => {
    if (!pool.length) pool = shuffle(modes);
    const seen = used.get(item) || [];
    let k = pool.findIndex(m => !seen.includes(m));
    if (k < 0) k = 0;
    const mode = pool.splice(k, 1)[0];
    used.set(item, seen.concat(mode));
    return { item, mode };
  });
}

/** 從題庫挑 n 個不重複的錯誤選項 */
function distractors(correct, values, n) {
  const pool = shuffle([...new Set(values.filter(v => v && v !== correct))]);
  return pool.slice(0, n);
}

function audioText(tl) {
  return String(tl || '').split(' ').map(s => s.split('/')[0].trim()).join(' ').trim();
}

function playWord(tl, btn) {
  const t = audioText(tl);
  if (!t) return;
  try {
    if (/^https?:\/\//.test(t)) { new Audio(t).play().catch(() => {}); return; }
    if (typeof holo === 'function') holo(btn || document.createElement('div'), t);
    else toast('發音元件還沒載入，請稍後再按一次');
  } catch (e) {
    toast('發音播放失敗');
  }
}

/* ---------- 各題型 ---------- */

const KINDS = {
  /* 生份字：聽音檔或看字，四選一 */
  SIANN: {
    modes: [1, 2, 3, 4],
    modeName: { 1: '聽音檔選台語', 2: '聽音檔選台羅', 3: '看台語選台羅', 4: '看台羅選台語' },
    build(item, mode) {
      const field = mode === 1 || mode === 4 ? 'ty' : 'tl';
      const others = LESSON.items.filter(o => o.ty !== item.ty && o.tl !== item.tl).map(o => o[field]);
      const correct = item[field];
      return { correct, options: shuffle([correct, ...distractors(correct, others, 3)]) };
    },
    render(q, box) {
      const it = q.item;
      const audio = q.mode === 1 || q.mode === 2;
      const ask = { 1: '請聽音檔，選出正確的台語', 2: '請聽音檔，選出正確的台羅', 3: '請選出這個台語語詞的台羅', 4: '請選出這個台羅的台語' }[q.mode];
      box.innerHTML = `
        <div class="qz-ask">${ask}</div>
        ${audio
          ? `<div class="qz-prompt"><button class="qz-play" type="button">🔊 播放音檔</button></div>`
          : `<div class="qz-prompt big">${escapeHtml(q.mode === 3 ? it.ty : it.tl)}</div>
             <div class="qz-hint">華語：${escapeHtml(it.md)}</div>`}
        <div class="qz-options"></div>`;
      if (audio) {
        const b = box.querySelector('.qz-play');
        b.addEventListener('click', () => playWord(it.tl, b));
        setTimeout(() => { if (quiz.questions[quiz.idx] === q) playWord(it.tl, b); }, 400);
      }
      renderChoices(q, box.querySelector('.qz-options'));
    },
    record(q, answer) {
      const it = q.item;
      const shown = { 1: '🔊 ' + it.tl, 2: '🔊 ' + it.ty, 3: it.ty, 4: it.tl }[q.mode];
      return { q: `【${this.modeName[q.mode]}】${shown}（${it.md}）`, a: answer, c: q.correct, pts: answer === q.correct ? PER_Q : 0 };
    }
  },

  /* 選詞塌空：句子挖空，選出合適的語詞（台語漢字或台羅） */
  SUANSU: {
    modes: ['ty', 'tl'],
    modeName: { ty: '選台語語詞', tl: '選台羅拼音' },
    build(item, mode) {
      const correct = item[mode];
      // 錯誤選項避開句子裡本來就有的語詞，減少「兩個都通」的情形
      const others = LESSON.items.filter(o => o.ty !== item.ty && o.tl !== item.tl && !item.sent.includes(o.ty)).map(o => o[mode]);
      return { correct, options: shuffle([correct, ...distractors(correct, others, 3)]) };
    },
    blanked(it) {
      const i = it.sent.indexOf(it.ty);
      return escapeHtml(it.sent.slice(0, i)) + '<span class="blank">＿＿＿</span>' + escapeHtml(it.sent.slice(i + it.ty.length));
    },
    render(q, box) {
      const it = q.item;
      box.innerHTML = `
        <div class="qz-ask">請選出最適合填入空格的${q.mode === 'ty' ? '台語語詞' : '台羅拼音'}</div>
        <div class="qz-prompt sentence-q">${this.blanked(it)}</div>
        <div class="qz-hint">華語：${escapeHtml(it.md)}</div>
        <div class="qz-options"></div>
        <div class="qz-note">適合的答案可能毋但一个，請選上合課文用法的</div>`;
      renderChoices(q, box.querySelector('.qz-options'));
    },
    record(q, answer) {
      const it = q.item;
      return { q: `【${this.modeName[q.mode]}】${it.sent.replace(it.ty, '＿＿')}（${it.md}）`, a: answer, c: q.correct, pts: answer === q.correct ? PER_Q : 0 };
    }
  },

  /* 咱來鬥句：把語詞依順序排成句子（另有 2 個不相干的語詞） */
  TAUKU: {
    modes: ['taigi', 'tailo'],
    modeName: { taigi: '台語語詞', tailo: '台羅語詞' },
    build(item, mode) {
      const isTaigi = mode === 'taigi';
      const seq = item.parts.map(p => {
        if (isTaigi) return p;
        if (p.includes(item.ty)) return p.split(item.ty).join(item.tl);
        const hit = LESSON.items.find(d => d.ty === p);
        return hit ? hit.tl : p;
      });
      const others = LESSON.items.filter(d => d.no !== item.no).map(d => isTaigi ? d.ty : d.tl).filter(w => !seq.includes(w));
      const extra = distractors('', others, 2);
      const tiles = shuffle([...seq, ...extra]).map((w, i) => ({ n: i + 1, w }));
      return { correct: seq.join(' '), seq, tiles };
    },
    render(q, box) {
      q.chosen = [];
      box.innerHTML = `
        <div class="qz-ask">請照順序點選語詞，組成一句通順的句子（有 2 个語詞是用袂著的）</div>
        <div class="tk-chosen" aria-label="你排的句子"></div>
        <div class="tk-tiles"></div>
        <div class="quiz-actions center">
          <button class="qbtn light" type="button" data-tk="clear">清除重排</button>
          <button class="qbtn" type="button" data-tk="ok" disabled>確定這題</button>
        </div>
        <div class="qz-note">按「確定這題」後就會鎖定，不能再修改</div>`;
      const draw = () => {
        box.querySelector('.tk-chosen').innerHTML = q.chosen.length
          ? q.chosen.map(t => `<button type="button" class="tile on" data-n="${t.n}">${escapeHtml(t.w)}</button>`).join('')
          : '<span class="hint">（點下面的語詞放到這裡；點這裡的語詞可以拿掉）</span>';
        box.querySelector('.tk-tiles').innerHTML = q.tiles.filter(t => !q.chosen.includes(t))
          .map(t => `<button type="button" class="tile" data-n="${t.n}">${escapeHtml(t.w)}</button>`).join('');
        box.querySelector('[data-tk=ok]').disabled = !q.chosen.length;
      };
      box.addEventListener('click', e => {
        if (quiz.locked) return;
        const tile = e.target.closest('.tile');
        if (tile) {
          const t = q.tiles.find(x => x.n === Number(tile.dataset.n));
          if (q.chosen.includes(t)) q.chosen = q.chosen.filter(x => x !== t);
          else q.chosen.push(t);
          draw();
          return;
        }
        const act = e.target.closest('[data-tk]');
        if (!act) return;
        if (act.dataset.tk === 'clear') { q.chosen = []; draw(); }
        if (act.dataset.tk === 'ok') {
          if (q.chosen.length !== q.seq.length &&
              !confirm(`正確的句子要用 ${q.seq.length} 個語詞，你用了 ${q.chosen.length} 個。確定要送出這題嗎？`)) return;
          answerQuestion(q.chosen.map(t => t.w).join(' '));
        }
      });
      draw();
    },
    record(q, answer) {
      const it = q.item;
      return { q: `【${this.modeName[q.mode]}】關鍵詞：${it.ty}（${it.md}）`, a: answer, c: q.correct, pts: answer === q.correct ? PER_Q : 0 };
    }
  },

  /* 形音義：聽音、看字，依序選出每個音節的聲母、韻母、聲調、變調；按答對格數比例給分 */
  HINGIM: {
    modes: ['all'],
    modeName: { all: '聲母韻母聲調變調' },
    TYPES: ['聲母', '韻母', '聲調', '變調'],
    build(item) {
      const steps = [];
      item.syl.forEach((s, si) => s.forEach((v, ti) => steps.push({ si, ti, correct: v, label: this.TYPES[ti] + (si + 1) })));
      return { steps, chosen: [], correct: item.syl.map(s => s.join(' ')).join('｜') };
    },
    pool(ti) {
      if (!this._pool) {
        this._pool = [[], [], [], []];
        LESSON.items.forEach(it => it.syl.forEach(s => s.forEach((v, k) => this._pool[k].push(v))));
      }
      return this._pool[ti];
    },
    render(q, box) {
      const it = q.item;
      box.innerHTML = `
        <div class="qz-ask">請聽發音，依序選出每個音節的聲母、韻母、聲調、變調</div>
        <div class="hg-word">
          <span class="hg-ty">${escapeHtml(it.ty)}</span>
          <button class="qz-play small" type="button">🔊</button>
        </div>
        <div class="qz-hint">華語：${escapeHtml(it.md)}</div>
        <div class="hg-matrix"></div>
        <div class="qz-options"></div>`;
      const pb = box.querySelector('.qz-play');
      pb.addEventListener('click', () => playWord(it.tl, pb));
      setTimeout(() => { if (quiz.questions[quiz.idx] === q) playWord(it.tl, pb); }, 500);
      this.step(q, box);
    },
    drawMatrix(q, box) {
      const cur = q.chosen.length;
      box.querySelector('.hg-matrix').innerHTML = q.item.syl.map((s, si) =>
        '<div class="hg-row">' + s.map((_, ti) => {
          const k = q.steps.findIndex(st => st.si === si && st.ti === ti);
          const v = q.chosen[k];
          return `<div class="hg-box${k === cur ? ' active' : ''}${v !== undefined ? ' filled' : ''}">
            <div class="hg-label">${this.TYPES[ti]}${si + 1}</div><div class="hg-val">${v !== undefined ? escapeHtml(v) : '?'}</div></div>`;
        }).join('') + '</div>').join('');
    },
    step(q, box) {
      this.drawMatrix(q, box);
      const st = q.steps[q.chosen.length];
      const opts = shuffle([st.correct, ...distractors(st.correct, this.pool(st.ti), 3)]);
      const grid = box.querySelector('.qz-options');
      grid.innerHTML = opts.map((o, i) =>
        `<button type="button" class="qz-opt" data-v="${escapeHtml(o)}"><span class="qz-lab">${LABELS[i]}</span><span class="qz-txt">${escapeHtml(o)}</span></button>`).join('');
      grid.querySelectorAll('.qz-opt').forEach(b => b.addEventListener('click', () => {
        if (quiz.locked) return;
        quiz.locked = true;
        b.classList.add('picked');
        q.chosen.push(b.dataset.v);
        setTimeout(() => {
          quiz.locked = false;
          if (q.chosen.length < q.steps.length) this.step(q, box);
          else { this.drawMatrix(q, box); answerQuestion(null); }
        }, 250);
      }));
      const active = box.querySelector('.hg-box.active');
      if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    record(q) {
      const it = q.item;
      const right = q.steps.filter((st, k) => q.chosen[k] === st.correct).length;
      const bySyl = arr => it.syl.map((s, si) => s.map((_, ti) => arr[q.steps.findIndex(st => st.si === si && st.ti === ti)]).join(' ')).join('｜');
      return {
        q: `${it.ty}（${it.tl}，${it.md}）`,
        a: bySyl(q.chosen), c: bySyl(q.steps.map(st => st.correct)),
        pts: Math.round(PER_Q * right / q.steps.length * 100) / 100,
        steps: `${right}/${q.steps.length}`
      };
    }
  }
};

const K = KINDS[LESSON.kind];

/** 四選一選項：點了就鎖定，停一下再跳下一題（不顯示對錯，交卷後才公布） */
function renderChoices(q, grid) {
  grid.innerHTML = q.options.map((o, i) =>
    `<button type="button" class="qz-opt" data-i="${i}"><span class="qz-lab">${LABELS[i]}</span><span class="qz-txt">${escapeHtml(o)}</span></button>`).join('');
  grid.querySelectorAll('.qz-opt').forEach(b => b.addEventListener('click', () => {
    if (quiz.locked) return;
    b.classList.add('picked');
    answerQuestion(q.options[Number(b.dataset.i)]);
  }));
}

/* ===================== 作答流程 ===================== */

function buildQuestions() {
  return assignModes(pickItems(LESSON.items, QUIZ_COUNT), K.modes)
    .map(({ item, mode }) => Object.assign({ item, mode }, K.build(item, mode)));
}

function startQuiz() {
  Object.assign(quiz, {
    started: true, finished: false, submitted: false, submitting: false,
    questions: buildQuestions(), idx: 0, records: [], hiddenCount: 0, startedAt: Date.now(), locked: false
  });
  showSection('quiz-play');
  renderQuestion();
}

function renderQuestion() {
  const q = quiz.questions[quiz.idx];
  document.getElementById('qz-progress').textContent = `第 ${quiz.idx + 1} 題 / 共 ${QUIZ_COUNT} 題`;
  document.getElementById('qz-bar-fill').style.width = `${quiz.idx / QUIZ_COUNT * 100}%`;
  const box = document.getElementById('qz-box');
  const fresh = box.cloneNode(false);   // 換新節點，舊題目的事件不會留下來
  box.replaceWith(fresh);
  K.render(q, fresh);
}

/** 作答一題：記錄後鎖定，0.6 秒後跳下一題 */
function answerQuestion(answer) {
  if (quiz.locked && LESSON.kind !== 'HINGIM') return;
  quiz.locked = true;
  const q = quiz.questions[quiz.idx];
  const r = K.record(q, answer);
  quiz.records.push(Object.assign({ no: q.item.no, mode: String(q.mode) }, r));
  document.querySelectorAll('#qz-box button').forEach(b => { b.disabled = true; });
  setTimeout(() => {
    quiz.locked = false;
    quiz.idx++;
    if (quiz.idx < QUIZ_COUNT) renderQuestion();
    else finishQuiz();
  }, 600);
}

function quizScore() {
  return Math.round(quiz.records.reduce((s, r) => s + r.pts, 0) * 10) / 10;
}

function fmtPts(v) {
  return String(Math.round(v * 100) / 100);
}

function finishQuiz() {
  quiz.finished = true;
  document.getElementById('qz-bar-fill').style.width = '100%';
  const total = quizScore();
  const right = quiz.records.filter(r => r.pts >= PER_Q - 1e-6).length;
  const rows = quiz.records.map((r, i) => {
    const full = r.pts >= PER_Q - 1e-6;
    return `<tr class="${full ? 'ok' : r.pts > 0 ? 'part' : 'wrong'}">
      <td>${i + 1}</td>
      <td class="l">${escapeHtml(r.q)}</td>
      <td class="l">${escapeHtml(r.a || '（未作答）')}</td>
      <td class="l"><b>${escapeHtml(r.c)}</b></td>
      <td>${full ? '✔' : r.pts > 0 ? '△' : '✘'} ${fmtPts(r.pts)}${r.steps ? `<div class="hint">${r.steps} 格</div>` : ''}</td>
    </tr>`;
  }).join('');
  document.getElementById('rs-score').textContent = total;
  document.getElementById('rs-summary').innerHTML =
    `答對 <b>${right}</b> / ${QUIZ_COUNT} 題` + (LESSON.kind === 'HINGIM' ? '（部分答對按比例給分）' : '') +
    `｜作答時間 ${Math.round((Date.now() - quiz.startedAt) / 1000)} 秒`;
  document.getElementById('rs-table').innerHTML = `<table class="rs-table">
    <tr><th>#</th><th>題目</th><th>你的答案</th><th>參考答案</th><th>得分</th></tr>${rows}</table>`;
  showSection('quiz-result');
  submitQuiz();
}

async function submitQuiz() {
  if (quiz.submitting || quiz.submitted) return;
  quiz.submitting = true;
  const st = document.getElementById('rs-status');
  st.className = 'rs-status';
  st.innerHTML = '⏫ 成績上傳中…請不要關閉網頁';
  document.getElementById('rs-retry').classList.add('hidden');
  try {
    const d = await api({
      action: 'quiz_submit',
      lesson: LESSON.id,
      hiddenCount: quiz.hiddenCount,
      seconds: Math.round((Date.now() - quiz.startedAt) / 1000),
      items: quiz.records
    });
    quiz.submitted = true;
    st.className = 'rs-status ok';
    st.innerHTML = `✅ 成績已記錄：這是你第 <b>${d.attempt}</b> 次作答，本次 <b>${d.total}</b> 分，目前最高 <b>${d.best}</b> 分`;
  } catch (err) {
    st.className = 'rs-status bad';
    st.innerHTML = `⚠️ 成績送出失敗：${escapeHtml(String(err.message || err))}<br>請確認網路後按「重新送出」。`;
    document.getElementById('rs-retry').classList.remove('hidden');
  } finally {
    quiz.submitting = false;
  }
}

async function showHistory() {
  openModal('<h3>📋 我的成績</h3><div>讀取中…</div>');
  try {
    const data = await api({ action: 'quiz_history', lesson: LESSON.id });
    const best = data.attempts.filter(a => a.verdict !== '判定作弊').reduce((m, a) => Math.max(m, Number(a.total) || 0), 0);
    const items = data.attempts.slice().reverse().map(a => `
      <div class="hist-item">
        <div class="hist-main">
          <div><b>第 ${a.attempt} 次</b>　答對 ${a.correct} / ${a.count} 題</div>
          <div class="hint">${escapeHtml(a.time)}</div>
          ${a.verdict ? `<div>老師審查：${escapeHtml(a.verdict)}</div>` : ''}
        </div>
        <div class="hist-score">${a.total}<span>分</span></div>
      </div>`).join('');
    openModal(`
      <h3>📋 我的成績</h3>
      <div class="hint">${escapeHtml(LESSON.kindName)}｜${escapeHtml(LESSON.book)} ${escapeHtml(LESSON.title)}${data.attempts.length ? `｜共 ${data.attempts.length} 次，最高 <b>${best}</b> 分` : ''}</div>
      ${data.attempts.length ? `<div class="hist-list">${items}</div>` : '<div>還沒有作答紀錄。</div>'}
      <div class="quiz-actions"><button class="qbtn light" id="btn-close">關閉</button></div>`);
  } catch (err) {
    openModal(`<h3>📋 我的成績</h3><div>讀取失敗：${escapeHtml(String(err.message || err))}</div>
      <div class="quiz-actions"><button class="qbtn light" id="btn-close">關閉</button></div>`);
  }
  document.getElementById('btn-close').addEventListener('click', closeModal);
}

/* ===================== 說明頁、教師模式 ===================== */

function showIntro() {
  const p = app.profile || {};
  const extra = p.cls ? `<div class="hint" style="margin-left:auto">班級 <b>${escapeHtml(p.cls)}</b>　座號 <b>${escapeHtml(p.seat)}</b>　${escapeHtml(p.name)}` +
    (app.isTeacher ? '<br><b>教師以學生身分測試</b>（成績會記錄在系統）' : '') + '</div>' : '';
  document.getElementById('quiz-user').innerHTML = userBadgeHtml(extra);
  document.getElementById('btn-back-admin').classList.toggle('hidden', !app.isTeacher);
  document.getElementById('btn-edit-profile').classList.toggle('hidden', app.isTeacher);
  showSection('quiz-intro');
}

function showTeacherChoice() {
  document.getElementById('choice-user').innerHTML = userBadgeHtml('<div class="hint" style="margin-left:auto">教師帳號</div>');
  showSection('teacher-choice');
}

app.onReady = () => {
  if (app.isTeacher) showTeacherChoice();
  else if (!app.profile) showProfileForm(showIntro, null);
  else showIntro();
};

/* ===================== 啟動 ===================== */

document.getElementById('intro-rules').innerHTML = {
  SIANN: '<li>四種出題方式混合：聽音檔選台語、聽音檔選台羅、看台語選台羅、看台羅選台語。</li>',
  SUANSU: '<li>每題一句挖空的句子，選出最適合填入的台語語詞或台羅拼音。</li>',
  TAUKU: '<li>每題依順序點選語詞排成句子（有 2 个語詞是用袂著的），按「確定這題」送出。</li>',
  HINGIM: '<li>每題依序選出每個音節的<b>聲母、韻母、聲調、變調</b>；每題 4 分依答對格數按比例給分。</li>'
}[LESSON.kind] + document.getElementById('intro-rules').innerHTML;

bindProfileForm();
document.getElementById('btn-start').addEventListener('click', startQuiz);
document.getElementById('btn-history').addEventListener('click', showHistory);
document.getElementById('btn-edit-profile').addEventListener('click', () => showProfileForm(showIntro, showIntro));
document.getElementById('btn-switch').addEventListener('click', signOut);
document.getElementById('btn-back-admin').addEventListener('click', goAdmin);
// 教師的學生模式：班級一律記為「教師」（收件程式決定），與各班區隔，不必點選班級座號
document.getElementById('mode-student').addEventListener('click', showIntro);
document.getElementById('mode-admin').addEventListener('click', goAdmin);
document.getElementById('rs-again').addEventListener('click', () => {
  if (!quiz.submitted && !confirm('這次成績還沒送出成功，確定要放棄並重新測驗嗎？')) return;
  startQuiz();
});
document.getElementById('rs-retry').addEventListener('click', submitQuiz);
document.getElementById('rs-history').addEventListener('click', showHistory);
document.getElementById('qz-quit').addEventListener('click', () => {
  if (!confirm('確定要放棄這次作答嗎？已作答的題目不會記錄。')) return;
  quiz.started = false;
  showIntro();
});

document.addEventListener('visibilitychange', () => {
  if (quiz.started && !quiz.finished && document.hidden) quiz.hiddenCount++;
});
window.addEventListener('beforeunload', e => {
  if ((quiz.started && !quiz.finished) || (quiz.finished && !quiz.submitted)) {
    e.preventDefault();
    e.returnValue = '';
  }
});

showSection('quiz-gate');
tryStoredLogin();
