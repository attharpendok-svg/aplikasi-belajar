'use strict';
/* =========================================================
   Aplikasi Belajar — ringkas PPT dosen, lalu latihan soal.
   Semua data disimpan di browser (localStorage).
   ========================================================= */

const KEY = 'aplikasi_belajar_v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BLANK = '⟦?⟧';
const LETTERS = 'ABCDEFGHIJ';

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
}

/* ---------------- Data ---------------- */
function emptyDb() { return { topics: [], questions: [], stats: {}, sessions: [] }; }
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.topics)) return { ...emptyDb(), ...d };
  } catch (e) { /* abaikan */ }
  return emptyDb();
}
let db = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
  catch (e) {
    toast('Gagal menyimpan: penyimpanan browser penuh. Hapus teks slide yang tidak dipakai atau ekspor backup.', true);
    return false;
  }
}
const topicById = id => db.topics.find(t => t.id === id);
const courses = () => [...new Set(db.topics.map(t => t.course || 'Umum'))].sort();

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/* ---------------- Util UI ---------------- */
let toastTimer;
function toast(msg, err = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), err ? 5000 : 2500);
}
function openModal(html, onMount) {
  $('#modal-body').innerHTML = html;
  $('#modal').classList.remove('hidden');
  onMount && onMount($('#modal-body'));
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modal-body').innerHTML = ''; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('.modal-close')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal(); });

function stripMd(s) { return String(s).replace(/\*\*|__|==|`/g, '').replace(/(^|\s)\*(\S)/g, '$1$2').replace(/(\S)\*(\s|$)/g, '$1$2').trim(); }

function renderMd(text) {
  const src = String(text || '').replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
  if (window.marked && window.DOMPurify) return DOMPurify.sanitize(marked.parse(src, { breaks: true }));
  return '<div style="white-space:pre-wrap">' + esc(text) + '</div>';
}
const blankHtml = s => esc(s).replace(BLANK, '<b>_____</b>');
const pct = (c, n) => n ? Math.round(100 * c / n) : 0;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function fmtDate(ts) { return new Date(ts).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }

/* ---------------- Soal otomatis dari ringkasan ----------------
   **istilah**          -> soal isian (cloze)
   Istilah :: definisi  -> flashcard (dua arah)
---------------------------------------------------------------- */
function generateFromSummary(t) {
  const out = [];
  let heading = '';
  for (const raw of String(t.summary || '').split('\n')) {
    let line = raw.trim();
    if (!line) continue;
    const h = line.match(/^#{1,6}\s+(.*)/);
    if (h) { heading = stripMd(h[1]); continue; }
    line = line.replace(/^([-*+]|\d+[.)])\s+/, '').replace(/^>\s*/, '');

    const card = line.match(/^(.+?)\s*::\s*(.+)$/);
    if (card) {
      const front = stripMd(card[1]), back = stripMd(card[2]);
      if (front && back) {
        out.push({ id: 'fc:' + t.id + ':' + hash(front + '::' + back), type: 'card', topicId: t.id, source: 'Flashcard',
          prompt: front, answerText: back, context: heading });
        out.push({ id: 'fr:' + t.id + ':' + hash(front + '::' + back), type: 'short', topicId: t.id, source: 'Flashcard (balik)',
          prompt: 'Istilah apa yang dimaksud?\n' + back, answerText: front, context: heading });
      }
      continue;
    }

    const re = /\*\*(.+?)\*\*/g;
    const terms = [...line.matchAll(re)];
    terms.forEach((m, i) => {
      let k = 0;
      const masked = line.replace(re, (all, inner) => (k++ === i ? BLANK : inner));
      const plain = stripMd(masked);
      if (plain.replace(BLANK, '').replace(/[\s:.,;-]/g, '').length < 8) return; // terlalu pendek, tak ada konteks
      out.push({ id: 'cz:' + t.id + ':' + hash(line + '#' + i), type: 'cloze', topicId: t.id, source: 'Isian otomatis',
        prompt: plain, answerText: stripMd(m[1]), context: heading });
    });
  }
  return out;
}

function bankToItem(q) {
  return { id: q.id, type: q.type, topicId: q.topicId, source: 'Bank soal', prompt: q.question,
    options: q.options || [], answerIndex: q.answerIndex, answerText: q.answer || '', explanation: q.explanation || '' };
}
function itemsForTopic(tid, src = { bank: true, cloze: true, card: true }) {
  const t = topicById(tid);
  if (!t) return [];
  let items = [];
  if (src.bank) items = items.concat(db.questions.filter(q => q.topicId === tid).map(bankToItem));
  const gen = generateFromSummary(t);
  if (src.cloze) items = items.concat(gen.filter(g => g.type === 'cloze'));
  if (src.card) items = items.concat(gen.filter(g => g.source.startsWith('Flashcard')));
  return items;
}
function topicAccuracy(tid) {
  let c = 0, w = 0;
  for (const it of itemsForTopic(tid)) { const s = db.stats[it.id]; if (s) { c += s.c; w += s.w; } }
  return { c, w, n: c + w };
}

/* ---------------- Parser import soal (teks) ---------------- */
function parseQuestions(text) {
  const out = [], failed = [];
  const qStart = /^(?:soal\s*)?\d+\s*[.)]\s+/i;
  const reOpt = /^\(?([A-Ja-j])[.)]\s+(.*)$/;
  const reAns = /^(?:jawaban(?:\s*benar)?|kunci(?:\s*jawaban)?|answer|jwb)\s*[:=]\s*(.*)$/i;
  const reExp = /^(?:penjelasan|pembahasan|explanation|alasan)\s*[:=]\s*(.*)$/i;
  let q = null, gap = false;

  const flush = () => {
    if (!q || !q.question.trim()) { q = null; return; }
    const question = q.question.trim();
    const answer = q.answer.trim();
    const explanation = q.exp.trim();
    if (q.options.length >= 2) {
      let idx = -1;
      const m = answer.match(/^\(?([A-Ja-j])(?:[.)]|\s|$)/);
      if (m && answer.length <= 3) idx = m[1].toUpperCase().charCodeAt(0) - 65;
      else if (m) {
        const letterIdx = m[1].toUpperCase().charCodeAt(0) - 65;
        const rest = answer.slice(m[0].length).trim().toLowerCase();
        if (q.options[letterIdx] && (!rest || q.options[letterIdx].toLowerCase().startsWith(rest.slice(0, 10)))) idx = letterIdx;
      }
      if (idx < 0 && answer) idx = q.options.findIndex(o => norm(o) === norm(answer));
      if (idx >= 0 && idx < q.options.length) out.push({ type: 'mc', question, options: q.options.map(o => o.trim()), answerIndex: idx, answer: '', explanation });
      else failed.push(question);
    } else if (answer) {
      out.push({ type: 'short', question, options: [], answerIndex: -1, answer, explanation });
    } else failed.push(question);
    q = null;
  };

  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const l = raw.trim();
    if (!l) { gap = true; continue; }
    const mA = l.match(reAns), mE = l.match(reExp), mO = l.match(reOpt);
    if (mA && q) { q.answer = mA[1]; q.stage = 'ans'; gap = false; continue; }
    if (mE && q) { q.exp = mE[1]; q.stage = 'exp'; gap = false; continue; }
    if (mO && q && (q.stage === 'q' || q.stage === 'opt')) { q.options.push(mO[2]); q.stage = 'opt'; gap = false; continue; }
    const startsNew = !q || qStart.test(l) && q.stage !== 'q' || q.stage === 'ans' || (q.stage === 'exp' && gap);
    if (startsNew) { flush(); q = { question: l.replace(qStart, ''), options: [], answer: '', exp: '', stage: 'q' }; }
    else if (q.stage === 'exp') q.exp += '\n' + l;
    else if (q.stage === 'opt') q.options[q.options.length - 1] += ' ' + l;
    else q.question += '\n' + l;
    gap = false;
  }
  flush();
  return { questions: out, failed };
}

/* ---------------- Pemeriksa jawaban isian ---------------- */
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function checkText(given, answer) {
  const g = norm(given);
  if (!g) return false;
  const alts = String(answer).split(/\s*[|;]\s*|\s+\/\s+/).map(norm).filter(Boolean);
  if (!alts.length) return false;
  return alts.some(a => g === a || lev(g, a) <= Math.max(1, Math.floor(a.length * 0.2)) ||
    (a.length > 25 && g.length >= a.length * 0.5 && a.includes(g)));
}

/* ---------------- Ekstraksi PPTX / PDF ---------------- */
async function extractPptx(file) {
  if (!window.JSZip) throw new Error('Pustaka JSZip gagal dimuat (pastikan folder lib/ ada).');
  const zip = await JSZip.loadAsync(file);
  const slideFiles = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  const parser = new DOMParser();
  const xmlText = xml => {
    const doc = parser.parseFromString(xml, 'application/xml');
    return [...doc.getElementsByTagNameNS('*', 'p')]
      .map(p => [...p.getElementsByTagNameNS('*', 't')].map(t => t.textContent).join(''))
      .map(s => s.trim()).filter(Boolean);
  };
  const slides = [];
  for (const name of slideFiles) {
    const num = name.match(/slide(\d+)\.xml/)[1];
    let lines = xmlText(await zip.file(name).async('string'));
    // catatan pembicara (notes), jika ada
    const relsFile = zip.file(`ppt/slides/_rels/slide${num}.xml.rels`);
    let notes = [];
    if (relsFile) {
      const rels = await relsFile.async('string');
      const m = rels.match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/);
      if (m && zip.file('ppt/notesSlides/' + m[1])) {
        notes = xmlText(await zip.file('ppt/notesSlides/' + m[1]).async('string')).filter(s => !/^\d+$/.test(s));
      }
    }
    let text = lines.join('\n');
    if (notes.length) text += '\n\n[Catatan] ' + notes.join('\n');
    slides.push(text);
  }
  return slides;
}
async function extractPdf(file) {
  if (!window.pdfjsLib) throw new Error('Pustaka pdf.js gagal dimuat (pastikan folder lib/ ada).');
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    let s = '';
    for (const it of tc.items) { s += it.str; s += it.hasEOL ? '\n' : (it.str.endsWith(' ') ? '' : ' '); }
    pages.push(s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
  }
  return pages;
}
async function extractFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pptx')) return extractPptx(file);
  if (name.endsWith('.pdf')) return extractPdf(file);
  if (name.endsWith('.txt') || name.endsWith('.md')) return (await file.text()).split(/\n\s*\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (name.endsWith('.ppt')) throw new Error('Format .ppt lama belum didukung. Buka di PowerPoint/Google Slides lalu simpan sebagai .pptx atau .pdf.');
  throw new Error('Format tidak didukung. Gunakan .pptx, .pdf, atau .txt');
}

/* ---------------- Router ---------------- */
let session = null;
function route() {
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  const nav = parts[0] === 'latihan' || parts[0] === 'sesi' ? 'latihan' : parts[0] === 'backup' ? 'backup' : 'home';
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
  closeModal();
  window.scrollTo(0, 0);
  const app = $('#app');
  if (parts[0] === 'topik' && parts[1]) return renderTopic(app, parts[1], parts[2] || 'ringkasan');
  if (parts[0] === 'latihan') return renderPracticeSetup(app, parts[1]);
  if (parts[0] === 'sesi') return session ? renderSession(app) : (location.hash = '#/latihan');
  if (parts[0] === 'backup') return renderBackup(app);
  renderHome(app);
}
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', e => { if (session && !session.done) { e.preventDefault(); e.returnValue = ''; } });

/* ---------------- Beranda ---------------- */
function streakDays() {
  const days = new Set(db.sessions.map(s => new Date(s.d).toDateString()));
  let n = 0; const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  while (days.has(d.toDateString())) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function renderHome(app) {
  const totalItems = db.topics.reduce((a, t) => a + itemsForTopic(t.id).length, 0);
  const allStats = Object.values(db.stats);
  const answered = allStats.reduce((a, s) => a + s.c + s.w, 0);
  const correct = allStats.reduce((a, s) => a + s.c, 0);
  const wrongCount = allStats.filter(s => s.lr === 0).length;
  const today = new Date().toDateString();
  const todayN = db.sessions.filter(s => new Date(s.d).toDateString() === today).reduce((a, s) => a + s.n, 0);

  const groups = courses().map(c => {
    const ts = db.topics.filter(t => (t.course || 'Umum') === c);
    return `<h2 style="margin-top:20px">${esc(c)}</h2>
      <div class="grid grid-cards">${ts.map(topicCard).join('')}</div>`;
  }).join('');

  app.innerHTML = `
    <div class="panel">
      <h1>Halo! Siap belajar? 👋</h1>
      <div class="steps" style="margin-top:12px">
        <div class="step"><span class="n">1</span><div><b>Upload PPT dosen</b><div class="muted small">.pptx atau .pdf — teks tiap slide otomatis diambil.</div></div></div>
        <div class="step"><span class="n">2</span><div><b>Tulis ringkasan</b><div class="muted small"><code>**istilah**</code> jadi soal isian, <code>Istilah :: arti</code> jadi flashcard.</div></div></div>
        <div class="step"><span class="n">3</span><div><b>Latihan sebanyak-banyaknya</b><div class="muted small">Tambah/impor soal, lalu latihan. Yang sering salah muncul lebih sering.</div></div></div>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="v">${db.topics.length}</div><div class="l">Materi</div></div>
      <div class="stat"><div class="v">${totalItems}</div><div class="l">Soal tersedia</div></div>
      <div class="stat"><div class="v">${todayN}</div><div class="l">Dijawab hari ini</div></div>
      <div class="stat"><div class="v">${answered ? pct(correct, answered) + '%' : '–'}</div><div class="l">Akurasi (${answered} jawaban)</div></div>
      <div class="stat"><div class="v">🔥 ${streakDays()}</div><div class="l">Hari berturut-turut</div></div>
    </div>
    ${wrongCount ? `<div class="panel row"><div>Ada <b>${wrongCount}</b> soal yang terakhir kamu jawab salah.</div><span class="spacer"></span>
      <button class="btn primary" id="practice-wrong">Latih soal yang salah</button></div>` : ''}
    <div class="panel">
      <h2>+ Materi baru</h2>
      <form id="new-topic" class="row">
        <input type="text" name="course" list="course-list" placeholder="Mata kuliah (mis. Biokimia)" style="flex:1;min-width:180px">
        <input type="text" name="title" placeholder="Judul materi / pertemuan (mis. Pertemuan 3 - Enzim)" required style="flex:2;min-width:220px">
        <datalist id="course-list">${courses().map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        <button class="btn primary">Buat</button>
      </form>
    </div>
    ${db.topics.length ? groups : '<div class="empty">Belum ada materi. Buat materi pertama di atas, lalu upload PPT dosenmu.</div>'}
  `;
  $('#new-topic').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const t = { id: uid(), course: String(f.get('course')).trim() || 'Umum', title: String(f.get('title')).trim(), slides: [], summary: '', created: Date.now(), updated: Date.now() };
    db.topics.push(t); save();
    location.hash = '#/topik/' + t.id;
  });
  $('#practice-wrong')?.addEventListener('click', () => {
    startSession({ topicIds: db.topics.map(t => t.id), src: { bank: true, cloze: true, card: true }, count: 50, order: 'wrong', shuffleOpts: true });
  });
}
function topicCard(t) {
  const n = itemsForTopic(t.id).length;
  const acc = topicAccuracy(t.id);
  const p = pct(acc.c, acc.n);
  return `<div class="panel topic-card">
    <h3><a href="#/topik/${t.id}">${esc(t.title)}</a></h3>
    <div class="muted small">${t.slides.length} slide · ${t.summary ? t.summary.split(/\s+/).filter(Boolean).length + ' kata ringkasan' : 'belum ada ringkasan'} · ${n} soal</div>
    <div class="bar" title="Akurasi ${p}%"><span style="width:${acc.n ? p : 0}%"></span></div>
    <div class="small muted">${acc.n ? `Akurasi ${p}% dari ${acc.n} jawaban` : 'Belum pernah latihan'}</div>
    <div class="row">
      <a class="btn sm" href="#/topik/${t.id}">Buka</a>
      <a class="btn sm primary" href="#/latihan/${t.id}">Latihan</a>
    </div>
  </div>`;
}

/* ---------------- Halaman materi ---------------- */
function renderTopic(app, id, tab) {
  const t = topicById(id);
  if (!t) { app.innerHTML = '<div class="empty">Materi tidak ditemukan. <a href="#/">Kembali</a></div>'; return; }
  const nBank = db.questions.filter(q => q.topicId === id).length;
  const nGen = generateFromSummary(t).length;
  app.innerHTML = `
    <div class="row" style="margin-bottom:8px">
      <a href="#/" class="small">← Beranda</a>
    </div>
    <div class="row" style="margin-bottom:12px">
      <input type="text" id="t-course" value="${esc(t.course)}" style="max-width:220px" list="course-list2" title="Mata kuliah">
      <datalist id="course-list2">${courses().map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <input type="text" id="t-title" value="${esc(t.title)}" style="flex:1;min-width:200px;font-weight:700;font-size:1.1rem" title="Judul materi">
      <a class="btn primary" href="#/latihan/${t.id}">▶ Latihan</a>
      <button class="btn danger" id="t-del">Hapus</button>
    </div>
    <div class="tabs">
      <a href="#/topik/${id}/ringkasan" class="${tab === 'ringkasan' ? 'active' : ''}">📝 Slide & Ringkasan</a>
      <a href="#/topik/${id}/soal" class="${tab === 'soal' ? 'active' : ''}">❓ Bank Soal (${nBank + nGen})</a>
    </div>
    <div id="tab-body"></div>`;
  const saveMeta = debounce(() => {
    t.title = $('#t-title').value.trim() || 'Tanpa judul';
    t.course = $('#t-course').value.trim() || 'Umum';
    t.updated = Date.now(); save();
  }, 400);
  $('#t-title').addEventListener('input', saveMeta);
  $('#t-course').addEventListener('input', saveMeta);
  $('#t-del').addEventListener('click', () => {
    if (!confirm(`Hapus materi "${t.title}" beserta ringkasan dan soalnya?`)) return;
    db.topics = db.topics.filter(x => x.id !== id);
    db.questions = db.questions.filter(q => q.topicId !== id);
    save(); location.hash = '#/';
  });
  if (tab === 'soal') renderQuestionsTab($('#tab-body'), t);
  else renderSummaryTab($('#tab-body'), t);
}

function renderSummaryTab(el, t) {
  el.innerHTML = `
    <div class="grid grid-2">
      <div class="panel">
        <div class="row"><h2 style="margin:0">Slide dosen</h2><span class="spacer"></span>
          ${t.slides.length ? '<button class="btn sm danger" id="clear-slides">Hapus semua slide</button>' : ''}</div>
        <label class="dropzone" id="drop" style="display:block;margin-top:10px">
          <input type="file" id="file" accept=".pptx,.pdf,.txt,.md" hidden>
          <b>Klik atau seret file PPT ke sini</b><br><span class="small">.pptx, .pdf, .txt — teks tiap slide diambil otomatis</span>
        </label>
        <div id="file-status" class="small muted"></div>
        ${t.slides.length ? `<div class="row small" style="margin:6px 0"><span class="muted">${t.slides.length} slide</span><span class="spacer"></span>
          <button class="btn sm" id="copy-all">Tempel semua ke ringkasan</button></div>` : ''}
        <div class="slides">
          ${t.slides.map((s, i) => `<div class="slide">
            <div class="slide-head"><b class="small">Slide ${i + 1}</b>
              <button class="btn sm" data-add="${i}" title="Tambahkan teks slide ini ke ringkasan">+ ke ringkasan</button></div>
            <pre>${esc(s) || '<span class="muted">(tidak ada teks — mungkin berisi gambar)</span>'}</pre></div>`).join('')}
        </div>
      </div>
      <div class="panel">
        <div class="row"><h2 style="margin:0">Ringkasanku</h2><span class="spacer"></span>
          <span class="small muted" id="save-status"></span>
          <button class="btn sm" id="toggle-view">👁 Pratinjau</button></div>
        <div class="toolbar" style="margin-top:10px">
          <button class="btn sm" data-wrap="**" title="Tandai sebagai kata kunci → jadi soal isian"><b>B</b> Kata kunci</button>
          <button class="btn sm" data-wrap="==" title="Stabilo"><mark>Stabilo</mark></button>
          <button class="btn sm" data-line="## ">Judul</button>
          <button class="btn sm" data-line="- ">• Poin</button>
          <button class="btn sm" data-insert="Istilah :: definisi" title="Jadi flashcard">Istilah :: arti</button>
        </div>
        <textarea id="summary" class="editor" placeholder="Tulis ringkasan dengan kata-katamu sendiri...

## Contoh judul
- **Enzim** adalah protein yang mempercepat reaksi kimia.
- Bagian enzim tempat substrat menempel disebut **sisi aktif**.
- Kofaktor :: zat non-protein yang dibutuhkan enzim agar aktif">${esc(t.summary)}</textarea>
        <div id="preview" class="preview md hidden"></div>
        <div class="hint" style="margin-top:8px">
          💡 Tebalkan <code>**istilah penting**</code> → otomatis jadi soal isian. Tulis <code>Istilah :: definisi</code> → otomatis jadi flashcard (dua arah).
          <br><b id="gen-count">${generateFromSummary(t).length}</b> soal otomatis dari ringkasan ini.
        </div>
      </div>
    </div>`;

  const ta = $('#summary');
  const persist = debounce(() => {
    t.summary = ta.value; t.updated = Date.now();
    if (save()) $('#save-status').textContent = 'Tersimpan ✓';
    $('#gen-count').textContent = generateFromSummary(t).length;
  }, 500);
  ta.addEventListener('input', () => { $('#save-status').textContent = 'Menyimpan…'; persist(); });

  function insertAtCursor(text) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.setRangeText(text, s, e, 'end'); ta.focus(); ta.dispatchEvent(new Event('input'));
  }
  function appendBlock(text) {
    ta.value = ta.value.replace(/\s*$/, '') + (ta.value.trim() ? '\n\n' : '') + text + '\n';
    ta.scrollTop = ta.scrollHeight; ta.dispatchEvent(new Event('input'));
  }
  const slideToMd = (s, i) => `## Slide ${i + 1}\n` + s.split('\n').filter(Boolean).map(l => '- ' + l).join('\n');

  $$('[data-wrap]', el).forEach(b => b.addEventListener('click', () => {
    const w = b.dataset.wrap, s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || 'teks';
    ta.setRangeText(w + sel + w, s, e, 'select'); ta.focus(); ta.dispatchEvent(new Event('input'));
  }));
  $$('[data-line]', el).forEach(b => b.addEventListener('click', () => {
    const s = ta.selectionStart, lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
    ta.setRangeText(b.dataset.line, lineStart, lineStart, 'end'); ta.focus(); ta.dispatchEvent(new Event('input'));
  }));
  $$('[data-insert]', el).forEach(b => b.addEventListener('click', () => insertAtCursor(b.dataset.insert)));
  $$('[data-add]', el).forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.add; appendBlock(slideToMd(t.slides[i], i)); toast('Slide ' + (i + 1) + ' ditambahkan — sekarang ringkas dengan kata-katamu!');
  }));
  $('#copy-all')?.addEventListener('click', () => {
    if (t.summary.trim() && !confirm('Tempel teks semua slide di akhir ringkasan?')) return;
    appendBlock(t.slides.map(slideToMd).join('\n\n'));
  });
  $('#toggle-view').addEventListener('click', () => {
    const pv = $('#preview'), showing = !pv.classList.contains('hidden');
    if (!showing) pv.innerHTML = renderMd(ta.value);
    pv.classList.toggle('hidden', showing); ta.classList.toggle('hidden', !showing);
    $('#toggle-view').textContent = showing ? '👁 Pratinjau' : '✏️ Edit';
  });
  $('#clear-slides')?.addEventListener('click', () => {
    if (!confirm('Hapus semua teks slide? (Ringkasan tidak ikut terhapus)')) return;
    t.slides = []; save(); renderSummaryTab(el, t);
  });

  async function handleFile(file) {
    if (!file) return;
    $('#file-status').textContent = 'Membaca ' + file.name + '…';
    try {
      const slides = await extractFile(file);
      const replace = !t.slides.length || confirm(`Ditemukan ${slides.length} slide. Ganti slide yang ada?\n(OK = ganti, Batal = tambahkan di akhir)`);
      t.slides = replace ? slides : t.slides.concat(slides);
      t.updated = Date.now();
      save(); renderSummaryTab(el, t);
      toast(`${slides.length} slide berhasil dibaca ✓`);
    } catch (err) {
      console.error(err);
      $('#file-status').textContent = '⚠️ ' + (err.message || 'Gagal membaca file');
    }
  }
  $('#file').addEventListener('change', e => handleFile(e.target.files[0]));
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));
}

