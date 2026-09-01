/* ============================================================
   Unit test parser Affalitycs — jalan tanpa framework:
   node tests\parsers.test.js
   Kalau semua lulus: "ALL TESTS PASSED". Kalau ada yang gagal,
   test berhenti di kasus pertama yang salah.
   ============================================================ */
const assert = require('assert');
const P = require('../parsers.js');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  OK  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exit(1); }
}

// ---------- parseNum (TIDAK boleh diubah: Shopee pakai titik desimal) ----------
console.log('parseNum');
t("'962.745' = 962.745 (3 desimal Shopee, BUKAN 962745)", () => assert.strictEqual(P.parseNum('962.745'), 962.745));
t("'102.35' = 102.35", () => assert.strictEqual(P.parseNum('102.35'), 102.35));
t("'18415' = 18415", () => assert.strictEqual(P.parseNum('18415'), 18415));
t("'' = 0, '-' = 0, null = 0", () => { assert.strictEqual(P.parseNum(''), 0); assert.strictEqual(P.parseNum('-'), 0); assert.strictEqual(P.parseNum(null), 0); });
t("'2.140992' (CTR FB) = 2.140992", () => assert.strictEqual(P.parseNum('2.140992'), 2.140992));

// ---------- parseSpent (guard ribuan khusus FB spend) ----------
console.log('parseSpent');
t("'18415' = 18415", () => assert.strictEqual(P.parseSpent('18415'), 18415));
t("'18.415' = 18415 (ribuan id-ID)", () => assert.strictEqual(P.parseSpent('18.415'), 18415));
t("'1.234.567' = 1234567", () => assert.strictEqual(P.parseSpent('1.234.567'), 1234567));
t("'149.71544715' = 149.71544715 (desimal panjang, bukan ribuan)", () => assert.strictEqual(P.parseSpent('149.71544715'), 149.71544715));
t("'Rp 25.000' = 25000", () => assert.strictEqual(P.parseSpent('Rp 25.000'), 25000));
t("'' = 0", () => assert.strictEqual(P.parseSpent(''), 0));

// ---------- fmtK (termasuk negatif) ----------
console.log('fmtK');
t("1500000 = '1.5Jt'", () => assert.strictEqual(P.fmtK(1500000), '1.5Jt'));
t("-2500 = '-2.5rb'", () => assert.strictEqual(P.fmtK(-2500), '-2.5rb'));
t("950 = '950'", () => assert.strictEqual(P.fmtK(950), '950'));
t("-1234567 = '-1.2Jt'", () => assert.strictEqual(P.fmtK(-1234567), '-1.2Jt'));

