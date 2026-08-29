/* ============================================================
   AFFALITYCS - app.js
   Shopee Affiliate  Facebook Ads Analytics Dashboard
   v2.3 - Agustus 2026
   ============================================================ */

// --- STATE -----------------------------------------------------
const state = {
  shopeeRows: [],
  fbCampaigns: [],
  clickReport: [],      // Website Click Report data
  filteredClicks: [],    // Filtered click report data
  mapping: {},
  filteredShopee: [],
  filteredFb: [],
  charts: {},
  sortDir: {},
  dateRatio: 1,
};

// --- HELPERS ---------------------------------------------------
const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n));
const fmtK = (n) => {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1_000_000) return sign + (a/1_000_000).toFixed(1) + 'Jt';
  if (a >= 1_000) return sign + (a/1_000).toFixed(1) + 'rb';
  return String(Math.round(a));
};
// Escape string sebelum masuk innerHTML — data CSV Shopee/FB bisa berisi <, >, &, "
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fmtRoas = (r) => r === null || r === undefined || !isFinite(r) ? '-' : r.toFixed(2) + 'x';
const parseNum = (s) => {
  if (s === null || s === undefined || s === '' || s === '-') return 0;
  return parseFloat(String(s).replace(/[^0-9.\-]/g, '')) || 0;
};
const colorRoas = (r) => r >= 2 ? 'roas-positive' : r >= 1 ? 'roas-neutral' : 'roas-negative';
const normalizeName = (s) => String(s || '').toLowerCase().replace(/[\s\-_\.-]/g, '');

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

// --- PARSE SHOPEE CSV --------------------------------------------
function parseShopeeCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0];
  const delim = (header.match(/;/g) || []).length > (header.match(/,/g) || []).length ? ';' : ',';
  const headers = header.split(delim).map(h => h.trim().replace(/\r/g, ''));

  const col = (name) => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));
  const CI = {
    orderId:        col('ID Pemesanan'),
    status:         col('Status Pesanan'),
    waktuPesan:     col('Waktu Pemesanan'),
    waktuKlik:      col('Waktu Klik'),          // Shopee-tracked click time
    toko:           col('Nama Toko'),
    barang:         col('Nama Barang') !== -1 ? col('Nama Barang') : col('Nama Barange'),
    kategori1:      col('L1 Kategori'),
    kategori2:      col('L2 Kategori'),
    harga:          col('Harga(Rp)'),
    jumlah:         col('Jumlah'),
    nilaiPembelian: col('Nilai Pembelian'),
    komisiShopee:   col('Komisi Shopee per Pesanan'),
    komisiXtra:     col('Komisi XTRA per Pesanan'),
    totalKomisi:    col('Total Komisi per Pesanan'),
    komisiBersih:   col('Komisi Bersih Affiliate'),
    statusProduk:   col('Status Produk Affiliate'),
    tipeOrder:      col('Tipe Pesanan'),
    tag1:           col('Tag_link1'),
    tag2:           col('Tag_link2'),
    tag3:           col('Tag_link3'),
    platform:       col('Platform'),
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCSVLine(lines[i], delim);
    if (cells.length < 5) continue;

    const get = (idx) => idx >= 0 && idx < cells.length ? cells[idx].trim().replace(/\r/g, '') : '';

    // Parse tanggal: coba berbagai format
    const parseDate = (raw) => {
      if (!raw) return '';
      // DD/MM/YYYY atau DD/MM/YYYY HH:MM
      let m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      // YYYY-MM-DD (sudah benar)
      m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      // YYYY/MM/DD
      m = raw.match(/(\d{4})\/(\d{2})\/(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      return '';
    };

    const orderDate = parseDate(get(CI.waktuPesan));
    const hasShopeeClick = get(CI.waktuKlik) !== '';  // apakah ada waktu klik Shopee

    rows.push({
      orderId:          get(CI.orderId),
      status:           get(CI.status),
      date:             orderDate,
      toko:             get(CI.toko),
      barang:           get(CI.barang),
      kategori1:        get(CI.kategori1),
      kategori2:        get(CI.kategori2),
      harga:            parseNum(get(CI.harga)),
      jumlah:           parseNum(get(CI.jumlah)) || 1,
      nilaiPembelian:   parseNum(get(CI.nilaiPembelian)),
      totalKomisi:      parseNum(get(CI.totalKomisi)),
      komisiBersih:     parseNum(get(CI.komisiBersih)),
      tag1:             get(CI.tag1),
      tag2:             get(CI.tag2),
      tag3:             get(CI.tag3),
      platform:         get(CI.platform),
      hasShopeeClick,   // true = klik tercatat di Shopee
    });
  }
  return rows;
}

function splitCSVLine(line, delim) {
  const result = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === delim && !inQuote) { result.push(cur); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

// --- PARSE SHOPEE WEBSITE CLICK REPORT --------------------------
function parseClickReportCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  // Header: Klik ID,Waktu Klik,Wilayah Klik,Tag_link,Perujuk
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    if (cells.length < 5) continue;
    const clickId = (cells[0] || '').trim().replace(/^\uFEFF/, '');
    const waktuKlik = (cells[1] || '').trim();
    const wilayah = (cells[2] || '').trim();
    const tagLink = (cells[3] || '').trim();
    const perujuk = (cells[4] || '').trim().replace(/\r/g, '');

    // Extract date from waktu klik (format: YYYY-MM-DD HH:MM:SS)
    const dateMatch = waktuKlik.match(/^(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch ? dateMatch[1] : '';

    // Parse tag_link segments: e.g. "MINIFOGGINGMACHINE-meta-cp03--"
    // Extract tag1 (first segment before first dash that matches a word)
    const tagParts = tagLink.split('-').filter(Boolean);
    const tag1 = tagParts[0] || '';

    rows.push({ clickId, date, waktuKlik, wilayah, tagLink, tag1, perujuk });
  }
  console.log('[ClickReport] Parsed', rows.length, 'clicks');
  return rows;
}

// Map click report Tag_link to campaign key (same as resolveShopeeKey)
function resolveClickKey(tagLink, fbNameSet, mapping) {
  if (!tagLink) return '(tidak ada tag)';
  // Try direct match with mapping
  if (mapping[tagLink]) return mapping[tagLink];
  if (fbNameSet.has(tagLink)) return tagLink;

  // The click report Tag_link format is: TAG1-meta-TAG3-- (or TAG1-TAG1-TAG1--)
  // Commission report Tag_link1 = TAG1, Tag_link3 = TAG3
  // So we extract tag1 from click report and match
  const parts = tagLink.split('-').filter(Boolean);
  const tag1 = parts[0] || '';
  if (tag1 && mapping[tag1]) return mapping[tag1];
  if (tag1 && fbNameSet.has(tag1)) return tag1;

  // Normalized match
  const normTag = normalizeName(tagLink);
  const normTag1 = normalizeName(tag1);
  for (const name of fbNameSet) {
    const normName = normalizeName(name);
    if (normName === normTag || normName === normTag1) return name;
    if (normName.includes(normTag1) || normTag1.includes(normName)) return name;
  }

  // Check existing shopee tag mapping keys
  for (const [mKey, mVal] of Object.entries(mapping)) {
    if (normalizeName(mKey) === normTag1 || tag1 === mKey) return mVal;
  }

  return tag1 || tagLink; // fallback to tag1 or full tag
}

// --- PARSE FB ADS XLSX ------------------------------------------
function parseFbXLSX(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
  console.log('[FB XLSX] rows:', raw.length);
  return extractFbRows(raw);
}

// --- PARSE FB ADS CSV -------------------------------------------
function parseFbCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0];
  const delim = (header.match(/;/g) || []).length > (header.match(/,/g) || []).length ? ';' : ',';
  const headers = splitCSVLine(header, delim).map(h => h.trim().replace(/\r/g, '').replace(/^"|"$/g, ''));

  const raw = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCSVLine(lines[i], delim);
    if (cells.length < 2) continue;
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (cells[idx] || '').trim().replace(/^"|"$/g, '').replace(/\r/g, '');
    });
    raw.push(row);
  }
  console.log('[FB CSV] rows:', raw.length);
  return extractFbRows(raw);
}

