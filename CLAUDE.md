# Affalitycs

Dashboard analisis **Shopee Affiliate × Facebook Ads** untuk menghitung ROAS, profit, dan rekomendasi aksi per campaign. Aplikasi 100% client-side (HTML + JS + CSS), tanpa backend, tanpa build step, **100% offline** (semua library lokal) — buka `index.html` di browser langsung jalan.

## Cara Pakai

1. Buka `index.html` di browser (tidak butuh internet sama sekali)
2. Upload minimal salah satu:
   - **Shopee Affiliate Report** (CSV komisi, bisa banyak file)
   - **Facebook Ads Report** (XLSX/XLS/CSV dari Meta Ads Manager, bisa banyak file)
   - **Shopee Website Click Report** (CSV klik, opsional — untuk funnel akurat)
3. Klik "Mulai Analisis" → kalau ada tag Shopee yang gak match nama campaign FB, muncul modal mapping
4. Dashboard tampil dengan 5 tab: Per Campaign, Per Produk, Perbandingan (funnel + scatter), Tren Harian, Rekomendasi

Tombol "Coba dengan Sample Data" memuat data demo yang di-generate di dalam `loadDemoData()` (app.js).

## Struktur File

| File | Isi |
|---|---|
| `index.html` | UI tunggal: upload, banner lanjutkan sesi, modal mapping, dashboard 5 tab, loading overlay |
| `parsers.js` | Lapisan data murni (tanpa DOM): format angka, parsing CSV/XLSX, matching tag→campaign, breakdown FB Ads. Bisa dites via Node |
| `app.js` | SEMUA logika UI (±1560 baris, v2.5): state, upload, filter, render semua chart & tabel, export CSV/PNG, persistensi sesi |
| `style.css` | Styling lengkap (tema terang, Inter font) |
| `tests/parsers.test.js` | Unit test parser (tanpa framework) — jalan: `node tests\parsers.test.js` |
| `vendor/` | Library lokal (Chart.js, datalabels plugin, SheetJS, font Inter) — biar 100% offline. Jangan edit |
| `Stable/` | **Backup versi stabil lama** (v2.2, sebelum split & fitur v2.3+). Jangan edit di sini, edit file root |

Library eksternal — semua **lokal** di `vendor/` (bukan CDN):
- Chart.js 4.4.0 + chartjs-plugin-datalabels 2.2.0 (semua chart; datalabels default off, aktif manual per chart)
- SheetJS/xlsx 0.18.5 (baca XLSX FB Ads + export Excel multi-sheet)
- Inter Variable font (woff2)

## Arsitektur app.js

Alur data: **Upload → Parse → Matching → Filter → Render**

1. **Parse** (`parseShopeeCSV`, `parseFbXLSX`/`parseFbCSV`, `parseClickReportCSV`)
   - Delimiter auto-detect (`;` atau `,`), nama kolom match pakai substring (toleran typo header Shopee)
   - Kolom penting Shopee: `Tag_link1`, `Tag_link3`, `Komisi Bersih Affiliate (Rp)`, `Waktu Klik`, `Status Pesanan`
   - Tanggal dinormalisasi ke format `YYYY-MM-DD`
2. **Matching tag → campaign** (`resolveShopeeKey`): urutan = manual mapping → exact → normalized → partial → fallback tag mentah
3. **Filter** (`applyFilters`): rentang tanggal + toggle **PPN 11%** (FB spend × 1.11) + toggle **Order valid saja** (default ON: status Belum Dibayar/Dibatalkan/Dikembalikan tidak dihitung sebagai pesanan). Kalau FB data ter-agregat (tanpa kolom tanggal), spend diprorata pakai `dateRatio` (rasio jumlah hari)
4. **Merge** (`buildCampaignData`): gabung Shopee + FB + Click Report per campaign, hitung ROAS/CPO/profit/funnel 3 tahap
5. **Render**: `renderAll()` memanggil fungsi render (KPI, Smart Report, 4 tab, sanity, riwayat, breakdown), masing-masing dibungkus try/catch biar satu error gak mematikan dashboard