// ---------- esc ----------
console.log('esc');
t("escape < > & \" '", () => assert.strictEqual(P.esc('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;'));

// ---------- splitCSVLine ----------
console.log('splitCSVLine');
t("koma dalam tanda kutip tidak dipecah (kutip dilepas)", () =>
  assert.deepStrictEqual(P.splitCSVLine('a,"b,c",d', ','), ['a', 'b,c', 'd']));
t("delimiter titik koma", () =>
  assert.deepStrictEqual(P.splitCSVLine('a;b;c', ';'), ['a', 'b', 'c']));

// ---------- parseShopeeCSV ----------
console.log('parseShopeeCSV');
t("delimiter koma + BOM + nama produk berkoma + komisi 3 desimal", () => {
  const csv = '\uFEFFID Pemesanan,Status Pesanan,Waktu Pemesanan,Waktu Klik,Nama Toko,Nama Barange,L1 Kategori Global,Harga(Rp),Jumlah,Nilai Pembelian(Rp),Total Komisi per Pesanan(Rp),Komisi Bersih Affiliate (Rp),Status Produk Affiliate,Tipe Pesanan,Tag_link1,Tag_link2,Tag_link3,Platform\n' +
    'ORD123,Tertunda,2026-08-28 22:02:14,,Toko ABC,"MATRAS MOBIL, SHENARCORN",Mobil,220000,1,187900,4697.5,4697.5,Ada,Pesanan,gacoan01,,meta,Facebook\n';
  const rows = P.parseShopeeCSV(csv);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].orderId, 'ORD123');
  assert.strictEqual(rows[0].barang, 'MATRAS MOBIL, SHENARCORN');
  assert.strictEqual(rows[0].komisiBersih, 4697.5);
  assert.strictEqual(rows[0].tag1, 'gacoan01');
  assert.strictEqual(rows[0].date, '2026-08-28');
  assert.strictEqual(rows[0].hasShopeeClick, false);
});
t("tanggal DD/MM/YYYY dinormalisasi ke YYYY-MM-DD", () => {
  const csv = 'ID Pemesanan;Status Pesanan;Waktu Pemesanan;Waktu Klik;Nama Toko;Nama Barange;Harga(Rp);Jumlah;Nilai Pembelian(Rp);Komisi Bersih Affiliate (Rp);Tag_link1\n' +
    'ORD1;Selesai;28/08/2026 10:00;;Toko;Barang;1000;1;1000;50;cp01\n';
  const rows = P.parseShopeeCSV(csv);
  assert.strictEqual(rows[0].date, '2026-08-28');
});
t("kolom multi-baris 1 order (komisi cuma di baris pertama)", () => {
  const csv = 'ID Pemesanan,Status Pesanan,Waktu Pemesanan,Nama Barange,Nilai Pembelian(Rp),Komisi Bersih Affiliate (Rp),Tag_link1\n' +
    'ORD1,Tertunda,2026-08-28 10:00,Produk A,10000,500,cp01\n' +
    'ORD1,Tertunda,2026-08-28 10:00,Produk B,5000,0,cp01\n';
  const rows = P.parseShopeeCSV(csv);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows.reduce((s, r) => s + r.komisiBersih, 0), 500);
});
t("orderHour diparse dari Waktu Pemesanan (23:35 -> 23)", () => {
  const csv = 'ID Pemesanan,Status Pesanan,Waktu Pemesanan,Nama Barange,Komisi Bersih Affiliate (Rp),Tag_link1\n' +
    'ORD9,Tertunda,2026-08-28 23:35:51,Produk Z,100,cp01\n';
  const rows = P.parseShopeeCSV(csv);
  assert.strictEqual(rows[0].orderHour, 23);
});
t("orderHour null kalau Waktu Pemesanan kosong/rusak", () => {
  const csv = 'ID Pemesanan,Status Pesanan,Waktu Pemesanan,Nama Barange,Komisi Bersih Affiliate (Rp),Tag_link1\n' +
    'ORD8,Tertunda,,Produk Y,100,cp01\n';
  const rows = P.parseShopeeCSV(csv);
  assert.strictEqual(rows[0].orderHour, null);
});
t("ID Barang ikut terbaca (kunci pengelompokan produk)", () => {
  const csv = 'ID Pemesanan,Status Pesanan,Waktu Pemesanan,Nama Barange,ID Barang,Komisi Bersih Affiliate (Rp),Tag_link1\n' +
    'ORD7,Tertunda,2026-08-28 10:00,Judul A versi pendek,999888,100,cp01\n' +
    'ORD7,Tertunda,2026-08-28 10:00,Judul A versi pendek (varian lain judul),999888,0,cp01\n';
  const rows = P.parseShopeeCSV(csv);
  assert.strictEqual(rows[0].idBarang, '999888');
  assert.strictEqual(rows[1].idBarang, '999888');
});

// ---------- parseClickReportCSV ----------
console.log('parseClickReportCSV');
t("format asli Shopee: BOM di kolom pertama, tag 'gacoan01----' -> tag1 'gacoan01'", () => {
  const csv = '\uFEFFKlik ID,Waktu Klik,Wilayah Klik,Tag_link,Perujuk\n' +
    'abc123,2026-08-28 23:59:47,-,gacoan01----,Facebook\n' +
    'def456,2026-08-28 13:05:06,Indonesia,cucipiring01----,Others\n';
  const rows = P.parseClickReportCSV(csv);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].clickId, 'abc123');
  assert.strictEqual(rows[0].tag1, 'gacoan01');
  assert.strictEqual(rows[0].date, '2026-08-28');
  assert.strictEqual(rows[1].perujuk, 'Others');
});