// FB "Amount spent (IDR)" selalu angka bulat — kalau export memakai format id-ID,
// '18.415' berarti delapan belas ribu (ribuan), bukan delapan belas koma empat.
// parseNum tidak bisa membedakan (rawan korup nilai Shopee 3 desimal seperti '962.745'),
// jadi guard ini khusus kolom spend FB saja.
function parseSpent(raw) {
  const s = String(raw || '').trim().replace(/[^0-9.\-]/g, '');
  return parseNum(/^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s);
}

// --- SHARED FB ROW EXTRACTOR ------------------------------------
function extractFbRows(raw) {
  const campaigns = [];
  for (const row of raw) {
    const keys = Object.keys(row);
    const get = (patterns) => {
      for (const p of patterns) {
        const k = keys.find(k => k.toLowerCase().includes(p.toLowerCase()));
        if (k !== undefined) return row[k];
      }
      return '';
    };

    const campaignName = String(get(['Campaign name', 'campaign name', 'nama campaign', 'nama kampanye']) || '').trim();
    if (!campaignName || campaignName === 'Campaign name' || /^\d{4}-\d{2}-\d{2}$/.test(campaignName)) continue;

    const parseDateAny = (raw) => {
      if (!raw) return '';
      raw = String(raw).trim();
      let m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      m = raw.match(/(\d{4})\/(\d{2})\/(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      return '';
    };
    const dateStr = get(['Day', 'Reporting starts', 'Hari', 'Tanggal mulai pelaporan', 'Date', 'Tanggal']);
    const date = parseDateAny(dateStr);

    campaigns.push({
      date,
      campaignName,
      spent:            parseSpent(get(['Amount spent', 'amount spent', 'Jumlah yang dibelanjakan'])),
      reach:            parseNum(get(['Reach', 'Jangkauan'])),
      impressions:      parseNum(get(['Impressions', 'Tayangan'])),
      linkClicks:       parseNum(get(['Link clicks', 'Klik tautan'])),
      allClicks:        parseNum(get(['Clicks (all)', 'Semua klik'])),
      cpc:              parseNum(get(['CPC (cost per link click)', 'CPC (all)', 'BPK'])),
      cpm:              parseNum(get(['CPM', 'BPT'])),
      ctr:              parseNum(get(['CTR (link click', 'CTR (all)', 'RKT'])),
      landingPageViews: parseNum(get(['Landing page views', 'Tampilan halaman landing'])),
      budget:           parseNum(get(['Ad set budget', 'Budget', 'Anggaran'])),
      delivery:         String(get(['Campaign delivery', 'Pengiriman kampanye']) || '').trim(),
    });
  }
  console.log('[FB] Campaigns:', campaigns.map(c => c.campaignName));
  return campaigns;
}

// --- RESOLVE SHOPEE KEY -----------------------------------------
function resolveShopeeKey(row, fbNameSet, mapping) {
  const tag1 = (row.tag1 || '').trim();
  const tag3 = (row.tag3 || '').trim();

  if (tag3 && mapping[tag3]) return { key: mapping[tag3], source: 'manual' };
  if (tag1 && mapping[tag1]) return { key: mapping[tag1], source: 'manual' };
  if (tag3 && fbNameSet.has(tag3)) return { key: tag3, source: 'tag3' };
  if (tag1 && fbNameSet.has(tag1)) return { key: tag1, source: 'tag1' };

  if (tag3) {
    const normTag3 = normalizeName(tag3);
    const match = [...fbNameSet].find(n => normalizeName(n) === normTag3);
    if (match) return { key: match, source: 'tag3_norm' };
  }
  if (tag1) {
    const normTag1 = normalizeName(tag1);
    const match = [...fbNameSet].find(n => normalizeName(n) === normTag1);
    if (match) return { key: match, source: 'tag1_norm' };
  }
  if (tag1) {
    const normTag1 = normalizeName(tag1);
    const match = [...fbNameSet].find(n => {
      const normN = normalizeName(n);
      return normN.includes(normTag1) || normTag1.includes(normN);
    });
    if (match) return { key: match, source: 'tag1_partial' };
  }

  if (tag3) return { key: tag3, source: 'tag3_raw' };
  if (tag1) return { key: tag1, source: 'tag1_raw' };
  return { key: '(tidak ada tag)', source: 'none' };
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

    state.fbCampaigns = [];
    for (const f of fbFiles) {
      if (f.name.match(/\.csv$/i)) {
        const text = await readAsText(f);
        state.fbCampaigns.push(...parseFbCSV(text));
      } else {
        const buf = await readAsArrayBuffer(f);
        state.fbCampaigns.push(...parseFbXLSX(buf));
      }
    }

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

// --- BUILD DASHBOARD --------------------------------------------
function buildDashboard() {
  showLoading('Membangun dashboard...');

  const dates = state.shopeeRows.map(r => r.date).filter(Boolean).sort();
  if (dates.length > 0) {
    document.getElementById('filter-start').value = dates[0];
    document.getElementById('filter-end').value = dates[dates.length - 1];
    document.getElementById('last-updated').textContent =
      `Data: ${dates[0]} - ${dates[dates.length - 1]}`;
  }

  setTimeout(() => {
    applyFilters();
    document.getElementById('section-upload').style.display = 'none';
    document.getElementById('section-dashboard').style.display = 'block';
    hideLoading();
    calcBreakeven();
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
  // Filter click report by date (per-batas, konsisten dengan filter Shopee & FB)
  state.filteredClicks = state.clickReport.filter(c => {
    if (!c.date) return true;
    if (start && c.date < start) return false;
    if (end   && c.date > end)   return false;
    return true;
  });
  console.log('[Filter] dateRatio:', state.dateRatio.toFixed(3), 'fbHasDates:', fbHasDates, 'clicks:', state.filteredClicks.length);
  renderAll();
}

function renderAll() {
  try { renderKPIs(); } catch(e) { console.warn('renderKPIs:', e); }
  try { renderInsightBar(); } catch(e) { console.warn('renderInsightBar:', e); }
  try { renderCampaignTab(); } catch(e) { console.warn('renderCampaignTab:', e); }
  try { renderProductTab(); } catch(e) { console.warn('renderProductTab:', e); }
  try { renderComparisonTab(); } catch(e) { console.warn('renderComparisonTab:', e); }
  try { renderTrendTab(); } catch(e) { console.warn('renderTrendTab:', e); }
  try { renderStatusTab(); } catch(e) { console.warn('renderStatusTab:', e); }
  try { renderDecisionTab(); } catch(e) { console.warn('renderDecisionTab:', e); }
  try { renderClickInsights(); } catch(e) { console.warn('renderClickInsights:', e); }
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
  const totalNilai  = state.filteredShopee.reduce((s, r) => s + r.nilaiPembelian, 0);

  const kpis = [
    { label: 'Total Komisi Bersih', value: 'Rp ' + fmtK(totalKomisi), sub: 'dari semua campaign', color: 'green',
      badge: totalProfit >= 0 ? { text: 'Untung', cls: 'pos' } : { text: 'Rugi', cls: 'neg' } },
    { label: 'Total Spend Iklan', value: 'Rp ' + fmtK(totalSpent), sub: 'Facebook Ads', color: 'orange' },
    { label: 'Profit / Loss', value: 'Rp ' + fmtK(Math.abs(totalProfit)),
      sub: totalProfit >= 0 ? '▲ profit' : '▼ rugi',
      color: totalProfit >= 0 ? 'green' : 'red',
      badge: totalProfit >= 0
        ? { text: '+' + fmtK(totalProfit), cls: 'pos' }
        : { text: '-' + fmtK(Math.abs(totalProfit)), cls: 'neg' }
    },
    { label: 'Overall ROAS', value: fmtRoas(overallRoas), sub: 'komisi / spend', color: overallRoas && overallRoas >= 2 ? 'green' : 'orange' },
    { label: 'Total Pesanan', value: fmt(totalOrders), sub: 'unique orders', color: 'blue' },
    { label: 'Nilai Pembelian', value: 'Rp ' + fmtK(totalNilai), sub: 'total GMV', color: 'purple' },
  ];

  document.getElementById('kpi-grid').innerHTML = kpis.map(k => `
    <div class="kpi-card ${k.color}">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-sub">${k.sub}</div>
      ${k.badge ? `<span class="kpi-badge ${k.badge.cls}">${k.badge.text}</span>` : ''}
    </div>
  `).join('');
}

// --- INSIGHT BAR ------------------------------------------------
function renderInsightBar() {
  const bar = document.getElementById('insight-bar');
  const campaigns = buildCampaignData().filter(c => c.spent > 0 || c.orders > 0);
  if (campaigns.length === 0) { bar.style.display = 'none'; return; }

  const insights = [];

  const withRoas = campaigns.filter(c => c.roas !== null);
  if (withRoas.length > 0) {
    const best = withRoas.reduce((a, b) => b.roas > a.roas ? b : a);
    insights.push({
      icon: '',
      text: `<strong>${esc(best.name)}</strong> adalah campaign terbaik dengan ROAS <strong>${best.roas.toFixed(2)}x</strong> dan komisi <strong>Rp${fmtK(best.komisi)}</strong>`,
      type: 'positive'
    });
  }

  const withSpend = campaigns.filter(c => c.spent > 0 && c.roas !== null && c.roas < 1);
  if (withSpend.length > 0) {
    const worst = withSpend.reduce((a, b) => b.roas < a.roas ? b : a);
    insights.push({
      icon: '⛔',
      text: `<strong>${esc(worst.name)}</strong> rugi dengan ROAS <strong>${worst.roas.toFixed(2)}x</strong> - disarankan di-pause atau dioptimasi kreatif`,
      type: 'negative'
    });
  }

  const highCtrLowRoas = campaigns.filter(c => c.fb && c.fb.ctr > 3 && c.roas !== null && c.roas < 1.5);
  if (highCtrLowRoas.length > 0) {
    const c = highCtrLowRoas[0];
    insights.push({
      icon: '💡',
      text: `<strong>${esc(c.name)}</strong> punya CTR tinggi (${c.fb.ctr.toFixed(1)}%) tapi ROAS rendah (${c.roas.toFixed(2)}x) - kemungkinan masalah ada di halaman produk atau harga`,
      type: 'warning'
    });
  }

  const pendingRows = state.filteredShopee.filter(r => /tertu|belum dibayar/i.test(r.status || ''));
  if (pendingRows.length > 0) {
    const pendingKomisi = pendingRows.reduce((s, r) => s + r.komisiBersih, 0);
    const pendingOrders = new Set(pendingRows.map(r => r.orderId)).size;
    insights.push({
      icon: '⏳',
      text: `<strong>${pendingOrders} pesanan</strong> masih berstatus Tertunda/Belum Dibayar - estimasi komisi pending <strong>Rp${fmtK(pendingKomisi)}</strong>`,
      type: 'neutral'
    });
  }

  const withCpo = campaigns.filter(c => c.cpo !== null && c.cpo > 0);
  if (withCpo.length > 0) {
    const mostEfficient = withCpo.reduce((a, b) => b.cpo < a.cpo ? b : a);
    insights.push({
      icon: '🎯',
      text: `Campaign <strong>${esc(mostEfficient.name)}</strong> paling efisien dengan CPO terendah: <strong>Rp${fmt(mostEfficient.cpo)}</strong> per order`,
      type: 'positive'
    });
  }

  if (insights.length === 0) { bar.style.display = 'none'; return; }

  bar.style.display = 'flex';
  bar.innerHTML = `
    <div class="insight-bar-header">💡 Quick Insights</div>
    <div class="insight-list">
      ${insights.slice(0, 4).map(ins => `
        <div class="insight-item insight-${ins.type}">
          <span class="insight-icon">${ins.icon}</span>
          <span class="insight-text">${ins.text}</span>
        </div>
      `).join('')}
    </div>
  `;
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
            borderColor: '#94a3b8', borderDash: [6,4], borderWidth: 2, pointRadius: 0, fill: false }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' }, tooltip: { callbacks: {
          label: (ctx) => ctx.dataset.label === 'ROAS' ? `ROAS: ${ctx.raw}x` : 'Break-even'
        }}},
        scales: { y: { beginAtZero: true, title: { display: true, text: 'ROAS (x)' } } }
      }
    });
  }

  destroyChart('revSpend');
  const ctxRS = document.getElementById('chart-revenue-spend');
  if (ctxRS) {
    const canvas = ensureCanvas(ctxRS);
    state.charts['revSpend'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: campaigns.map(c => c.name),
        datasets: [
          { label: 'Komisi (Rp)', data: campaigns.map(c => c.komisi), backgroundColor: '#6366f1', borderRadius: 4 },
          { label: 'Spend (Rp)',  data: campaigns.map(c => c.spent),  backgroundColor: '#f97316', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { ticks: { callback: v => 'Rp' + fmtK(v) } } }
      }
    });
  }

  destroyChart('profit');
  const ctxPL = document.getElementById('chart-profit');
  if (ctxPL) {
    const canvas = ensureCanvas(ctxPL);
    const profits = campaigns.map(c => c.profit);
    state.charts['profit'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: campaigns.map(c => c.name),
        datasets: [{ label: 'Profit/Loss (Rp)', data: profits,
          backgroundColor: profits.map(v => v >= 0 ? '#10b981' : '#ef4444'), borderRadius: 4 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { callback: v => 'Rp' + fmtK(v) } } }
      }
    });
  }

  const tbody = document.getElementById('tbody-campaign');
  tbody.innerHTML = campaigns.map(c => {
    const roasTxt   = c.roas !== null ? c.roas.toFixed(2) + 'x' : (c.spent > 0 ? '0.00x' : '-');
    const roasClass = c.roas !== null ? colorRoas(c.roas) : '';
    const cpoTxt    = c.cpo !== null ? 'Rp ' + fmt(c.cpo) : '-';
    return `<tr>
      <td><strong>${esc(c.name)}</strong>${c.fb && c.fb.delivery === 'inactive' ? ' <span class="badge badge-gray" style="font-size:10px">nonaktif</span>' : ''}</td>
      <td>${c.spent > 0 ? 'Rp ' + fmt(c.spent) : '-'}</td>
      <td>${c.orders}</td>
      <td>Rp ${fmt(c.komisi)}</td>
      <td class="${c.profit >= 0 ? 'profit-pos' : 'profit-neg'}">${c.profit >= 0 ? '(+)' : '▼'} Rp ${fmt(Math.abs(c.profit))}</td>
      <td class="${roasClass}">${roasTxt}</td>
      <td>${cpoTxt}</td>
      <td>${c.fb ? fmt(c.fb.impressions) : '-'}</td>
      <td>${c.fb ? fmt(c.fb.linkClicks) : '-'}</td>
      <td>${c.fb ? c.fb.ctr.toFixed(2) + '%' : '-'}</td>
      <td>${getStatusBadge(c.roas, c.spent)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="11" class="no-data">Tidak ada data campaign</td></tr>';
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
function renderProductTab() {
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

  const products = Object.values(byProduct)
    .map(p => ({ ...p, orders: p.orders.size, campaigns: [...p.campaigns] }))
    .sort((a, b) => b.orders - a.orders);

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
      const scatterData = hasFb.map(c => ({
        x: parseFloat(c.fb.ctr.toFixed(2)),
        y: parseFloat(c.roas.toFixed(4)),
        r: Math.max(6, (c.spent / maxSpend) * 28),
        label: c.name, spent: c.spent, roas: c.roas, ctr: c.fb.ctr,
      }));
      state.charts['scatter'] = new Chart(canvas, {
        type: 'bubble',
        data: { datasets: [{ label: 'Campaign', data: scatterData,
          backgroundColor: scatterData.map(d => d.roas >= 2 ? 'rgba(16,185,129,0.6)' : d.roas >= 1 ? 'rgba(245,158,11,0.6)' : 'rgba(239,68,68,0.6)'),
          borderColor:     scatterData.map(d => d.roas >= 2 ? '#10b981' : d.roas >= 1 ? '#f59e0b' : '#ef4444'),
          borderWidth: 2 }] },
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
            x: { title: { display:true, text:'CTR Facebook Ads (%)' }, ticks: { callback: v => v+'%' } },
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
            legend: { position: 'top' },
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

  // -- DROP-OFF CHART: % hilang di setiap tahap --
  destroyChart('clickCompare');
  const ctxClick = document.getElementById('chart-click-compare');
  if (ctxClick) {
    const hasFbData = campaigns.filter(c => c.fb && c.fbLinkClicks > 0);
    if (hasFbData.length > 0) {
      const canvas = ensureCanvas(ctxClick);
      const labels = hasFbData.map(c => c.name);
      const dropStage1 = hasFbData.map(c => (c.dropClickToShopeePct != null && isFinite(c.dropClickToShopeePct)) ? parseFloat(c.dropClickToShopeePct.toFixed(1)) : 0);
      const dropStage2 = hasFbData.map(c => (c.dropShopeeToOrderPct != null && isFinite(c.dropShopeeToOrderPct)) ? parseFloat(c.dropShopeeToOrderPct.toFixed(1)) : 0);
      const convRate   = hasFbData.map(c => (c.overallConvPct != null && isFinite(c.overallConvPct)) ? parseFloat(c.overallConvPct.toFixed(2)) : 0);

      state.charts['clickCompare'] = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets: [
          { label: 'Drop: Klik → Shopee (%)', data: dropStage1,
            backgroundColor: 'rgba(249,115,22,0.75)', borderColor: '#f97316', borderWidth: 1.5, borderRadius: 5, yAxisID: 'y' },
          { label: 'Drop: Shopee → Order (%)', data: dropStage2,
            backgroundColor: 'rgba(239,68,68,0.75)', borderColor: '#ef4444', borderWidth: 1.5, borderRadius: 5, yAxisID: 'y' },
          { label: 'Conv. Rate Klik→Order (%)', data: convRate, type: 'line',
            borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)',
            borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, fill: false, tension: 0.3, yAxisID: 'y2' }
        ]},
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => {
            if (ctx.datasetIndex === 0) return `Hilang sebelum masuk Shopee: ${ctx.raw}%`;
            if (ctx.datasetIndex === 1) return `Lihat tapi tidak order: ${ctx.raw}%`;
            return `Overall conv: ${ctx.raw}%`;
          }}}},
          scales: {
            y:  { type: 'linear', position: 'left',  title: { display: true, text: '% Drop-off' }, ticks: { callback: v => v + '%' }, min: 0, max: 100 },
            y2: { type: 'linear', position: 'right', title: { display: true, text: 'Conv. Rate (%)' }, ticks: { callback: v => v + '%' }, grid: { drawOnChartArea: false } }
          }
        }
      });
    } else {
      ctxClick.innerHTML = '<div class="chart-empty">Upload file FB Ads untuk melihat drop-off analysis.</div>';
    }
  }

  // -- Funnel Select --
  const sel = document.getElementById('funnel-campaign-select');
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">- Pilih Campaign -</option>' +
    campaigns.filter(c => c.fb).map(c =>
      `<option value="${esc(c.name)}" ${currentVal===c.name?'selected':''}>${esc(c.name)}</option>`
    ).join('');
  if (sel.value) renderFunnel();

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
      <td class="${roasClass}">${roasTxt}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="13" class="no-data">Tidak ada data</td></tr>';
}

function renderFunnel() {
  const sel       = document.getElementById('funnel-campaign-select');
  const name      = sel.value;
  const container = document.getElementById('funnel-container');

  if (!name) {
    container.innerHTML = '<div class="funnel-placeholder">Pilih campaign di atas untuk melihat funnel konversi</div>';
    return;
  }

  const c = buildCampaignData().find(x => x.name === name);
  if (!c) return;

  const impressions = c.fb ? c.fb.impressions : 0;
  const clicks      = c.fb ? c.fb.linkClicks  : 0;
  const orders      = c.orders;
  const spent       = c.spent;

  const ctr      = impressions > 0 ? (clicks  / impressions * 100).toFixed(1) : '-';
  const convRate = clicks > 0      ? (orders  / clicks  * 100).toFixed(1)     : '-';
  const roas     = c.roas !== null ? c.roas.toFixed(2) + 'x' : '-';

  const clickPct = impressions > 0 ? Math.max(10, (clicks / impressions) * 100) : 0;
  const orderPct = clicks > 0 ? Math.max(5, (orders / clicks) * clickPct)       : 0;

  container.innerHTML = `
    <div class="funnel-wrapper">
      <div class="funnel-step">
        <div class="funnel-bar fb-bar" style="width:100%">
          <span class="funnel-bar-label">Tayangan (Impressi)</span>
          <span class="funnel-bar-value">${fmt(impressions)}</span>
        </div>
        <div class="funnel-meta">Budget terpakai: <strong>Rp${fmt(spent)}</strong></div>
      </div>
      <div class="funnel-arrow">v CTR: <strong>${ctr}%</strong></div>
      <div class="funnel-step">
        <div class="funnel-bar fb-bar-2" style="width:${clickPct}%">
          <span class="funnel-bar-label">Klik Tautan</span>
          <span class="funnel-bar-value">${fmt(clicks)}</span>
        </div>
        <div class="funnel-meta">CPC rata-rata: <strong>Rp${c.fb ? fmt(c.fb.cpc) : '-'}</strong></div>
      </div>
      <div class="funnel-arrow">v Conv. Rate: <strong>${convRate}%</strong></div>
      <div class="funnel-step">
        <div class="funnel-bar shopee-bar" style="width:${Math.max(5, orderPct)}%">
          <span class="funnel-bar-label">Order Masuk</span>
          <span class="funnel-bar-value">${orders}</span>
        </div>
        <div class="funnel-meta">CPO: <strong>${c.cpo !== null ? 'Rp' + fmt(c.cpo) : '-'}</strong></div>
      </div>
      <div class="funnel-arrow">v Komisi</div>
      <div class="funnel-step">
        <div class="funnel-bar komisi-bar" style="width:${Math.max(5, orderPct * 0.8)}%">
          <span class="funnel-bar-label">Komisi Bersih</span>
          <span class="funnel-bar-value">Rp${fmt(c.komisi)}</span>
        </div>
        <div class="funnel-meta">ROAS: <strong class="${c.roas !== null ? colorRoas(c.roas) : ''}">${roas}</strong></div>
      </div>
    </div>
  `;
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

// --- STATUS TAB -------------------------------------------------
function renderStatusTab() {
  const byStatus = {};
  state.filteredShopee.forEach(r => {
    if (!byStatus[r.status]) byStatus[r.status] = { count: 0, komisi: 0, orders: new Set() };
    byStatus[r.status].orders.add(r.orderId);
    byStatus[r.status].komisi += r.komisiBersih;
  });
  Object.values(byStatus).forEach(v => { v.count = v.orders.size; });

  const statusList = Object.entries(byStatus).sort((a, b) => b[1].count - a[1].count);
  const labels  = statusList.map(([s]) => s);
  const counts  = statusList.map(([, v]) => v.count);
  const komisis = statusList.map(([, v]) => v.komisi);
  const palette = ['#6366f1','#10b981','#f97316','#ef4444','#f59e0b','#3b82f6','#8b5cf6'];

  destroyChart('statusPie');
  const ctxPie = document.getElementById('chart-status-pie');
  if (ctxPie) {
    const canvas = ensureCanvas(ctxPie);
    state.charts['statusPie'] = new Chart(canvas, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: counts, backgroundColor: palette, hoverOffset: 8 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.raw} pesanan` } } }
      }
    });
  }

  destroyChart('statusKomisi');
  const ctxSK = document.getElementById('chart-status-komisi');
  if (ctxSK) {
    const canvas = ensureCanvas(ctxSK);
    state.charts['statusKomisi'] = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Komisi (Rp)', data: komisis, backgroundColor: palette, borderRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { callback: v => 'Rp' + fmtK(v) } } }
      }
    });
  }

  const statusIcons = { 'Tertunda': '⏳', 'Selesai': '✅', 'Dibatalkan': '❌', 'Dikembalikan': '↩️', 'Belum Dibayar': '💳' };
  document.getElementById('status-summary-grid').innerHTML = statusList.map(([status, d]) => `
    <div class="status-card">
      <div class="status-card-icon">${statusIcons[status] || ''}</div>
      <div class="status-card-label">${esc(status)}</div>
      <div class="status-card-count">${d.count}</div>
      <div class="status-card-komisi">Rp ${fmt(d.komisi)}</div>
    </div>
  `).join('');
}

