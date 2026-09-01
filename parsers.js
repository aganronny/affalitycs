/* ============================================================
   AFFALITYCS - parsers.js
   Lapisan data murni: parsing CSV/XLSX, format angka, matching.
   TIDAK menyentuh DOM - bisa dites via Node (tests/parsers.test.js)
   v2.4 - Agustus 2026
   ============================================================ */

// --- FORMAT & PARSE ANGKA ---------------------------------------
const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n));
const fmtK = (n) => {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1_000_000) return sign + (a/1_000_000).toFixed(1) + 'Jt';
  if (a >= 1_000) return sign + (a/1_000).toFixed(1) + 'rb';
  return String(Math.round(a));
};
const fmtRoas = (r) => r === null || r === undefined || !isFinite(r) ? '-' : r.toFixed(2) + 'x';
const parseNum = (s) => {
  if (s === null || s === undefined || s === '' || s === '-') return 0;
  return parseFloat(String(s).replace(/[^0-9.\-]/g, '')) || 0;
};

// FB "Amount spent (IDR)" selalu angka bulat — kalau export memakai format id-ID,
// '18.415' berarti delapan belas ribu (ribuan), bukan delapan belas koma empat.
// parseNum tidak bisa membedakan (rawan korup nilai Shopee 3 desimal seperti '962.745'),
// jadi guard ini khusus kolom spend FB saja.
function parseSpent(raw) {
  const s = String(raw || '').trim().replace(/[^0-9.\-]/g, '');
  return parseNum(/^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s);
}

// Escape string sebelum masuk innerHTML — data CSV Shopee/FB bisa berisi <, >, &, "
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const normalizeName = (s) => String(s || '').toLowerCase().replace(/[\s\-_\.-]/g, '');