function statBadge(id) {
  const s = db.stats[id];
  if (!s) return '<span class="badge">baru</span>';
  return `<span class="badge ${s.lr ? 'ok' : 'bad'}">✓${s.c} ✗${s.w}</span>`;
}

function renderQuestionsTab(el, t) {
  const bank = db.questions.filter(q => q.topicId === t.id);
  const gen = generateFromSummary(t);
  el.innerHTML = `
    <div class="panel">
      <div class="row">
        <button class="btn primary" id="add-q">+ Tambah soal</button>
        <button class="btn" id="import-q">📋 Impor dari teks</button>
        <button class="btn" id="ai-q">🤖 Buat soal pakai AI</button>
        <span class="spacer"></span>
        <a class="btn" href="#/latihan/${t.id}">▶ Latihan</a>
      </div>
      <p class="small muted" style="margin:10px 0 0">Tips: makin banyak soal makin bagus. Ketik soal dari buku/soal tahun lalu, atau minta AI (ChatGPT/Claude/Gemini) membuatkan soal dari ringkasanmu lalu tempel hasilnya lewat <b>Impor dari teks</b>.</p>
    </div>
    <div class="panel">
      <h2>Bank soal (${bank.length})</h2>
      ${bank.length ? bank.map((q, i) => `<div class="qitem">
        <div class="row small"><b>${i + 1}.</b><span class="badge">${q.type === 'mc' ? 'Pilihan ganda' : 'Isian'}</span>${statBadge(q.id)}
          <span class="spacer"></span><button class="btn sm" data-edit="${q.id}">Edit</button><button class="btn sm danger" data-del="${q.id}">Hapus</button></div>
        <div class="q">${esc(q.question)}</div>
        ${q.type === 'mc' ? `<ol type="A">${q.options.map((o, j) => `<li class="${j === q.answerIndex ? 'correct' : ''}">${esc(o)}</li>`).join('')}</ol>`
          : `<div class="small">Jawaban: <b>${esc(q.answer)}</b></div>`}
        ${q.explanation ? `<div class="small muted">💬 ${esc(q.explanation)}</div>` : ''}
      </div>`).join('') : '<div class="empty">Belum ada soal. Tambah manual, impor, atau buat pakai AI.</div>'}
    </div>
    <div class="panel">
      <h2>Soal otomatis dari ringkasan (${gen.length})</h2>
      <p class="small muted">Dibuat dari <code>**kata kunci**</code> dan <code>Istilah :: definisi</code> di ringkasan. Edit ringkasannya untuk mengubah soal ini.</p>
      ${gen.length ? gen.map(g => `<div class="qitem small">
        <div class="row"><span class="badge">${esc(g.source)}</span>${statBadge(g.id)}</div>
        <div class="q">${g.type === 'cloze' ? blankHtml(g.prompt) : esc(g.prompt)}</div>
        <div>→ <b>${esc(g.answerText)}</b></div></div>`).join('')
        : `<div class="empty">Belum ada. <a href="#/topik/${t.id}/ringkasan">Tebalkan istilah penting di ringkasan</a>.</div>`}
    </div>`;

  $('#add-q').addEventListener('click', () => questionForm(t));
  $('#import-q').addEventListener('click', () => importForm(t));
  $('#ai-q').addEventListener('click', () => aiPromptForm(t));
  $$('[data-edit]', el).forEach(b => b.addEventListener('click', () => questionForm(t, db.questions.find(q => q.id === b.dataset.edit))));
  $$('[data-del]', el).forEach(b => b.addEventListener('click', () => {
    if (!confirm('Hapus soal ini?')) return;
    db.questions = db.questions.filter(q => q.id !== b.dataset.del);
    delete db.stats[b.dataset.del];
    save(); route();
  }));
}