Metrik inti:
- `ROAS = komisi bersih / spend FB`
- `CPO = spend / orders (unique order ID)` — hitungan pesanan mengikuti toggle "Order valid saja"
- `Profit = komisi - spend`
- Funnel 3 tahap: Klik Iklan FB → Klik Masuk Shopee (dari Click Report **perujuk Facebook**, fallback total klik, lalu LPV) → Order
- Click report di-dedup by `clickId` saat upload multi-file (aman dari periode overlap)
- `parseSpent` khusus kolom FB spend: '18.415' = delapan belas ribu (guard format id-ID). `parseNum` global sengaja TIDAK diubah — nilai Shopee 3 desimal ('962.745') harus tetap kebaca desimal

Aturan rekomendasi (tab Rekomendasi) — urutan evaluasi: (1) tanpa FB & tanpa spend = NO DATA, (2) FB ada tapi spend 0 = NONAKTIF, (3) order ≥1 tapi komisi 0 = GANTI PRODUK, (4) order 0 = PAUSE, (5) order <3 & periode <7 hari = DATA TIPIS (jangan ambil keputusan dulu), (6) ladder ROAS: ≥3 SCALE UP, ≥2 SCALE, ≥1.2 MAINTAIN, ≥0.8 MONITOR, <0.8 PAUSE. Ekstra: komisi/order < Rp 300 = hint butuh volume besar.

Fitur tambahan v2.3:
- Tab Perbandingan punya chart **Klik per Negara** (top 10, dari Wilayah Klik) & **Klik per Jam** (00-23) — keduanya butuh Click Report
- Tombol **⬇ PNG** auto-inject di semua chart card, **⬇ CSV** di semua table card (BOM UTF-8, aman dibuka Excel)
- Semua injeksi data user ke innerHTML wajib pakai helper `esc()` (nama produk/campaign bisa berisi `<`, `&`, `"`)

Fitur v2.5 (Smart Report):
- Panel **Smart Report** di atas KPI: verdict UNTUNG/RUGI, komisi **cair (Selesai) vs pending (Tertunda/Belum Dibayar) vs gagal** — dari kolom Status Pesanan file komisi yang sama, tanpa upload tambahan — plus kandidat pause (dengan hitungan order/hari yang dibutuhkan vs realita), campaign terbaik, dan funnel bocor terparah
- Nilai rugi **wajib pakai tanda minus** (`-Rp 73.820`), bukan nilai absolut berwarna
- Support **file breakdown FB Ads** (Ads Manager → Breakdown Age/Gender/Platform/Region): 4 chart di tab Perbandingan. Parser milih kolom pakai exact-match dulu baru includes; gender 'female' dicek SEBELUM 'male' (includes trap). File campaign biasa → breakdown kosong, chart nampilin panduan export
- Tab Rekomendasi punya hitungan BEP konkret per campaign: butuh X order/hari vs realita Y order/hari
- `daysInPeriod()` = sumber jumlah hari terfilter untuk semua hitungan per-hari

