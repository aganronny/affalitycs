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
  fbAds: [],             // Export FB level Ad (Ad name) — untuk tabel per-ad/adset
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
// dan semua parser ada di parsers.js (dipakai bersama unit test Node)
const colorRoas = (r) => r >= 2 ? 'roas-positive' : r >= 1 ? 'roas-neutral' : 'roas-negative';

// Order "valid" = bukan Belum Dibayar / Dibatalkan / Dikembalikan (untuk hitungan pesanan & funnel).
// Bisa dimatikan lewat toggle "Order valid saja" di filter bar.
const INVALID_ORDER_RE = /belum dibayar|dibatalkan|dikembalikan/i;
function isCountableOrder(r) {
  const t = document.getElementById('valid-orders-toggle');
  if (!t || !t.checked) return true;
  return !INVALID_ORDER_RE.test(r.status || '');
}

// Pajak / Biaya Tambahan (PPN 11%, Fee Sewa Akun Agency, Fee Payment, dsb.)
function getTaxFeePct() {
  const el = document.getElementById('tax-fee-input');
  if (!el) return 0;
  const val = parseFloat(el.value);
  return (isNaN(val) || val < 0) ? 0 : val;
}
function getTaxFeeRatio() {
  return 1 + (getTaxFeePct() / 100);
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
  // render ulang kalau dashboard sedang terbuka agar chart mengikuti tema
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
// Klik di dalam panel tidak boleh dianggap "klik luar" — listener dipasang di panel
// (bukan document) karena innerHTML panel diganti tiap klik, yang membuat target klik
// jadi detached node sehingga closest('.range-wrap') gagal di document listener.
const _rpPanelEl = document.getElementById('range-panel');
if (_rpPanelEl) _rpPanelEl.addEventListener('click', (ev) => ev.stopPropagation());
document.addEventListener('click', (ev) => {
  const panel = document.getElementById('range-panel');
  if (!panel || panel.style.display !== 'block') return;
  if (!ev.target.closest('.range-wrap')) closeRangePicker();
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeRangePicker(); });

// --- DROPDOWN MORE MENU -----------------------------------------
function toggleMoreMenu(ev) {
  if (ev) ev.stopPropagation();
  const menu = document.getElementById('dropdown-more-menu');
  if (!menu) return;
  menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
}

function closeMoreMenu() {
  const menu = document.getElementById('dropdown-more-menu');
  if (menu) menu.style.display = 'none';
}

document.addEventListener('click', (ev) => {
  if (!ev.target.closest('#dropdown-more-wrap')) {
    closeMoreMenu();
  }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closeMoreMenu();
});

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
    // Dedup baris identik — file komisi yang overlap tidak boleh dihitung ganda
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
      const ads = extractFbAdRows(raw);
      let camps = extractFbRows(raw);
      // file ad-level tanpa kolom "Campaign name" → agregat campaign disintesis dari ad
      if (camps.length === 0 && ads.length > 0) camps = synthesizeCampaignRowsFromAds(ads);
      const bd = extractFbBreakdown(raw);
      // file ad-level & breakdown = sumber multi-baris per campaign (sah)
      camps.forEach(r => { r._fileIdx = fbFileIdx; r._fromBreakdown = bd.length > 0 || ads.length > 0; });
      state.fbCampaigns.push(...camps);
      state.fbBreakdown.push(...bd);
      state.fbAds.push(...ads);
      fbFileIdx++;
    }
    // Cegah biaya iklan terhitung ganda antara file ad-level/breakdown & file campaign biasa
    state.fbCampaigns = resolveFbCampaignRows(state.fbCampaigns);

    // Parse Website Click Report
    state.clickReport = [];
    for (const f of clickFiles) {
      const text = await readAsText(f);
      state.clickReport.push(...parseClickReportCSV(text));
    }
    // Dedup klik ID — beberapa file click report yang periodenya tumpang tindih tidak dihitung ganda
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

    const fbNameSet = new Set([
      ...state.fbCampaigns.map(c => c.campaignName),
      ...(state.fbAds || []).map(a => a.adName),
      ...(state.fbAds || []).map(a => a.adSetName),
      ...(state.fbAds || []).map(a => a.campaignName)
    ].filter(Boolean));
    const savedMapping = loadMapping();
    state.mapping = { ...savedMapping };

    const allShopeeTags = new Set();
    state.shopeeRows.forEach(r => {
      if (r.tag3 && r.tag3 !== '-') allShopeeTags.add(r.tag3);
      if (r.tag1 && r.tag1 !== '-') allShopeeTags.add(r.tag1);
    });

    const fbNormMap = {};
    fbNameSet.forEach(name => { fbNormMap[normalizeName(name)] = name; });

    allShopeeTags.forEach(tag => {
      if (state.mapping[tag]) return;
      if (fbNameSet.has(tag)) { state.mapping[tag] = tag; return; }
      const normTag = normalizeName(tag);
      if (!normTag) return;
      if (fbNormMap[normTag]) { state.mapping[tag] = fbNormMap[normTag]; return; }
      const partial = Object.entries(fbNormMap).find(([normFb]) =>
        normFb && (normFb.includes(normTag) || normTag.includes(normFb))
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
    alert('Terjadi kesalahan saat memproses file: ' + err.message + '\n\nBuka Console (F12) untuk detail.');
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
  if (modalTitle) modalTitle.textContent = showAll ? 'Semua Tag Shopee' : 'Mapping Campaign';

  if (unmatchedTags.length === 0) {
    container.innerHTML = '<p style="color:#64748b;text-align:center;padding:20px">Semua tag sudah terpetakan otomatis</p>';
    document.getElementById('mapping-modal').style.display = 'flex';
    return;
  }

  unmatchedTags.forEach(tag => {
    const currentMap = state.mapping[tag];
    const row = document.createElement('div');
    row.className = 'mapping-row';
    const autoLabel = currentMap ? `<span style="font-size:11px;color:#10b981;margin-left:6px">auto</span>` : '';
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
    } else {
      delete state.mapping[tag];
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
  const fbNameSet = new Set([
    ...state.fbCampaigns.map(c => c.campaignName),
    ...(state.fbAds || []).map(a => a.adName),
    ...(state.fbAds || []).map(a => a.adSetName),
    ...(state.fbAds || []).map(a => a.campaignName)
  ].filter(Boolean));
  const allTags = new Set();
  state.shopeeRows.forEach(r => {
    if (r.tag3 && r.tag3 !== '-') allTags.add(r.tag3);
    if (r.tag1 && r.tag1 !== '-') allTags.add(r.tag1);
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
// Data upload disimpan lokal di browser agar refresh tidak perlu unggah ulang.
// Murni storage browser ini — tidak ada data yang dikirim ke mana pun.
// PARSER_VERSION naik tiap kali format hasil parse berubah — sesi lama
// dikasih warning agar diketahui harus mengunggah ulang.
const PARSER_VERSION = 3;
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
      filterStart: document.getElementById('filter-start')?.value || '',
      filterEnd: document.getElementById('filter-end')?.value || '',
      taxFee: getTaxFeePct(),
      validOrders: document.getElementById('valid-orders-toggle')?.checked !== false,
    };
    db.transaction('session', 'readwrite').objectStore('session').put(data, 'current');
  } catch (e) { /* storage tidak tersedia (mis. private mode) — abaikan */ }
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
    // Otomatis pulihkan sesi terakhir agar data langsung tampil tanpa perlu klik banner
    await restoreSession();
  } catch (e) {
    console.warn('checkResume error:', e);
  }
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
  const feeInput = document.getElementById('tax-fee-input');
  if (feeInput) {
    feeInput.value = s.taxFee !== undefined ? s.taxFee : (s.ppn ? 11 : 0);
  }
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
// Data terkurung di browser perangkat ini — cadangan membuat data portabel.
function backupData() {
  try {
    const bundle = {
      app: 'affalitycs', version: 1, exportedAt: new Date().toISOString(),
      history: state.history || [],
      mapping: loadMapping(),
    };
    const ses = {
      savedAt: Date.now(),
      parserVersion: PARSER_VERSION,
      shopeeRows: state.shopeeRows, fbCampaigns: state.fbCampaigns,
      fbBreakdown: state.fbBreakdown, fbAds: state.fbAds || [], clickReport: state.clickReport,
      filterStart: document.getElementById('filter-start')?.value || '',
      filterEnd: document.getElementById('filter-end')?.value || '',
      taxFee: getTaxFeePct(),
      ppn: getTaxFeePct() > 0,
      validOrders: document.getElementById('valid-orders-toggle')?.checked !== false,
    };
    if (ses.shopeeRows.length || ses.fbCampaigns.length || ses.clickReport.length) bundle.session = ses;
    const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'affalitycs-backup-' + todayYmd().replace(/-/g, '') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { alert('Pencadangan gagal: ' + e.message); }
}

async function restoreData(file) {
  try {
    const bundle = JSON.parse(await file.text());
    if (!bundle || bundle.app !== 'affalitycs') { alert('File ini bukan cadangan Affalitycs.'); return; }
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
    alert('Pemulihan selesai: ' + nHist + ' snapshot riwayat dipulihkan.');
    renderAll();
  } catch (e) { alert('Pemulihan gagal — file rusak atau bukan cadangan yang valid. (' + e.message + ')'); }
}

checkResume();

// --- BUILD DASHBOARD --------------------------------------------
function buildDashboard(opts = {}) {
  showLoading('Membangun dashboard...');

  const allDates = [
    ...state.shopeeRows.map(r => r.date),
    ...state.fbCampaigns.map(c => c.date),
    ...(state.fbAds || []).map(a => a.date),
  ].filter(Boolean).sort();

  const minDate = allDates[0] || '';
  const maxDate = allDates[allDates.length - 1] || '';

  const curStart = document.getElementById('filter-start')?.value || '';
  const curEnd   = document.getElementById('filter-end')?.value || '';

  // Jika tidak minta keepFilters, atau filter saat ini kosong / di luar rentang tanggal data baru:
  const isOutOfRange = !curStart || !curEnd || (minDate && curEnd < minDate) || (maxDate && curStart > maxDate);

  if (!opts.keepFilters || isOutOfRange) {
    if (minDate && maxDate) {
      setRange(minDate, maxDate);
    }
  }

  setTimeout(() => {
    applyFilters();
    document.getElementById('section-upload').style.display = 'none';
    document.getElementById('section-dashboard').style.display = 'block';
    setupSectionNavObserver();
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
  const rawStart = document.getElementById('filter-start')?.value || '';
  const rawEnd   = document.getElementById('filter-end')?.value || '';
  const start = normDateInput(rawStart);
  const end   = normDateInput(rawEnd);

  console.log('[Filter] start:', JSON.stringify(start), 'end:', JSON.stringify(end));
  console.log('[Filter] total rows:', state.shopeeRows.length);

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
    // FB has daily data, filter exactly like Shopee —
    // baris multi-hari (ada endDate) cukup rentangnya NIMPA window filter
    state.filteredFb = state.fbCampaigns.filter(c => {
      const s = c.date || '', e = c.endDate || c.date || '';
      if (!s && !e) return true;
      if (start && e < start) return false;
      if (end && s > end) return false;
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
  // Safety guard: jika ada data Shopee tapi hasil filter 0 baris (karena filter tanggal basi/di luar rentang data baru)
  if (state.shopeeRows.length > 0 && state.filteredShopee.length === 0) {
    console.warn('[Filter] Filter tanggal basi (0 baris ditemukan). Me-reset otomatis ke seluruh rentang data.');
    const allDates = [...new Set(state.shopeeRows.map(r => r.date).filter(Boolean))].sort();
    if (allDates.length > 0) {
      setRange(allDates[0], allDates[allDates.length - 1]);
      state.filteredShopee = state.shopeeRows;
      state.filteredFb = state.fbCampaigns;
      state.filteredFbAds = state.fbAds;
      state.filteredClicks = state.clickReport;
      state.dateRatio = 1;
    }
  }

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
  try { renderTrendTab(); } catch(e) { console.warn('renderTrendTab:', e); }
  try { renderClickInsights(); } catch(e) { console.warn('renderClickInsights:', e); }
  try { renderSanity(); } catch(e) { console.warn('renderSanity:', e); }
  try { renderRoasJourney(); } catch(e) { console.warn('renderRoasJourney:', e); }
}

// --- TAG HELPER FOR ADS ----------------------------------------
function tagForAd(adName, knownTags = null) {
  if (!adName) return null;
  const lower = String(adName).toLowerCase();
  const nAd = normalizeName(adName);
  const tags = knownTags || [...new Set([
    ...state.shopeeRows.map(r => (r.tag1 || '').trim()),
    ...state.shopeeRows.map(r => (r.tag3 || '').trim()),
    ...state.clickReport.map(c => (c.tag1 || c.tagLink || '').trim()),
  ])].filter(t => t && t !== '-' && t !== '--');

  let best = null;
  for (const t of tags) {
    const lt = t.toLowerCase();
    const nT = normalizeName(t);
    if (!nT) continue;
    let hit = false;
    const i = lower.indexOf(lt);
    if (i >= 0 && !/\d/.test(lower.charAt(i + lt.length))) hit = true;
    if (!hit) {
      const j = nAd.indexOf(nT);
      if (j >= 0 && !/\d/.test(nAd.charAt(j + nT.length))) hit = true;
    }
    if (hit && (!best || lt.length > best.length)) best = t;
  }
  return best;
}

// --- MERGE SHOPEE + FB (UNIFIED AUTHORITATIVE PIPELINE) ---------
function buildCampaignData() {
  const masterRows = computeMasterTableRows();
  return masterRows.map(r => ({
    name: r.adDisplay !== '-' ? r.adDisplay : r.campaignDisplay,
    campaignName: r.campaignDisplay,
    adSetName: r.adSetDisplay,
    spent: r.spent,
    komisi: r.komisi,
    orders: r.orders,
    profit: r.profit,
    roas: r.roas,
    cpo: r.cpo,
    fbLinkClicks: r.linkClicks,
    stage2Value: r.shopeeClicks,
    dropClickToShopeePct: r.dropPct,
    dropClickToShopee: (r.linkClicks > 0 && r.shopeeClicks !== null) ? Math.max(0, r.linkClicks - r.shopeeClicks) : 0,
    cpcShopee: r.realCpc,
    komisiPerOrder: r.orders > 0 ? (r.komisi / r.orders) : null,
    fb: r.delivery === 'organic' ? null : {
      spent: r.spent,
      linkClicks: r.linkClicks,
      cpc: r.cpcFb,
      delivery: r.delivery,
      ctr: r.linkClicks > 0 && r.impressions > 0 ? (r.linkClicks / r.impressions) * 100 : 0,
    }
  }));
}

// --- KPIs -------------------------------------------------------
function renderKPIs() {
  const feePct = getTaxFeePct();
  const feeRatio = getTaxFeeRatio();
  const isCountableActive = document.getElementById('valid-orders-toggle')?.checked !== false;
  const isCountable = r => isCountableOrder(r);

  // Sumber kebenaran Shopee:
  const activeShopee = state.filteredShopee || [];
  const countableRows = activeShopee.filter(isCountable);
  const totalOrders = new Set(countableRows.map(r => r.orderId)).size;
  const totalKomisi = Math.round(countableRows.reduce((s, r) => s + (r.komisiBersih || 0), 0));

  // Sumber kebenaran FB Spend:
  let rawSpend = 0;
  if (state.filteredFbAds && state.filteredFbAds.length > 0) {
    rawSpend = state.filteredFbAds.reduce((s, a) => s + (a.spent || 0), 0);
  } else if (state.filteredFb && state.filteredFb.length > 0) {
    rawSpend = state.filteredFb.reduce((s, c) => s + (c.spent || 0), 0) * (state.dateRatio || 1);
  }
  const totalSpent = Math.round(rawSpend * feeRatio);

  const totalProfit = Math.round(totalKomisi - totalSpent);
  const overallRoas = totalSpent > 0 ? (totalKomisi / totalSpent) : null;

  const kpis = [
    { label: 'Total Komisi Bersih', value: 'Rp ' + fmtK(totalKomisi), count: totalKomisi, format: 'rupiah', sub: isCountableActive ? 'order valid (cair & pending)' : 'semua order Shopee', color: 'green',
      badge: totalProfit >= 0 ? { text: 'Untung', cls: 'pos' } : { text: 'Rugi', cls: 'neg' } },
    { label: 'Total Spend Iklan', value: 'Rp ' + fmtK(totalSpent), count: totalSpent, format: 'rupiah', sub: feePct > 0 ? `Meta Ads (+${feePct}% Fee/Pajak)` : 'Meta Ads (tanpa fee/pajak)', color: 'orange' },
    { label: 'Profit / Loss', value: (totalProfit >= 0 ? 'Rp ' : '-Rp ') + fmtK(Math.abs(totalProfit)),
      count: totalProfit, format: 'rupiah',
      sub: totalProfit >= 0 ? '▲ profit' : '▼ rugi',
      color: totalProfit >= 0 ? 'green' : 'red',
      badge: totalProfit >= 0
        ? { text: '+' + fmtK(totalProfit), cls: 'pos' }
        : { text: '-' + fmtK(Math.abs(totalProfit)), cls: 'neg' }
    },
    { label: 'Overall ROAS', value: fmtRoas(overallRoas), count: overallRoas !== null && overallRoas !== undefined ? overallRoas : '', format: 'roas', sub: 'komisi / spend', color: overallRoas && overallRoas >= 2 ? 'green' : (overallRoas && overallRoas >= 1 ? 'blue' : 'orange') },
    { label: 'Total Pesanan', value: fmt(totalOrders), count: totalOrders, format: 'plain', sub: isCountableActive ? 'unique order valid' : 'semua unique order', color: 'blue' },
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
      ${best && best.roas >= 1 ? `<div class="sr-item"><div class="sr-label">🏆 Performa ROAS Tertinggi</div>
        <strong>${esc(best.name)}</strong> — ROAS ${best.roas.toFixed(2)}x · komisi Rp ${fmt(best.komisi)}</div>` : ''}
      ${worst && worst.roas !== null && worst.roas < 1 ? `<div class="sr-item"><div class="sr-label">⚠️ Defisit Terbesar</div>
        <strong>${esc(worst.name)}</strong> — ROAS ${worst.roas.toFixed(2)}x · rugi -Rp ${fmt(Math.abs(worst.profit))}${worstBep ? ' · ' + worstBep : ''}</div>` : ''}
      ${worstFunnel ? `<div class="sr-item"><div class="sr-label">🔍 Klik bocor terparah</div>
        <strong>${esc(worstFunnel.name)}</strong> — ${worstFunnel.dropClickToShopeePct.toFixed(0)}% klik tidak sampai ke Shopee (${fmt(worstFunnel.dropClickToShopee)} klik hilang)</div>` : ''}
    </div>`;
}

// --- GUIDE & TUTORIAL & LIKE MODALS -----------------------------
function openGuideModal() {
  const m = document.getElementById('guide-modal');
  if (m) m.style.display = 'flex';
}
function closeGuideModal() {
  const m = document.getElementById('guide-modal');
  if (m) m.style.display = 'none';
}

function openLikeModal() {
  const m = document.getElementById('like-modal');
  if (m) m.style.display = 'flex';
}
function closeLikeModal() {
  const m = document.getElementById('like-modal');
  if (m) m.style.display = 'none';
}
function submitPrayer() {
  closeLikeModal();
  showToast('🤲 Jazakallahu khairan! Terima kasih banyak atas doa tulusnya.');
}

function openTutorialModal() {
  const m = document.getElementById('tutorial-modal');
  if (m) m.style.display = 'flex';
}
function closeTutorialModal() {
  const m = document.getElementById('tutorial-modal');
  if (m) m.style.display = 'none';
}
function switchTutTab(tabId, btn) {
  document.querySelectorAll('.tut-pane').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.tut-tab-btn').forEach(b => b.classList.remove('active'));
  const target = document.getElementById(tabId);
  if (target) target.style.display = 'block';
  if (btn) btn.classList.add('active');
}

// --- MASTER DECISION TABLE ROWS ---------------------------------
function computeMasterTableRows() {
  const feeRatio = getTaxFeeRatio();
  const hasAds = state.filteredFbAds && state.filteredFbAds.length > 0;

  // Target FB Name Set untuk matching otomatis
  const fbNameSet = new Set([
    ...(hasAds ? (state.filteredFbAds || []).map(a => a.adName) : []),
    ...(hasAds ? (state.filteredFbAds || []).map(a => a.adSetName) : []),
    ...(hasAds ? (state.filteredFbAds || []).map(a => a.campaignName) : []),
    ...(!hasAds ? (state.filteredFb || []).map(c => c.campaignName) : [])
  ].filter(Boolean));

  // 1. Kumpulkan penjualan Shopee per resolved key (hanya order valid bila toggle aktif)
  const salesByKey = {};
  (state.filteredShopee || []).forEach(r => {
    if (!isCountableOrder(r)) return;
    const { key } = resolveShopeeKey(r, fbNameSet, state.mapping || {});
    if (!salesByKey[key]) salesByKey[key] = { orders: new Set(), komisi: 0, gmv: 0, rows: 0 };
    salesByKey[key].orders.add(r.orderId);
    salesByKey[key].komisi += (r.komisiBersih || 0);
    salesByKey[key].gmv += (r.nilaiPembelian || 0);
    salesByKey[key].rows++;
  });

  // 2. Kumpulkan klik Shopee per resolved key dari Click Report
  const clicksByKey = {};
  (state.filteredClicks || []).forEach(c => {
    const key = resolveClickKey(c.tagLink, fbNameSet, state.mapping || {});
    if (!clicksByKey[key]) clicksByKey[key] = { total: 0, fromFacebook: 0 };
    clicksByKey[key].total++;
    if (c.perujuk === 'Facebook') clicksByKey[key].fromFacebook++;
  });

  if (hasAds) {
    // Agregasi ad-level
    const byAd = {};
    (state.filteredFbAds || []).forEach(a => {
      const k = a.adName || '(tanpa nama)';
      if (!byAd[k]) {
        byAd[k] = {
          adName: a.adName || '-',
          adSetName: a.adSetName || '-',
          campaignName: a.campaignName || '-',
          spent: 0,
          linkClicks: 0,
          landingPageViews: 0,
          delivery: a.delivery || '',
        };
      }
      byAd[k].spent += (a.spent || 0);
      byAd[k].linkClicks += (a.linkClicks || 0);
      byAd[k].landingPageViews += (a.landingPageViews || 0);
      if (a.delivery) byAd[k].delivery = a.delivery;
    });

    const boundKeys = new Set();
    const rows = Object.values(byAd).map(a => {
      boundKeys.add(a.adName);
      if (a.adSetName && a.adSetName !== '-') boundKeys.add(a.adSetName);
      if (a.campaignName && a.campaignName !== '-') boundKeys.add(a.campaignName);

      const sale = salesByKey[a.adName] || 
        (a.adSetName && a.adSetName !== '-' ? salesByKey[a.adSetName] : null) || 
        (a.campaignName && a.campaignName !== '-' ? salesByKey[a.campaignName] : null) || null;
      const orders = sale ? sale.orders.size : 0;
      const komisi = sale ? Math.round(sale.komisi) : 0;
      const spent = Math.round(a.spent * feeRatio);
      const profit = Math.round(komisi - spent);
      const roas = spent > 0 ? (komisi / spent) : null;
      const cpo = (spent > 0 && orders > 0) ? Math.round(spent / orders) : null;

      const cData = clicksByKey[a.adName] || 
        (a.adSetName && a.adSetName !== '-' ? clicksByKey[a.adSetName] : null) || 
        (a.campaignName && a.campaignName !== '-' ? clicksByKey[a.campaignName] : null) || null;
      const shopeeClicks = cData ? (cData.fromFacebook > 0 ? cData.fromFacebook : cData.total) : a.landingPageViews;
      const dropPct = (a.linkClicks > 0 && shopeeClicks !== null)
        ? Math.max(0, ((a.linkClicks - shopeeClicks) / a.linkClicks * 100))
        : null;
      const cpcFb = (a.linkClicks > 0 && spent > 0) ? Math.round(spent / a.linkClicks) : null;
      const realCpc = (shopeeClicks > 0 && spent > 0) ? Math.round(spent / shopeeClicks) : null;

      return {
        campaignDisplay: a.campaignName,
        adSetDisplay: a.adSetName,
        adDisplay: a.adName,
        tagDisplay: a.adName,
        spent,
        linkClicks: a.linkClicks,
        shopeeClicks,
        dropPct,
        cpcFb,
        realCpc,
        orders,
        komisi,
        profit,
        roas,
        cpo,
        delivery: a.delivery,
      };
    });

    // Tambahkan penjualan Shopee yang tidak terafiliasi ke Iklan FB (Organik / Tag Bebas)
    // Hanya masukkan jika memiliki pesanan atau komisi riil (bukan klik nyasar kosong)
    const allUnbound = new Set(Object.keys(salesByKey));
    allUnbound.forEach(tag => {
      if (!boundKeys.has(tag)) {
        const sale = salesByKey[tag] || null;
        const orders = sale ? sale.orders.size : 0;
        const komisi = sale ? Math.round(sale.komisi) : 0;
        const cData = clicksByKey[tag] || null;
        const shopeeClicks = cData ? (cData.fromFacebook > 0 ? cData.fromFacebook : cData.total) : 0;
        if (orders > 0 || komisi > 0) {
          rows.push({
            campaignDisplay: 'Organik / Tanpa Iklan FB',
            adSetDisplay: '-',
            adDisplay: '(Organik) ' + tag,
            tagDisplay: tag,
            spent: 0,
            linkClicks: 0,
            shopeeClicks,
            dropPct: null,
            cpcFb: null,
            realCpc: null,
            orders,
            komisi,
            profit: komisi,
            roas: null,
            cpo: null,
            delivery: 'organic',
          });
        }
      }
    });

    return rows.sort((a, b) => {
      if ((b.spent || 0) !== (a.spent || 0)) return (b.spent || 0) - (a.spent || 0);
      if ((b.komisi || 0) !== (a.komisi || 0)) return (b.komisi || 0) - (a.komisi || 0);
      return (b.linkClicks || 0) - (a.linkClicks || 0);
    });
  } else {
    // Campaign level handling
    const byCamp = {};
    (state.filteredFb || []).forEach(c => {
      const k = c.campaignName || '(tanpa nama)';
      if (!byCamp[k]) {
        byCamp[k] = { campaignName: k, spent: 0, linkClicks: 0, landingPageViews: 0, delivery: c.delivery || '' };
      }
      byCamp[k].spent += (c.spent || 0);
      byCamp[k].linkClicks += (c.linkClicks || 0);
      byCamp[k].landingPageViews += (c.landingPageViews || 0);
    });

    const boundKeys = new Set();
    const rows = Object.values(byCamp).map(c => {
      boundKeys.add(c.campaignName);
      const sale = salesByKey[c.campaignName] || null;
      const orders = sale ? sale.orders.size : 0;
      const komisi = sale ? Math.round(sale.komisi) : 0;
      const spent = Math.round(c.spent * feeRatio * (state.dateRatio || 1));
      const profit = Math.round(komisi - spent);
      const roas = spent > 0 ? (komisi / spent) : null;
      const cpo = (spent > 0 && orders > 0) ? Math.round(spent / orders) : null;

      const cData = clicksByKey[c.campaignName] || null;
      const shopeeClicks = cData ? (cData.fromFacebook > 0 ? cData.fromFacebook : cData.total) : c.landingPageViews;
      const dropPct = (c.linkClicks > 0 && shopeeClicks !== null)
        ? Math.max(0, ((c.linkClicks - shopeeClicks) / c.linkClicks * 100))
        : null;
      const cpcFb = (c.linkClicks > 0 && spent > 0) ? Math.round(spent / c.linkClicks) : null;
      const realCpc = (shopeeClicks > 0 && spent > 0) ? Math.round(spent / shopeeClicks) : null;

      return {
        campaignDisplay: c.campaignName,
        adSetDisplay: '-',
        adDisplay: '-',
        tagDisplay: c.campaignName,
        spent,
        linkClicks: c.linkClicks,
        shopeeClicks,
        dropPct,
        cpcFb,
        realCpc,
        orders,
        komisi,
        profit,
        roas,
        cpo,
        delivery: c.delivery,
      };
    });

    const allUnbound = new Set(Object.keys(salesByKey));
    allUnbound.forEach(tag => {
      if (!boundKeys.has(tag)) {
        const sale = salesByKey[tag] || null;
        const orders = sale ? sale.orders.size : 0;
        const komisi = sale ? Math.round(sale.komisi) : 0;
        const cData = clicksByKey[tag] || null;
        const shopeeClicks = cData ? (cData.fromFacebook > 0 ? cData.fromFacebook : cData.total) : 0;
        if (orders > 0 || komisi > 0) {
          rows.push({
            campaignDisplay: 'Organik / Tanpa Iklan FB',
            adSetDisplay: '-',
            adDisplay: '(Organik) ' + tag,
            tagDisplay: tag,
            spent: 0,
            linkClicks: 0,
            shopeeClicks,
            dropPct: null,
            cpcFb: null,
            realCpc: null,
            orders,
            komisi,
            profit: komisi,
            roas: null,
            cpo: null,
            delivery: 'organic',
          });
        }
      }
    });

    return rows.sort((a, b) => {
      if ((b.spent || 0) !== (a.spent || 0)) return (b.spent || 0) - (a.spent || 0);
      if ((b.komisi || 0) !== (a.komisi || 0)) return (b.komisi || 0) - (a.komisi || 0);
      return (b.linkClicks || 0) - (a.linkClicks || 0);
    });
  }
}

// --- FUNNEL SUMMARY & CHART -------------------------------------
function renderFunnelSummary(campaigns, masterRows) {
  const clSummary = document.getElementById('click-loss-summary');
  const ctxLoss = document.getElementById('chart-click-loss');
  if (!clSummary) return;

  const rows = (masterRows && masterRows.length > 0) ? masterRows : campaigns;
  if (!rows || rows.length === 0) {
    clSummary.style.display = 'none';
    if (ctxLoss) ctxLoss.innerHTML = '';
    return;
  }

  // Sumber kebenaran corong: seluruh baris kampanye/iklan terfilter
  const totalSpent     = rows.reduce((s, r) => s + (r.spent || 0), 0);
  const totalFbClicks  = rows.reduce((s, r) => s + (r.linkClicks || r.fbLinkClicks || 0), 0);
  const totalShopeeClk = rows.reduce((s, r) => s + (r.shopeeClicks || r.stage2Value || 0), 0);
  
  // Total order valid unik (sinkron 100% dengan Kartu KPI dan Master Table)
  const countableShopee = (state.filteredShopee || []).filter(r => isCountableOrder(r));
  const exactShopeeOrders = countableShopee.length > 0
    ? new Set(countableShopee.map(r => r.orderId)).size
    : 0;
  const totalOrders    = exactShopeeOrders > 0 ? exactShopeeOrders : rows.reduce((s, r) => s + (r.orders || 0), 0);

  // Pisahkan teratribusi iklan vs organik untuk info tambahan (jika ada)
  const fbRows = rows.filter(r => (r.spent > 0 || r.linkClicks > 0) && r.delivery !== 'organic');
  const fbOrders = fbRows.reduce((s, r) => s + (r.orders || 0), 0);
  const organicOrders = Math.max(0, totalOrders - fbOrders);

  if (totalFbClicks > 0 || totalShopeeClk > 0 || totalOrders > 0) {
    const dropStage1     = Math.max(0, totalFbClicks - totalShopeeClk);
    const dropStage1Pct  = totalFbClicks > 0 ? (dropStage1 / totalFbClicks * 100) : 0;
    const shopeeCvr      = totalShopeeClk > 0 ? (totalOrders / totalShopeeClk * 100) : 0;
    const overallConv    = totalFbClicks > 0 ? (totalOrders / totalFbClicks * 100) : 0;

    const cpcFb          = (totalFbClicks > 0 && totalSpent > 0) ? Math.round(totalSpent / totalFbClicks) : null;
    const realCpc        = (totalShopeeClk > 0 && totalSpent > 0) ? Math.round(totalSpent / totalShopeeClk) : null;
    const cpo            = (totalOrders > 0 && totalSpent > 0) ? Math.round(totalSpent / totalOrders) : null;

    const cpcFbTxt       = cpcFb !== null ? 'Rp ' + fmt(cpcFb) : '-';
    const realCpcTxt     = realCpc !== null ? 'Rp ' + fmt(realCpc) : '-';
    const cpoTxt         = cpo !== null ? 'Rp ' + fmt(cpo) : '-';

    const dropPillClass = dropStage1Pct > 50 ? 'pill-danger' : dropStage1Pct > 25 ? 'pill-warn' : 'pill-good';
    const dropPillTitle = dropStage1Pct > 0 
      ? `🔻 Drop-off ${dropStage1Pct.toFixed(1)}%` 
      : `✅ Lolos 100%`;
    const dropPillDesc = dropStage1Pct > 0 
      ? `<strong>${fmt(dropStage1)}</strong> klik mental di jalan` 
      : `Semua klik masuk Shopee`;
    const dropPillSub = dropStage1Pct > 0 
      ? `sebelum Shopee terbuka` 
      : `tanpa kebocoran teknis`;

    clSummary.innerHTML = `
      <div class="funnel-step step-fb">
        <div class="funnel-step-header">
          <span class="funnel-step-badge badge-fb">Tahap 1</span>
          <span class="funnel-cost-tag">CPC FB: ${cpcFbTxt}</span>
        </div>
        <div class="funnel-step-title">Klik Iklan (Meta FB)</div>
        <div class="funnel-step-value" style="color:#2563eb">${fmt(totalFbClicks)}</div>
        <div class="funnel-step-sub">Link clicks tercatat dari iklan berbayar</div>
      </div>

      <div class="funnel-connector">
        <div class="connector-arrow">➔</div>
        <div class="connector-pill ${dropPillClass}">
          <div class="pill-top">${dropPillTitle}</div>
          <div class="pill-mid">${dropPillDesc}</div>
          <div class="pill-bot">${dropPillSub}</div>
        </div>
      </div>

      <div class="funnel-step step-shopee">
        <div class="funnel-step-header">
          <span class="funnel-step-badge badge-shopee">Tahap 2</span>
          <span class="funnel-cost-tag">Real CPC: ${realCpcTxt}</span>
        </div>
        <div class="funnel-step-title">Sampai di Shopee</div>
        <div class="funnel-step-value" style="color:#8b5cf6">${fmt(totalShopeeClk)}</div>
        <div class="funnel-step-sub">${state.clickReport.length > 0 ? 'Shopee Click Report' : 'Landing Page Views'} (${(100 - dropStage1Pct).toFixed(1)}% lolos)</div>
      </div>

      <div class="funnel-connector">
        <div class="connector-arrow">➔</div>
        <div class="connector-pill pill-cvr">
          <div class="pill-top">🛒 Shopee CVR ${shopeeCvr.toFixed(2)}%</div>
          <div class="pill-mid"><strong>${fmt(totalOrders)}</strong> pesanan dari <strong>${fmt(totalShopeeClk)}</strong> pengunjung</div>
          <div class="pill-bot">rasio pesanan per pengunjung Shopee</div>
        </div>
      </div>

      <div class="funnel-step step-order">
        <div class="funnel-step-header">
          <span class="funnel-step-badge badge-order">Tahap 3</span>
          <span class="funnel-cost-tag">CPO: ${cpoTxt}</span>
        </div>
        <div class="funnel-step-title">Pesanan Masuk (Order)</div>
        <div class="funnel-step-value" style="color:#10b981">${fmt(totalOrders)}</div>
        <div class="funnel-step-sub">Total CVR: <strong>${overallConv.toFixed(2)}%</strong> dari total klik FB</div>
        ${organicOrders > 0 ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${fmt(fbOrders)} dari iklan · ${fmt(organicOrders)} organik</div>` : ''}
      </div>
    `;
    clSummary.style.display = 'flex';

    destroyChart('clickLoss');
    if (ctxLoss) {
      const canvas = ensureCanvas(ctxLoss);
      const topItems = rows.filter(r => (r.spent > 0 || r.linkClicks > 0 || r.orders > 0)).slice(0, 10);
      const labels = topItems.map(r => (r.adDisplay && r.adDisplay !== '-') ? r.adDisplay : (r.campaignDisplay || r.name));
      const fbClicks = topItems.map(r => r.linkClicks || r.fbLinkClicks || 0);
      const spClicks = topItems.map(r => r.shopeeClicks || r.stage2Value || 0);
      const orders = topItems.map(r => r.orders || 0);

      state.charts['clickLoss'] = new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: '1. Klik Iklan (FB)', data: fbClicks, backgroundColor: 'rgba(59,130,246,0.85)', borderRadius: 4 },
            { label: '2. Klik Shopee', data: spClicks, backgroundColor: 'rgba(139,92,246,0.85)', borderRadius: 4 },
            { label: '3. Order', data: orders, backgroundColor: 'rgba(16,185,129,0.85)', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top' },
            datalabels: { display: true, anchor: 'end', align: 'end', color: dlColor(), font: { size: 9, weight: 600 }, formatter: v => v ? fmt(v) : '' }
          },
          scales: { y: { beginAtZero: true, title: { display: true, text: 'Jumlah' } } }
        }
      });
    }
  } else {
    clSummary.style.display = 'none';
    if (ctxLoss) ctxLoss.innerHTML = '';
  }
}

// --- ROAS BAR CHART ---------------------------------------------
function renderRoasBarChart(campaigns) {
  destroyChart('roas');
  const ctxRoas = document.getElementById('chart-roas');
  if (!ctxRoas) return;
  const canvas = ensureCanvas(ctxRoas);
  // Hanya tampilkan campaign/ad yang berbayar (spent > 0)
  const paidCampaigns = campaigns.filter(c => (c.spent || 0) > 0);
  const targetCampaigns = paidCampaigns.length > 0 ? paidCampaigns : campaigns;
  const labels   = targetCampaigns.map(c => c.name);
  const roasVals = targetCampaigns.map(c => c.roas !== null ? +c.roas.toFixed(2) : 0);
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

// --- CAMPAIGN TAB -----------------------------------------------
function renderCampaignTab() {
  const masterRows = computeMasterTableRows();
  const campaigns = buildCampaignData();

  // 1. Funnel 3-Tahap
  renderFunnelSummary(campaigns, masterRows);

  // 2. Master Table (15 Kolom)
  const tbody = document.getElementById('tbody-campaign');
  if (tbody) {
    tbody.innerHTML = masterRows.map(r => {
      const roasTxt = r.roas !== null ? r.roas.toFixed(2) + 'x' : (r.spent > 0 ? '0.00x' : '-');
      const roasClass = r.roas !== null ? colorRoas(r.roas) : '';
      const cpoTxt = r.cpo !== null ? 'Rp ' + fmt(Math.round(r.cpo)) : '-';
      const cpcFbTxt = r.cpcFb !== null ? 'Rp ' + fmt(Math.round(r.cpcFb)) : '-';
      const realCpcTxt = r.realCpc !== null ? 'Rp ' + fmt(Math.round(r.realCpc)) : '-';

      let dropBadge = '-';
      if (r.dropPct !== null) {
        const cls = r.dropPct > 50 ? 'drop-danger' : r.dropPct > 25 ? 'drop-warn' : 'drop-good';
        dropBadge = `<span class="drop-badge ${cls}">${r.dropPct.toFixed(1)}%</span>`;
      }

      const fbKlik = r.linkClicks > 0 ? fmt(r.linkClicks) : '-';
      const spKlik = r.shopeeClicks > 0 ? fmt(r.shopeeClicks) : '-';

      return `<tr>
        <td><span class="campaign-link" onclick="filterProductByCampaign('${esc(r.campaignDisplay)}')" title="Klik untuk filter produk dari campaign ini"><strong>${esc(r.campaignDisplay)}</strong> <span class="drill-icon">🔍</span></span>${r.delivery === 'inactive' ? ' <span class="badge badge-gray" style="font-size:10px">nonaktif</span>' : ''}</td>
        <td>${esc(r.adSetDisplay)}</td>
        <td>${r.adDisplay !== '-' ? `<span class="badge badge-blue">${esc(r.adDisplay)}</span>` : '-'}</td>
        <td>${r.spent > 0 ? 'Rp ' + fmt(r.spent) : '-'}</td>
        <td>${fbKlik}</td>
        <td>${spKlik}</td>
        <td>${dropBadge}</td>
        <td>${r.orders}</td>
        <td>${cpcFbTxt}</td>
        <td><strong>${realCpcTxt}</strong></td>
        <td>${cpoTxt}</td>
        <td>Rp ${fmt(r.komisi)}</td>
        <td class="${r.profit >= 0 ? 'profit-pos' : 'profit-neg'}">${r.profit >= 0 ? 'Rp ' : '-Rp '}${fmt(Math.abs(r.profit))}</td>
        <td class="${roasClass}"><strong>${roasTxt}</strong></td>
        <td>${getStatusBadge(r.roas, r.spent, r.delivery)}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="15" class="no-data">Tidak ada data campaign</td></tr>';
  }

  // 3. Table Footer Summary (100% Cocok dengan Kartu KPI)
  const tfoot = document.getElementById('tfoot-campaign');
  if (tfoot) {
    const sumSpent = masterRows.reduce((s, r) => s + (r.spent || 0), 0);
    const sumFbKlik = masterRows.reduce((s, r) => s + (r.linkClicks || 0), 0);
    const sumShopeeKlik = masterRows.reduce((s, r) => s + (r.shopeeClicks || 0), 0);
    const sumOrders = masterRows.reduce((s, r) => s + (r.orders || 0), 0);
    const sumKomisi = masterRows.reduce((s, r) => s + (r.komisi || 0), 0);
    const sumProfit = sumKomisi - sumSpent;
    const avgRoas = sumSpent > 0 ? (sumKomisi / sumSpent) : null;
    const avgCpo = (sumSpent > 0 && sumOrders > 0) ? Math.round(sumSpent / sumOrders) : null;
    const avgCpcFb = (sumFbKlik > 0 && sumSpent > 0) ? Math.round(sumSpent / sumFbKlik) : null;
    const avgRealCpc = (sumShopeeKlik > 0 && sumSpent > 0) ? Math.round(sumSpent / sumShopeeKlik) : null;
    const avgDropPct = sumFbKlik > 0 ? Math.max(0, ((sumFbKlik - sumShopeeKlik) / sumFbKlik * 100)) : null;

    tfoot.innerHTML = `<tr>
      <td><strong>TOTAL / RINGKASAN</strong></td>
      <td>-</td>
      <td><strong>${masterRows.length} item</strong></td>
      <td><strong>Rp ${fmt(sumSpent)}</strong></td>
      <td><strong>${sumFbKlik > 0 ? fmt(sumFbKlik) : '-'}</strong></td>
      <td><strong>${sumShopeeKlik > 0 ? fmt(sumShopeeKlik) : '-'}</strong></td>
      <td>${avgDropPct !== null ? `<span class="drop-badge ${avgDropPct > 50 ? 'drop-danger' : avgDropPct > 25 ? 'drop-warn' : 'drop-good'}">${avgDropPct.toFixed(1)}%</span>` : '-'}</td>
      <td><strong>${fmt(sumOrders)}</strong></td>
      <td>${avgCpcFb !== null ? 'Rp ' + fmt(avgCpcFb) : '-'}</td>
      <td><strong>${avgRealCpc !== null ? 'Rp ' + fmt(avgRealCpc) : '-'}</strong></td>
      <td>${avgCpo !== null ? 'Rp ' + fmt(avgCpo) : '-'}</td>
      <td><strong>Rp ${fmt(sumKomisi)}</strong></td>
      <td class="${sumProfit >= 0 ? 'profit-pos' : 'profit-neg'}"><strong>${sumProfit >= 0 ? 'Rp ' : '-Rp '}${fmt(Math.abs(sumProfit))}</strong></td>
      <td class="${avgRoas !== null ? colorRoas(avgRoas) : ''}"><strong>${avgRoas !== null ? avgRoas.toFixed(2) + 'x' : '-'}</strong></td>
      <td>-</td>
    </tr>`;
  }

  // 4. ROAS Bar Chart
  renderRoasBarChart(campaigns);
}

function getStatusBadge(roas, spent, delivery) {
  if (delivery === 'organic') return '<span class="badge badge-gray">Organik</span>';
  if (spent === 0) return '<span class="badge badge-gray">Rp 0 Spend</span>';
  if (roas === null) return '<span class="badge badge-gray">-</span>';
  if (roas >= 2)    return '<span class="badge badge-green">ROAS ' + roas.toFixed(2) + 'x</span>';
  if (roas >= 1)    return '<span class="badge badge-yellow">ROAS ' + roas.toFixed(2) + 'x</span>';
  return '<span class="badge badge-red">ROAS ' + roas.toFixed(2) + 'x</span>';
}

// --- PRODUCT TAB ------------------------------------------------
function computeProductRows() {
  const byProduct = {};
  const fbNameSet = new Set([
    ...state.filteredFb.map(c => c.campaignName),
    ...(state.filteredFbAds || []).map(a => a.adName),
    ...(state.filteredFbAds || []).map(a => a.adSetName),
    ...(state.filteredFbAds || []).map(a => a.campaignName)
  ].filter(Boolean));

  (state.filteredShopee || []).forEach(r => {
    if (!isCountableOrder(r)) return;
    const id = r.idBarang || r.barang || '(tidak diketahui)';
    if (!byProduct[id]) {
      byProduct[id] = {
        name: r.barang || '(tidak diketahui)',
        kategori: r.kategori1 || '-',
        qty: 0,
        orders: new Set(),
        nilai: 0,
        komisi: 0,
        campaigns: new Set()
      };
    }
    if (r.barang && r.barang.length > byProduct[id].name.length) byProduct[id].name = r.barang;
    byProduct[id].qty += (r.jumlah || 1);
    byProduct[id].orders.add(r.orderId);
    byProduct[id].nilai  += (r.nilaiPembelian || 0);
    byProduct[id].komisi += (r.komisiBersih || 0);
    const { key: campKey } = resolveShopeeKey(r, fbNameSet, state.mapping || {});
    if (campKey && campKey !== '(tidak ada tag)') byProduct[id].campaigns.add(campKey);
  });
  return Object.values(byProduct)
    .map(p => ({
      ...p,
      orders: p.orders.size,
      orderCount: p.orders.size,
      orderIds: [...p.orders],
      campaigns: [...p.campaigns]
    }))
    .sort((a, b) => b.orders - a.orders || b.komisi - a.komisi);
}

function renderProductTab() {
  destroyChart('topProduct');
  let products = computeProductRows();
  if (state.activeProductCampaignFilter) {
    const q = state.activeProductCampaignFilter.toLowerCase();
    products = products.filter(p => p.campaigns.some(c => c.toLowerCase().includes(q) || q.includes(c.toLowerCase())));
  }
  const tbody = document.getElementById('tbody-product');
  if (tbody) {
    tbody.innerHTML = products.map(p => `<tr>
      <td style="max-width:260px;white-space:normal;line-height:1.4">${esc(p.name)}</td>
      <td>${esc(p.kategori)}</td>
      <td><strong>${fmt(p.qty)}</strong></td>
      <td><strong>${p.orderCount}</strong></td>
      <td>Rp ${fmt(p.nilai)}</td>
      <td>Rp ${fmt(p.komisi)}</td>
      <td style="max-width:160px;white-space:normal">${p.campaigns.slice(0,3).map(c => `<span class="badge badge-blue clickable-badge" onclick="filterProductByCampaign('${esc(c)}')" title="Filter campaign ini">${esc(c)}</span>`).join(' ')}</td>
    </tr>`).join('') || `<tr><td colspan="7" class="no-data">Tidak ada produk${state.activeProductCampaignFilter ? ` untuk campaign "${esc(state.activeProductCampaignFilter)}"` : ''}</td></tr>`;
  }

  const tfoot = document.getElementById('tfoot-product');
  if (tfoot) {
    const totalQty = products.reduce((s, p) => s + (p.qty || 0), 0);
    const sumItemOrders = products.reduce((s, p) => s + (p.orderCount || 0), 0);
    const uniqueOrders = new Set(products.flatMap(p => p.orderIds || [])).size;
    const totalNilai = products.reduce((s, p) => s + (p.nilai || 0), 0);
    const totalKomisi = products.reduce((s, p) => s + (p.komisi || 0), 0);

    tfoot.innerHTML = `<tr>
      <td><strong>TOTAL (${products.length} Produk)</strong></td>
      <td>-</td>
      <td><strong>${fmt(totalQty)} pcs</strong></td>
      <td><strong>${fmt(uniqueOrders)} order unik</strong><div style="font-size:10px;color:var(--text-muted);font-weight:400">(${sumItemOrders} pesanan produk)</div></td>
      <td><strong>Rp ${fmt(totalNilai)}</strong></td>
      <td><strong>Rp ${fmt(totalKomisi)}</strong></td>
      <td>-</td>
    </tr>`;
  }
}

// --- SCATTER PLOT (REMOVED / NO-OP) ------------------------------
function renderScatterPlot() {
  destroyChart('scatter');
}

// --- TREND TAB --------------------------------------------------
function renderTrendTab() {
  const byDate  = {};
  const fbNameSet = new Set([
    ...state.filteredFb.map(c => c.campaignName),
    ...(state.filteredFbAds || []).map(a => a.adName),
    ...(state.filteredFbAds || []).map(a => a.adSetName),
    ...(state.filteredFbAds || []).map(a => a.campaignName)
  ].filter(Boolean));
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
    geoWrap.innerHTML  = '<div class="chart-empty">Unggah Shopee Click Report untuk melihat distribusi negara.</div>';
    hourWrap.innerHTML = '<div class="chart-empty">Unggah Click Report atau file komisi untuk melihat distribusi jam.</div>';
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
    geoWrap.innerHTML = '<div class="chart-empty">Unggah Shopee Click Report untuk melihat distribusi negara.</div>';
  }

  // Klik vs Order per jam (00-23) — bandingkan jam klik iklan vs jam order masuk
  const byHour = Array(24).fill(0);
  state.filteredClicks.forEach(c => {
    const m = (c.waktuKlik || '').match(/(?:^|\s)(\d{1,2}):\d{2}/);
    if (m) {
      const h = parseInt(m[1], 10);
      if (h >= 0 && h <= 23) byHour[h]++;
    }
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
    if (!tag || tag === '-') return;
    if (!salesByTag[tag]) salesByTag[tag] = { orders: new Set(), komisi: 0 };
    if (isCountableOrder(r)) salesByTag[tag].orders.add(r.orderId);
    salesByTag[tag].komisi += r.komisiBersih;
  });
  // tag dari click report juga dihitung kandidat — ad yang tag-nya hidup di click
  // report tapi belum jualan tetap terhubung (order '-'), bukan dianggap tidak dikenali
  const clickTags = new Set();
  state.filteredClicks.forEach(c => { if (c.tag1) clickTags.add(c.tag1); });
  const allTags = [...new Set([...Object.keys(salesByTag), ...clickTags])];

  // matching toleran: cek apa adanya dulu, lalu versi ternormalisasi (spasi/strip/dot diabaikan).
  // Guard: digit setelah tag = kelanjutan angka lain ('gacoan010' ≠ 'gacoan01') → tolak.
  // Huruf setelah tag = kata biasa ('gacoan01video' = ad video) → terima.
  const tagForAd = (adName) => {
    const lower = String(adName || '').toLowerCase();
    const nAd = normalizeName(adName);
    let best = null;
    for (const t of allTags) {
      const lt = t.toLowerCase();
      const nT = normalizeName(t);
      if (!nT) continue;
      let hit = false;
      const i = lower.indexOf(lt);
      if (i >= 0 && !/\d/.test(lower.charAt(i + lt.length))) hit = true;
      if (!hit) {
        const j = nAd.indexOf(nT);
        if (j >= 0 && !/\d/.test(nAd.charAt(j + nT.length))) hit = true;
      }
      if (hit && (!best || lt.length > best.length)) best = t;
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

  const feeRatio = getTaxFeeRatio();
  const rows = Object.values(byAd).map(a => {
    const tag = tagForAd(a.adName);
    const sale = tag ? salesByTag[tag] : null;
    const orders = sale ? sale.orders.size : null;
    const komisi = sale ? sale.komisi : null;
    const spent = Math.round(a.spent * feeRatio);
    const roas = spent > 0 && komisi !== null ? komisi / spent : null;
    const cpo = spent > 0 && orders ? spent / orders : null;
    return { ...a, spent, orders, komisi, roas, cpo, tag, matched: !!tag };
  });
  // ad dengan ROAS dulu (keputusan), tanpa data menyusul
  rows.sort((a, b) => (b.roas ?? -1) - (a.roas ?? -1));
  state._adMatchStats = {
    unmatched: rows.filter(r => !r.matched).map(r => r.adName),
    // zero-trace = jalan (ada spend/klik FB) tapi nol jejak Shopee → alarm link/tag
    zeroTrace: rows.filter(r => !r.matched && (r.spent > 0 || r.linkClicks > 0))
      .map(r => ({ name: r.adName, spent: r.spent, clicks: r.linkClicks })),
  };
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
  const title = card.querySelector('.table-title');
  if (title) {
    const matched = rows.filter(r => r.matched).length;
    title.innerHTML = `📋 Detail per Ad / Ad Set <span class="chart-hint">(${rows.length} ad · ${matched} terhubung tag · tag di nama ad → sales per ad)</span>`;
  }
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
      <td>${getStatusBadge(r.roas, r.spent, r.delivery)}</td>
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
      text: `<strong>Sesi ini dibuat dengan versi aplikasi yang lama.</strong> Beberapa fitur baru (misalnya analisis order per jam) memerlukan data yang diproses ulang. Klik <strong>↩️ Upload Ulang</strong> lalu unggah file yang sama — semua angka tetap, malah lebih lengkap.` });
  }

  // 0. Baris komisi identik yang dibuang saat upload
  if (state.shopeeDupCount > 0) {
    warns.push({ type: 'warn', icon: '📄',
      text: `<strong>${state.shopeeDupCount} baris komisi identik telah dibuang</strong> — kemungkinan ada file komisi yang periodenya tumpang tindih. Angka pada dashboard sudah dibersihkan.` });
  }

  // 1. Kemungkinan biaya terhitung ganda: campaign+tanggal sama muncul >1x di data FB
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
      text: `<strong>Kemungkinan biaya iklan terhitung ganda:</strong> ${dups.length} kombinasi campaign+tanggal muncul lebih dari satu kali (total ${totalDup} baris berlebih). Contoh: <strong>${esc(name)}</strong> tanggal ${esc(date)} muncul ${dups[0][1]}x. Periksa apakah ada file FB Ads yang periodenya tumpang tindih.` });
  }

  // 1b. File FB agregat multi-hari: angka = total seluruh rentang, bukan per hari
  const ranged = state.filteredFb.filter(c => c.endDate && c.date && c.endDate > c.date);
  if (ranged.length > 0) {
    const r0 = ranged[0];
    warns.push({ type: 'info', icon: '📆',
      text: `File FB Ads berisi <strong>rentang multi-hari</strong> (${esc(r0.date)} s/d ${esc(r0.endDate)}) — angka campaign adalah <strong>total seluruh rentang</strong>, bukan per hari. Untuk analisis per hari, export FB per tanggal.` });
  }

  // 2. Order di tag yang tidak cocok dengan campaign FB manapun
  if (state.filteredFb.length > 0) {
    buildCampaignData()
      .filter(c => !c.fb && c.orders > 0 && c.name !== '(tidak ada tag)')
      .forEach(c => {
        warns.push({ type: 'warn', icon: '🔗',
          text: `<strong>${esc(c.name)}</strong>: ${c.orders} order (komisi Rp ${fmt(c.komisi)}) tidak cocok dengan campaign FB manapun — komisi ini tidak terbanding dengan spend-nya. Buka <strong>⚙️ Mapping</strong> untuk menghubungkannya.` });
      });
  }

  // 2b. Ad yang jalan tapi NOL jejak Shopee -> alarm link/tag bocor
  const adStats = state._adMatchStats;
  if (adStats && adStats.zeroTrace.length > 0) {
    const z = adStats.zeroTrace[0];
    warns.push({ type: 'warn', icon: '🚨',
      text: `<strong>${adStats.zeroTrace.length} iklan mengeluarkan biaya tetapi tidak meninggalkan jejak di Shopee</strong> — contoh: <strong>${esc(z.name)}</strong> (biaya Rp ${fmt(z.spent)}, ${fmt(z.clicks)} klik FB, tetapi 0 klik & 0 order Shopee dengan tag tersebut). Periksa apakah link/tag pada iklan masih aktif & benar — jangan biarkan anggaran terbuang.` });
  }
  // 2c. Ad tanpa tag sama sekali (naming) — hanya kalau bukan kasus zero-trace
  if (adStats && adStats.unmatched.length > 0 && adStats.zeroTrace.length === 0) {
    warns.push({ type: 'warn', icon: '🏷️',
      text: `<strong>${adStats.unmatched.length} iklan tidak memiliki tag yang dikenali pada namanya</strong> (contoh: <strong>${esc(adStats.unmatched[0])}</strong>) — penjualan dari iklan ini tidak dapat dihitung. Gunakan konvensi penamaan: cantumkan tag (mis. gacoan01) pada nama iklan, lalu export ulang level Ad.` });
  }

  // 3. Coverage Click Report vs periode data
  if (state.clickReport.length > 0 && state.filteredClicks.length > 0) {
    const shopeeDays = new Set(state.filteredShopee.map(r => r.date).filter(Boolean));
    const clickDays = new Set(state.filteredClicks.map(c => c.date).filter(Boolean));
    if (shopeeDays.size > 0 && clickDays.size < shopeeDays.size) {
      warns.push({ type: 'info', icon: 'ℹ️',
        text: `Click Report hanya mencakup <strong>${clickDays.size} dari ${shopeeDays.size} hari</strong> — funnel tahap 2 (klik masuk Shopee) bisa lebih kecil dari kenyataan. Unduh Click Report untuk periode penuh agar funnel akurat.` });
    }
  } else if (state.clickReport.length === 0 && state.filteredFb.some(c => c.landingPageViews > 0)) {
    warns.push({ type: 'info', icon: 'ℹ️',
      text: `Funnel tahap 2 saat ini menggunakan <strong>Landing Page Views</strong> dari FB (perkiraan kasar). Unggah <strong>Shopee Website Click Report</strong> agar jumlah klik masuk Shopee akurat.` });
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
    wrap.innerHTML = '<div class="chart-empty">Belum cukup riwayat — lakukan analisis pada minimal 2 periode berbeda (misalnya minggu lalu & minggu ini), maka grafik Perjalanan ROAS akan muncul otomatis.</div>';
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

// --- FB BREAKDOWN (REMOVED / NO-OP) ------------------------------
function renderFbBreakdown() {
  ['fbAge', 'fbGender', 'fbPlatform', 'fbRegion'].forEach(k => destroyChart(k));
}

// --- TABLES: SORT & SEARCH --------------------------------------
function sortTable(tableId, colIdx) {
  const table = document.getElementById(tableId);
  const tbody = table.querySelector('tbody');
  const rows  = Array.from(tbody.querySelectorAll('tr'));
  const key   = tableId + '-' + colIdx;
  state.sortDir[key] = !state.sortDir[key];

  const parseCell = (s) => {
    const str = String(s || '').trim();
    if (!str || str === '-') return { isNum: true, val: null, str: '' };
    // Pola angka (misal: "Rp 18.415", "-Rp 73.820", "2.14%", "1.85x", "50", "▲ +0.50", "123")
    const m = str.match(/^([+-])?(?:Rp\s*)?(-?[\d.,]+)(?:\s*(?:%|x|rb|Jt|jt|k|K|klik\/order))?$/i);
    if (m) {
      const sign = (m[1] === '-' || m[2].startsWith('-')) ? -1 : 1;
      let numStr = m[2].replace(/^-/, '');
      if (/^\d{1,3}(\.\d{3})+$/.test(numStr)) numStr = numStr.replace(/\./g, '');
      const val = parseFloat(numStr);
      if (!isNaN(val)) return { isNum: true, val: sign * val, str: str.toLowerCase() };
    }
    return { isNum: false, val: null, str: str.toLowerCase() };
  };

  rows.sort((a, b) => {
    const ta = parseCell(a.cells[colIdx]?.innerText || '');
    const tb = parseCell(b.cells[colIdx]?.innerText || '');
    if (ta.isNum && tb.isNum) {
      if (ta.val === null && tb.val === null) return 0;
      if (ta.val === null) return 1;
      if (tb.val === null) return -1;
      return state.sortDir[key] ? ta.val - tb.val : tb.val - ta.val;
    }
    const cmp = ta.str.localeCompare(tb.str, 'id', { numeric: true });
    return state.sortDir[key] ? cmp : -cmp;
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
    if (camps.length === 0) { alert('Belum ada data untuk diekspor.'); return; }
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

    // Evaluasi Campaign & Ad (Master Table)
    const masterRows = computeMasterTableRows();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(masterRows.map(r => ({
      Campaign: r.campaignDisplay,
      'Ad Set': r.adSetDisplay,
      'Ad / Tag': r.adDisplay,
      'Spend (Rp)': r.spent,
      'Klik FB': r.linkClicks,
      'Klik Shopee': r.shopeeClicks > 0 ? r.shopeeClicks : '',
      'Bocor (%)': r.dropPct !== null ? +r.dropPct.toFixed(1) : '',
      Orders: r.orders,
      'CPC FB (Rp)': r.cpcFb !== null ? Math.round(r.cpcFb) : '',
      'Real CPC (Rp)': r.realCpc !== null ? Math.round(r.realCpc) : '',
      'CPO (Rp)': r.cpo !== null ? Math.round(r.cpo) : '',
      'Komisi (Rp)': r.komisi,
      'Profit (Rp)': r.profit,
      ROAS: r.roas !== null ? +r.roas.toFixed(2) : '',
    }))), 'Evaluasi Campaign & Ad');

    // Per Produk
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(computeProductRows().map(p => ({
      Produk: p.name, Kategori: p.kategori, Qty: p.qty, Orders: p.orders,
      Nilai_Pembelian: Math.round(p.nilai), Komisi: Math.round(p.komisi),
      Campaign: p.campaigns.join(', '),
    }))), 'Per Produk');

    // Status Pesanan
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(st.map(s => ({
      Status: s.status, Orders: s.count, Komisi: Math.round(s.komisi),
    }))), 'Status Pesanan');

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
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM agar Excel membaca UTF-8
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename + '_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportChartPNG(card) {
  const canvas = card.querySelector('.chart-wrap canvas');
  if (!canvas) { alert('Chart belum ter-render (belum ada data).'); return; }
  // Gambar ulang di canvas putih supaya PNG-nya tidak transparan
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
    btn.title = 'Unduh grafik sebagai PNG';
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
    btn.title = 'Unduh tabel sebagai CSV (dapat dibuka di Excel)';
    btn.addEventListener('click', () => exportTableCSV(table.id, 'affalitycs_' + table.id.replace('tbl-', '')));
    header.appendChild(btn);
  });
}
setupExportButtons();

// --- SECTION NAVIGATION & SMOOTH JUMP ---------------------------
let isProgrammaticScroll = false;
let isScrollSpyBound = false;

function updateActiveNavPill() {
  if (isProgrammaticScroll) return;
  const sections = document.querySelectorAll('.dashboard-section');
  const navPills = document.querySelectorAll('.nav-pill');
  if (!sections.length || !navPills.length) return;

  const scrollY = window.scrollY || window.pageYOffset || 0;
  // Offset header (60px) + sticky nav pill (48px) + offset buffer (40px) = ~150px
  const probeY = scrollY + 150;

  let activeId = sections[0].id;
  sections.forEach(sec => {
    if (probeY >= sec.offsetTop) {
      activeId = sec.id;
    }
  });

  navPills.forEach(p => {
    if (p.getAttribute('href') === '#' + activeId) {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });
}

function scrollToSection(secId, event) {
  if (event) event.preventDefault();
  const el = document.getElementById(secId);
  if (el) {
    isProgrammaticScroll = true;
    document.querySelectorAll('.nav-pill').forEach(p => {
      if (p.getAttribute('href') === '#' + secId) p.classList.add('active');
      else p.classList.remove('active');
    });
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      isProgrammaticScroll = false;
      updateActiveNavPill();
    }, 700);
  }
}

function switchTab(tabName) {
  const map = { campaign: 'sec-campaign', product: 'sec-product', trend: 'sec-trend' };
  if (map[tabName]) scrollToSection(map[tabName]);
}

function setupSectionNavObserver() {
  if (!isScrollSpyBound) {
    window.addEventListener('scroll', () => {
      window.requestAnimationFrame(updateActiveNavPill);
    }, { passive: true });
    window.addEventListener('resize', () => {
      window.requestAnimationFrame(updateActiveNavPill);
    }, { passive: true });
    isScrollSpyBound = true;
  }
  updateActiveNavPill();
}

// --- DRILL-DOWN CAMPAIGN & PRODUK (FITUR D) ---------------------
function filterProductByCampaign(campaignName) {
  state.activeProductCampaignFilter = campaignName;
  renderProductTab();
  const chip = document.getElementById('product-filter-chip');
  const chipName = document.getElementById('product-filter-name');
  if (chip && chipName) {
    chipName.textContent = campaignName;
    chip.style.display = 'inline-flex';
  }
  scrollToSection('sec-product');
  showToast(`🔍 Menampilkan produk dari campaign "${campaignName}"`);
}

function clearProductCampaignFilter() {
  state.activeProductCampaignFilter = null;
  renderProductTab();
  const chip = document.getElementById('product-filter-chip');
  if (chip) chip.style.display = 'none';
  showToast('Semua produk ditampilkan kembali');
}

// --- SALIN RINGKASAN WA / CATATAN (FITUR C) --------------------
function showToast(msg) {
  let t = document.getElementById('aff-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'aff-toast';
    t.className = 'aff-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

function copyWaSummary() {
  const feePct = getTaxFeePct();
  const masterRows = computeMasterTableRows();
  const sumSpent = masterRows.reduce((s, r) => s + (r.spent || 0), 0);
  const sumFbKlik = masterRows.reduce((s, r) => s + (r.linkClicks || 0), 0);
  const sumShopeeKlik = masterRows.reduce((s, r) => s + (r.shopeeClicks || 0), 0);
  const sumOrders = masterRows.reduce((s, r) => s + (r.orders || 0), 0);
  const sumKomisi = masterRows.reduce((s, r) => s + (r.komisi || 0), 0);
  const sumProfit = sumKomisi - sumSpent;
  const roas = sumSpent > 0 ? (sumKomisi / sumSpent) : null;
  const cpo = (sumSpent > 0 && sumOrders > 0) ? Math.round(sumSpent / sumOrders) : null;
  const dropPct = sumFbKlik > 0 ? Math.max(0, ((sumFbKlik - sumShopeeKlik) / sumFbKlik * 100)) : 0;

  const rawStart = document.getElementById('filter-start')?.value || '';
  const rawEnd = document.getElementById('filter-end')?.value || '';
  let periode = (rawStart && rawEnd) ? `${rawStart} s/d ${rawEnd}` : '';
  if (!periode) {
    const allDates = [...state.filteredShopee.map(r => r.date), ...state.filteredFb.map(c => c.date)].filter(Boolean).sort();
    periode = allDates.length > 0 ? `${allDates[0]} s/d ${allDates[allDates.length - 1]}` : 'Semua Periode';
  }

  const best = masterRows.filter(r => r.spent > 0 && r.roas !== null).sort((a, b) => b.roas - a.roas)[0];
  const worst = masterRows.filter(r => r.spent > 0 && r.profit < 0).sort((a, b) => a.profit - b.profit)[0];

  const lines = [
    `📊 *Laporan Affalitycs*`,
    `📅 Periode: ${periode}`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `💰 *Total Komisi*: Rp ${fmt(sumKomisi)}`,
    `💸 *Total Spend FB*: Rp ${fmt(sumSpent)}${feePct > 0 ? ` (+${feePct}% Fee/Pajak)` : ''}`,
    `📈 *Overall ROAS*: ${roas !== null ? roas.toFixed(2) + 'x' : '-'}`,
    `⚖️ *Profit / Loss*: ${sumProfit >= 0 ? '+Rp ' : '-Rp '}${fmt(Math.abs(sumProfit))} (${sumProfit >= 0 ? 'Untung' : 'Rugi'})`,
    `📦 *Total Order*: ${fmt(sumOrders)} pesanan${cpo !== null ? ` (CPO Rp ${fmt(cpo)})` : ''}`,
    `🖱️ *Klik FB*: ${fmt(sumFbKlik)} ➔ *Shopee*: ${fmt(sumShopeeKlik)} (Bocor ${dropPct.toFixed(1)}%)`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ];
  if (best) {
    lines.push(`🏆 *Best Campaign*: ${best.campaignDisplay} (ROAS ${best.roas.toFixed(2)}x, Profit ${best.profit >= 0 ? '+Rp ' : '-Rp '}${fmt(Math.abs(best.profit))})`);
  }
  if (worst && worst.campaignDisplay !== best?.campaignDisplay) {
    lines.push(`⚠️ *Defisit Terbesar*: ${worst.campaignDisplay} (Rugi -Rp ${fmt(Math.abs(worst.profit))})`);
  }
  lines.push(`\n_Dibuat otomatis oleh Affalitycs_`);

  const text = lines.join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('📋 Ringkasan berhasil disalin ke clipboard!');
    }).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }

  function fallbackCopy(str) {
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('📋 Ringkasan berhasil disalin ke clipboard!');
  }
}

// --- FILTERS ----------------------------------------------------
function resetFilters() {
  const dates = [
    ...state.shopeeRows.map(r => r.date),
    ...state.fbCampaigns.map(c => c.date),
  ].filter(Boolean).sort();
  if (dates.length > 0) {
    setRange(dates[0], dates[dates.length - 1]);
  } else {
    setRange('', '');
  }
  const feeInput = document.getElementById('tax-fee-input');
  if (feeInput) feeInput.value = 0;
  const validToggle = document.getElementById('valid-orders-toggle');
  if (validToggle) validToggle.checked = true;
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
        `${orderId};${status};2291870000000;${dateStr} ${10+Math.floor(Math.random()*12)}:${String(Math.floor(Math.random()*59)).padStart(2,'0')};;${dateStr} ${8+Math.floor(Math.random()*10)}:00;DemoStore;12345;Preferred(Non-CB);PROD123;${prod[0]};MODEL1;Normal Product;;${prod[1]};;;${prod[2]};1;Komisi Shopee;;${prod[2]};;1.50%;${(prod[2]*0.015).toFixed(0)};2.00%;${(prod[2]*0.02).toFixed(0)};${(prod[2]*0.035).toFixed(0)};${(prod[2]*0.015).toFixed(0)};${(prod[2]*0.02).toFixed(0)};${(prod[2]*0.035).toFixed(0)};;;0.00%;0;100.00%;${komisi};Aktif;-;Pesanan dari Toko yang tidak Dipromosikan;Ada;${cp};meta;${cp};;;Facebook`
      );
      orderCounter++;
    }
  }

  const fbData = [
    { name: 'cp01', spent: 36796, reach: 7106, impressions: 7300,  linkClicks: 511, cpc: 72.0,  cpm: 5040.5, ctr: 7.0, budget: 25000 },
    { name: 'cp02', spent: 40592, reach: 7032, impressions: 7032,  linkClicks: 652, cpc: 62.3,  cpm: 5772.5, ctr: 9.3, budget: 25000 },
    { name: 'cp03', spent: 23148, reach: 6062, impressions: 6352,  linkClicks: 547, cpc: 42.3,  cpm: 3644.2, ctr: 8.6, budget: 25000 },
    { name: 'cp04', spent: 19850, reach: 5200, impressions: 5400,  linkClicks: 340, cpc: 58.4,  cpm: 3675.9, ctr: 6.3, budget: 25000 },
    { name: 'cp05', spent: 28510, reach: 9938, impressions: 10083, linkClicks: 208, cpc: 137.1, cpm: 2827.5, ctr: 2.1, budget: 25000 },
  ];

  state.shopeeRows   = parseShopeeCSV(csvLines.join('\n'));
  state.fbCampaigns  = fbData.map(d => ({
    campaignName: d.name, spent: d.spent, reach: d.reach,
    impressions: d.impressions, linkClicks: d.linkClicks,
    cpc: d.cpc, cpm: d.cpm, ctr: d.ctr,
    landingPageViews: Math.round(d.linkClicks * 0.78), budget: d.budget, delivery: 'active'
  }));

  state.mapping = {};
  state.clickReport = [];
  state.fbBreakdown = [];
  state.fbAds = [];
  state.fbCampaigns.forEach(c => { state.mapping[c.campaignName] = c.campaignName; });

  setTimeout(() => { buildDashboard(); }, 300);
}