function questionForm(t, q) {
  const editing = !!q;
  q = q || { type: 'mc', question: '', options: ['', '', '', ''], answerIndex: 0, answer: '', explanation: '' };
  const isTF = q.type === 'mc' && q.options.length === 2 && q.options[0] === 'Benar' && q.options[1] === 'Salah';
  openModal(`
    <h2>${editing ? 'Edit soal' : 'Tambah soal'}</h2>
    <form id="qf" class="stack">
      <div class="field"><label>Jenis</label>
        <select name="type">
          <option value="mc" ${q.type === 'mc' && !isTF ? 'selected' : ''}>Pilihan ganda</option>
          <option value="tf" ${isTF ? 'selected' : ''}>Benar / Salah</option>
          <option value="short" ${q.type === 'short' ? 'selected' : ''}>Isian singkat</option>
        </select></div>
      <div class="field"><label>Pertanyaan</label><textarea name="question" required style="min-height:90px">${esc(q.question)}</textarea></div>
      <div class="field" id="f-opts"><label>Pilihan (satu per baris)</label>
        <textarea name="options" style="min-height:110px">${esc(q.type === 'mc' && !isTF ? q.options.join('\n') : '')}</textarea></div>
      <div class="field" id="f-idx"><label>Jawaban benar</label><select name="answerIndex"></select></div>
      <div class="field" id="f-ans"><label>Jawaban</label><input type="text" name="answer" value="${esc(q.answer)}">
        <span class="small muted">Beberapa jawaban yang diterima pisahkan dengan <code>|</code>, mis. <code>mitokondria | mitochondria</code></span></div>
      <div class="field"><label>Penjelasan (opsional)</label><textarea name="explanation" style="min-height:60px">${esc(q.explanation)}</textarea></div>
      <div class="row"><button class="btn primary">Simpan</button>${editing ? '' : '<label class="check small"><input type="checkbox" name="again" checked> Tambah soal lagi setelah simpan</label>'}</div>
    </form>`, body => {
    const f = $('#qf', body);
    const refresh = () => {
      const type = f.type.value;
      $('#f-opts', body).classList.toggle('hidden', type !== 'mc');
      $('#f-idx', body).classList.toggle('hidden', type === 'short');
      $('#f-ans', body).classList.toggle('hidden', type !== 'short');
      const opts = type === 'tf' ? ['Benar', 'Salah'] : f.options.value.split('\n').map(s => s.trim()).filter(Boolean);
      const cur = f.answerIndex.value === '' ? q.answerIndex : +f.answerIndex.value;
      f.answerIndex.innerHTML = opts.map((o, i) => `<option value="${i}" ${i === cur ? 'selected' : ''}>${LETTERS[i]}. ${esc(o.slice(0, 60))}</option>`).join('');
    };
    f.type.addEventListener('change', refresh);
    f.options.addEventListener('input', refresh);
    refresh();
    f.question.focus();
    f.addEventListener('submit', e => {
      e.preventDefault();
      const type = f.type.value;
      const data = { question: f.question.value.trim(), explanation: f.explanation.value.trim() };
      if (type === 'short') {
        if (!f.answer.value.trim()) return toast('Isi jawabannya dulu', true);
        Object.assign(data, { type: 'short', options: [], answerIndex: -1, answer: f.answer.value.trim() });
      } else {
        const opts = type === 'tf' ? ['Benar', 'Salah'] : f.options.value.split('\n').map(s => s.trim()).filter(Boolean);
        if (opts.length < 2) return toast('Minimal 2 pilihan', true);
        Object.assign(data, { type: 'mc', options: opts, answerIndex: Math.min(+f.answerIndex.value || 0, opts.length - 1), answer: '' });
      }
      if (editing) Object.assign(q, data);
      else db.questions.push({ id: uid(), topicId: t.id, created: Date.now(), ...data });
      save();
      const again = !editing && f.again?.checked;
      route();
      toast('Soal tersimpan ✓');
      if (again) questionForm(t);
    });
  });
}