// --- CSV SPLIT (quote-aware) ------------------------------------
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
    idBarang:       col('ID Barang'),
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
    const orderHourMatch = get(CI.waktuPesan).match(/^\d{4}-\d{2}-\d{2} (\d{2})/);
    const orderHour = orderHourMatch ? parseInt(orderHourMatch[1], 10) : null; // 0-23, buat analisis per jam
    const hasShopeeClick = get(CI.waktuKlik) !== '';  // apakah ada waktu klik Shopee

    rows.push({
      orderId:          get(CI.orderId),
      status:           get(CI.status),
      date:             orderDate,
      orderHour,        // jam order (dari Waktu Pemesanan)
      toko:             get(CI.toko),
      barang:           get(CI.barang),
      idBarang:         get(CI.idBarang),
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
function fbRawFromXLSX(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
}

// --- PARSE FB ADS CSV -------------------------------------------
function fbRawFromCSV(text) {
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
  return raw;
}

function parseFbCSV(text) {
  return extractFbRows(fbRawFromCSV(text));
}

function parseFbXLSX(arrayBuffer) {
  return extractFbRows(fbRawFromXLSX(arrayBuffer));
}

// --- FB BREAKDOWN (Age / Gender / Platform / Region) -------------
// File dari Ads Manager dengan Breakdown diaktifkan: baris per campaign x nilai breakdown.
// Kolom breakdown opsional — kalau tidak ada satu pun, baris di-skip (bukan file breakdown).
const FB_AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];

function normalizeFbGender(g) {
  const s = String(g || '').trim().toLowerCase();
  if (!s) return '';
  // cek 'female' SEBELUM 'male' ('female' mengandung 'male')
  if (s === 'female' || s === 'f' || s.startsWith('perempuan')) return 'Perempuan';
  if (s === 'male' || s === 'm' || s.startsWith('laki')) return 'Laki-laki';
  if (s === 'unknown') return 'Tidak diketahui';
  return String(g || '').trim();
}

function extractFbBreakdown(raw) {
  const rows = [];
  for (const row of raw) {
    const keys = Object.keys(row);
    // exact dulu, baru includes — agar 'Platform' tidak menempel ke 'Platform position'
    const getExact = (patterns) => {
      for (const p of patterns) {
        const k = keys.find(k => k.toLowerCase() === p.toLowerCase());
        if (k !== undefined) return row[k];
      }
      return '';
    };
    const getIn = (patterns) => {
      for (const p of patterns) {
        const k = keys.find(k => k.toLowerCase().includes(p.toLowerCase()));
        if (k !== undefined) return row[k];
      }
      return '';
    };

    const age = String(getExact(['Age', 'Usia']) || '').trim();
    const gender = normalizeFbGender(getExact(['Gender', 'Jenis kelamin']));
    const region = String(getExact(['Region', 'Wilayah']) || '').trim();
    const platform = String(getExact(['Publisher platform', 'Platform']) || '').trim();
    if (!age && !gender && !region && !platform) continue;

    const campaignName = String(getIn(['Campaign name', 'nama campaign', 'nama kampanye']) || '').trim();
    if (!campaignName || campaignName === 'Campaign name') continue;

    const parseDateAny = (v) => {
      const rawd = String(v || '').trim();
      if (!rawd) return '';
      let m = rawd.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      m = rawd.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      m = rawd.match(/(\d{4})\/(\d{2})\/(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      return '';
    };

    rows.push({
      campaignName,
      date: parseDateAny(getIn(['Day', 'Reporting starts', 'Hari', 'Tanggal mulai pelaporan', 'Date', 'Tanggal'])),
      age, gender, region, platform,
      spent:       parseSpent(getIn(['Amount spent', 'Jumlah yang dibelanjakan'])),
      impressions: parseNum(getIn(['Impressions', 'Tayangan'])),
      linkClicks:  parseNum(getIn(['Link clicks', 'Klik tautan'])),
    });
  }
  return rows;
}

function parseFbBreakdownCSV(text) {
  return extractFbBreakdown(fbRawFromCSV(text));
}

function parseFbBreakdownXLSX(arrayBuffer) {
  return extractFbBreakdown(fbRawFromXLSX(arrayBuffer));
}

// Klik link: export biasa punya kolom "Link clicks"; export dengan Breakdown/level lain
// kadang kehilangan kolom itu — fallback ke "Results" kalau Result indicator = actions:link_click
function fbLinkClicksOf(row, keys, get) {
  let lc = parseNum(get(['Link clicks', 'Klik tautan']));
  if (!lc) {
    const ri = String(get(['Result indicator', 'Indikator hasil']) || '').toLowerCase();
    if (ri.includes('link_click')) {
      const keysLower = keys.map(k => k.toLowerCase());
      const iExact = keysLower.indexOf('results');
      const iInc = keysLower.findIndex(k => k.includes('results') && !k.includes('cost'));
      const key = iExact >= 0 ? keys[iExact] : (iInc >= 0 ? keys[iInc] : undefined);
      if (key !== undefined) lc = parseNum(row[key]);
    }
  }
  return lc || 0;
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
    const endDate = parseDateAny(get(['Reporting ends', 'Tanggal akhir pelaporan']));
    const linkClicks = fbLinkClicksOf(row, keys, get);

    campaigns.push({
      date,
      endDate,
      campaignName,
      spent:            parseSpent(get(['Amount spent', 'amount spent', 'Jumlah yang dibelanjakan'])),
      reach:            parseNum(get(['Reach', 'Jangkauan'])),
      impressions:      parseNum(get(['Impressions', 'Tayangan'])),
      linkClicks,
      allClicks:        parseNum(get(['Clicks (all)', 'Semua klik'])),
      cpc:              parseNum(get(['CPC (cost per link click)', 'CPC (all)', 'BPK'])),
      cpm:              parseNum(get(['CPM', 'BPT'])),
      ctr:              parseNum(get(['CTR (link click', 'CTR (all)', 'RKT'])),
      landingPageViews: parseNum(get(['Landing page views', 'Tampilan halaman landing'])),
      budget:           parseNum(get(['Ad set budget', 'Budget', 'Anggaran'])),
      delivery:         String(get(['Campaign delivery', 'Pengiriman kampanye']) || '').trim(),
    });
  }
  return campaigns;
}

// --- DEDUP BARIS KOMISI -----------------------------------------
// Upload file komisi yang periodenya overlap = order sama kehitung komisi 2x.
// Baris identik (order+produk+nilai sama persis) dianggap duplikat.
function dedupShopeeRows(rows) {
  const seen = new Set();
  const out = [];
  let removed = 0;
  rows.forEach(r => {
    const k = [r.orderId, r.status, r.date, r.toko, r.barang, r.harga, r.jumlah,
      r.nilaiPembelian, r.komisiBersih, r.tag1, r.tag3, r.platform].join('¦');
    if (seen.has(k)) { removed++; return; }
    seen.add(k);
    out.push(r);
  });
  return { rows: out, removed };
}

// --- FB BREAKDOWN vs FILE CAMPAIGN BIASA ------------------------
// File breakdown berisi beberapa baris per (campaign, tanggal) — itu sah.
// Aturan anti-dobel antar file:
//  - Grup (campaign,tanggal) yang punya baris file biasa → pakai baris biasa saja
//  - Grup yang SEMUA barisnya dari file breakdown → pakai file breakdown pertama saja
function resolveFbCampaignRows(rows) {
  const groups = new Map();
  rows.forEach(r => {
    const k = r.campaignName + '|' + (r.date || '');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  const kept = [];
  groups.forEach(gr => {
    if (gr.length === 1) { kept.push(gr[0]); return; }
    const plain = gr.filter(r => !r._fromBreakdown);
    if (plain.length > 0) { plain.forEach(r => kept.push(r)); return; }
    const idxOf = (r) => r._fileIdx === undefined ? 0 : r._fileIdx;
    const minIdx = Math.min(...gr.map(idxOf));
    gr.forEach(r => { if (idxOf(r) === minIdx) kept.push(r); });
  });
  return kept;
}

// --- FB ADS LEVEL AD (Ad name / Ad set name) ---------------------
// Export dari Ads Manager dengan level "Ad": tiap baris = satu iklan.
// Satu campaign bisa punya banyak adset & ad, masing-masing dengan tag sendiri
// (tag ditanam di NAMA ad) — tabel per-ad menjawab "ad mana yang jualan".
function extractFbAdRows(raw) {
  const out = [];
  for (const row of raw) {
    const keys = Object.keys(row);
    const get = (patterns) => {
      for (const p of patterns) {
        const k = keys.find(k => k.toLowerCase().includes(p.toLowerCase()));
        if (k !== undefined) return row[k];
      }
      return '';
    };
    const adName = String(get(['Ad name', 'Nama iklan']) || '').trim();
    if (!adName || adName === 'Ad name' || /^\d{4}-\d{2}-\d{2}$/.test(adName)) continue;
    const adSetName = String(get(['Ad set name', 'Nama set iklan']) || '').trim();
    const campaignName = String(get(['Campaign name', 'nama kampanye', 'nama campaign']) || '').trim();

    const parseDateAny = (v) => {
      const rawd = String(v || '').trim();
      if (!rawd) return '';
      let m = rawd.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      m = rawd.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      m = rawd.match(/(\d{4})\/(\d{2})\/(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      return '';
    };

    out.push({
      date: parseDateAny(get(['Day', 'Reporting starts', 'Hari', 'Tanggal mulai pelaporan', 'Date', 'Tanggal'])),
      endDate: parseDateAny(get(['Reporting ends', 'Tanggal akhir pelaporan'])),
      adName,
      adSetName,
      campaignName,
      spent:       parseSpent(get(['Amount spent', 'Jumlah yang dibelanjakan'])),
      impressions: parseNum(get(['Impressions', 'Tayangan'])),
      linkClicks:  fbLinkClicksOf(row, keys, get),
    });
  }
  return out;
}

// Jika file ad-level tidak memiliki kolom "Campaign name", agregat campaign
// disintesis dari baris ad (jumlah semua ad = total campaign).
function synthesizeCampaignRowsFromAds(adsRows) {
  const groups = new Map();
  adsRows.forEach(a => {
    const key = (a.campaignName || a.adName) + '|' + (a.date || '');
    if (!groups.has(key)) groups.set(key, { campaignName: a.campaignName || a.adName, date: a.date || '', endDate: '', spent: 0, reach: 0, impressions: 0, linkClicks: 0, landingPageViews: 0 });
    const g = groups.get(key);
    g.spent += a.spent || 0;
    g.reach += a.reach || 0;
    g.impressions += a.impressions || 0;
    g.linkClicks += a.linkClicks || 0;
    g.landingPageViews += a.landingPageViews || 0;
    if (a.endDate && a.endDate > g.endDate) g.endDate = a.endDate;
  });
  return [...groups.values()].map(g => ({
    date: g.date, endDate: g.endDate, campaignName: g.campaignName,
    spent: g.spent, reach: g.reach, impressions: g.impressions,
    linkClicks: g.linkClicks, allClicks: 0, cpc: 0, cpm: 0, ctr: 0,
    landingPageViews: g.landingPageViews, budget: 0, delivery: '',
  }));
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

// --- NODE EXPORT (untuk unit test) ------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fmt, fmtK, fmtRoas, parseNum, parseSpent, esc, normalizeName, splitCSVLine,
    parseShopeeCSV, parseClickReportCSV, dedupShopeeRows,
    fbRawFromCSV, fbRawFromXLSX, parseFbCSV, parseFbXLSX, extractFbRows,
    FB_AGE_ORDER, normalizeFbGender, extractFbBreakdown, parseFbBreakdownCSV, parseFbBreakdownXLSX,
    resolveFbCampaignRows,
    extractFbAdRows,
    synthesizeCampaignRowsFromAds,
    resolveShopeeKey, resolveClickKey,
  };
}