Fitur v2.6 (guard & riwayat):
- **Sanity warnings** (banner kuning/biru di atas Smart Report): (1) kemungkinan spend dobel = duplikat campaign+tanggal di data FB (file overlap), (2) order nyangkut di tag yang gak match campaign FB — arahkan ke ⚙️ Mapping, (3) coverage Click Report < periode data, (4) funnel pakai LPV karena Click Report gak diupload
- **Riwayat snapshot** per periode (IndexedDB store `history`, key `start|end`, di-save tiap applyFilters): chart **Perjalanan ROAS** di tab Tren Harian + baris "vs periode sebelumnya" di Smart Report (ROAS/spend/komisi vs snapshot terakhir yang end-nya sebelum periode sekarang)
- **Checklist aksi** di tab Rekomendasi (localStorage `affalitycs_action_checks`): centang campaign yang udah dieksekusi; auto-hapus kalau rekomendasi campaign berubah atau campaign hilang dari data
- **Komisi/1k Klik** di tabel Perbandingan (kolom baru — thead Shopee colspan jadi pas 8)
- **🖨️ Cetak / PDF**: window.print() + `@media print` (sembunyikan filter/tab/upload, cetak Smart Report + KPI + tab aktif)
- **Mobile responsive**: `@media (max-width: 768px)` — KPI 2 kolom, chart 1 kolom, tabel scroll horizontal

Fitur v3.0 (penyederhanaan & rules cerdas):
- **5 tab saja** (Status Pesanan dihapus — datanya tetap ada di Smart Report & export Excel); banner intro dekoratif dihapus; funnel-per-campaign dihapus (duplikat funnel 3 tahap); breakeven calculator manual dihapus (digantikan BEP otomatis per campaign)
- **Rekomendasi punya gerbang data**: DATA TIPIS (order <3 & periode <7 hari) cegah keputusan prematur; GANTI PRODUK (order ada tapi komisi 0%) beda dari PAUSE; NONAKTIF buat campaign delivery inactive
- Scatter CTR vs ROAS dapat **garis referensi break-even 1x** + hint kuadran di judul chart

Fitur v2.9 (range picker):
- **Filter tanggal 1 tombol**: klik → dropdown berisi preset sekali-klik (Hari terakhir / 7 hari / 30 hari / Semua data — anchor-nya tanggal data terakhir, bukan hari ini) + kalender mini (mulai Senin). Klik awal → klik akhir → otomatis apply
- `filter-start`/`filter-end` (input date tersembunyi) tetap SATU SUMBER KEBENARAN semua logika filter — picker cuma lapisan tampilan. Set tanggal programatik WAJIB lewat `setRange()` (bukan set .value langsung) biar label tombol ikut ter-update
- Filter bar 2 zona: kiri = range picker + toggle (PPN, order valid), kanan = tombol aksi (Reset/Mapping/PDF/Excel/Upload) dipisah border kiri, `margin-left: auto`

Fitur v2.7 (offline & polish):
- **Dedup baris komisi** (`dedupShopeeRows` di parsers.js): upload file komisi overlap gak dobel hitung; jumlah baris yang dibuang muncul sebagai sanity warning (`state.shopeeDupCount`)
- **100% offline**: Chart.js, datalabels, SheetJS, dan font Inter di-serve dari `vendor/` — nol request internet
- **Dark mode**: toggle 🌙 di header, tersimpan di `localStorage` key `affalitycs_theme`; chart ikut tema via `Chart.defaults.color`; print selalu paksa tema terang via override variabel di `@media print`
- **Export Excel multi-sheet**: tombol 📗 → 1 file .xlsx berisi sheet Ringkasan / Per Campaign / Per Produk / Status Pesanan / Riwayat
- **Animasi angka KPI**: count-up 700ms ease-out (`animateCountUps()`), lewat atribut `data-count`/`data-format`
- **Datalabels**: nilai di atas batang chart ROAS & funnel
- Polish: angka tabular-nums, hover lift di KPI & decision card, animasi pindah tab, favicon, badge header jadi "v2.6+"

## Persistensi

- Mapping tag→campaign disimpan di `localStorage` key `affalitycs_mapping`
- **Sesi upload disimpan di IndexedDB** (db `affalitycs`, store `session`, key `current`): data hasil parse + setting filter — muncul banner "Lanjutkan Sesi" saat buka ulang halaman. Reset lewat tombol "Upload Ulang". Gagap di private mode = diam-diam dilewati
- Run unit test: `node tests\parsers.test.js` (36 kasus, lulus semua = parser aman)
