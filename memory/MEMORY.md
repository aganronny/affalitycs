# MEMORY — Affalitycs

## Overview
- Vibe-coded analytics tool: gabungin laporan komisi Shopee Affiliate + biaya iklan Facebook Ads jadi dashboard ROAS/profit.
- Dibuat untuk pengambilan keputusan cepat: campaign mana yang di-scale up, mana yang di-pause.
- Target user: affiliate marketer Shopee di Indonesia (UI full Bahasa Indonesia).
- Status: v2.2 (April 2026), berjalan stabil, tanpa backend.

## Kondisi Terkini (dipelajari 2026-08-29)
- File di root: app.js (1695 baris), index.html, style.css, CLAUDE.md, folder Stable/.
- CSV sample (AffiliateCommissionReport, BB-06-Campaigns, WebsiteClickReport) sempat terlihat di listing tapi sudah TIDAK ada di disk — kemungkinan dipindah/dihapus user. Data demo tersedia via tombol "Coba dengan Sample Data".
- Belum ada git repo (di-init saat sesi dokumentasi ini).
- Folder Stable/ = backup byte-identical dari 3 file root (diverifikasi pakai fc /b). Bukan versi lama/berbeda.

## Keputusan Desain
- 100% client-side, no build step: biar bisa dipakai non-programmer tanpa install apa pun.
- PPN 11% opsional di spend FB: biaya iklan Meta di Indonesia kena PPN, jadi ROAS real lebih akurat.
- dateRatio prorating: FB Ads Manager sering diekspor ter-agregat (tanpa kolom tanggal) — spend diprorata proporsional rasio jumlah hari.
- Matching tag→campaign pakai 5 lapis (manual mapping → exact → normalized → partial → raw fallback) karena naming Shopee tag vs nama campaign FB sering beda.
- Funnel tahap 2 (klik masuk Shopee) pakai Website Click Report kalau ada, fallback ke Landing Page Views FB.
- Setiap render dibungkus try/catch terpisah: satu chart error gak bikin dashboard mati total.
- Smart Report pakai komisi PENDING (bukan cuma cair) sesuai maunya user — keputusan butuh kecepatan, bukan nunggu cair 10-15 hari kerja. Split cair/pending/gagal dihitung dari kolom Status Pesanan file yang SAMA (tanpa upload tambahan).
- Nilai rugi selalu pakai tanda minus eksplisit (-Rp X), bukan cuma warna — biar gak ambigu buat user.

## Quirks & Gotcha
- Typo di parser itu SENGAJA — match header asli ekspor Shopee: "Nama Barange", "Kampanye Partnerr", "Status Pemebelian". Jangan "diperbaiki".
- Kunci mapping localStorage: `affalitycs_mapping`. Ganti nama campaign FB → mapping lama bisa basi.
- Tanggal input filter dinormalisasi via `normDateInput` karena format input date beda-beda antar browser.
- Chart harus di-destroy dulu (`destroyChart`) sebelum render ulang, dan canvas selalu dibuat baru via `ensureCanvas` (avoid Chart.js "canvas already in use").
- FB CSV kadang punya baris tanggal sebagai kolom pertama — difilter dengan regex `^\d{4}-\d{2}-\d{2}$` di `extractFbRows`.
- Banyak format tanggal di-detect: DD/MM/YYYY, YYYY-MM-DD, YYYY/MM/DD (urutan prioritas seperti itu).

## Hal yang Belum Ada / Ide Lanjutan
- Tidak ada export hasil analisis (PNG/CSV/PDF).
- Tidak ada unit test (logika parsing rawan kalau Shopee ganti format CSV).
- Data upload gak persist — user harus upload ulang tiap refresh (by design, privasi).
- Single file app.js makin gemuk (1695 baris) — kalau nambah fitur besar, pertimbangkan split modul.