// ---------- parseFbCSV ----------
console.log('parseFbCSV');
t("header berkoma dalam kutip ('CPM (cost per 1,000 impressions)') tetap kebaca", () => {
  const csv = '"Reporting starts","Campaign name","Amount spent (IDR)","Link clicks","Impressions","CPM (cost per 1,000 impressions) (IDR)","Ad set budget"\n' +
    '"2026-08-28","catok01","18415","123","5745","3205.395997","20000"\n' +
    '"2026-08-28","hilo01","18.415","119","4942","3663","20000"\n';
  const rows = P.parseFbCSV(csv);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].campaignName, 'catok01');
  assert.strictEqual(rows[0].date, '2026-08-28');
  assert.strictEqual(rows[0].spent, 18415);
  assert.strictEqual(rows[0].cpm, 3205.395997);
  t('  dan "18.415" dari locale id = 18415', () => assert.strictEqual(rows[1].spent, 18415));
});
t("baris tanggal (bukan campaign) dibuang", () => {
  const csv = '"Day","Campaign name","Amount spent (IDR)"\n"2026-08-28","2026-08-28","100"\n"2026-08-28","cp01","100"\n';
  const rows = P.parseFbCSV(csv);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].campaignName, 'cp01');
});

// ---------- resolveShopeeKey ----------
console.log('resolveShopeeKey');
const fbSet = new Set(['Gacoan01 Ads', 'cp02']);
t("prioritas: manual mapping > exact", () => {
  assert.deepStrictEqual(P.resolveShopeeKey({ tag1: 'gacoan01', tag3: '' }, fbSet, { gacoan01: 'Gacoan01 Ads' }), { key: 'Gacoan01 Ads', source: 'manual' });
});
t("exact tag1 match", () => {
  assert.deepStrictEqual(P.resolveShopeeKey({ tag1: 'cp02', tag3: '' }, fbSet, {}), { key: 'cp02', source: 'tag1' });
});
t("normalized match (beda spasi/huruf)", () => {
  assert.deepStrictEqual(P.resolveShopeeKey({ tag1: 'gacoan_01', tag3: '' }, fbSet, {}), { key: 'Gacoan01 Ads', source: 'tag1_partial' });
});
t("fallback tag mentah kalau gak match sama sekali", () => {
  assert.deepStrictEqual(P.resolveShopeeKey({ tag1: 'zzz', tag3: '' }, fbSet, {}), { key: 'zzz', source: 'tag1_raw' });
});

// ---------- resolveClickKey ----------
console.log('resolveClickKey');
t("'gacoan01----' -> exact via tag1", () =>
  assert.strictEqual(P.resolveClickKey('gacoan01----', new Set(['gacoan01']), {}), 'gacoan01'));
t("mapping manual diprioritaskan", () =>
  assert.strictEqual(P.resolveClickKey('gacoan01----', new Set(), { gacoan01: 'Gacoan Ads' }), 'Gacoan Ads'));

// ---------- extractFbBreakdown ----------
console.log('extractFbBreakdown');
const bdCsv = '"Reporting starts","Campaign name","Amount spent (IDR)","Link clicks","Impressions","Age","Gender"\n' +
  '"2026-08-28","cp01","1000","10","100","18-24","male"\n' +
  '"2026-08-28","cp01","2500","20","200","25-34","female"\n' +
  '"2026-08-28","cp01","500","3","50","35-44","unknown"\n';
const bd = P.extractFbBreakdown(P.fbRawFromCSV(bdCsv));
t("3 baris breakdown terbaca", () => assert.strictEqual(bd.length, 3));
t("gender 'male' -> Laki-laki, 'female' -> Perempuan, 'unknown' -> Tidak diketahui", () => {
  assert.strictEqual(bd[0].gender, 'Laki-laki');
  assert.strictEqual(bd[1].gender, 'Perempuan');
  assert.strictEqual(bd[2].gender, 'Tidak diketahui');
});
t("spent pakai parseSpent ('1.000' = seribu)", () => {
  const bd2 = P.extractFbBreakdown(P.fbRawFromCSV(bdCsv.replace('"1000"', '"1.000"')));
  assert.strictEqual(bd2[0].spent, 1000);
});
t("file campaign biasa (tanpa kolom breakdown) -> array kosong", () => {
  const plain = '"Reporting starts","Campaign name","Amount spent (IDR)","Link clicks"\n"2026-08-28","cp01","5000","50"\n';
  assert.strictEqual(P.extractFbBreakdown(P.fbRawFromCSV(plain)).length, 0);
});
t("extractFbRows tetap bekerja di file yang sama (agregat campaign)", () => {
  const camp = P.extractFbRows(P.fbRawFromCSV(bdCsv));
  assert.strictEqual(camp.length, 3);
  assert.strictEqual(camp[0].campaignName, 'cp01');
});