const FORMAT_EXAMPLE = `1. Organel tempat respirasi sel adalah...
A. Ribosom
B. Mitokondria
C. Lisosom
D. Badan Golgi
Jawaban: B
Penjelasan: Mitokondria menghasilkan ATP melalui respirasi sel.

2. Enzim yang memecah amilum disebut...
Jawaban: amilase
Penjelasan: Amilase menghidrolisis amilum menjadi maltosa.`;

function importForm(t) {
  openModal(`
    <h2>Impor soal dari teks</h2>
    <p class="small muted">Tempel soal (dari AI, catatan, atau soal tahun lalu) dengan format seperti contoh. Soal tanpa pilihan jadi soal isian.</p>
    <details class="small" style="margin-bottom:8px"><summary>Lihat contoh format</summary><pre class="hint" style="white-space:pre-wrap">${esc(FORMAT_EXAMPLE)}</pre></details>
    <textarea id="imp-text" style="min-height:260px" placeholder="${esc(FORMAT_EXAMPLE)}"></textarea>
    <div class="row" style="margin-top:10px"><span id="imp-info" class="small muted"></span><span class="spacer"></span>
      <button class="btn primary" id="imp-go" disabled>Impor</button></div>`, body => {
    const ta = $('#imp-text', body);
    let parsed = { questions: [], failed: [] };
    ta.addEventListener('input', debounce(() => {
      parsed = parseQuestions(ta.value);
      $('#imp-info', body).innerHTML = `Terbaca <b>${parsed.questions.length}</b> soal` +
        (parsed.failed.length ? ` · <span style="color:var(--bad)">${parsed.failed.length} gagal (jawaban tidak ditemukan)</span>` : '');
      $('#imp-go', body).disabled = !parsed.questions.length;
    }, 250));
    ta.focus();
    $('#imp-go', body).addEventListener('click', () => {
      parsed.questions.forEach(q => db.questions.push({ id: uid(), topicId: t.id, created: Date.now(), ...q }));
      save();
      const n = parsed.questions.length;
      if (location.hash.endsWith('/soal')) route(); else location.hash = '#/topik/' + t.id + '/soal';
      toast(n + ' soal berhasil diimpor ✓');
    });
  });
}

