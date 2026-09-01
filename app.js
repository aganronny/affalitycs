/* ============================================================
   AFFALITYCS - app.js
   Shopee Affiliate  Facebook Ads Analytics Dashboard
   v3.3 - Agustus 2026
   ============================================================ */

// --- STATE -----------------------------------------------------
const state = {
  shopeeRows: [],
  fbCampaigns: [],
  fbBreakdown: [],       // Breakdown FB Ads (age/gender/platform/region) kalau file breakdown diupload
  filteredFbBreakdown: [],
  fbAds: [],             // Export FB level Ad (Ad name) — buat tabel per-ad/adset
  filteredFbAds: [],
  clickReport: [],      // Website Click Report data
  filteredClicks: [],    // Filtered click report data
  mapping: {},
  filteredShopee: [],
  filteredFb: [],
  charts: {},
  sortDir: {},
  dateRatio: 1,
  history: [],           // snapshot riwayat analisis (dari IndexedDB)
  shopeeDupCount: 0,     // baris komisi identik yang dibuang saat upload
};

// --- HELPERS ---------------------------------------------------
// fmt, fmtK, fmtRoas, parseNum, parseSpent, esc, normalizeName, splitCSVLine
// dan semua parser ada di parsers.js (dipakai bareng unit test Node)
const colorRoas = (r) => r >= 2 ? 'roas-positive' : r >= 1 ? 'roas-neutral' : 'roas-negative';

// Order "valid" = bukan Belum Dibayar / Dibatalkan / Dikembalikan (untuk hitungan pesanan & funnel).
// Bisa dimatikan lewat toggle "Order valid saja" di filter bar.
const INVALID_ORDER_RE = /belum dibayar|dibatalkan|dikembalikan/i;
function isCountableOrder(r) {
  const t = document.getElementById('valid-orders-toggle');
  if (!t || !t.checked) return true;
  return !INVALID_ORDER_RE.test(r.status || '');
}

function showLoading(msg = 'Memproses data...') {
  document.getElementById('loading-text').textContent = msg;
  document.getElementById('loading-overlay').style.display = 'flex';
}
function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}
function destroyChart(key) {
  if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
}

// --- CHART GLOBAL CONFIG ----------------------------------------
if (window.Chart) {
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.scale.grid.color = 'rgba(148,163,184,0.14)';
}
if (window.ChartDataLabels) {
  Chart.register(ChartDataLabels);
  Chart.defaults.set('plugins.datalabels', { display: false }); // aktif manual per chart
}
const dlColor = () => document.documentElement.dataset.theme === 'dark' ? '#cbd5e1' : '#334155';

// --- THEME (terang/gelap) ----------------------------------------
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('affalitycs_theme', t); } catch (e) {}
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
  if (window.Chart) {
    Chart.defaults.color = t === 'dark' ? '#cbd5e1' : '#475569';
    Chart.defaults.borderColor = t === 'dark' ? 'rgba(148,163,184,0.15)' : 'rgba(148,163,184,0.18)';
  }
  // render ulang kalau dashboard lagi kebuka biar chart ikut tema
  if (document.getElementById('section-dashboard') && document.getElementById('section-dashboard').style.display !== 'none' && typeof renderAll === 'function') {
    renderAll();
  }
}
function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}
applyTheme(localStorage.getItem('affalitycs_theme') || 'light');

// --- ANIMASI ANGKA KPI -------------------------------------------
function animateCountUps() {
  document.querySelectorAll('.kpi-value[data-count]').forEach(el => {
    const target = parseFloat(el.dataset.count);
    if (isNaN(target)) return;
    const mode = el.dataset.format || 'plain';
    const dur = 700;
    const t0 = performance.now();
    const render = (v) => {
      if (mode === 'rupiah') return (v < 0 ? '-Rp ' : 'Rp ') + fmtK(Math.abs(v));
      if (mode === 'roas') return fmtRoas(v);
      return fmt(v);
    };
    el.textContent = render(0);
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      el.textContent = render(target * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// --- RANGE PICKER -------------------------------------------------
// 1 tombol + preset + kalender. Input filter-start/filter-end tetap ada
// (disembunyikan) sebagai sumber kebenaran semua logika filter.
function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseYmd(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDaysYmd(ymdStr, n) {
  const d = parseYmd(ymdStr);
  d.setDate(d.getDate() + n);
  return ymdLocal(d);
}
function todayYmd() { return ymdLocal(new Date()); }

function setRange(start, end) {
  document.getElementById('filter-start').value = start || '';
  document.getElementById('filter-end').value = end || '';
  updateRangeLabel();
}

function updateRangeLabel() {
  const btn = document.getElementById('range-btn');
  if (!btn) return;
  const s = document.getElementById('filter-start').value;
  const e = document.getElementById('filter-end').value;
  if (!s && !e) { btn.textContent = '📅 Semua tanggal'; return; }
  const fmtId = (ymdStr) => {
    const d = parseYmd(ymdStr);
    return d ? d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : (ymdStr || '…');
  };
  btn.textContent = (s && s === e) ? `📅 ${fmtId(s)}` : `📅 ${fmtId(s)} → ${fmtId(e)}`;
}

function toggleRangePicker(ev) {
  if (ev) ev.stopPropagation();
  const panel = document.getElementById('range-panel');
  if (!panel) return;
  if (panel.style.display === 'block') { closeRangePicker(); return; }
  const s = document.getElementById('filter-start').value;
  const e = document.getElementById('filter-end').value;
  state._rpStart = s || null;
  state._rpEnd = (s && e && e >= s) ? e : null;
  const anchorStr = s || state.shopeeRows.map(r => r.date).filter(Boolean).sort().pop() || todayYmd();
  const anchor = parseYmd(anchorStr);
  state._rpCursor = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  panel.style.display = 'block';
  renderRangePanel();
}
function closeRangePicker() {
  const panel = document.getElementById('range-panel');
  if (panel) panel.style.display = 'none';
}
function rpNav(dir) {
  state._rpCursor.setMonth(state._rpCursor.getMonth() + dir);
  renderRangePanel();
}
function rpClickDay(ymdStr) {
  if (!state._rpStart || (state._rpStart && state._rpEnd)) {
    state._rpStart = ymdStr;
    state._rpEnd = null;
  } else if (ymdStr < state._rpStart) {
    state._rpStart = ymdStr;
  } else {
    state._rpEnd = ymdStr;
    setRange(state._rpStart, state._rpEnd);
    applyFilters();
    closeRangePicker();
    return;
  }
  renderRangePanel();
}
function rpPreset(i) {
  const dates = state.shopeeRows.map(r => r.date).filter(Boolean).sort();
  const anchor = dates.length ? dates[dates.length - 1] : todayYmd();
  const fns = [
    () => [anchor, anchor],
    () => [addDaysYmd(anchor, -6), anchor],
    () => [addDaysYmd(anchor, -29), anchor],
    () => ['', ''],
  ];
  const [s, e] = fns[i]();
  setRange(s, e);
  applyFilters();
  closeRangePicker();
}
function renderRangePanel() {
  const panel = document.getElementById('range-panel');
  if (!panel) return;
  const cursor = state._rpCursor;
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const monthLabel = cursor.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7; // minggu mulai Senin
  const startCell = new Date(y, m, 1 - offset);
  const today = todayYmd();
  const s = state._rpStart, e = state._rpEnd;
  let cells = '';
  ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].forEach(w => { cells += `<div class="rp-wd">${w}</div>`; });
  for (let i = 0; i < 42; i++) {
    const d = new Date(startCell.getFullYear(), startCell.getMonth(), startCell.getDate() + i);
    const ymd = ymdLocal(d);
    const cls = [
      d.getMonth() !== m ? ' muted' : '',
      (ymd === s || ymd === e) ? ' sel' : '',
      (s && e && ymd > s && ymd < e) ? ' inrange' : '',
      ymd === today ? ' today' : '',
    ].join('');
    cells += `<button type="button" class="rp-day${cls}" onclick="rpClickDay('${ymd}')">${d.getDate()}</button>`;
  }
  panel.innerHTML = `
    <div class="rp-presets">
      <button type="button" class="rp-chip" title="Tanggal data terakhir saja" onclick="rpPreset(0)">Hari terakhir</button>
      <button type="button" class="rp-chip" onclick="rpPreset(1)">7 hari</button>
      <button type="button" class="rp-chip" onclick="rpPreset(2)">30 hari</button>
      <button type="button" class="rp-chip" onclick="rpPreset(3)">Semua data</button>
    </div>
    <div class="rp-head">
      <button type="button" class="rp-nav" onclick="rpNav(-1)">‹</button>
      <div class="rp-month">${monthLabel}</div>
      <button type="button" class="rp-nav" onclick="rpNav(1)">›</button>
    </div>
    <div class="rp-grid">${cells}</div>
    <div class="rp-foot">Klik tanggal awal, lalu tanggal akhir</div>`;
}
// Klik di dalam panel gak boleh dianggap "klik luar" — listener dipasang di panel
// (bukan document) karena innerHTML panel diganti tiap klik, yang bikin target klik
// jadi detached node sehingga closest('.range-wrap') gagal di document listener.
const _rpPanelEl = document.getElementById('range-panel');
if (_rpPanelEl) _rpPanelEl.addEventListener('click', (ev) => ev.stopPropagation());
document.addEventListener('click', (ev) => {
  const panel = document.getElementById('range-panel');
  if (!panel || panel.style.display !== 'block') return;
  if (!ev.target.closest('.range-wrap')) closeRangePicker();
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeRangePicker(); });

// --- FILE UPLOAD ------------------------------------------------
let shopeeFiles = [], fbFiles = [], clickFiles = [];

document.getElementById('file-shopee').addEventListener('change', (e) => {
  shopeeFiles = Array.from(e.target.files);
  updateUploadStatus('status-shopee', shopeeFiles, 'csv', 'drop-shopee');
  updateAnalyzeBtn();
});
document.getElementById('file-fb').addEventListener('change', (e) => {
  fbFiles = Array.from(e.target.files);
  updateUploadStatus('status-fb', fbFiles, 'xlsx/csv', 'drop-fb');
  updateAnalyzeBtn();
});
document.getElementById('file-clicks').addEventListener('change', (e) => {
  clickFiles = Array.from(e.target.files);
  updateUploadStatus('status-clicks', clickFiles, 'csv', 'drop-clicks');
  updateAnalyzeBtn();
});

setupDrop('drop-shopee', (files) => {
  shopeeFiles = files.filter(f => f.name.match(/\.csv$/i));
  updateUploadStatus('status-shopee', shopeeFiles, 'csv', 'drop-shopee');
  updateAnalyzeBtn();
});
setupDrop('drop-fb', (files) => {
  fbFiles = files.filter(f => f.name.match(/\.(xlsx?|csv)$/i));
  updateUploadStatus('status-fb', fbFiles, 'xlsx/csv', 'drop-fb');
  updateAnalyzeBtn();
});
setupDrop('drop-clicks', (files) => {
  clickFiles = files.filter(f => f.name.match(/\.csv$/i));
  updateUploadStatus('status-clicks', clickFiles, 'csv', 'drop-clicks');
  updateAnalyzeBtn();
});

function setupDrop(id, cb) {
  const el = document.getElementById(id);
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag-over'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drag-over');
    cb(Array.from(e.dataTransfer.files));
  });
}

function updateUploadStatus(statusId, files, ext, cardId) {
  const el = document.getElementById(statusId);
  const card = document.getElementById(cardId);
  if (files.length === 0) {
    el.textContent = 'Belum ada file';
    el.className = 'upload-status';
    card.classList.remove('has-file');
  } else {
    el.textContent = `✅ ${files.length} file dipilih: ${files.map(f => f.name).join(', ')}`;
    el.className = 'upload-status ok';
    card.classList.add('has-file');
  }
}

function updateAnalyzeBtn() {
  document.getElementById('btn-analyze').disabled = (shopeeFiles.length === 0 && fbFiles.length === 0);
}

// --- MAIN ANALYSIS ----------------------------------------------
async function runAnalysis() {
  showLoading('Membaca file...');
  await sleep(50);

  try {
    state.shopeeRows = [];
    for (const f of shopeeFiles) {
      const text = await readAsText(f);
      state.shopeeRows.push(...parseShopeeCSV(text));
    }
    // Dedup baris identik — file komisi yang overlap gak boleh dobel hitung
    const deduped = dedupShopeeRows(state.shopeeRows);
    state.shopeeRows = deduped.rows;
    state.shopeeDupCount = deduped.removed;
    if (deduped.removed > 0) console.log('[Shopee] Dibuang', deduped.removed, 'baris identik (file overlap)');

    state.fbCampaigns = [];
    state.fbBreakdown = [];
    state.fbAds = [];
    let fbFileIdx = 0;
    for (const f of fbFiles) {
      let raw;
      if (f.name.match(/\.csv$/i)) {
        raw = fbRawFromCSV(await readAsText(f));
      } else {
        raw = fbRawFromXLSX(await readAsArrayBuffer(f));
      }
      // Satu file FB dipakai tiga arah: agregat campaign + breakdown + per-ad (kalau ada kolomnya)
      const bd = extractFbBreakdown(raw);
      const ads = extractFbAdRows(raw);
      const camps = extractFbRows(raw);
      // file ad-level & breakdown = sumber multi-baris per campaign (sah)
      camps.forEach(r => { r._fileIdx = fbFileIdx; r._fromBreakdown = bd.length > 0 || ads.length > 0; });
      state.fbCampaigns.push(...camps);
      state.fbBreakdown.push(...bd);
      state.fbAds.push(...ads);
      fbFileIdx++;
    }
    // Cegah spend dobel antara file ad-level/breakdown & file campaign biasa
    state.fbCampaigns = resolveFbCampaignRows(state.fbCampaigns);

    // Parse Website Click Report
    state.clickReport = [];
    for (const f of clickFiles) {
      const text = await readAsText(f);
      state.clickReport.push(...parseClickReportCSV(text));
    }
    // Dedup klik ID — beberapa file click report yang periodenya overlap tidak dihitung dobel
    const seenClickIds = new Set();
    state.clickReport = state.clickReport.filter(c => {
      if (!c.clickId) return true;
      if (seenClickIds.has(c.clickId)) return false;
      seenClickIds.add(c.clickId);
      return true;
    });
    console.log('[ClickReport] Total clicks loaded:', state.clickReport.length, '(duplikat dibuang)');

    showLoading('Mencocokkan data...');
    await sleep(50);

    const fbNameSet = new Set(state.fbCampaigns.map(c => c.campaignName));
    const savedMapping = loadMapping();
    state.mapping = { ...savedMapping };

    const allShopeeTags = new Set();
    state.shopeeRows.forEach(r => {
      if (r.tag3) allShopeeTags.add(r.tag3);
      if (r.tag1) allShopeeTags.add(r.tag1);
    });

    const fbNormMap = {};
    fbNameSet.forEach(name => { fbNormMap[normalizeName(name)] = name; });

    allShopeeTags.forEach(tag => {
      if (state.mapping[tag]) return;
      if (fbNameSet.has(tag)) { state.mapping[tag] = tag; return; }
      const normTag = normalizeName(tag);
      if (fbNormMap[normTag]) { state.mapping[tag] = fbNormMap[normTag]; return; }
      const partial = Object.entries(fbNormMap).find(([normFb]) =>
        normFb.includes(normTag) || normTag.includes(normFb)
      );
      if (partial) state.mapping[tag] = partial[1];
    });

    const uniqueTagPairs = new Map();
    state.shopeeRows.forEach(r => {
      const resolved = resolveShopeeKey(r, fbNameSet, state.mapping);
      if (!fbNameSet.has(resolved.key)) {
        const displayTag = r.tag3 || r.tag1 || '?';
        if (!uniqueTagPairs.has(displayTag)) {
          uniqueTagPairs.set(displayTag, { tag1: r.tag1, tag3: r.tag3 });
        }
      }
    });
    const unmatchedTags = [...uniqueTagPairs.keys()];

    if (unmatchedTags.length > 0 && state.fbCampaigns.length > 0) {
      hideLoading();
      showMappingModal(unmatchedTags, [...fbNameSet]);
    } else {
      buildDashboard();
    }
  } catch (err) {
    hideLoading();
    alert('Error memproses file: ' + err.message + '\n\nCek Console (F12) untuk detail.');
    console.error(err);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const readAsText = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsText(f, 'utf-8'); });
const readAsArrayBuffer = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsArrayBuffer(f); });