// ---------- resolveFbCampaignRows ----------
console.log('resolveFbCampaignRows');
const mkRow = (name, date, fromBd, fileIdx) => ({ campaignName: name, date, _fromBreakdown: fromBd, _fileIdx: fileIdx, spent: 100 });
t("file breakdown saja (4 baris per campaign+tanggal) → semua dipakai, gak ada yang dibuang", () => {
  const rows = ['18-24', '25-34', '35-44', '45-54'].map((_, i) => mkRow('cp01', '2026-08-29', true, 0));
  const kept = P.resolveFbCampaignRows(rows);
  assert.strictEqual(kept.length, 4);
});
t("file breakdown + file biasa untuk periode sama → baris biasa yang dipakai", () => {
  const rows = [
    mkRow('cp01', '2026-08-29', true, 0),
    mkRow('cp01', '2026-08-29', true, 0),
    mkRow('cp01', '2026-08-29', true, 0),
    mkRow('cp01', '2026-08-29', false, 1),
  ];
  const kept = P.resolveFbCampaignRows(rows);
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(kept[0]._fromBreakdown, false);
});
t("dua file breakdown beda jenis untuk periode sama → file pertama yang dipakai", () => {
  const rows = [
    mkRow('cp01', '2026-08-29', true, 0),
    mkRow('cp01', '2026-08-29', true, 0),
    mkRow('cp01', '2026-08-29', true, 1),
    mkRow('cp01', '2026-08-29', true, 1),
  ];
  const kept = P.resolveFbCampaignRows(rows);
  assert.strictEqual(kept.length, 2);
  assert.ok(kept.every(r => r._fileIdx === 0));
});
t("file biasa overlap (dua file biasa) → tetap dipertahankan semua (warning yang bekerja)", () => {
  const rows = [mkRow('cp01', '2026-08-29', false, 0), mkRow('cp01', '2026-08-29', false, 1)];
  const kept = P.resolveFbCampaignRows(rows);
  assert.strictEqual(kept.length, 2);
});
t("campaign beda tanggal tidak saling terpengaruh", () => {
  const rows = [mkRow('cp01', '2026-08-28', false, 0), mkRow('cp01', '2026-08-29', false, 0)];
  const kept = P.resolveFbCampaignRows(rows);
  assert.strictEqual(kept.length, 2);
});

// ---------- export dengan Breakdown: kolom "Link clicks" hilang ----------
console.log('extractFbRows (breakdown export)');
t("linkClicks fallback ke 'Results' kalau Result indicator = actions:link_click", () => {
  const csv = '"Reporting starts","Campaign name",Age,Gender,"Amount spent (IDR)","Results","Result indicator","Clicks (all)","Impressions"\n' +
    '"2026-08-28","cp01","18-24","female","3094","21","actions:link_click","26","837"\n';
  const rows = P.extractFbRows(P.fbRawFromCSV(csv));
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].linkClicks, 21);
  assert.strictEqual(rows[0].impressions, 837);
  assert.strictEqual(rows[0].spent, 3094);
});
t("Results gak dipakai kalau Result indicator bukan link_click", () => {
  const csv = '"Reporting starts","Campaign name","Amount spent (IDR)","Results","Result indicator","Impressions"\n' +
    '"2026-08-28","cp01","5000","77","landing_page_view","1000"\n';
  const rows = P.extractFbRows(P.fbRawFromCSV(csv));
  assert.strictEqual(rows[0].linkClicks, 0);
});
t("file biasa (ada kolom Link clicks) tetap kebaca seperti biasa", () => {
  const csv = '"Reporting starts","Campaign name","Amount spent (IDR)","Link clicks","Impressions"\n' +
    '"2026-08-28","cp01","5000","50","1000"\n';
  const rows = P.extractFbRows(P.fbRawFromCSV(csv));
  assert.strictEqual(rows[0].linkClicks, 50);
});