function aiPromptForm(t) {
  openModal(`
    <h2>Buat soal pakai AI</h2>
    <ol class="small" style="padding-left:18px">
      <li>Atur pilihan di bawah lalu klik <b>Salin prompt</b>.</li>
      <li>Tempel di ChatGPT / Claude / Gemini dan kirim.</li>
      <li>Salin jawaban AI, lalu klik <b>Tempel hasil AI</b> di sini.</li>
    </ol>
    <div class="row">
      <div class="field" style="width:120px"><label>Jumlah soal</label><input type="number" id="ai-n" value="30" min="5" max="200"></div>
      <div class="field" style="flex:1;min-width:180px"><label>Jenis</label>
        <select id="ai-type"><option value="mix">Campuran (pilihan ganda + isian)</option><option value="mc">Pilihan ganda saja</option><option value="short">Isian singkat saja</option></select></div>
      <div class="field" style="flex:1;min-width:160px"><label>Tingkat</label>
        <select id="ai-lvl"><option value="campuran">Campuran mudah–sulit</option><option value="sulit">Sulit (setara UTS/UAS)</option><option value="mudah">Mudah (hafalan dasar)</option></select></div>
    </div>
    <label class="check small" style="margin:8px 0"><input type="checkbox" id="ai-slides" ${t.summary.trim() ? '' : 'checked'}> Sertakan teks slide dosen (lebih lengkap, tapi lebih panjang)</label>
    <textarea id="ai-prompt" readonly style="min-height:200px;font-size:.85rem"></textarea>
    <div class="row" style="margin-top:10px">
      <button class="btn primary" id="ai-copy">📋 Salin prompt</button>
      <button class="btn" id="ai-paste">Tempel hasil AI →</button>
    </div>`, body => {
    const build = () => {
      const n = +$('#ai-n', body).value || 30;
      const type = $('#ai-type', body).value;
      const jenis = type === 'mc' ? 'pilihan ganda (4 opsi A–D)' : type === 'short' ? 'isian singkat (jawaban 1–4 kata)' : 'campuran: sekitar 70% pilihan ganda (4 opsi A–D) dan 30% isian singkat (jawaban 1–4 kata)';
      let material = '';
      if (t.summary.trim()) material += `=== RINGKASAN MATERI ===\n${t.summary.trim()}\n\n`;
      if ($('#ai-slides', body).checked && t.slides.length) material += `=== ISI SLIDE DOSEN ===\n${t.slides.map((s, i) => `[Slide ${i + 1}]\n${s}`).join('\n\n')}\n`;
      if (!material) material = '(Belum ada ringkasan/slide — tempel materi di sini)';
      $('#ai-prompt', body).value =
`Kamu adalah dosen yang menyusun soal latihan ujian untuk mata kuliah "${t.course}", materi "${t.title}".
Buat ${n} soal ${jenis} berdasarkan materi di bawah. Tingkat kesulitan: ${$('#ai-lvl', body).value}.
Variasikan jenis kemampuan: ingatan, pemahaman, penerapan/kasus, dan analisis. Jangan ada soal yang sama.
Pengecoh pilihan ganda harus masuk akal. Sertakan penjelasan singkat untuk tiap soal.

Tulis HANYA soal dengan format PERSIS seperti ini (tanpa teks pembuka/penutup, tanpa markdown/tebal, satu baris kosong antar soal):

${FORMAT_EXAMPLE}

${material}`;
    };
    $$('input,select', body).forEach(x => x.addEventListener('input', build));
    build();
    $('#ai-copy', body).addEventListener('click', async () => {
      const ta = $('#ai-prompt', body);
      try { await navigator.clipboard.writeText(ta.value); }
      catch { ta.select(); document.execCommand('copy'); }
      toast('Prompt disalin! Tempel di ChatGPT/Claude/Gemini.');
    });
    $('#ai-paste', body).addEventListener('click', () => importForm(t));
  });
}