// --- MAPPING MODAL ----------------------------------------------
function showMappingModal(unmatchedTags, fbNames, showAll = false) {
  const container = document.getElementById('mapping-rows');
  container.innerHTML = '';

  const modalTitle = document.querySelector('.modal-header h2');
  if (modalTitle) modalTitle.textContent = showAll ? ' Semua Tag Shopee' : ' Mapping Campaign';

  if (unmatchedTags.length === 0) {
    container.innerHTML = '<p style="color:#64748b;text-align:center;padding:20px">Semua tag sudah terpetakan otomatis </p>';
    document.getElementById('mapping-modal').style.display = 'flex';
    return;
  }

  unmatchedTags.forEach(tag => {
    const currentMap = state.mapping[tag];
    const row = document.createElement('div');
    row.className = 'mapping-row';
    const autoLabel = currentMap ? `<span style="font-size:11px;color:#10b981;margin-left:6px"> auto</span>` : '';
    const options = ['- Tidak Dipetakan -', ...fbNames].map(n =>
      `<option value="${esc(n)}" ${currentMap === n ? 'selected' : ''}>${esc(n)}</option>`
    ).join('');
    row.innerHTML = `
      <div class="mapping-tag">${esc(tag)}${autoLabel}</div>
      <div class="mapping-arrow">-></div>
      <select class="mapping-select" data-tag="${esc(tag)}">${options}</select>
    `;
    container.appendChild(row);
  });
  document.getElementById('mapping-modal').style.display = 'flex';
}

function applyMapping() {
  document.querySelectorAll('.mapping-select').forEach(sel => {
    const tag = sel.dataset.tag;
    const val = sel.value;
    if (val && !val.includes('Tidak Dipetakan')) {
      state.mapping[tag] = val;
    }
  });
  saveMapping(state.mapping);
  document.getElementById('mapping-modal').style.display = 'none';
  buildDashboard();
}

function skipMapping() {
  document.getElementById('mapping-modal').style.display = 'none';
  buildDashboard();
}

function openMapping() {
  const fbNameSet = new Set(state.fbCampaigns.map(c => c.campaignName));
  const allTags = new Set();
  state.shopeeRows.forEach(r => {
    if (r.tag3) allTags.add(r.tag3);
    if (r.tag1) allTags.add(r.tag1);
  });
  showMappingModal([...allTags], [...fbNameSet], true);
}

function loadMapping() {
  try { return JSON.parse(localStorage.getItem('affalitycs_mapping') || '{}'); } catch { return {}; }
}
function saveMapping(m) {
  try { localStorage.setItem('affalitycs_mapping', JSON.stringify(m)); } catch {}
}

// --- PERSISTENSI SESI (IndexedDB) --------------------------------
// Data upload disimpan lokal di browser biar refresh gak perlu upload ulang.
// Murni storage browser ini — gak ada data yang dikirim ke mana pun.
// PARSER_VERSION naik tiap kali format hasil parse berubah — sesi lama
// dikasih warning biar user tahu harus upload ulang.
const PARSER_VERSION = 2;
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('affalitycs', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('session')) db.createObjectStore('session');
      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveSession() {
  try {
    const db = await idbOpen();
    const data = {
      savedAt: Date.now(),
      parserVersion: PARSER_VERSION,
      shopeeRows: state.shopeeRows,
      fbCampaigns: state.fbCampaigns,
      fbBreakdown: state.fbBreakdown,
      fbAds: state.fbAds,
      clickReport: state.clickReport,
      mapping: state.mapping,
      filterStart: document.getElementById('filter-start').value,
      filterEnd: document.getElementById('filter-end').value,
      ppn: document.getElementById('ppn-toggle').checked,
      validOrders: document.getElementById('valid-orders-toggle')?.checked !== false,
    };
    db.transaction('session', 'readwrite').objectStore('session').put(data, 'current');
  } catch (e) { /* storage gak tersedia (mis. private mode) — abaikan */ }
}

async function loadSession() {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const rq = db.transaction('session', 'readonly').objectStore('session').get('current');
      rq.onsuccess = () => resolve(rq.result || null);
      rq.onerror = () => reject(rq.error);
    });
  } catch (e) { return null; }
}

async function clearSession() {
  try {
    const db = await idbOpen();
    db.transaction('session', 'readwrite').objectStore('session').delete('current');
  } catch (e) {}
}

async function checkResume() {
  try {
    state.history = await loadHistory();
    state.history.sort((a, b) => (a.end || '').localeCompare(b.end || ''));
    const s = await loadSession();
    if (!s || !s.shopeeRows || !s.shopeeRows.length) return;
    const dates = s.shopeeRows.map(r => r.date).filter(Boolean).sort();
    const range = dates.length ? `${dates[0]} s/d ${dates[dates.length - 1]}` : 'tanpa data Shopee';
    document.getElementById('resume-text').innerHTML =
      `Sesi sebelumnya ditemukan (disimpan ${new Date(s.savedAt).toLocaleString('id-ID')}):` +
      `<br><strong>${fmt(s.shopeeRows.length)}</strong> baris komisi Shopee · <strong>${s.fbCampaigns.length}</strong> baris FB Ads · <strong>${s.clickReport.length}</strong> klik · ${range}` +
      `<br><span style="font-size:12px;color:#94a3b8">Tersimpan lokal di browser ini — gak ada yang dikirim ke internet.</span>`;
    document.getElementById('resume-banner').style.display = 'flex';
  } catch (e) {}
}

async function restoreSession() {
  const s = await loadSession();
  if (!s) return;
  showLoading('Memulihkan sesi terakhir...');
  state.shopeeRows = s.shopeeRows || [];
  state.fbCampaigns = s.fbCampaigns || [];
  state.fbBreakdown = s.fbBreakdown || [];
  state.fbAds = s.fbAds || [];
  state.clickReport = s.clickReport || [];
  state.shopeeDupCount = 0;
  state.mapping = s.mapping || {};
  state.sessionStale = s.parserVersion !== PARSER_VERSION; // sesi dari parser lama = fitur baru butuh data segar
  setRange(s.filterStart || '', s.filterEnd || '');
  document.getElementById('ppn-toggle').checked = !!s.ppn;
  const vo = document.getElementById('valid-orders-toggle');
  if (vo) vo.checked = s.validOrders !== false;
  dismissResume();
  hideLoading();
  buildDashboard({ keepFilters: true });
}

function dismissResume() {
  document.getElementById('resume-banner').style.display = 'none';
}

// --- RIWAYAT SNAPSHOT (IndexedDB store 'history') -----------------
// Tiap analisis tersimpan per periode (start|end) — buat tren ROAS & perbandingan antar periode.
async function loadHistory() {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const rq = db.transaction('history', 'readonly').objectStore('history').getAll();
      rq.onsuccess = () => resolve(rq.result || []);
      rq.onerror = () => reject(rq.error);
    });
  } catch (e) { return []; }
}

async function saveSnapshot() {
  try {
    const camps = buildCampaignData().filter(c => c.spent > 0 || c.orders > 0);
    if (camps.length === 0) return;
    const totalSpent = camps.reduce((s, c) => s + c.spent, 0);
    const totalKomisi = camps.reduce((s, c) => s + c.komisi, 0);
    if (totalSpent === 0 && totalKomisi === 0) return;

    let cair = 0, pending = 0;
    state.filteredShopee.forEach(r => {
      const st = (r.status || '').toLowerCase();
      if (st.includes('selesai')) cair += r.komisiBersih;
      else if (st.includes('tertu') || st.includes('belum dibayar')) pending += r.komisiBersih;
    });

    const start = document.getElementById('filter-start').value;
    const end = document.getElementById('filter-end').value;
    if (!start && !end) return;

    const snap = {
      key: start + '|' + end, start, end, savedAt: Date.now(),
      spent: totalSpent, komisi: totalKomisi,
      orders: new Set(state.filteredShopee.filter(isCountableOrder).map(r => r.orderId)).size,
      profit: totalKomisi - totalSpent,
      roas: totalSpent > 0 ? totalKomisi / totalSpent : null,
      days: daysInPeriod(), cair, pending,
      // per-campaign — buat kolom delta "vs periode lalu" di tabel
      campaigns: camps.map(c => ({
        name: c.name, spent: Math.round(c.spent), orders: c.orders,
        komisi: Math.round(c.komisi), roas: c.roas !== null && c.roas !== undefined ? +c.roas.toFixed(4) : null,
      })),
    };
    const i = state.history.findIndex(h => h.key === snap.key);
    if (i >= 0) state.history[i] = snap; else state.history.push(snap);
    state.history.sort((a, b) => (a.end || '').localeCompare(b.end || ''));

    const db = await idbOpen();
    db.transaction('history', 'readwrite').objectStore('history').put(snap, snap.key);
  } catch (e) { /* diam-diam */ }
}

async function clearHistory() {
  if (!confirm('Hapus semua riwayat analisis? Sesi upload tidak ikut terhapus.')) return;
  try {
    const db = await idbOpen();
    db.transaction('history', 'readwrite').objectStore('history').clear();
  } catch (e) {}
  state.history = [];
  renderAll();
}