// ---------- extractFbAdRows (export level Ad) ----------
console.log('extractFbAdRows');
t("export level Ad: Ad name + Ad set + Campaign + Results fallback", () => {
  const csv = '"Reporting starts","Campaign name","Ad set name","Ad name","Amount spent (IDR)","Results","Result indicator","Impressions"\n' +
    '"2026-08-28","gacoan","gacoan01-broad","gacoan01-video-A","15000","120","actions:link_click","3000"\n' +
    '"2026-08-28","cp-x","cs-x","TanpaTag Ad 123","","5","actions:link_click","100"\n';
  const rows = P.extractFbAdRows(P.fbRawFromCSV(csv));
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].adName, 'gacoan01-video-A');
  assert.strictEqual(rows[0].campaignName, 'gacoan');
  assert.strictEqual(rows[0].linkClicks, 120);
  assert.strictEqual(rows[0].spent, 15000);
});
t("file campaign level (tanpa kolom Ad name) -> array kosong", () => {
  const csv = '"Reporting starts","Campaign name","Amount spent (IDR)","Link clicks"\n"2026-08-28","cp01","5000","50"\n';
  assert.strictEqual(P.extractFbAdRows(P.fbRawFromCSV(csv)).length, 0);
});
t("baris tanggal/total dibuang (bukan ad)", () => {
  const csv = '"Reporting starts","Campaign name","Ad name","Amount spent (IDR)"\n"2026-08-28","2026-08-28","2026-08-28","100"\n';
  assert.strictEqual(P.extractFbAdRows(P.fbRawFromCSV(csv)).length, 0);
});
t("file ad-level TANPA kolom Campaign name → agregat disintesis dari ad", () => {
  const csv = '"Reporting starts","Ad name","Amount spent (IDR)","Results","Result indicator"\n' +
    '"2026-08-28","cp-a","300","3","actions:link_click"\n' +
    '"2026-08-28","cp-a","200","2","actions:link_click"\n' +
    '"2026-08-29","cp-a","100","1","actions:link_click"\n';
  const ads = P.extractFbAdRows(P.fbRawFromCSV(csv));
  const syn = P.synthesizeCampaignRowsFromAds(ads);
  assert.strictEqual(syn.length, 2); // 2 tanggal
  const d28 = syn.find(s => s.date === '2026-08-28');
  assert.strictEqual(d28.campaignName, 'cp-a');
  assert.strictEqual(d28.spent, 500);
  assert.strictEqual(d28.linkClicks, 5);
});
t("ad dengan Campaign name → sintesis pakai campaign, bukan ad", () => {
  const csv = '"Reporting starts","Campaign name","Ad name","Amount spent (IDR)","Results","Result indicator"\n' +
    '"2026-08-28","kampA","ad-x","300","3","actions:link_click"\n' +
    '"2026-08-28","kampA","ad-y","200","2","actions:link_click"\n';
  const syn = P.synthesizeCampaignRowsFromAds(P.extractFbAdRows(P.fbRawFromCSV(csv)));
  assert.strictEqual(syn.length, 1);
  assert.strictEqual(syn[0].campaignName, 'kampA');
  assert.strictEqual(syn[0].spent, 500);
});
t("sintesis membawa endDate terjauh dari Reporting ends", () => {
  const csv = '"Reporting starts","Reporting ends","Ad name","Amount spent (IDR)"\n' +
    '"2026-08-28","2026-08-31","ad-x","300"\n' +
    '"2026-08-28","2026-08-29","ad-x","200"\n';
  const syn = P.synthesizeCampaignRowsFromAds(P.extractFbAdRows(P.fbRawFromCSV(csv)));
  assert.strictEqual(syn[0].endDate, '2026-08-31');
});

console.log(`\nALL TESTS PASSED (${passed} kasus)`);