// --- CLICK INSIGHTS: NEGARA & JAM (butuh Click Report) ----------
function renderClickInsights() {
  const geoWrap  = document.getElementById('chart-geo');
  const hourWrap = document.getElementById('chart-hours');
  if (!geoWrap || !hourWrap) return;

  if (!state.filteredClicks || state.filteredClicks.length === 0) {
    destroyChart('geo');
    destroyChart('hours');
    geoWrap.innerHTML  = '<div class="chart-empty">Upload Shopee Click Report untuk melihat distribusi negara.</div>';
    hourWrap.innerHTML = '<div class="chart-empty">Upload Shopee Click Report untuk melihat distribusi jam.</div>';
    return;
  }

  // Klik per negara (top 10)
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

  // Klik per jam (00-23) — jam tertinggi di-highlight hijau
  const byHour = Array(24).fill(0);
  state.filteredClicks.forEach(c => {
    const h = parseInt((c.waktuKlik || '').slice(11, 13), 10);
    if (!isNaN(h) && h >= 0 && h <= 23) byHour[h]++;
  });
  const maxHour = Math.max(...byHour);
  destroyChart('hours');
  const hourCanvas = ensureCanvas(hourWrap);
  state.charts['hours'] = new Chart(hourCanvas, {
    type: 'bar',
    data: {
      labels: byHour.map((_, h) => String(h).padStart(2, '0')),
      datasets: [{ label: 'Klik', data: byHour, backgroundColor: byHour.map(v => maxHour > 0 && v === maxHour ? '#10b981' : '#3b82f6'), borderRadius: 3 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${fmt(ctx.raw)} klik` } } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'Klik' } },
        x: { title: { display: true, text: 'Jam (00-23)' } }
      }
    }
  });
}

// --- DECISION TAB -----------------------------------------------
function renderDecisionTab() {
  const campaigns = buildCampaignData().filter(c => c.spent > 0 || c.orders > 0);

  document.getElementById('decision-cards').innerHTML = campaigns.map(c => {
    let action, actionClass, icon, reason;

    if (c.spent === 0) {
      action = 'NO DATA'; actionClass = 'action-nodata'; icon = '';
      reason = 'Tidak ada data spend iklan. Kemungkinan traffic organik atau mapping belum sesuai.';
    } else if (c.roas === null || c.komisi === 0) {
      action = 'PAUSE'; actionClass = 'action-pause'; icon = '(pause)';
      reason = 'Tidak ada komisi tercatat. Periksa tracking link dan apakah iklan sedang berjalan.';
    } else if (c.roas >= 3) {
      action = 'SCALE UP'; actionClass = 'action-scale'; icon = '🚀';
      reason = `ROAS ${c.roas.toFixed(2)}x sangat baik. Pertimbangkan menambah budget 2050% secara bertahap.`;
    } else if (c.roas >= 2) {
      action = 'SCALE'; actionClass = 'action-scale'; icon = '';
      reason = `ROAS ${c.roas.toFixed(2)}x profitable. Bisa ditingkatkan budget perlahan sambil monitoring.`;
    } else if (c.roas >= 1.2) {
      action = 'MAINTAIN'; actionClass = 'action-maintain'; icon = '✅';
      reason = `ROAS ${c.roas.toFixed(2)}x untung tipis. Pertahankan dan coba optimasi kreatif iklan.`;
    } else if (c.roas >= 0.8) {
      action = 'MONITOR'; actionClass = 'action-monitor'; icon = '';
      reason = `ROAS ${c.roas.toFixed(2)}x mendekati rugi. Monitor ketat, coba A/B test creative.`;
    } else {
      action = 'PAUSE'; actionClass = 'action-pause'; icon = '⛔';
      reason = `ROAS ${c.roas.toFixed(2)}x - rugi. Pause dan evaluasi ulang produk, targeting, atau kreatif.`;
    }

    const cpoTxt   = c.cpo   ? 'Rp ' + fmt(c.cpo)       : '-';
    const roasTxt  = c.roas  !== null ? c.roas.toFixed(2) + 'x' : '-';
    const ctrTxt   = c.fb    ? c.fb.ctr.toFixed(2) + '%' : '-';
    const cpcTxt   = c.fb    ? 'Rp ' + fmt(c.fb.cpc)     : '-';
    const impTxt   = c.fb    ? fmtK(c.fb.impressions)     : '-';
    const clickTxt = c.fb    ? fmtK(c.fb.linkClicks)      : '-';

    let fbHint = '';
    if (c.fb) {
      if (c.fb.ctr < 1)  fbHint = ` CTR rendah (${ctrTxt}) - kreatif iklan perlu diperbaiki.`;
      else if (c.fb.ctr > 5) fbHint = ` CTR tinggi (${ctrTxt}) - audiens tertarik, masalah mungkin di produk/harga.`;
      if (c.fb.cpc > 5000) fbHint += ` CPC mahal (Rp${fmt(c.fb.cpc)}) - narrow audience atau kompetisi tinggi.`;
    }

    return `
    <div class="decision-card">
      <div class="decision-card-header">
        <span class="decision-action-icon">${icon}</span>
        <span class="decision-campaign-name">${esc(c.name)}</span>
        <span class="decision-action-badge ${actionClass}">${action}</span>
      </div>
      <div class="decision-metrics">
        <div class="dm-item"><div class="dm-label">ROAS</div><div class="dm-value ${colorRoas(c.roas)}">${roasTxt}</div></div>
        <div class="dm-item"><div class="dm-label">Spend</div><div class="dm-value">Rp${fmtK(c.spent)}</div></div>
        <div class="dm-item"><div class="dm-label">Komisi</div><div class="dm-value">Rp${fmtK(c.komisi)}</div></div>
        <div class="dm-item"><div class="dm-label">CPO</div><div class="dm-value">${cpoTxt}</div></div>
        <div class="dm-item"><div class="dm-label">Orders</div><div class="dm-value">${c.orders}</div></div>
      </div>
      ${c.fb ? `<div class="decision-metrics" style="margin-top:6px;padding-top:10px;border-top:1px solid #f1f5f9">
        <div class="dm-item"><div class="dm-label">Impresi</div><div class="dm-value" style="font-size:13px">${impTxt}</div></div>
        <div class="dm-item"><div class="dm-label">Klik</div><div class="dm-value" style="font-size:13px">${clickTxt}</div></div>
        <div class="dm-item"><div class="dm-label">CTR</div><div class="dm-value" style="font-size:13px;${c.fb.ctr < 1 ? 'color:#ef4444' : c.fb.ctr > 3 ? 'color:#10b981' : ''}">${ctrTxt}</div></div>
        <div class="dm-item"><div class="dm-label">CPC</div><div class="dm-value" style="font-size:13px">${cpcTxt}</div></div>
      </div>` : ''}
      <div class="decision-reason">${reason}${fbHint}</div>
    </div>`;
  }).join('') || '<p class="no-data">Tidak ada data untuk ditampilkan.</p>';
}

// --- BREAKEVEN --------------------------------------------------
function calcBreakeven() {
  const budget      = parseNum(document.getElementById('be-budget').value);
  const avgKomisi   = parseNum(document.getElementById('be-komisi').value);
  const targetProfit = parseNum(document.getElementById('be-profit').value);

  if (budget <= 0 || avgKomisi <= 0) {
    document.getElementById('be-result').innerHTML = 'Isi nilai budget dan komisi rata-rata.';
    return;
  }

  const ordersNeeded  = Math.ceil((budget + targetProfit) / avgKomisi);
  const minRoas       = (budget + targetProfit) / budget;
  const komisiNeeded  = budget + targetProfit;

  document.getElementById('be-result').innerHTML = `
    ❌ Dengan budget <strong>Rp ${fmt(budget)}</strong>/hari dan komisi rata-rata <strong>Rp ${fmt(avgKomisi)}</strong>/order:<br>
     Minimum <strong>${ordersNeeded} order</strong>/hari dibutuhkan agar tidak rugi<br>
     Minimum komisi total <strong>Rp ${fmt(komisiNeeded)}</strong>/hari<br>
     ROAS minimum: <strong>${minRoas.toFixed(2)}x</strong>
    ${targetProfit > 0 ? `<br> Untuk profit Rp ${fmt(targetProfit)}, butuh ROAS <strong>${minRoas.toFixed(2)}x</strong>` : ''}
  `;
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
    document.getElementById('filter-start').value = dates[0];
    document.getElementById('filter-end').value   = dates[dates.length - 1];
  }
  applyFilters();
}

function resetAll() {
  if (!confirm('Reset semua data dan kembali ke halaman upload?')) return;
  shopeeFiles = []; fbFiles = []; clickFiles = [];
  state.shopeeRows = []; state.fbCampaigns = []; state.clickReport = [];
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
  state.fbCampaigns.forEach(c => { state.mapping[c.campaignName] = c.campaignName; });

  setTimeout(() => { buildDashboard(); }, 300);
}