// --- BACKUP / RESTORE (file JSON) ---------------------------------
// Data terkurung di browser perangkat ini — backup bikin dia portable.
function backupData() {
  try {
    const bundle = {
      app: 'affalitycs', version: 1, exportedAt: new Date().toISOString(),
      history: state.history || [],
      mapping: loadMapping(),
    };
    const ses = {
      shopeeRows: state.shopeeRows, fbCampaigns: state.fbCampaigns,
      fbBreakdown: state.fbBreakdown, clickReport: state.clickReport,
      filterStart: document.getElementById('filter-start').value,
      filterEnd: document.getElementById('filter-end').value,
      ppn: document.getElementById('ppn-toggle').checked,
      validOrders: document.getElementById('valid-orders-toggle')?.checked !== false,
    };
    if (ses.shopeeRows.length || ses.fbCampaigns.length || ses.clickReport.length) bundle.session = ses;
    const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'affalitycs-backup-' + todayYmd().replace(/-/g, '') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { alert('Backup gagal: ' + e.message); }
}

async function restoreData(file) {
  try {
    const bundle = JSON.parse(await file.text());
    if (!bundle || bundle.app !== 'affalitycs') { alert('File ini bukan backup Affalitycs.'); return; }
    const db = await idbOpen();
    let nHist = 0;
    if (Array.isArray(bundle.history)) {
      const store = db.transaction('history', 'readwrite').objectStore('history');
      bundle.history.forEach(h => { if (h && h.key) { store.put(h, h.key); nHist++; } });
      const byKey = {};
      (state.history || []).concat(bundle.history.filter(h => h && h.key)).forEach(h => { byKey[h.key] = h; });
      state.history = Object.values(byKey).sort((a, b) => (a.end || '').localeCompare(b.end || ''));
    }
    if (bundle.mapping) {
      saveMapping({ ...loadMapping(), ...bundle.mapping });
      state.mapping = loadMapping();
    }
    const ses = bundle.session;
    if (ses && ((ses.shopeeRows || []).length || (ses.fbCampaigns || []).length || (ses.clickReport || []).length)) {
      db.transaction('session', 'readwrite').objectStore('session').put(ses, 'current');
      restoreSession(); // pulihkan sesi + tampilkan dashboard
      return;
    }
    alert('Restore selesai: ' + nHist + ' snapshot riwayat dipulihkan.');
    renderAll();
  } catch (e) { alert('Restore gagal — file rusak atau bukan backup yang valid. (' + e.message + ')'); }
}

checkResume();

// --- BUILD DASHBOARD --------------------------------------------
function buildDashboard(opts = {}) {
  showLoading('Membangun dashboard...');

  if (!opts.keepFilters) {
    const dates = state.shopeeRows.map(r => r.date).filter(Boolean).sort();
    if (dates.length > 0) {
      setRange(dates[0], dates[dates.length - 1]);
      document.getElementById('last-updated').textContent =
        `Data: ${dates[0]} - ${dates[dates.length - 1]}`;
    }
  }

  setTimeout(() => {
    applyFilters();
    document.getElementById('section-upload').style.display = 'none';
    document.getElementById('section-dashboard').style.display = 'block';
    hideLoading();
  }, 100);
}

// --- APPLY FILTERS (DATE RANGE) ---------------------------------
// Normalisasi value dari input[type=date] - browser bisa beda format
function normDateInput(val) {
  if (!val) return '';
  val = val.trim();
  // Sudah YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  // DD/MM/YYYY
  let m = val.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // MM/DD/YYYY (US)
  m = val.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return val;
}

function applyFilters() {
  const rawStart = document.getElementById('filter-start').value;
  const rawEnd   = document.getElementById('filter-end').value;
  const start = normDateInput(rawStart);
  const end   = normDateInput(rawEnd);

  console.log('[Filter] start:', JSON.stringify(start), 'end:', JSON.stringify(end));
  console.log('[Filter] total rows:', state.shopeeRows.length);

  if (start || end) {
    const label = (start || '...') + '  ' + (end || '...');
    document.getElementById('last-updated').textContent = 'Data: ' + label;
  }

  state.filteredShopee = state.shopeeRows.filter(r => {
    if (!r.date) return true;
    if (start && r.date < start) return false;
    if (end   && r.date > end)   return false;
    return true;
  });

  console.log('[Filter] filtered rows:', state.filteredShopee.length);
  // Log sample dates for debug
  const sample = state.shopeeRows.slice(0, 3).map(r => r.date);
  console.log('[Filter] sample parsed dates:', sample);

  const fbHasDates = state.fbCampaigns.some(c => !!c.date);
  if (fbHasDates) {
    // FB has daily data, filter exactly like Shopee
    state.filteredFb = state.fbCampaigns.filter(c => {
      if (!c.date) return true;
      if (start && c.date < start) return false;
      if (end   && c.date > end)   return false;
      return true;
    });
    state.dateRatio = 1; // No proration needed
  } else {
    // FB is aggregated, use dateRatio to prorate
    state.filteredFb = state.fbCampaigns;
    if (start && end && state.shopeeRows.length > 0) {
      const allDates = [...new Set(state.shopeeRows.map(r => r.date).filter(Boolean))].sort();
      const filtDates = [...new Set(state.filteredShopee.map(r => r.date).filter(Boolean))].sort();
      state.dateRatio = allDates.length > 0 ? Math.min(1, filtDates.length / allDates.length) : 1;
    } else {
      state.dateRatio = 1;
    }
  }
  // Filter breakdown FB by date
  state.filteredFbBreakdown = state.fbBreakdown.filter(b => {
    if (!b.date) return true;
    if (start && b.date < start) return false;
    if (end   && b.date > end)   return false;
    return true;
  });
  // Filter data per-ad by date
  state.filteredFbAds = state.fbAds.filter(a => {
    if (!a.date) return true;
    if (start && a.date < start) return false;
    if (end   && a.date > end)   return false;
    return true;
  });
  // Filter click report by date (per-batas, konsisten dengan filter Shopee & FB)
  state.filteredClicks = state.clickReport.filter(c => {
    if (!c.date) return true;
    if (start && c.date < start) return false;
    if (end   && c.date > end)   return false;
    return true;
  });
  console.log('[Filter] dateRatio:', state.dateRatio.toFixed(3), 'fbHasDates:', fbHasDates, 'clicks:', state.filteredClicks.length);
  renderAll();
  saveSession();
  saveSnapshot();
}

function renderAll() {
  try { renderSmartReport(); } catch(e) { console.warn('renderSmartReport:', e); }
  try { renderKPIs(); } catch(e) { console.warn('renderKPIs:', e); }
  try { renderCampaignTab(); } catch(e) { console.warn('renderCampaignTab:', e); }
  try { renderProductTab(); } catch(e) { console.warn('renderProductTab:', e); }
  try { renderComparisonTab(); } catch(e) { console.warn('renderComparisonTab:', e); }
  try { renderTrendTab(); } catch(e) { console.warn('renderTrendTab:', e); }
  try { renderClickInsights(); } catch(e) { console.warn('renderClickInsights:', e); }
  try { renderFbBreakdown(); } catch(e) { console.warn('renderFbBreakdown:', e); }
  try { renderSanity(); } catch(e) { console.warn('renderSanity:', e); }
  try { renderRoasJourney(); } catch(e) { console.warn('renderRoasJourney:', e); }
}

// --- MERGE SHOPEE + FB ------------------------------------------
function buildCampaignData() {
  const fbNameSet = new Set(state.filteredFb.map(c => c.campaignName));

  // Aggregate click report data by campaign key
  const clicksByTag = {};
  (state.filteredClicks || []).forEach(click => {
    const key = resolveClickKey(click.tagLink, fbNameSet, state.mapping);
    if (!clicksByTag[key]) clicksByTag[key] = { total: 0, fromFacebook: 0, fromOthers: 0 };
    clicksByTag[key].total++;
    if (click.perujuk === 'Facebook') clicksByTag[key].fromFacebook++;
    else clicksByTag[key].fromOthers++;
  });

  const shopeeByTag = {};
  state.filteredShopee.forEach(r => {
    const { key } = resolveShopeeKey(r, fbNameSet, state.mapping);
    if (!shopeeByTag[key]) shopeeByTag[key] = [];
    shopeeByTag[key].push(r);
  });

  const allCampaigns = new Set([
    ...Object.keys(shopeeByTag),
    ...Object.keys(clicksByTag),
    ...state.filteredFb.map(c => c.campaignName)
  ]);

  const result = [];
  allCampaigns.forEach(name => {
    const ppnToggle = document.getElementById('ppn-toggle');
    const ppnRatio = (ppnToggle && ppnToggle.checked) ? 1.11 : 1;
    const shopeeRows = shopeeByTag[name] || [];
    // Aggregate FB rows (in case it's daily data with multiple rows per campaign)
    const fbRows = state.filteredFb.filter(c => c.campaignName === name);
    let fbRow = null;
    if (fbRows.length > 0) {
      fbRow = fbRows.reduce((acc, row) => ({
        campaignName: name,
        spent: acc.spent + (row.spent || 0),
        reach: acc.reach + (row.reach || 0),
        impressions: acc.impressions + (row.impressions || 0),
        linkClicks: acc.linkClicks + (row.linkClicks || 0),
        allClicks: acc.allClicks + (row.allClicks || 0),
        landingPageViews: acc.landingPageViews + (row.landingPageViews || 0),
      }), { spent: 0, reach: 0, impressions: 0, linkClicks: 0, allClicks: 0, landingPageViews: 0 });
      
      // Apply PPN 11% to FB spend immediately so cpc and cpm are calculated with tax included
      fbRow.spent = fbRow.spent * ppnRatio;
      
      fbRow.ctr = fbRow.impressions > 0 ? (fbRow.linkClicks / fbRow.impressions) * 100 : 0;
      fbRow.cpc = fbRow.linkClicks > 0 ? fbRow.spent / fbRow.linkClicks : 0;
      fbRow.cpm = fbRow.impressions > 0 ? (fbRow.spent / fbRow.impressions) * 1000 : 0;
    }

    const countableRows = shopeeRows.filter(isCountableOrder);
    const uniqueOrders = new Set(countableRows.map(r => r.orderId));
    const orders = uniqueOrders.size;
    const komisi = shopeeRows.reduce((s, r) => s + r.komisiBersih, 0);
    const nilaiPembelian = shopeeRows.reduce((s, r) => s + r.nilaiPembelian, 0);
    // Apply dateRatio to prorate FB metrics when date range is filtered
    const ratio = state.dateRatio !== undefined ? state.dateRatio : 1;

    const spent = fbRow ? fbRow.spent * ratio : 0;
    const profit = komisi - spent;
    const roas = spent > 0 ? komisi / spent : null;
    const cpo = orders > 0 && spent > 0 ? spent / orders : null;

    const statusCount = {};
    shopeeRows.forEach(r => {
      statusCount[r.status] = (statusCount[r.status] || 0) + 1;
    });

    // === FUNNEL 3 TAHAP (dengan data klik Shopee asli) ===
    // Stage 1: Klik Iklan (FB Link Clicks)
    const fbLinkClicks = fbRow ? Math.round(fbRow.linkClicks * ratio) : 0;
    // Stage 2: Klik Masuk Shopee (dari Website Click Report jika tersedia, fallback ke LPV)
    const clickData = clicksByTag[name] || null;
    const shopeeClicks = clickData ? clickData.total : 0;
    const shopeeClicksFb = clickData ? clickData.fromFacebook : 0;
    const shopeeClicksOthers = clickData ? clickData.fromOthers : 0;
    const landingViews = fbRow ? Math.round(fbRow.landingPageViews * ratio) : 0;
    // Use real click data if available — prioritas klik perujuk Facebook (konteks funnel iklan),
    // fallback ke total klik kalau tidak ada yang berujuk FB, terakhir ke LPV
    const stage2Value = clickData ? (shopeeClicksFb > 0 ? shopeeClicksFb : shopeeClicks) : landingViews;
    const stage2Source = clickData ? 'click_report' : 'lpv';
    // Stage 3: Yang Order (unique orders dari Shopee)
    // orders sudah dihitung di atas

    // Drop-off metrics
    const dropClickToShopee = fbLinkClicks > 0 ? Math.max(0, fbLinkClicks - stage2Value) : null;
    const dropClickToShopeePct = fbLinkClicks > 0 ? ((fbLinkClicks - stage2Value) / fbLinkClicks * 100) : null;
    const dropShopeeToOrder = stage2Value > 0 ? Math.max(0, stage2Value - orders) : null;
    const dropShopeeToOrderPct = stage2Value > 0 ? ((stage2Value - orders) / stage2Value * 100) : null;
    const overallConvPct = fbLinkClicks > 0 ? (orders / fbLinkClicks * 100) : null;

    // New metrics
    const cpcShopee = stage2Value > 0 && spent > 0 ? spent / stage2Value : null; // CPC Shopee = spend / klik masuk
    const komisiPerOrder = orders > 0 ? komisi / orders : null; // Affiliate per pesanan

    result.push({ name, shopeeRows, orders, komisi, nilaiPembelian, spent, profit, roas, cpo, statusCount,
      fbLinkClicks, landingViews, shopeeClicks, shopeeClicksFb, shopeeClicksOthers,
      stage2Value, stage2Source,
      dropClickToShopee, dropClickToShopeePct,
      dropShopeeToOrder, dropShopeeToOrderPct, overallConvPct,
      cpcShopee, komisiPerOrder,
      fb: fbRow || null });
  });

  return result.sort((a, b) => (b.roas || -Infinity) - (a.roas || -Infinity));
}

// --- KPIs -------------------------------------------------------
function renderKPIs() {
  const campaigns = buildCampaignData();
  const totalSpent  = campaigns.reduce((s, c) => s + c.spent, 0);
  const totalKomisi = campaigns.reduce((s, c) => s + c.komisi, 0);
  const totalOrders = new Set(state.filteredShopee.filter(isCountableOrder).map(r => r.orderId)).size;
  const totalProfit = totalKomisi - totalSpent;
  const overallRoas = totalSpent > 0 ? totalKomisi / totalSpent : null;

  const kpis = [
    { label: 'Total Komisi Bersih', value: 'Rp ' + fmtK(totalKomisi), count: totalKomisi, format: 'rupiah', sub: 'dari semua campaign', color: 'green',
      badge: totalProfit >= 0 ? { text: 'Untung', cls: 'pos' } : { text: 'Rugi', cls: 'neg' } },
    { label: 'Total Spend Iklan', value: 'Rp ' + fmtK(totalSpent), count: totalSpent, format: 'rupiah', sub: 'Facebook Ads', color: 'orange' },
    { label: 'Profit / Loss', value: (totalProfit >= 0 ? 'Rp ' : '-Rp ') + fmtK(Math.abs(totalProfit)),
      count: totalProfit, format: 'rupiah',
      sub: totalProfit >= 0 ? '▲ profit' : '▼ rugi',
      color: totalProfit >= 0 ? 'green' : 'red',
      badge: totalProfit >= 0
        ? { text: '+' + fmtK(totalProfit), cls: 'pos' }
        : { text: '-' + fmtK(Math.abs(totalProfit)), cls: 'neg' }
    },
    { label: 'Overall ROAS', value: fmtRoas(overallRoas), count: overallRoas !== null && overallRoas !== undefined ? overallRoas : '', format: 'roas', sub: 'komisi / spend', color: overallRoas && overallRoas >= 2 ? 'green' : 'orange' },
    { label: 'Total Pesanan', value: fmt(totalOrders), count: totalOrders, format: 'plain', sub: 'unique order valid', color: 'blue' },
  ];

  document.getElementById('kpi-grid').innerHTML = kpis.map(k => `
    <div class="kpi-card ${k.color}">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value" data-count="${k.count ?? ''}" data-format="${k.format || 'plain'}">${k.value}</div>
      <div class="kpi-sub">${k.sub}</div>
      ${k.badge ? `<span class="kpi-badge ${k.badge.cls}">${k.badge.text}</span>` : ''}
    </div>
  `).join('');
  animateCountUps();
}

// --- SMART REPORT (panel verdict di atas KPI) --------------------
// Jumlah hari unik dalam periode terfilter (dipakai hitungan per-hari)
function daysInPeriod() {
  return new Set([
    ...state.filteredShopee.map(r => r.date).filter(Boolean),
    ...state.filteredFb.map(c => c.date).filter(Boolean),
  ]).size || 1;
}

// Snapshot riwayat terakhir yang periode-nya selesai SEBELUM periode sekarang mulai
function getPrevSnapshot() {
  const startCur = document.getElementById('filter-start').value;
  if (!startCur || !state.history || !state.history.length) return null;
  return state.history
    .filter(h => h.end && h.end < startCur && h.roas !== null && h.roas !== undefined)
    .sort((a, b) => (b.end || '').localeCompare(a.end || ''))[0] || null;
}

function renderSmartReport() {
  const el = document.getElementById('smart-report');
  if (!el) return;
  const campaigns = buildCampaignData().filter(c => c.spent > 0 || c.orders > 0);
  if (campaigns.length === 0) { el.style.display = 'none'; return; }
  el.style.display = 'flex';

  const totalSpent = campaigns.reduce((s, c) => s + c.spent, 0);
  const totalKomisi = campaigns.reduce((s, c) => s + c.komisi, 0);
  const profit = totalKomisi - totalSpent;
  el.style.borderLeftColor = totalSpent === 0 ? '' : (profit >= 0 ? '#10b981' : '#ef4444');
  const roas = totalSpent > 0 ? totalKomisi / totalSpent : null;

  // Komisi cair vs pending vs gagal — dari kolom Status Pesanan di file komisi yang SAMA
  let cair = 0, pending = 0, gagal = 0;
  state.filteredShopee.forEach(r => {
    const st = (r.status || '').toLowerCase();
    if (st.includes('selesai')) cair += r.komisiBersih;
    else if (st.includes('tertu') || st.includes('belum dibayar')) pending += r.komisiBersih;
    else gagal += r.komisiBersih;
  });

  const days = daysInPeriod();
  const withSpend = campaigns.filter(c => c.spent > 0);
  const worst = withSpend.slice().sort((a, b) => (a.roas ?? Infinity) - (b.roas ?? Infinity))[0] || null;
  const best = campaigns.filter(c => c.roas !== null).sort((a, b) => b.roas - a.roas)[0] || null;
  const worstFunnel = campaigns.filter(c => c.fbLinkClicks > 0 && c.dropClickToShopeePct != null && isFinite(c.dropClickToShopeePct))
    .sort((a, b) => b.dropClickToShopeePct - a.dropClickToShopeePct)[0] || null;

  const verdict = totalSpent === 0 ? 'Tanpa Spend'
    : profit >= 0 ? 'UNTUNG Rp ' + fmt(profit) : 'RUGI Rp ' + fmt(Math.abs(profit));
  const verdictColor = totalSpent === 0 ? 'var(--text-primary)' : profit >= 0 ? '#10b981' : '#ef4444';

  let worstBep = '';
  if (worst && worst.roas !== null && worst.roas < 1 && worst.komisiPerOrder > 0) {
    const needed = Math.ceil((worst.spent / days) / worst.komisiPerOrder);
    const actual = (worst.orders / days).toFixed(1);
    worstBep = 'butuh ' + needed + ' order/hari (realita ' + actual + '/hari)';
  }

  // Perbandingan dengan periode tersimpan sebelumnya
  let prevItem = '';
  const prev = getPrevSnapshot();
  if (prev && roas !== null) {
      const dr = prev.roas > 0 ? ((roas - prev.roas) / prev.roas * 100) : null;
      const roasColor = dr !== null && dr < 0 ? '#ef4444' : '#10b981';
      prevItem = `<div class="sr-item"><div class="sr-label">📅 vs periode sebelumnya (${esc(prev.start || '…')} – ${esc(prev.end || '…')})</div>
        ROAS ${prev.roas.toFixed(2)}x → <strong>${roas.toFixed(2)}x</strong>${dr !== null ? ` <span style="color:${roasColor};font-weight:700">(${dr >= 0 ? '+' : ''}${dr.toFixed(0)}%)</span>` : ''}
        ${prev.spent > 0 ? `<div style="font-size:12px;color:#64748b">Spend Rp ${fmt(prev.spent)} → Rp ${fmt(totalSpent)} · Komisi Rp ${fmt(prev.komisi)} → Rp ${fmt(totalKomisi)}</div>` : ''}</div>`;
  }

  el.innerHTML = `
    <div class="sr-head">
      <span>🤖</span>
      <span>Smart Report — Posisi: <span style="color:${verdictColor}">${verdict}</span></span>
      ${roas !== null ? `<span class="sr-roas ${colorRoas(roas)}">ROAS ${roas.toFixed(2)}x</span>` : ''}
    </div>
    <div class="sr-grid">
      ${prevItem}
      <div class="sr-item"><div class="sr-label">💰 Komisi (kondisi)</div>
        Cair <strong>Rp ${fmt(cair)}</strong> · Pending <strong>Rp ${fmt(pending)}</strong>${gagal > 0 ? ' · Gagal <strong>Rp ' + fmt(gagal) + '</strong>' : ''}
        <div style="font-size:11px;color:#94a3b8">komisi pending biasanya cair 10-15 hari kerja</div></div>
      <div class="sr-item"><div class="sr-label">💸 Iklan</div>
        Spend <strong>Rp ${fmt(totalSpent)}</strong> dalam <strong>${days} hari</strong>${profit < 0 ? ' · defisit <strong>-Rp ' + fmt(Math.abs(profit)) + '</strong>' : ''}
        <div style="font-size:12px;color:#64748b">GMV Shopee: Rp ${fmtK(state.filteredShopee.reduce((s, r) => s + r.nilaiPembelian, 0))}</div></div>
      ${best && best.roas >= 1 ? `<div class="sr-item"><div class="sr-label">🚀 Pertahankan & scale</div>
        <strong>${esc(best.name)}</strong> — ROAS ${best.roas.toFixed(2)}x · komisi Rp ${fmt(best.komisi)}</div>` : ''}
      ${worst && worst.roas !== null && worst.roas < 1 ? `<div class="sr-item"><div class="sr-label">⛔ Kandidat pause</div>
        <strong>${esc(worst.name)}</strong> — ROAS ${worst.roas.toFixed(2)}x · rugi -Rp ${fmt(Math.abs(worst.profit))}${worstBep ? ' · ' + worstBep : ''}</div>` : ''}
      ${worstFunnel ? `<div class="sr-item"><div class="sr-label">🔍 Klik bocor terparah</div>
        <strong>${esc(worstFunnel.name)}</strong> — ${worstFunnel.dropClickToShopeePct.toFixed(0)}% klik gak sampai Shopee (${fmt(worstFunnel.dropClickToShopee)} klik hilang)</div>` : ''}
    </div>`;
}

// --- CAMPAIGN TAB -----------------------------------------------
function renderCampaignTab() {
  const campaigns = buildCampaignData();

  destroyChart('roas');
  const ctxRoas = document.getElementById('chart-roas');
  if (ctxRoas) {
    const canvas = ensureCanvas(ctxRoas);
    const labels   = campaigns.map(c => c.name);
    const roasVals = campaigns.map(c => c.roas !== null ? +c.roas.toFixed(2) : 0);
    const colors   = roasVals.map(v => v >= 2 ? '#10b981' : v >= 1 ? '#f59e0b' : '#ef4444');
    state.charts['roas'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'ROAS', data: roasVals, backgroundColor: colors, borderRadius: 6 },
          { label: 'Break-even (1x)', data: labels.map(() => 1), type: 'line',
            borderColor: '#94a3b8', borderDash: [6,4], borderWidth: 2, pointRadius: 0, fill: false,
            datalabels: { display: false } }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          tooltip: { callbacks: {
            label: (ctx) => ctx.dataset.label === 'ROAS' ? `ROAS: ${ctx.raw}x` : 'Break-even'
          }},
          datalabels: { display: true, anchor: 'end', align: 'end', offset: -2, color: dlColor(),
            font: { weight: 700, size: 10 }, formatter: (v) => v ? v.toFixed(2) + 'x' : '' }
        },
        scales: { y: { beginAtZero: true, suggestedMax: 1.2, title: { display: true, text: 'ROAS (x)' } } }
      }
    });
  }

  const tbody = document.getElementById('tbody-campaign');
  const prevSnap = getPrevSnapshot();
  const prevCamp = prevSnap && Array.isArray(prevSnap.campaigns)
    ? Object.fromEntries(prevSnap.campaigns.map(x => [x.name, x])) : {};
  tbody.innerHTML = campaigns.map(c => {
    const roasTxt   = c.roas !== null ? c.roas.toFixed(2) + 'x' : (c.spent > 0 ? '0.00x' : '-');
    const roasClass = c.roas !== null ? colorRoas(c.roas) : '';
    const cpoTxt    = c.cpo !== null ? 'Rp ' + fmt(c.cpo) : '-';
    // Delta vs snapshot periode sebelumnya
    const pv = prevCamp[c.name];
    let dRoas = '<span style="color:var(--text-muted)">-</span>';
    let dSpend = '<span style="color:var(--text-muted)">-</span>';
    if (pv && pv.roas !== null && pv.roas !== undefined && c.roas !== null) {
      const d = c.roas - pv.roas;
      dRoas = `<span style="color:${d >= 0 ? '#10b981' : '#ef4444'};font-weight:600">${d >= 0 ? '▲ +' : '▼ '}${d.toFixed(2)}</span>`;
    }
    if (pv && pv.spent > 0 && c.spent > 0) {
      const dp = (c.spent - pv.spent) / pv.spent * 100;
      dSpend = `${dp >= 0 ? '+' : ''}${dp.toFixed(0)}%`;
    }
    return `<tr>
      <td><strong>${esc(c.name)}</strong>${c.fb && c.fb.delivery === 'inactive' ? ' <span class="badge badge-gray" style="font-size:10px">nonaktif</span>' : ''}</td>
      <td>${c.spent > 0 ? 'Rp ' + fmt(c.spent) : '-'}</td>
      <td>${c.orders}</td>
      <td>Rp ${fmt(c.komisi)}</td>
      <td class="${c.profit >= 0 ? 'profit-pos' : 'profit-neg'}">${c.profit >= 0 ? 'Rp ' : '-Rp '}${fmt(Math.abs(c.profit))}</td>
      <td class="${roasClass}">${roasTxt}</td>
      <td>${dRoas}</td>
      <td>${dSpend}</td>
      <td>${cpoTxt}</td>
      <td>${c.fb ? fmt(c.fb.impressions) : '-'}</td>
      <td>${c.fb ? fmt(c.fb.linkClicks) : '-'}</td>
      <td>${c.fb ? c.fb.ctr.toFixed(2) + '%' : '-'}</td>
      <td>${getStatusBadge(c.roas, c.spent)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="13" class="no-data">Tidak ada data campaign</td></tr>';

  renderAdsTable();
}

function getStatusBadge(roas, spent) {
  if (spent === 0) return '<span class="badge badge-gray">Organik</span>';
  if (roas === null) return '<span class="badge badge-gray">-</span>';
  if (roas >= 3)    return '<span class="badge badge-green">🚀 Scale Up</span>';
  if (roas >= 2)    return '<span class="badge badge-green">✅ Profitable</span>';
  if (roas >= 1)    return '<span class="badge badge-yellow">[!] Break-even</span>';
  return '<span class="badge badge-red">❌ Rugi</span>';
}

// --- PRODUCT TAB ------------------------------------------------
function computeProductRows() {
  const byProduct = {};
  const fbNameSet = new Set(state.filteredFb.map(c => c.campaignName));
  state.filteredShopee.forEach(r => {
    const key = r.barang || '(tidak diketahui)';
    if (!byProduct[key]) byProduct[key] = { name: key, kategori: r.kategori1 || '-', orders: new Set(), nilai: 0, komisi: 0, campaigns: new Set() };
    if (isCountableOrder(r)) byProduct[key].orders.add(r.orderId);
    byProduct[key].nilai  += r.nilaiPembelian;
    byProduct[key].komisi += r.komisiBersih;
    const { key: campKey } = resolveShopeeKey(r, fbNameSet, state.mapping);
    byProduct[key].campaigns.add(campKey);
  });
  return Object.values(byProduct)
    .map(p => ({ ...p, orders: p.orders.size, campaigns: [...p.campaigns] }))
    .sort((a, b) => b.orders - a.orders);
}

function renderProductTab() {
  const products = computeProductRows();

  destroyChart('topProduct');
  const ctxTP = document.getElementById('chart-top-product');
  if (ctxTP) {
    const canvas = ensureCanvas(ctxTP);
    const top15 = products.slice(0, 15);
    state.charts['topProduct'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: top15.map(p => p.name.length > 40 ? p.name.slice(0, 40) + '...' : p.name),
        datasets: [{ label: 'Orders', data: top15.map(p => p.orders), backgroundColor: '#6366f1', borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { title: { display: true, text: 'Jumlah Order' } } }
      }
    });
  }

  document.getElementById('tbody-product').innerHTML = products.map(p => `<tr>
    <td style="max-width:260px;white-space:normal;line-height:1.4">${esc(p.name)}</td>
    <td>${esc(p.kategori)}</td>
    <td><strong>${p.orders}</strong></td>
    <td>Rp ${fmt(p.nilai)}</td>
    <td>Rp ${fmt(p.komisi)}</td>
    <td style="max-width:160px;white-space:normal">${p.campaigns.slice(0,3).map(c => `<span class="badge badge-blue">${esc(c)}</span>`).join(' ')}</td>
  </tr>`).join('') || '<tr><td colspan="6" class="no-data">Tidak ada produk</td></tr>';
}

// --- COMPARISON TAB ---------------------------------------------
function renderComparisonTab() {
  const campaigns = buildCampaignData();

  // -- Scatter Plot: CTR vs ROAS --
  destroyChart('scatter');
  const ctxScatter = document.getElementById('chart-scatter');
  if (ctxScatter) {
    const canvas = ensureCanvas(ctxScatter);
    const hasFb = campaigns.filter(c => c.fb && c.fb.ctr > 0 && c.roas !== null);
    if (hasFb.length > 0) {
      const maxSpend  = Math.max(...hasFb.map(c => c.spent), 1);
      const xMax = Math.max(...hasFb.map(c => c.fb.ctr), 3) * 1.2;
      const scatterData = hasFb.map(c => ({
        x: parseFloat(c.fb.ctr.toFixed(2)),
        y: parseFloat(c.roas.toFixed(4)),
        r: Math.max(6, (c.spent / maxSpend) * 28),
        label: c.name, spent: c.spent, roas: c.roas, ctr: c.fb.ctr,
      }));
      state.charts['scatter'] = new Chart(canvas, {
        type: 'bubble',
        data: { datasets: [
          { label: 'Campaign', data: scatterData,
            backgroundColor: scatterData.map(d => d.roas >= 2 ? 'rgba(16,185,129,0.6)' : d.roas >= 1 ? 'rgba(245,158,11,0.6)' : 'rgba(239,68,68,0.6)'),
            borderColor:     scatterData.map(d => d.roas >= 2 ? '#10b981' : d.roas >= 1 ? '#f59e0b' : '#ef4444'),
            borderWidth: 2 },
          { type: 'line', label: 'Break-even (1x)',
            data: [{ x: 0, y: 1 }, { x: xMax, y: 1 }],
            borderColor: '#94a3b8', borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false,
            datalabels: { display: false } }
        ] },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: { onComplete(anim) {
            const chart = anim.chart, ctx2 = chart.ctx;
            chart.data.datasets[0].data.forEach((d, i) => {
              const pt = chart.getDatasetMeta(0).data[i]; if (!pt) return;
              ctx2.save(); ctx2.fillStyle = '#1e293b'; ctx2.font = 'bold 10px Inter,sans-serif'; ctx2.textAlign = 'center';
              ctx2.fillText(d.label.length > 12 ? d.label.slice(0,12)+'...' : d.label, pt.x, pt.y-(pt.options.radius||8)-4);
              ctx2.restore();
            });
          }},
          plugins: { legend: { display: false }, tooltip: { callbacks: {
            title: (items) => items[0].raw.label,
            label: (ctx) => { const d=ctx.raw; return [`CTR: ${d.ctr.toFixed(2)}%`,`ROAS: ${d.roas.toFixed(2)}x`,`Spend: Rp${fmtK(d.spent)}`]; }
          }}},
          scales: {
            x: { min: 0, suggestedMax: 8, title: { display:true, text:'CTR Facebook Ads (%)' }, ticks: { callback: v => v+'%' } },
            y: { title: { display:true, text:'ROAS (Komisi / Spend)' }, ticks: { callback: v => parseFloat(v).toFixed(2)+'x' } }
          }
        }
      });
    } else {
      ctxScatter.innerHTML = '<div class="chart-empty">Tidak ada data FB Ads untuk scatter plot.</div>';
    }
  }

  // -- FUNNEL CHART: 3 Tahap (Klik Iklan → Sampai Shopee → Order) --
  destroyChart('clickLoss');
  const ctxLoss = document.getElementById('chart-click-loss');
  if (ctxLoss) {
    const hasFbData = campaigns.filter(c => c.fb && c.fbLinkClicks > 0);
    if (hasFbData.length > 0) {
      const canvas = ensureCanvas(ctxLoss);
      const labels       = hasFbData.map(c => c.name);
      const fbClicks     = hasFbData.map(c => c.fbLinkClicks);
      const shopeeClicks = hasFbData.map(c => c.stage2Value);
      const orderCounts  = hasFbData.map(c => c.orders);

      state.charts['clickLoss'] = new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: '1. Klik Iklan (FB)', data: fbClicks,
              backgroundColor: 'rgba(59,130,246,0.8)', borderColor: '#3b82f6', borderWidth: 1.5, borderRadius: 5 },
            { label: '2. Klik Masuk Shopee', data: shopeeClicks,
              backgroundColor: 'rgba(139,92,246,0.8)', borderColor: '#8b5cf6', borderWidth: 1.5, borderRadius: 5 },
            { label: '3. Order', data: orderCounts,
              backgroundColor: 'rgba(16,185,129,0.8)', borderColor: '#10b981', borderWidth: 1.5, borderRadius: 5 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'bottom' },
            datalabels: { display: true, anchor: 'end', align: 'end', color: dlColor(),
              font: { size: 9, weight: 600 }, formatter: (v) => v ? fmt(v) : '' },
            tooltip: { callbacks: { label: (ctx) => {
              const i = ctx.dataIndex;
              const c = hasFbData[i];
              if (ctx.datasetIndex === 0) return `Klik Iklan: ${fmt(ctx.raw)}`;
              if (ctx.datasetIndex === 1) {
                const drop = (c.dropClickToShopeePct != null && isFinite(c.dropClickToShopeePct)) ? c.dropClickToShopeePct.toFixed(1) : '0';
                return `Klik Masuk Shopee: ${fmt(ctx.raw)} (hilang ${drop}% dari klik)${c.stage2Source === 'click_report' ? ' [Click Report]' : ' [LPV]'}`;
              }
              const conv = (c.overallConvPct != null && isFinite(c.overallConvPct)) ? c.overallConvPct.toFixed(2) : '0';
              return `Order: ${ctx.raw} (conv. ${conv}% dari klik)`;
            }}}
          },
          scales: {
            y: { title: { display: true, text: 'Jumlah' }, ticks: { callback: v => fmtK(v) } }
          }
        }
      });
    } else {
      ctxLoss.innerHTML = '<div class="chart-empty">Upload file FB Ads untuk melihat funnel klik.</div>';
    }
  }

  // -- Funnel Summary Cards (3 Tahap) --
  const clSummary = document.getElementById('click-loss-summary');
  if (clSummary) {
    const withFb = campaigns.filter(c => c.fb && c.fbLinkClicks > 0);
    if (withFb.length > 0) {
      const totalFbClicks   = withFb.reduce((s,c) => s + c.fbLinkClicks, 0);
      const totalShopeeClk  = withFb.reduce((s,c) => s + c.stage2Value, 0);
      const totalOrders     = withFb.reduce((s,c) => s + c.orders, 0);
      const dropStage1Pct   = totalFbClicks > 0 ? ((totalFbClicks - totalShopeeClk) / totalFbClicks * 100) : 0;
      const dropStage2Pct   = totalShopeeClk > 0 ? ((totalShopeeClk - totalOrders) / totalShopeeClk * 100) : 0;
      const overallConv     = totalFbClicks > 0 ? (totalOrders / totalFbClicks * 100) : 0;
      const colorDrop1      = dropStage1Pct > 50 ? '#ef4444' : dropStage1Pct > 20 ? '#f97316' : '#10b981';
      const colorDrop2      = dropStage2Pct > 98 ? '#ef4444' : dropStage2Pct > 95 ? '#f97316' : '#10b981';

      clSummary.innerHTML = `
        <div class="cl-card">
          <div class="cl-label">1. Klik Iklan (FB)</div>
          <div class="cl-value" style="color:#3b82f6">${fmt(totalFbClicks)}</div>
          <div class="cl-sub">link clicks dari FB Ads</div>
        </div>
        <div class="cl-card">
          <div class="cl-label">↓ Hilang ${dropStage1Pct.toFixed(1)}%</div>
          <div class="cl-value" style="color:${colorDrop1}">${fmt(totalFbClicks - totalShopeeClk)}</div>
          <div class="cl-sub">tidak sampai ke Shopee</div>
        </div>
        <div class="cl-card">
          <div class="cl-label">2. Klik Masuk Shopee</div>
          <div class="cl-value" style="color:#8b5cf6">${fmt(totalShopeeClk)}</div>
          <div class="cl-sub">${state.clickReport.length > 0 ? 'dari Click Report (perujuk Facebook)' : 'dari Landing Page Views'}</div>
        </div>
        <div class="cl-card">
          <div class="cl-label">↓ Hilang ${dropStage2Pct.toFixed(1)}%</div>
          <div class="cl-value" style="color:${colorDrop2}">${fmt(totalShopeeClk - totalOrders)}</div>
          <div class="cl-sub">lihat tapi tidak order</div>
        </div>
        <div class="cl-card">
          <div class="cl-label">3. Order</div>
          <div class="cl-value" style="color:#10b981">${fmt(totalOrders)}</div>
          <div class="cl-sub">conv. rate: ${overallConv.toFixed(2)}%</div>
        </div>
      `;
      clSummary.style.display = 'grid';
    } else {
      clSummary.style.display = 'none';
    }
  }

  // -- Comparison Table --
  const tbody = document.getElementById('tbody-comparison');
  tbody.innerHTML = campaigns.map(c => {
    const convRate    = c.fb && c.fb.linkClicks>0 ? (c.orders/c.fb.linkClicks*100).toFixed(2)+'%' : '-';
    const roasTxt     = c.roas !== null ? c.roas.toFixed(2)+'x' : '-';
    const roasClass   = c.roas !== null ? colorRoas(c.roas) : '';
    const cpoTxt      = c.cpo !== null ? 'Rp '+fmt(c.cpo) : '-';
    const clickGap    = c.fb && c.fb.linkClicks>0 && c.orders>0 ? Math.round(c.fb.linkClicks/c.orders) : null;
    const clickGapCls = clickGap!==null ? (clickGap>100?'roas-negative':clickGap>50?'roas-neutral':'roas-positive') : '';
    // Funnel columns
    const fbKlik      = c.fb ? fmt(c.fbLinkClicks) : '-';
    const spClk       = c.stage2Value > 0 ? fmt(c.stage2Value) : '-';
    const dropPct     = (c.dropClickToShopeePct != null && isFinite(c.dropClickToShopeePct)) ? parseFloat(c.dropClickToShopeePct.toFixed(1)) : null;
    const dropClass   = dropPct!==null ? (dropPct>50?'roas-negative':dropPct>20?'roas-neutral':'roas-positive') : '';
    return `<tr>
      <td><strong>${esc(c.name)}</strong></td>
      <td>${c.fb ? fmt(c.fb.impressions) : '-'}</td>
      <td>${fbKlik}</td>
      <td>${spClk}</td>
      <td class="${dropClass}">${dropPct!==null ? dropPct+'%' : '-'}</td>
      <td class="${c.fb && c.fb.ctr>3?'roas-positive':c.fb && c.fb.ctr<1?'roas-negative':''}">${c.fb ? c.fb.ctr.toFixed(2)+'%' : '-'}</td>
      <td>${c.spent>0 ? 'Rp '+fmt(c.spent) : '-'}</td>
      <td>${c.orders}</td>
      <td>${convRate}</td>
      <td class="${clickGapCls}">${clickGap!==null ? clickGap+' klik/order' : '-'}</td>
      <td>${cpoTxt}</td>
      <td>Rp ${fmt(c.komisi)}</td>
      <td>${c.fb && c.fb.linkClicks > 0 ? 'Rp ' + fmt(c.komisi / c.fb.linkClicks * 1000) : '-'}</td>
      <td class="${roasClass}">${roasTxt}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="13" class="no-data">Tidak ada data</td></tr>';
}

function filterComparisonTable() {
  const q = document.getElementById('search-comparison').value.toLowerCase();
  document.querySelectorAll('#tbody-comparison tr').forEach(tr => {
    tr.style.display = tr.innerText.toLowerCase().includes(q) ? '' : 'none';
  });
}

// --- TREND TAB --------------------------------------------------
function renderTrendTab() {
  const byDate  = {};
  const fbNameSet = new Set(state.filteredFb.map(c => c.campaignName));
  const campaignColors = {};
  const palette = ['#6366f1','#10b981','#f97316','#3b82f6','#8b5cf6','#ef4444','#f59e0b','#06b6d4'];
  let colorIdx = 0;

  state.filteredShopee.forEach(r => {
    if (!r.date || !isCountableOrder(r)) return;
    const { key } = resolveShopeeKey(r, fbNameSet, state.mapping);
    if (!byDate[r.date]) byDate[r.date] = {};
    if (!byDate[r.date][key]) byDate[r.date][key] = { orders: new Set(), komisi: 0 };
    byDate[r.date][key].orders.add(r.orderId);
    byDate[r.date][key].komisi += r.komisiBersih;
    if (!campaignColors[key]) campaignColors[key] = palette[colorIdx++ % palette.length];
  });

  const allDates    = Object.keys(byDate).sort();
  const allCampaigns = [...new Set(Object.values(byDate).flatMap(d => Object.keys(d)))];

  destroyChart('trendOrders');
  const ctxTO = document.getElementById('chart-trend-orders');
  if (ctxTO) {
    const canvas = ensureCanvas(ctxTO);
    state.charts['trendOrders'] = new Chart(canvas, {
      type: 'line',
      data: {
        labels: allDates,
        datasets: allCampaigns.map(camp => ({
          label: camp,
          data: allDates.map(d => byDate[d]?.[camp] ? byDate[d][camp].orders.size : 0),
          borderColor: campaignColors[camp] || '#6366f1',
          backgroundColor: (campaignColors[camp] || '#6366f1') + '20',
          borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, fill: false, tension: 0.3,
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Jumlah Order' } },
          x: { title: { display: true, text: 'Tanggal' } }
        }
      }
    });
  }

  destroyChart('trendKomisi');
  const ctxTK = document.getElementById('chart-trend-komisi');
  if (ctxTK) {
    const canvas = ensureCanvas(ctxTK);
    let cumulative = 0;
    const dailyKomisi = allDates.map(d => {
      const dayTotal = Object.values(byDate[d] || {}).reduce((s, v) => s + v.komisi, 0);
      cumulative += dayTotal;
      return cumulative;
    });
    const dailyRaw = allDates.map(d =>
      Object.values(byDate[d] || {}).reduce((s, v) => s + v.komisi, 0)
    );

    state.charts['trendKomisi'] = new Chart(canvas, {
      type: 'line',
      data: {
        labels: allDates,
        datasets: [
          { label: 'Komisi Kumulatif (Rp)', data: dailyKomisi, borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', borderWidth: 2.5, fill: true, tension: 0.3, pointRadius: 4, yAxisID: 'y' },
          { label: 'Komisi Harian (Rp)',    data: dailyRaw,    borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', borderWidth: 1.5, fill: false, tension: 0.3, pointRadius: 3, borderDash: [4,3], yAxisID: 'y' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: {
          y: { title: { display: true, text: 'Komisi (Rp)' }, ticks: { callback: v => 'Rp' + fmtK(v) } },
          x: { title: { display: true, text: 'Tanggal' } }
        }
      }
    });
  }
}

// --- STATUS (helper data, ditampilkan di export Excel & Smart Report) ---
function computeStatusRows() {
  const byStatus = {};
  state.filteredShopee.forEach(r => {
    if (!byStatus[r.status]) byStatus[r.status] = { count: 0, komisi: 0, orders: new Set() };
    byStatus[r.status].orders.add(r.orderId);
    byStatus[r.status].komisi += r.komisiBersih;
  });
  return Object.entries(byStatus).map(([status, v]) => ({ status, count: v.orders.size, komisi: v.komisi }))
    .sort((a, b) => b.count - a.count);
}

// --- CLICK INSIGHTS: NEGARA & JAM --------------------------------
function renderClickInsights() {
  const geoWrap  = document.getElementById('chart-geo');
  const hourWrap = document.getElementById('chart-hours');
  if (!geoWrap || !hourWrap) return;

  // Order per jam (unique order, valid saja) — dari file komisi
  const ordersByHour = Array(24).fill(0);
  const orderHourMap = {};
  state.filteredShopee.forEach(r => {
    if (r.orderHour === null || r.orderHour === undefined) return;
    if (!orderHourMap[r.orderId]) orderHourMap[r.orderId] = { hour: r.orderHour, valid: false };
    if (isCountableOrder(r)) orderHourMap[r.orderId].valid = true;
  });
  Object.values(orderHourMap).forEach(o => { if (o.valid) ordersByHour[o.hour]++; });

  const hasClicks = state.filteredClicks && state.filteredClicks.length > 0;
  const hasOrders = ordersByHour.some(v => v > 0);

  if (!hasClicks && !hasOrders) {
    destroyChart('geo');
    destroyChart('hours');
    geoWrap.innerHTML  = '<div class="chart-empty">Upload Shopee Click Report untuk melihat distribusi negara.</div>';
    hourWrap.innerHTML = '<div class="chart-empty">Upload Click Report atau file komisi untuk melihat distribusi jam.</div>';
    return;
  }

  // Klik per negara (top 10) — butuh Click Report
  if (hasClicks) {
    const byGeo = {};
    state.filteredClicks.forEach(c => {
      const key = c.wilayah && c.wilayah !== '-' ? c.wilayah : '(tidak diketahui)';
      byGeo[key] = (byGeo[key] || 0) + 1;
    });
    const geoList = Object.entries(byGeo).sort((a, b) => b[1] - a[1]).slice(0, 10);
    destroyChart('geo');
    const geoCanvas = ensureCanvas(geoWrap);
    state.charts['geo'] = new Chart(geoCanvas, {
      type: 'bar',
      data: {
        labels: geoList.map(([g]) => g.length > 25 ? g.slice(0, 25) + '…' : g),
        datasets: [{ label: 'Klik', data: geoList.map(([, v]) => v), backgroundColor: '#8b5cf6', borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, title: { display: true, text: 'Jumlah Klik' } } }
      }
    });
  } else {
    destroyChart('geo');
    geoWrap.innerHTML = '<div class="chart-empty">Upload Shopee Click Report untuk melihat distribusi negara.</div>';
  }

  // Klik vs Order per jam (00-23) — bandingin jam klik iklan vs jam order masuk
  const byHour = Array(24).fill(0);
  state.filteredClicks.forEach(c => {
    const h = parseInt((c.waktuKlik || '').slice(11, 13), 10);
    if (!isNaN(h) && h >= 0 && h <= 23) byHour[h]++;
  });
  const maxHour = Math.max(...byHour);
  const maxOrders = Math.max(...ordersByHour);
  destroyChart('hours');
  const hourCanvas = ensureCanvas(hourWrap);
  const hourDatasets = [
    { label: 'Klik', data: byHour, backgroundColor: byHour.map(v => maxHour > 0 && v === maxHour ? '#1d4ed8' : '#3b82f6'), borderRadius: 3 }
  ];
  if (hasOrders) {
    hourDatasets.push({ type: 'line', label: 'Order', data: ordersByHour, yAxisID: 'y2',
      borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.15)', borderWidth: 2.5,
      pointRadius: 4, pointHoverRadius: 6, tension: 0.3, fill: true,
      datalabels: { display: true, align: 'top', offset: 2, color: '#10b981',
        font: { size: 10, weight: 700 }, formatter: (v) => v > 0 ? v : '' } });
  }
  state.charts['hours'] = new Chart(hourCanvas, {
    type: 'bar',
    data: {
      labels: byHour.map((_, h) => String(h).padStart(2, '0')),
      datasets: hourDatasets
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false }, // tooltip nampilin Klik + Order sekaligus
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (ctx) => {
        const total = ctx.dataset.data[ctx.dataIndex];
        return `${ctx.dataset.label}: ${fmt(total)}`;
      } } } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'Klik' } },
        y2: hasOrders ? { position: 'right', beginAtZero: true, suggestedMax: Math.max(4, maxOrders + 1),
          title: { display: true, text: 'Order' }, grid: { drawOnChartArea: false },
          ticks: { precision: 0, color: '#10b981' } } : undefined,
        x: { title: { display: true, text: 'Jam (00-23)' } }
      }
    }
  });
}