/* ---------------- Latihan: pengaturan ---------------- */
const lastSetup = (() => { try { return JSON.parse(localStorage.getItem(KEY + '_setup')) || {}; } catch { return {}; } })();

function renderPracticeSetup(app, preTopic) {
  if (!db.topics.length) { app.innerHTML = '<div class="empty">Belum ada materi. <a href="#/">Buat materi dulu</a>.</div>'; return; }
  const selected = new Set(preTopic ? [preTopic] : (lastSetup.topicIds || []).filter(topicById));
  if (!selected.size) db.topics.forEach(t => selected.add(t.id));
  const src = lastSetup.src || { bank: true, cloze: true, card: true };
  app.innerHTML = `
    <div class="quiz" id="setup">
      <h1>Latihan soal</h1>
      <div class="panel">
        <div class="row"><h2 style="margin:0">Materi</h2><span class="spacer"></span>
          <button class="btn sm" id="sel-all">Pilih semua</button><button class="btn sm" id="sel-none">Kosongkan</button></div>
        ${courses().map(c => `<div style="margin-top:10px"><div class="small muted"><b>${esc(c)}</b></div>
          ${db.topics.filter(t => (t.course || 'Umum') === c).map(t => `<label class="check"><input type="checkbox" name="topic" value="${t.id}" ${selected.has(t.id) ? 'checked' : ''}>
            ${esc(t.title)} <span class="small muted">(${itemsForTopic(t.id).length} soal)</span></label>`).join('')}</div>`).join('')}
      </div>
      <div class="panel">
        <h2>Sumber soal</h2>
        <label class="check"><input type="checkbox" name="src" value="bank" ${src.bank ? 'checked' : ''}> Bank soal (pilihan ganda & isian)</label>
        <label class="check"><input type="checkbox" name="src" value="cloze" ${src.cloze ? 'checked' : ''}> Isian otomatis dari <b>kata kunci</b> ringkasan</label>
        <label class="check"><input type="checkbox" name="src" value="card" ${src.card ? 'checked' : ''}> Flashcard (Istilah :: definisi)</label>
      </div>
      <div class="panel grid grid-2">
        <div class="field"><label>Jumlah soal</label>
          <select id="count">${[10, 20, 30, 50, 100, 0].map(n => `<option value="${n}" ${(lastSetup.count ?? 20) === n ? 'selected' : ''}>${n || 'Semua'}</option>`).join('')}</select></div>
        <div class="field"><label>Urutan</label>
          <select id="order">
            <option value="smart" ${lastSetup.order !== 'random' && lastSetup.order !== 'wrong' ? 'selected' : ''}>Pintar — utamakan yang sering salah & belum pernah</option>
            <option value="random" ${lastSetup.order === 'random' ? 'selected' : ''}>Acak</option>
            <option value="wrong" ${lastSetup.order === 'wrong' ? 'selected' : ''}>Hanya yang pernah salah</option>
          </select></div>
        <label class="check"><input type="checkbox" id="shuf" ${lastSetup.shuffleOpts !== false ? 'checked' : ''}> Acak urutan pilihan jawaban</label>
      </div>
      <div class="row"><span id="avail" class="muted"></span><span class="spacer"></span><button class="btn primary lg" id="start">▶ Mulai</button></div>
    </div>`;

  const read = () => ({
    topicIds: $$('[name=topic]:checked').map(x => x.value),
    src: Object.fromEntries(['bank', 'cloze', 'card'].map(k => [k, !!$(`[name=src][value=${k}]:checked`)])),
    count: +$('#count').value, order: $('#order').value, shuffleOpts: $('#shuf').checked,
  });
  const update = () => {
    const cfg = read();
    const n = buildPool(cfg).length;
    $('#avail').textContent = n + ' soal tersedia';
    $('#start').disabled = !n;
  };
  $('#setup').addEventListener('change', update);
  $('#sel-all').addEventListener('click', () => { $$('[name=topic]').forEach(x => (x.checked = true)); update(); });
  $('#sel-none').addEventListener('click', () => { $$('[name=topic]').forEach(x => (x.checked = false)); update(); });
  $('#start').addEventListener('click', () => startSession(read()));
  update();
}

function buildPool(cfg) {
  let pool = cfg.topicIds.flatMap(id => itemsForTopic(id, cfg.src));
  if (cfg.order === 'wrong') pool = pool.filter(it => db.stats[it.id]?.w > 0);
  return pool;
}

