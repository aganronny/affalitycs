# Affalitycs

Dashboard analisis **Shopee Affiliate × Facebook Ads** — hitung ROAS, profit, dan lihat funnel klik (FB Ads → Shopee → Order) langsung dari file export, tanpa server, tanpa login.

**100% client-side & 100% offline** — semua library lokal (Chart.js, SheetJS, font Inter). Data yang lo upload **tidak pernah dikirim ke mana pun**: semua proses & penyimpanan terjadi di browser lo sendiri.

## Fitur

- 🤖 **Smart Report** — verdict UNTUNG/RUGI, komisi cair vs pending (dari Status Pesanan), kandidat pause + BEP (butuh X order/hari vs realita), funnel bocor terparah
- 📊 **4 tab**: Per Campaign (+ tabel per Ad/Ad Set), Per Produk, Perbandingan (funnel 3 tahap + scatter CTR vs ROAS), Tren Harian
- 🔍 **Funnel akurat** — Klik Iklan FB → Klik Masuk Shopee (perujuk Facebook) → Order, dengan % hilang di tiap tahap
- 🛡️ **Guard data**: spend dobel antar file overlap, order nyangkut di tag gak match, ad yang spending tapi nol jejak Shopee, coverage Click Report
- 📈 **Riwayat snapshot** — Perjalanan ROAS antar periode + kolom Δ ROAS/Δ Spend vs periode lalu
- 🕒 **Klik vs Order per Jam** — jam tayang mana yang beneran ngasih order
- 👥 **Breakdown FB Ads** (Usia/Gender/Platform/Wilayah) & **Per Ad** (join tag di nama ad)
- 💾 **Backup/Restore JSON**, Export Excel multi-sheet, Cetak PDF, Dark mode
- 🔒 Sesi tersimpan lokal (IndexedDB) — refresh gak perlu upload ulang

## Cara pakai

1. Buka `index.html` (atau halaman GitHub Pages ini) — bisa 100% offline setelah load pertama
2. Upload minimal salah satu: **Shopee Affiliate Report** (CSV), **Facebook Ads Report** (XLSX/CSV, level Campaign/Ad Set/Ad + Breakdown — boleh banyak file), dan opsional **Shopee Website Click Report** (CSV, untuk funnel akurat)
3. Klik "Mulai Analisis" — kalau ada tag yang gak match nama campaign, muncul modal mapping
4. Ambil keputusan dari Smart Report & tab yang tersedia

Untuk analisis level Ad: taruh **tag di nama ad** (naming convention, mis. `gacoan01-video-A`), export level Ad dari Ads Manager, lalu upload bersama file lainnya.

## Menjalankan & test

- Buka langsung `index.html` di browser (gak butuh build step)
- Unit test parser: `node tests/parsers.test.js`

## Catatan privasi

Semua data tersimpan lokal di perangkat (IndexedDB/localStorage). Tidak ada pengiriman data ke server mana pun — aplikasi ini tidak memiliki backend.