// --- PER AD / AD SET (butuh export level Ad) ---------------------
// Tag ditanam di NAMA ad — join antara file komisi Shopee dan export FB level Ad.
function computeAdRows() {
  const ads = state.filteredFbAds || [];
  if (ads.length === 0) return [];

  // penjualan per tag (dari file komisi, unique order valid)
  const salesByTag = {};
  state.filteredShopee.forEach(r => {
    const tag = (r.tag1 || r.tag3 || '').trim();
    if (!tag) return;
    if (!salesByTag[tag]) salesByTag[tag] = { orders: new Set(), komisi: 0 };
    if (isCountableOrder(r)) salesByTag[tag].orders.add(r.orderId);
    salesByTag[tag].komisi += r.komisiBersih;
  });
  const tags = Object.keys(salesByTag);
  const tagForAd = (adName) => {
    const lower = String(adName || '').toLowerCase();
    let best = null;
    for (const t of tags) {
      const lt = t.toLowerCase();
      const i = lower.indexOf(lt);
      if (i < 0) continue;
      // guard 'gacoan010' tidak boleh match 'gacoan01': huruf/angka nempel setelah tag = bukan
      if (/[a-z0-9]/.test(lower.charAt(i + lt.length))) continue;
      if (!best || lt.length > best.length) best = t;
    }
    return best;
  };

  // agregat per ad (lintas tanggal dalam rentang filter)
  const byAd = {};
  ads.forEach(a => {
    if (!byAd[a.adName]) byAd[a.adName] = { adName: a.adName, adSetName: a.adSetName || '-', campaignName: a.campaignName || '-', spent: 0, linkClicks: 0, impressions: 0 };
    byAd[a.adName].spent += a.spent || 0;
    byAd[a.adName].linkClicks += a.linkClicks || 0;
    byAd[a.adName].impressions += a.impressions || 0;
  });

  const ppn = document.getElementById('ppn-toggle')?.checked ? 1.11 : 1;
  const rows = Object.values(byAd).map(a => {
    const tag = tagForAd(a.adName);
    const sale = tag ? salesByTag[tag] : null;
    const orders = sale ? sale.orders.size : null;
    const komisi = sale ? sale.komisi : null;
    const spent = a.spent * ppn;
    const roas = spent > 0 && komisi !== null ? komisi / spent : null;
    const cpo = spent > 0 && orders ? spent / orders : null;
    return { ...a, spent, orders, komisi, roas, cpo, tag, matched: !!tag };
  });
  // ad dengan ROAS dulu (keputusan), tanpa data menyusul
  rows.sort((a, b) => (b.roas ?? -1) - (a.roas ?? -1));
  state._adMatchStats = { unmatched: rows.filter(r => !r.matched).map(r => r.adName) };
  return rows;
}

