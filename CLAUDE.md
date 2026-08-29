# Affalitycs

Dashboard analisis **Shopee Affiliate × Facebook Ads** untuk menghitung ROAS, profit, dan rekomendasi aksi per campaign. Aplikasi 100% client-side (HTML + JS + CSS), tanpa backend, tanpa build step — buka `index.html` di browser langsung jalan.

## Cara Pakai

1. Buka `index.html` di browser (butuh internet untuk CDN Chart.js & XLSX)
2. Upload minimal salah satu:
   - **Shopee Affiliate Report** (CSV komisi, bisa banyak file)
   - **Facebook Ads Report** (XLSX/XLS/CSV dari Meta Ads Manager, bisa banyak file)
   - **Shopee Website Click Report** (CSV klik, opsional — untuk funnel akurat)
3. Klik "Mulai Analisis" → kalau ada tag Shopee yang gak match nama campaign FB, muncul modal mapping
4. Dashboard tampil dengan 6 tab: Per Campaign, Per Produk, Perbandingan (funnel), Tren Harian, Status Pesanan, Rekomendasi

Tombol "Coba dengan Sample Data" memuat data demo yang di-generate di dalam `loadDemoData()` (app.js).

## Struktur File

| File | Isi |
|---|---|
| `index.html` | UI tunggal: upload, modal mapping, dashboard 6 tab, loading overlay |
| `app.js` | SEMUA logika (±1695 baris, v2.2): parsing CSV/XLSX, matching tag→campaign, agregasi, render semua chart & tabel |
| `style.css` | Styling lengkap (tema terang, Inter font) |
| `Stable/` | **Backup identik** dari app.js, index.html, style.css (bukan versi berbeda — diverifikasi byte-identical). Jangan edit di sini, edit file root |

Library eksternal via CDN:
- Chart.js 4.4.0 (semua chart)
- SheetJS/xlsx 0.18.5 (baca XLSX FB Ads)

## Arsitektur app.js

Alur data: **Upload → Parse → Matching → Filter → Render**

1. **Parse** (`parseShopeeCSV`, `parseFbXLSX`/`parseFbCSV`, `parseClickReportCSV`)
   - Delimiter auto-detect (`;` atau `,`), nama kolom match pakai substring (toleran typo header Shopee)
   - Kolom penting Shopee: `Tag_link1`, `Tag_link3`, `Komisi Bersih Affiliate (Rp)`, `Waktu Klik`, `Status Pesanan`
   - Tanggal dinormalisasi ke format `YYYY-MM-DD`
2. **Matching tag → campaign** (`resolveShopeeKey`): urutan = manual mapping → exact → normalized → partial → fallback tag mentah
3. **Filter** (`applyFilters`): rentang tanggal + toggle **PPN 11%** (FB spend × 1.11). Kalau FB data ter-agregat (tanpa kolom tanggal), spend diprorata pakai `dateRatio` (rasio jumlah hari)
4. **Merge** (`buildCampaignData`): gabung Shopee + FB + Click Report per campaign, hitung ROAS/CPO/profit/funnel 3 tahap
5. **Render**: `renderAll()` memanggil 8 fungsi render (KPI, insight, 6 tab), masing-masing dibungkus try/catch biar satu error gak mematikan dashboard

Metrik inti:
- `ROAS = komisi bersih / spend FB`
- `CPO = spend / orders (unique order ID)`
- `Profit = komisi - spend`
- Funnel 3 tahap: Klik Iklan FB → Klik Masuk Shopee (dari Click Report, fallback ke Landing Page Views) → Order

Aturan rekomendasi otomatis (tab Rekomendasi): ROAS ≥3 SCALE UP, ≥2 SCALE, ≥1.2 MAINTAIN, ≥0.8 MONITOR, <0.8 PAUSE.

## Persistensi

- Mapping tag→campaign disimpan di `localStorage` key `affalitycs_mapping`
- Data upload **tidak** disimpan — refresh = upload ulang