function startSession(cfg) {
  try { localStorage.setItem(KEY + '_setup', JSON.stringify(cfg)); Object.assign(lastSetup, cfg); } catch { /* abaikan */ }
  let pool = buildPool(cfg);
  if (!pool.length) return toast('Tidak ada soal yang cocok dengan pilihanmu.', true);
  const now = Date.now();
  if (cfg.order === 'random') shuffle(pool);
  else {
    const prio = it => {
      const s = db.stats[it.id];
      if (!s) return 5 + Math.random() * 2;                        // belum pernah
      const days = Math.min((now - s.t) / 864e5, 10);
      return s.w * 2.5 - s.c * 1.2 + (s.lr === 0 ? 4 : 0) + days * 0.4 + Math.random() * 2;
    };
    pool = pool.map(it => [prio(it), it]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  }
  if (cfg.count) pool = pool.slice(0, cfg.count);
  if (cfg.order !== 'random') shuffle(pool);
  const items = pool.map(it => {
    const x = { ...it };
    if (x.type === 'mc') {
      x.opts = x.options.map((text, i) => ({ text, correct: i === x.answerIndex }));
      const isTF = x.options.length === 2 && /^(benar|true)$/i.test(x.options[0]);
      if (cfg.shuffleOpts && !isTF) shuffle(x.opts);
    }
    return x;
  });
  session = { cfg, items, i: 0, answers: [], started: now, done: false };
  if (location.hash === '#/sesi') route(); else location.hash = '#/sesi';
}

/* ---------------- Latihan: sesi ---------------- */
function recordStat(id, correct, undo = false) {
  const s = db.stats[id] || (db.stats[id] = { c: 0, w: 0, t: 0, lr: 1 });
  const d = undo ? -1 : 1;
  if (correct) s.c = Math.max(0, s.c + d); else s.w = Math.max(0, s.w + d);
  s.t = Date.now();
  if (!undo) s.lr = correct ? 1 : 0;
}

function answer(correct, given) {
  const it = session.items[session.i];
  if (session.answers[session.i]) return;
  session.answers[session.i] = { correct, given };
  recordStat(it.id, correct);
  save();
  renderSession($('#app'));
}

function renderSession(app) {
  const S = session;
  if (S.done) return renderResults(app);
  const it = S.items[S.i];
  const ans = S.answers[S.i];
  const nCorrect = S.answers.filter(a => a?.correct).length;
  const topic = topicById(it.topicId);
  const typeLabel = { mc: 'Pilihan ganda', short: 'Isian', cloze: 'Isian (lengkapi)', card: 'Flashcard' }[it.type];

  let body = '';
  if (it.type === 'mc') {
    body = `<div class="opts">${it.opts.map((o, j) => {
      let cls = '';
      if (ans) { if (o.correct) cls = 'correct'; else if (ans.given === j) cls = 'wrong'; }
      return `<button class="opt ${cls}" data-opt="${j}" ${ans ? 'disabled' : ''}><span class="k">${LETTERS[j]}</span><span>${esc(o.text)}</span></button>`;
    }).join('')}</div>`;
  } else if (it.type === 'card') {
    body = ans || S.revealed
      ? `<div class="flashcard"><div><div class="small muted">Jawaban</div><b>${esc(it.answerText)}</b></div></div>
         ${ans ? '' : `<div class="row" style="margin-top:12px;justify-content:center">
           <button class="btn lg" id="card-no">✗ Belum hafal <kbd>1</kbd></button>
           <button class="btn lg primary" id="card-yes">✓ Saya tahu <kbd>2</kbd></button></div>`}`
      : `<div class="row" style="justify-content:center"><button class="btn lg primary" id="reveal">Tampilkan jawaban <kbd>Spasi</kbd></button></div>`;
  } else {
    body = `<form id="short-form" class="row">
        <input type="text" id="short-in" autocomplete="off" placeholder="Ketik jawabanmu…" value="${esc(ans?.given || '')}" ${ans ? 'disabled' : ''} style="flex:1">
        ${ans ? '' : '<button class="btn primary">Cek</button><button type="button" class="btn" id="dunno">Tidak tahu</button>'}
      </form>`;
  }

  let feedback = '';
  if (ans) {
    const correctText = it.type === 'mc' ? it.opts.find(o => o.correct)?.text : it.answerText;
    feedback = `<div class="feedback ${ans.correct ? 'ok' : 'bad'}"><b>${ans.correct ? '✓ Benar!' : '✗ Kurang tepat.'}</b>` +
      (!ans.correct || it.type !== 'mc' ? `<div>Jawaban: <b>${esc(correctText)}</b></div>` : '') +
      (it.explanation ? `<div style="margin-top:8px;white-space:pre-wrap">💬 ${esc(it.explanation)}</div>` : '') +
      ((it.type === 'short' || it.type === 'cloze') && !ans.correct && ans.given ? `<div style="margin-top:8px"><button class="btn sm" id="override">Sebenarnya jawabanku benar</button></div>` : '') +
      `</div>
    <div class="row" style="margin-top:14px"><span class="spacer"></span>
      <button class="btn primary lg" id="next">${S.i + 1 < S.items.length ? 'Lanjut →' : 'Lihat hasil'} <kbd>Enter</kbd></button></div>`;
  }

  app.innerHTML = `
    <div class="quiz">
      <div class="row small">
        <b>Soal ${S.i + 1} / ${S.items.length}</b>
        <span class="muted">· ✓ ${nCorrect} benar</span>
        <span class="spacer"></span>
        <button class="btn sm" id="quit">Akhiri</button>
      </div>
      <div class="progress"><span style="width:${100 * S.i / S.items.length}%"></span></div>
      <div class="panel">
        <div class="row small"><span class="badge">${typeLabel}</span>
          <span class="muted">${esc(topic?.title || '')}${it.context ? ' › ' + esc(it.context) : ''}</span></div>
        <div class="qtext">${it.type === 'cloze' ? blankHtml(it.prompt) : esc(it.prompt)}</div>
        ${body}
        ${feedback}
      </div>
      <p class="small muted" style="text-align:center">Pintasan: <kbd>A</kbd>–<kbd>E</kbd> / <kbd>1</kbd>–<kbd>5</kbd> pilih jawaban · <kbd>Enter</kbd> lanjut</p>
    </div>`;

  $$('[data-opt]').forEach(b => b.addEventListener('click', () => {
    const j = +b.dataset.opt; answer(it.opts[j].correct, j);
  }));
  $('#reveal')?.addEventListener('click', () => { S.revealed = true; renderSession(app); });
  $('#card-yes')?.addEventListener('click', () => answer(true, 'tahu'));
  $('#card-no')?.addEventListener('click', () => answer(false, ''));
  const sf = $('#short-form');
  if (sf && !ans) {
    $('#short-in').focus();
    sf.addEventListener('submit', e => { e.preventDefault(); const v = $('#short-in').value; if (!v.trim()) return; answer(checkText(v, it.answerText), v); });
    $('#dunno').addEventListener('click', () => answer(false, ''));
  }
  $('#override')?.addEventListener('click', () => {
    recordStat(it.id, false, true); recordStat(it.id, true);
    ans.correct = true; save(); renderSession(app);
  });
  $('#next')?.addEventListener('click', next);
  $('#quit').addEventListener('click', () => {
    if (!S.answers.filter(Boolean).length) { session = null; location.hash = '#/latihan'; return; }
    if (confirm('Akhiri latihan sekarang dan lihat hasil?')) finish();
  });
}

function next() {
  session.revealed = false;
  if (session.i + 1 < session.items.length) { session.i++; renderSession($('#app')); window.scrollTo(0, 0); }
  else finish();
}

function finish() {
  const S = session;
  S.done = true;
  const answered = S.answers.filter(Boolean);
  if (answered.length) {
    db.sessions.push({ d: Date.now(), n: answered.length, c: answered.filter(a => a.correct).length, topics: S.cfg.topicIds, secs: Math.round((Date.now() - S.started) / 1000) });
    if (db.sessions.length > 500) db.sessions = db.sessions.slice(-500);
    save();
  }
  renderResults($('#app'));
}

function renderResults(app) {
  const S = session;
  const answered = S.answers.map((a, i) => a && { a, it: S.items[i] }).filter(Boolean);
  const c = answered.filter(x => x.a.correct).length;
  const p = pct(c, answered.length);
  const wrong = answered.filter(x => !x.a.correct);
  const mins = Math.max(1, Math.round((Date.now() - S.started) / 60000));
  const msg = p >= 90 ? 'Luar biasa! 🎉' : p >= 75 ? 'Bagus, sedikit lagi sempurna! 💪' : p >= 50 ? 'Lumayan — ulangi yang salah ya.' : 'Tetap semangat! Baca lagi ringkasanmu lalu coba lagi. 📖';
  app.innerHTML = `
    <div class="quiz">
      <div class="panel" style="text-align:center">
        <div class="big-score">${p}%</div>
        <div><b>${c}</b> dari <b>${answered.length}</b> benar · ${mins} menit</div>
        <p>${msg}</p>
        <div class="row" style="justify-content:center">
          ${wrong.length ? '<button class="btn primary" id="redo-wrong">🔁 Ulangi yang salah (' + wrong.length + ')</button>' : ''}
          <button class="btn" id="again">Latihan lagi</button>
          <a class="btn" href="#/">Beranda</a>
        </div>
      </div>
      ${wrong.length ? `<div class="panel"><h2>Yang perlu dipelajari lagi</h2>
        ${wrong.map(({ a, it }) => {
          const correctText = it.type === 'mc' ? it.opts.find(o => o.correct)?.text : it.answerText;
          const givenText = it.type === 'mc' ? it.opts[a.given]?.text : a.given;
          return `<div class="qitem">
            <div class="small muted">${esc(topicById(it.topicId)?.title || '')}</div>
            <div class="q">${it.type === 'cloze' ? blankHtml(it.prompt) : esc(it.prompt)}</div>
            ${givenText ? `<div class="small" style="color:var(--bad)">Jawabanmu: ${esc(givenText)}</div>` : ''}
            <div class="small" style="color:var(--ok)">Benar: <b>${esc(correctText)}</b></div>
            ${it.explanation ? `<div class="small muted">💬 ${esc(it.explanation)}</div>` : ''}
          </div>`;
        }).join('')}</div>` : ''}
    </div>`;
  $('#redo-wrong')?.addEventListener('click', () => {
    const items = wrong.map(({ it }) => { const x = { ...it }; if (x.opts) x.opts = shuffle([...x.opts]); return x; });
    session = { cfg: S.cfg, items: shuffle(items), i: 0, answers: [], started: Date.now(), done: false };
    renderSession(app);
  });
  $('#again').addEventListener('click', () => startSession(S.cfg));
}

document.addEventListener('keydown', e => {
  if (location.hash !== '#/sesi' || !session || session.done) return;
  if (!$('#modal').classList.contains('hidden')) return;
  const it = session.items[session.i];
  const ans = session.answers[session.i];
  const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  if (e.key === 'Enter' && ans && !['BUTTON', 'A'].includes(e.target.tagName)) { e.preventDefault(); next(); return; }
  if (inInput || e.ctrlKey || e.metaKey || e.altKey) return;
  if (it.type === 'mc' && !ans) {
    let j = -1;
    if (/^[1-9]$/.test(e.key)) j = +e.key - 1;
    else if (/^[a-j]$/i.test(e.key)) j = e.key.toUpperCase().charCodeAt(0) - 65;
    if (j >= 0 && j < it.opts.length) answer(it.opts[j].correct, j);
  } else if (it.type === 'card' && !ans) {
    if (e.key === ' ' && !session.revealed) { e.preventDefault(); session.revealed = true; renderSession($('#app')); }
    else if (session.revealed && e.key === '1') answer(false, '');
    else if (session.revealed && e.key === '2') answer(true, 'tahu');
  }
});

/* ---------------- Backup ---------------- */
function renderBackup(app) {
  const size = new Blob([localStorage.getItem(KEY) || '']).size;
  app.innerHTML = `
    <div class="quiz">
      <h1>Backup & data</h1>
      <div class="panel">
        <p>Semua data (ringkasan, soal, statistik) tersimpan <b>di browser ini saja</b> (${(size / 1024).toFixed(0)} KB).
        Ekspor backup secara rutin, terutama sebelum menghapus riwayat browser atau pindah perangkat.</p>
        <div class="row">
          <button class="btn primary" id="exp">⬇ Ekspor backup (.json)</button>
          <label class="btn">⬆ Impor backup<input type="file" id="imp" accept=".json,application/json" hidden></label>
        </div>
      </div>
      <div class="panel">
        <h2>Riwayat latihan</h2>
        ${db.sessions.length ? db.sessions.slice(-15).reverse().map(s => `<div class="row small qitem">
          <span>${fmtDate(s.d)}</span><span class="spacer"></span><span>${s.c}/${s.n} benar</span><span class="badge ${pct(s.c, s.n) >= 70 ? 'ok' : 'bad'}">${pct(s.c, s.n)}%</span></div>`).join('')
          : '<div class="empty">Belum ada riwayat.</div>'}
      </div>
      <div class="panel">
        <h2>Zona bahaya</h2>
        <div class="row">
          <button class="btn danger" id="reset-stats">Reset statistik saja</button>
          <button class="btn danger" id="reset-all">Hapus semua data</button>
        </div>
      </div>
    </div>`;
  $('#exp').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'backup-belajar-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#imp').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.topics)) throw new Error('bukan file backup');
      const merge = db.topics.length && confirm('Gabungkan dengan data yang ada?\nOK = gabungkan, Batal = ganti semua data');
      if (merge) {
        const ids = new Set(db.topics.map(t => t.id)), qids = new Set(db.questions.map(q => q.id));
        db.topics.push(...data.topics.filter(t => !ids.has(t.id)));
        db.questions.push(...(data.questions || []).filter(q => !qids.has(q.id)));
        db.stats = { ...(data.stats || {}), ...db.stats };
        db.sessions = [...(data.sessions || []), ...db.sessions].sort((a, b) => a.d - b.d);
      } else db = { ...emptyDb(), ...data };
      save(); toast('Backup berhasil diimpor ✓'); location.hash = '#/';
    } catch (err) { toast('File backup tidak valid: ' + err.message, true); }
  });
  $('#reset-stats').addEventListener('click', () => {
    if (!confirm('Reset semua statistik benar/salah dan riwayat latihan?')) return;
    db.stats = {}; db.sessions = []; save(); route();
  });
  $('#reset-all').addEventListener('click', () => {
    if (!confirm('Hapus SEMUA materi, ringkasan, soal, dan statistik? Tidak bisa dibatalkan.')) return;
    if (prompt('Ketik HAPUS untuk konfirmasi') !== 'HAPUS') return;
    db = emptyDb(); save(); location.hash = '#/';
  });
}

route();