function renderAdsTable() {
  const card = document.getElementById('ads-table-card');
  const tbody = document.getElementById('tbody-ads');
  if (!card || !tbody) return;
  const rows = computeAdRows();
  if (rows.length === 0) {
    card.style.display = 'none';
    state._adMatchStats = null;
    return;
  }
  card.style.display = 'block';
  tbody.innerHTML = rows.map(r => {
    const roasTxt = r.roas !== null ? r.roas.toFixed(2) + 'x' : '-';
    return `<tr>
      <td><strong>${esc(r.adName)}</strong>${r.tag ? ' <span class="badge badge-blue" style="font-size:10px">' + esc(r.tag) + '</span>' : ''}</td>
      <td>${esc(r.adSetName)}</td>
      <td>${r.spent > 0 ? 'Rp ' + fmt(r.spent) : '-'}</td>
      <td>${fmt(r.linkClicks)}</td>
      <td>${r.orders !== null ? r.orders : '-'}</td>
      <td>${r.komisi !== null ? 'Rp ' + fmt(r.komisi) : '-'}</td>
      <td class="${r.roas !== null ? colorRoas(r.roas) : ''}">${roasTxt}</td>
      <td>${getStatusBadge(r.roas, r.spent)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="no-data">Tidak ada data ad</td></tr>';
}

// --- SANITY WARNINGS (guard data aneh) ---------------------------
function renderSanity() {
  const el = document.getElementById('sanity-warnings');
  if (!el) return;
  const warns = [];

  // 0a. Sesi dari versi parser lama — fitur baru butuh data yang di-parse ulang
  if (state.sessionStale) {
    warns.push({ type: 'warn', icon: '📦',
      text: `<strong>Sesi ini dibuat dengan versi aplikasi lama.</strong> Beberapa fitur baru (mis. analisis order per jam) butuh data yang di-parse ulang. Klik <strong>↩️ Upload Ulang</strong> lalu upload file yang sama — semua angka tetap, malah lebih lengkap.` });
  }

  // 0. Baris komisi identik yang dibuang saat upload
  if (state.shopeeDupCount > 0) {
    warns.push({ type: 'warn', icon: '📄',
      text: `<strong>${state.shopeeDupCount} baris komisi identik dibuang</strong> — kemungkinan lo upload file komisi yang periodenya overlap. Angka di dashboard sudah dibersihkan.` });
  }

  // 1. Kemungkinan spend dobel: campaign+tanggal sama muncul >1x di data FB
  //    (baris dari file breakdown dikecualikan — multi baris per campaign itu wajarnya)
  const seen = new Map();
  state.filteredFb.filter(c => !c._fromBreakdown).forEach(c => {
    if (!c.date) return;
    const k = c.campaignName + '|' + c.date;
    seen.set(k, (seen.get(k) || 0) + 1);
  });
  const dups = [...seen.entries()].filter(([, n]) => n > 1);
  if (dups.length > 0) {
    const totalDup = dups.reduce((s, [, n]) => s + (n - 1), 0);
    const [name, date] = dups[0][0].split('|');
    warns.push({ type: 'warn', icon: '⚠️',
      text: `<strong>Kemungkinan spend dobel:</strong> ${dups.length} kombinasi campaign+tanggal muncul lebih dari 1x (total ${totalDup} baris berlebih). Contoh: <strong>${esc(name)}</strong> tanggal ${esc(date)} muncul ${dups[0][1]}x. Cek apakah ada file FB Ads yang periodenya overlap.` });
  }

  // 1b. File FB agregat multi-hari: angka = total seluruh rentang, bukan per hari
  const ranged = state.filteredFb.filter(c => c.endDate && c.date && c.endDate > c.date);
  if (ranged.length > 0) {
    const r0 = ranged[0];
    warns.push({ type: 'info', icon: '📆',
      text: `File FB Ads berisi <strong>rentang multi-hari</strong> (${esc(r0.date)} s/d ${esc(r0.endDate)}) — angka campaign adalah <strong>total seluruh rentang</strong>, bukan per hari. Kalau mau analisis per hari, export FB per tanggal.` });
  }

  // 2. Order nyangkut di tag yang gak match campaign FB manapun
  if (state.filteredFb.length > 0) {
    buildCampaignData()
      .filter(c => !c.fb && c.orders > 0 && c.name !== '(tidak ada tag)')
      .forEach(c => {
        warns.push({ type: 'warn', icon: '🔗',
          text: `<strong>${esc(c.name)}</strong>: ${c.orders} order (komisi Rp ${fmt(c.komisi)}) gak match campaign FB manapun — komisi ini gak kebanding sama spend-nya. Buka <strong>⚙️ Mapping</strong> buat nyambungin.` });
      });
  }

  // 2b. Ad yang gak punya tag di namanya — order-nya gak bisa diatribusi
  const adStats = state._adMatchStats;
  if (adStats && adStats.unmatched.length > 0) {
    warns.push({ type: 'warn', icon: '🏷️',
      text: `<strong>${adStats.unmatched.length} ad gak punya tag yang dikenali di namanya</strong> (contoh: <strong>${esc(adStats.unmatched[0])}</strong>) — sales dari ad ini gak bisa dihitung. Pakai naming convention: taruh tag (mis. gacoan01) di nama ad, lalu export ulang level Ad.` });
  }

  // 3. Coverage Click Report vs periode data
  if (state.clickReport.length > 0 && state.filteredClicks.length > 0) {
    const shopeeDays = new Set(state.filteredShopee.map(r => r.date).filter(Boolean));
    const clickDays = new Set(state.filteredClicks.map(c => c.date).filter(Boolean));
    if (shopeeDays.size > 0 && clickDays.size < shopeeDays.size) {
      warns.push({ type: 'info', icon: 'ℹ️',
        text: `Click Report cuma cover <strong>${clickDays.size} dari ${shopeeDays.size} hari</strong> — funnel tahap 2 (klik masuk Shopee) bisa lebih kecil dari kenyataan. Download Click Report untuk periode penuh kalau mau funnel akurat.` });
    }
  } else if (state.clickReport.length === 0 && state.filteredFb.some(c => c.landingPageViews > 0)) {
    warns.push({ type: 'info', icon: 'ℹ️',
      text: `Funnel tahap 2 sekarang pakai <strong>Landing Page Views</strong> dari FB (proxy kasar). Upload <strong>Shopee Website Click Report</strong> biar jumlah klik masuk Shopee akurat.` });
  }

  if (warns.length === 0) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = warns.map(w => `<div class="sanity-item sanity-${w.type}"><span>${w.icon}</span><span>${w.text}</span></div>`).join('');
}

// --- PERJALANAN ROAS (dari riwayat snapshot) ---------------------
function renderRoasJourney() {
  const wrap = document.getElementById('chart-history-roas');
  if (!wrap) return;
  const hist = (state.history || []).filter(h => h.roas !== null && h.roas !== undefined)
    .sort((a, b) => (a.end || '').localeCompare(b.end || ''));
  destroyChart('roasJourney');
  if (hist.length < 2) {
    wrap.innerHTML = '<div class="chart-empty">Belum cukup riwayat — lakukan analisis di minimal 2 periode berbeda (mis. minggu lalu & minggu ini), nanti perjalanan ROAS lo muncul di sini otomatis.</div>';
    return;
  }
  const canvas = ensureCanvas(wrap);
  state.charts['roasJourney'] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: hist.map(h => h.start ? `${(h.start || '').slice(5)} → ${(h.end || '').slice(5)}` : new Date(h.savedAt).toLocaleDateString('id-ID')),
      datasets: [
        { label: 'ROAS', data: hist.map(h => +h.roas.toFixed(2)), borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, fill: true, tension: 0.3 },
        { label: 'Break-even (1x)', data: hist.map(() => 1), borderColor: '#94a3b8', borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => {
        if (ctx.datasetIndex !== 0) return 'Break-even';
        const h = hist[ctx.dataIndex];
        return [`ROAS: ${h.roas.toFixed(2)}x`, `Spend: Rp${fmtK(h.spent)}`, `Komisi: Rp${fmtK(h.komisi)}`, `Orders: ${h.orders}`];
      } } } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => parseFloat(v).toFixed(1) + 'x' } } }
    }
  });
}

// --- FB BREAKDOWN: AGE / GENDER / PLATFORM / REGION -------------
function renderFbBreakdown() {
  const wrapAge = document.getElementById('chart-fb-age');
  const wrapGender = document.getElementById('chart-fb-gender');
  const wrapPlatform = document.getElementById('chart-fb-platform');
  const wrapRegion = document.getElementById('chart-fb-region');
  const secEl = document.getElementById('fb-breakdown-section');
  const emptyEl = document.getElementById('fb-breakdown-empty');
  const emptyText = document.getElementById('fb-breakdown-empty-text');
  if (!wrapAge || !wrapGender || !wrapPlatform || !wrapRegion) return;

  const bd = state.filteredFbBreakdown || [];
  if (bd.length === 0) {
    ['fbAge', 'fbGender', 'fbPlatform', 'fbRegion'].forEach(k => destroyChart(k));
    if (secEl) secEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'flex';
    if (emptyText) emptyText.innerHTML = 'Belum ada data breakdown. Di <strong>Ads Manager → Reports → Breakdown</strong>: pilih <strong>Usia & Gender</strong> (satu file), atau <strong>Wilayah / Platform</strong> lewat Breakdown → By Delivery (file terpisah). Export CSV, lalu upload sebagai file FB Ads tambahan — boleh beberapa file breakdown sekaligus, spend tidak akan dobel hitung.';
    return;
  }
  if (secEl) secEl.style.display = 'block';
  if (emptyEl) emptyEl.style.display = 'none';

  const agg = (keyFn, order) => {
    const m = {};
    const ppn = document.getElementById('ppn-toggle')?.checked ? 1.11 : 1; // konsisten dgn spend di metrik lain
    bd.forEach(r => {
      const k = keyFn(r);
      if (!k) return;
      if (!m[k]) m[k] = { clicks: 0, spent: 0 };
      m[k].clicks += r.linkClicks;
      m[k].spent += r.spent * ppn;
    });
    let entries = Object.entries(m);
    if (order) entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    else entries.sort((a, b) => b[1].clicks - a[1].clicks);
    return entries;
  };

  // AGE — urut sesuai rentang usia
  const ageData = agg(r => r.age, FB_AGE_ORDER.concat('unknown'));
  destroyChart('fbAge');
  const ageCanvas = ensureCanvas(wrapAge);
  state.charts['fbAge'] = new Chart(ageCanvas, {
    type: 'bar',
    data: { labels: ageData.map(([k]) => k), datasets: [{ label: 'Klik', data: ageData.map(([, v]) => v.clicks), backgroundColor: '#6366f1', borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => { const d = ageData[ctx.dataIndex][1]; return [`${fmt(d.clicks)} klik`, `Spend Rp${fmtK(d.spent)}`]; } } } }, scales: { y: { beginAtZero: true } } }
  });

  // GENDER — doughnut
  const genderData = agg(r => r.gender);
  const genderColors = { 'Laki-laki': '#3b82f6', 'Perempuan': '#ec4899', 'Tidak diketahui': '#94a3b8' };
  destroyChart('fbGender');
  const genderCanvas = ensureCanvas(wrapGender);
  state.charts['fbGender'] = new Chart(genderCanvas, {
    type: 'doughnut',
    data: { labels: genderData.map(([k]) => k), datasets: [{ data: genderData.map(([, v]) => v.clicks), backgroundColor: genderData.map(([k]) => genderColors[k] || '#64748b'), hoverOffset: 8 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (ctx) => { const d = genderData[ctx.dataIndex][1]; return `${ctx.label}: ${fmt(d.clicks)} klik (Spend Rp${fmtK(d.spent)})`; } } } } }
  });

  // PLATFORM
  const platData = agg(r => r.platform);
  destroyChart('fbPlatform');
  const platCanvas = ensureCanvas(wrapPlatform);
  state.charts['fbPlatform'] = new Chart(platCanvas, {
    type: 'bar',
    data: { labels: platData.map(([k]) => k), datasets: [{ label: 'Klik', data: platData.map(([, v]) => v.clicks), backgroundColor: '#10b981', borderRadius: 4 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => { const d = platData[ctx.dataIndex][1]; return [`${fmt(d.clicks)} klik`, `Spend Rp${fmtK(d.spent)}`]; } } } }, scales: { x: { beginAtZero: true } } }
  });

  // REGION — top 8
  const regData = agg(r => r.region).slice(0, 8);
  destroyChart('fbRegion');
  const regCanvas = ensureCanvas(wrapRegion);
  state.charts['fbRegion'] = new Chart(regCanvas, {
    type: 'bar',
    data: { labels: regData.map(([k]) => k.length > 30 ? k.slice(0, 30) + '…' : k), datasets: [{ label: 'Klik', data: regData.map(([, v]) => v.clicks), backgroundColor: '#f97316', borderRadius: 4 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => { const d = regData[ctx.dataIndex][1]; return [`${fmt(d.clicks)} klik`, `Spend Rp${fmtK(d.spent)}`]; } } } }, scales: { x: { beginAtZero: true } } }
  });
}

// --- TABLES: SORT & SEARCH --------------------------------------
function sortTable(tableId, colIdx) {
  const table = document.getElementById(tableId);
  const tbody = table.querySelector('tbody');
  const rows  = Array.from(tbody.querySelectorAll('tr'));
  const key   = tableId + '-' + colIdx;
  state.sortDir[key] = !state.sortDir[key];

  const parse = (s) => {
    const raw = String(s).replace(/[^0-9.\-]/g, '');
    // Format id-ID: titik = pemisah ribuan ('501.234', '1.234.567'), bukan desimal.
    // Pola ini aman karena ROAS/CTR tampil 2 desimal ('0.75', '2.14') sehingga tidak kena.
    if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) return parseFloat(raw.replace(/\./g, ''));
    const n = parseNum(raw);
    return isNaN(n) ? String(s).toLowerCase() : n;
  };

  rows.sort((a, b) => {
    const ta = parse(a.cells[colIdx]?.innerText || '');
    const tb = parse(b.cells[colIdx]?.innerText || '');
    if (ta < tb) return state.sortDir[key] ? -1 : 1;
    if (ta > tb) return state.sortDir[key] ?  1 : -1;
    return 0;
  });
  rows.forEach(r => tbody.appendChild(r));
}

function filterCampaignTable() {
  const q = document.getElementById('search-campaign').value.toLowerCase();
  document.querySelectorAll('#tbody-campaign tr').forEach(tr => {
    tr.style.display = tr.innerText.toLowerCase().includes(q) ? '' : 'none';
  });
}

function filterProductTable() {
  const q = document.getElementById('search-product').value.toLowerCase();
  document.querySelectorAll('#tbody-product tr').forEach(tr => {
    tr.style.display = tr.innerText.toLowerCase().includes(q) ? '' : 'none';
  });
}

// --- EXPORT: CSV & PNG ------------------------------------------
// Excel multi-sheet: Ringkasan + Per Campaign + Per Produk + Status + Riwayat
function exportExcel() {
  try {
    const camps = buildCampaignData().filter(c => c.spent > 0 || c.orders > 0);
    if (camps.length === 0) { alert('Belum ada data buat diexport.'); return; }
    const wb = XLSX.utils.book_new();

    // Ringkasan
    const totalSpent = camps.reduce((s, c) => s + c.spent, 0);
    const totalKomisi = camps.reduce((s, c) => s + c.komisi, 0);
    const st = computeStatusRows();
    const cair = st.filter(s => /selesai/i.test(s.status)).reduce((s, r) => s + r.komisi, 0);
    const pending = st.filter(s => /tertu|belum dibayar/i.test(s.status)).reduce((s, r) => s + r.komisi, 0);
    const start = document.getElementById('filter-start').value;
    const end = document.getElementById('filter-end').value;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { Metrik: 'Periode', Nilai: (start || '…') + ' s/d ' + (end || '…') },
      { Metrik: 'Total Spend FB', Nilai: Math.round(totalSpent) },
      { Metrik: 'Total Komisi Bersih', Nilai: Math.round(totalKomisi) },
      { Metrik: 'Profit / Loss', Nilai: Math.round(totalKomisi - totalSpent) },
      { Metrik: 'ROAS', Nilai: totalSpent > 0 ? +(totalKomisi / totalSpent).toFixed(2) : '' },
      { Metrik: 'Komisi Cair (Selesai)', Nilai: Math.round(cair) },
      { Metrik: 'Komisi Pending', Nilai: Math.round(pending) },
      { Metrik: 'Total Order Valid', Nilai: new Set(state.filteredShopee.filter(isCountableOrder).map(r => r.orderId)).size },
    ]), 'Ringkasan');

    // Per Campaign
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(camps.map(c => ({
      Campaign: c.name, Spend: Math.round(c.spent), Orders: c.orders,
      Komisi: Math.round(c.komisi), Profit: Math.round(c.profit),
      ROAS: c.roas !== null ? +c.roas.toFixed(2) : '',
      CPO: c.cpo !== null ? Math.round(c.cpo) : '',
      Impresi: c.fb ? c.fb.impressions : '', Klik_FB: c.fb ? c.fb.linkClicks : '',
      CTR_pct: c.fb ? +c.fb.ctr.toFixed(2) : '',
      Klik_Masuk_Shopee: c.stage2Value > 0 ? c.stage2Value : '',
      Klik_per_Order: (c.fb && c.fb.linkClicks > 0 && c.orders > 0) ? Math.round(c.fb.linkClicks / c.orders) : '',
      Komisi_per_1k_Klik: (c.fb && c.fb.linkClicks > 0) ? Math.round(c.komisi / c.fb.linkClicks * 1000) : '',
    }))), 'Per Campaign');

    // Per Produk
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(computeProductRows().map(p => ({
      Produk: p.name, Kategori: p.kategori, Orders: p.orders,
      Nilai_Pembelian: Math.round(p.nilai), Komisi: Math.round(p.komisi),
      Campaign: p.campaigns.join(', '),
    }))), 'Per Produk');

    // Status Pesanan
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(st.map(s => ({
      Status: s.status, Orders: s.count, Komisi: Math.round(s.komisi),
    }))), 'Status Pesanan');

    // Per Ad (kalau ada export level Ad)
    const adRows = computeAdRows();
    if (adRows.length > 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(adRows.map(a => ({
        Ad: a.adName, 'Ad Set': a.adSetName, Campaign: a.campaignName, Tag: a.tag || '',
        Spend: Math.round(a.spent), 'Klik FB': a.linkClicks,
        Orders: a.orders !== null ? a.orders : '',
        Komisi: a.komisi !== null ? Math.round(a.komisi) : '',
        ROAS: a.roas !== null ? +a.roas.toFixed(2) : '',
      }))), 'Per Ad');
    }

    // Riwayat
    if (state.history.length > 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.history.map(h => ({
        Periode: (h.start || '…') + ' s/d ' + (h.end || '…'),
        Spend: Math.round(h.spent), Komisi: Math.round(h.komisi),
        Profit: Math.round(h.profit), ROAS: h.roas !== null && h.roas !== undefined ? +h.roas.toFixed(2) : '',
        Orders: h.orders, Hari: h.days, Disimpan: new Date(h.savedAt).toLocaleString('id-ID'),
      }))), 'Riwayat');
    }

    XLSX.writeFile(wb, 'Affalitycs_' + (start || '') + (end ? '_' + end : '') + '.xlsx');
  } catch (e) { alert('Export Excel gagal: ' + e.message); }
}

function exportTableCSV(tableId, filename) {
  const trs = [...document.querySelectorAll('#' + tableId + ' tr')];
  if (trs.length === 0) { alert('Tabel masih kosong.'); return; }
  const csv = trs.map(tr => {
    return [...tr.querySelectorAll('th,td')].map(c => {
      const txt = (c.innerText || '').replace(/\s+/g, ' ').trim();
      return '"' + txt.replace(/"/g, '""') + '"';
    }).join(',');
  }).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM biar Excel baca UTF-8
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename + '_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportChartPNG(card) {
  const canvas = card.querySelector('.chart-wrap canvas');
  if (!canvas) { alert('Chart belum ter-render (belum ada data).'); return; }
  // Gambar ulang di canvas putih supaya PNG-nya gak transparan
  const tmp = document.createElement('canvas');
  tmp.width = canvas.width;
  tmp.height = canvas.height;
  const ctx = tmp.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tmp.width, tmp.height);
  ctx.drawImage(canvas, 0, 0);
  const title = (card.querySelector('.chart-title')?.childNodes[0]?.textContent || 'chart').trim();
  const a = document.createElement('a');
  a.href = tmp.toDataURL('image/png');
  a.download = title.replace(/[^\w\-]+/g, '_').slice(0, 50) + '.png';
  a.click();
}

// Tombol export di-inject otomatis ke semua chart card & table card
function setupExportButtons() {
  document.querySelectorAll('.chart-card').forEach(card => {
    const title = card.querySelector('.chart-title');
    if (!title || title.querySelector('.btn-export')) return;
    const btn = document.createElement('button');
    btn.className = 'btn-export';
    btn.type = 'button';
    btn.textContent = '⬇ PNG';
    btn.title = 'Download chart sebagai PNG';
    btn.addEventListener('click', () => exportChartPNG(card));
    title.appendChild(btn);
  });
  document.querySelectorAll('.table-card').forEach(card => {
    const header = card.querySelector('.table-header');
    const table = card.querySelector('table');
    if (!header || !table || header.querySelector('.btn-export')) return;
    const btn = document.createElement('button');
    btn.className = 'btn-export';
    btn.type = 'button';
    btn.textContent = '⬇ CSV';
    btn.title = 'Download tabel sebagai CSV (bisa dibuka di Excel)';
    btn.addEventListener('click', () => exportTableCSV(table.id, 'affalitycs_' + table.id.replace('tbl-', '')));
    header.appendChild(btn);
  });
}
setupExportButtons();

// --- TABS -------------------------------------------------------
function switchTab(tabName, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tabName).classList.add('active');
  btn.classList.add('active');
}

// --- FILTERS ----------------------------------------------------
function resetFilters() {
  const dates = state.shopeeRows.map(r => r.date).filter(Boolean).sort();
  if (dates.length > 0) {
    setRange(dates[0], dates[dates.length - 1]);
  }
  applyFilters();
}

function resetAll() {
  if (!confirm('Reset semua data dan kembali ke halaman upload?')) return;
  clearSession();
  shopeeFiles = []; fbFiles = []; clickFiles = [];
  state.shopeeRows = []; state.fbCampaigns = []; state.clickReport = [];
  state.fbBreakdown = []; state.filteredFbBreakdown = [];
  state.fbAds = []; state.filteredFbAds = [];
  state.shopeeDupCount = 0;
  state.filteredShopee = []; state.filteredFb = []; state.filteredClicks = [];
  Object.keys(state.charts).forEach(k => { try { state.charts[k].destroy(); } catch {} });
  state.charts = {};
  document.getElementById('status-shopee').textContent = 'Belum ada file';
  document.getElementById('status-shopee').className = 'upload-status';
  document.getElementById('status-fb').textContent = 'Belum ada file';
  document.getElementById('status-fb').className = 'upload-status';
  document.getElementById('drop-shopee').classList.remove('has-file');
  document.getElementById('drop-fb').classList.remove('has-file');
  try {
    document.getElementById('status-clicks').textContent = 'Belum ada file';
    document.getElementById('status-clicks').className = 'upload-status';
    document.getElementById('drop-clicks').classList.remove('has-file');
  } catch(e) {}
  document.getElementById('section-dashboard').style.display = 'none';
  document.getElementById('section-upload').style.display = 'block';
  updateAnalyzeBtn();
}

// --- CANVAS UTILITY ---------------------------------------------
function ensureCanvas(wrapper) {
  wrapper.innerHTML = '';
  const canvas = document.createElement('canvas');
  wrapper.appendChild(canvas);
  return canvas;
}

// --- DEMO DATA --------------------------------------------------
function loadDemoData() {
  showLoading('Memuat demo data...');

  const campaigns = ['cp01', 'cp02', 'cp03', 'cp04', 'cp05'];
  const statuses  = ['Tertunda', 'Tertunda', 'Tertunda', 'Selesai', 'Selesai', 'Dibatalkan', 'Belum Dibayar'];
  const products  = [
    ['Robot Flashdisk 32GB', 'Komputer & Aksesoris', 63500],
    ['Charger Dual 2A Robot', 'Handphone & Aksesoris', 55000],
    ['Acnes Creamy Wash 100gr', 'Perawatan & Kecantikan', 24500],
    ['Peci Embos Terbaru', 'Fashion Muslim', 12000],
    ['Kuas Cat 2 Inch', 'Perlengkapan Rumah', 8500],
    ['Barbel 3kg Sepasang', 'Olahraga & Outdoor', 95000],
    ['CDI GX160 Original', 'Perlengkapan Rumah', 32301],
    ['Power Bank 10000mAh', 'Handphone & Aksesoris', 89000],
    ['Baju Koko Premium', 'Fashion Muslim', 150000],
    ['Minyak Goreng 2L', 'Makanan & Minuman', 35000],
  ];

  const csvLines = ['ID Pemesanan;Status Pesanan;Kode Pesanan Affiliate;Waktu Pemesanan;Waktu Terselesaikan;Waktu Klik;Nama Toko;ID Shop;Tipe toko.;ID Barang;Nama Barange;ID Model;Tipe Produk;ID Promosi;L1 Kategori Global;L2 Kategori Global;L3 Kategori Global;Harga(Rp);Jumlah;Tipe Penawaran;Kampanye Partnerr;Nilai Pembelian(Rp);Jumlah Pengembalian Dana(Rp);Persentase Komisi Shopee pada Produk;Komisi Barang Shopee(Rp);Persentase Komisi XTRA pada Produk;Komisi XTRA Produk(Rp);Total Komisi per Produk(Rp);Komisi Shopee per Pesanan(Rp);Komisi XTRA per Pesanan(Rp);Total Komisi per Pesanan(Rp);Nama MCN Terhubung;ID Kontrak MCN;Persentase Biaya Manajemen MCN;Biaya Manajemen MCN(Rp);Persentase Pembagian Komisi Affiliate;Komisi Bersih Affiliate (Rp);Status Produk Affiliate;Catatan Produk;Tipe Pesanan;Status Pemebelian;Tag_link1;Tag_link2;Tag_link3;Tag_link4;Tag_link5;Platform'];

  let orderCounter = 1;
  const baseDate = new Date(2026, 3, 7); // April 7, 2026
  for (let day = 0; day < 7; day++) {
    const d  = new Date(baseDate);
    d.setDate(baseDate.getDate() + day);
    const dd   = String(d.getDate()).padStart(2, '0');
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const dateStr = `${dd}/${mm}/${yyyy}`;

    const ordersPerDay = Math.floor(Math.random() * 8) + 3;
    for (let o = 0; o < ordersPerDay; o++) {
      const orderId = `2604060DEMO${String(orderCounter).padStart(4,'0')}`;
      const cp     = campaigns[Math.floor(Math.random() * campaigns.length)];
      const prod   = products[Math.floor(Math.random() * products.length)];
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const komisi = Math.round(prod[2] * 0.02 + Math.random() * prod[2] * 0.03);
      csvLines.push(
        `${orderId};${status};2291870000000;${dateStr} ${10+Math.floor(Math.random()*12)}:${String(Math.floor(Math.random()*59)).padStart(2,'0')};;${dateStr} ${8+Math.floor(Math.random()*10)}:00;DemoStore;12345;Preferred(Non-CB);PROD123;${prod[0]};MODEL1;Normal Product;;${prod[1]};;;${prod[2]};1;Komisi Shopee;;${prod[2]};;1.50%;${(prod[2]*0.015).toFixed(0)};2.00%;${(prod[2]*0.02).toFixed(0)};${(prod[2]*0.035).toFixed(0)};${(prod[2]*0.015).toFixed(0)};${(prod[2]*0.02).toFixed(0)};${(prod[2]*0.035).toFixed(0)};;;0.00%;0;100.00%;${komisi};Aktif;-;Pesanan dari Toko yang tidak Dipromosikan;Ada;DemoTag;meta;${cp};;;Facebook`
      );
      orderCounter++;
    }
  }

  const fbData = [
    { name: 'cp01', spent: 36796, reach: 7106, impressions: 7300,  linkClicks: 511, cpc: 72.0,  cpm: 5040.5, ctr: 7.0, budget: 25000 },
    { name: 'cp02', spent: 40592, reach: 7032, impressions: 7032,  linkClicks: 652, cpc: 62.3,  cpm: 5772.5, ctr: 9.3, budget: 25000 },
    { name: 'cp03', spent: 23148, reach: 6062, impressions: 6352,  linkClicks: 547, cpc: 42.3,  cpm: 3644.2, ctr: 8.6, budget: 25000 },
    { name: 'cp04', spent: 0,     reach: 0,    impressions: 0,     linkClicks: 0,   cpc: 0,     cpm: 0,      ctr: 0,   budget: 25000 },
    { name: 'cp05', spent: 28510, reach: 9938, impressions: 10083, linkClicks: 208, cpc: 137.1, cpm: 2827.5, ctr: 2.1, budget: 25000 },
  ];

  state.shopeeRows   = parseShopeeCSV(csvLines.join('\n'));
  state.fbCampaigns  = fbData.map(d => ({
    campaignName: d.name, spent: d.spent, reach: d.reach,
    impressions: d.impressions, linkClicks: d.linkClicks,
    cpc: d.cpc, cpm: d.cpm, ctr: d.ctr,
    landingPageViews: d.linkClicks, budget: d.budget, delivery: 'active'
  }));

  state.mapping = {};
  state.clickReport = [];
  state.fbBreakdown = [];
  state.fbCampaigns.forEach(c => { state.mapping[c.campaignName] = c.campaignName; });

  setTimeout(() => { buildDashboard(); }, 300);
}
