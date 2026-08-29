# Arsitektur — Affalitycs

## Alur data (app.js)

```
Upload (3 slot file)
  ├─ Shopee Commission CSV  → parseShopeeCSV()   → state.shopeeRows
  ├─ FB Ads XLSX/CSV        → parseFbXLSX/CSV()  → state.fbCampaigns
  └─ Shopee Click CSV       → parseClickReportCSV() → state.clickReport
        ↓
runAnalysis() → auto-match tag↔campaign → modal mapping (kalau ada unmatched)
        ↓
buildDashboard() → applyFilters() → renderAll()
        ↓
buildCampaignData() = SATU SUMBER KEBENARAN (dipanggil ulang oleh semua render)
```

## State (object `state`)
- `shopeeRows / fbCampaigns / clickReport` — data mentah hasil parse
- `filteredShopee / filteredFb / filteredClicks` — hasil filter tanggal
- `mapping` — tag → nama campaign (persist ke localStorage `affalitycs_mapping`)
- `dateRatio` — faktor prorating spend FB kalau data ter-agregat
- `charts` — registry Chart.js instances (wajib destroy sebelum render ulang)

## Fungsi kunci (dengan lokasi)
| Fungsi | Baris | Peran |
|---|---|---|
| `parseShopeeCSV` | app.js:108 | Parse komisi Shopee, column matching substring |
| `parseClickReportCSV` | app.js:204 | Parse klik perujuk (kolom: Klik ID, Waktu Klik, Wilayah, Tag_link, Perujuk) |
| `parseFbXLSX` / `parseFbCSV` / `extractFbRows` | app.js:266-346 | Parse FB Ads, extractor shared |
| `resolveShopeeKey` | app.js:349 | Matching tag→campaign 5 lapis |
| `resolveClickKey` | app.js:234 | Matching click-report tag (format `TAG1-meta-TAG3--`) |
| `applyFilters` | app.js:573 | Filter tanggal + PPN toggle + dateRatio |
| `buildCampaignData` | app.js:642 | Merge semua sumber, hitung ROAS/CPO/profit/funnel |
| `renderAll` | app.js:630 | 8 render functions, masing-masing try/catch |
| `loadDemoData` | app.js:1630 | Generate CSV demo + FB data hardcoded |

## Metrik & aturan
- ROAS = komisi bersih / spend (× PPN kalau toggle aktif)
- CPO = spend / unique orders (dedup by `orderId`)
- Funnel 3 tahap: FB link clicks → klik masuk Shopee (Click Report / fallback LPV) → orders
- Rekomendasi: ≥3 SCALE UP · ≥2 SCALE · ≥1.2 MAINTAIN · ≥0.8 MONITOR · <0.8 PAUSE
- Status badge table: ≥3 Scale Up, ≥2 Profitable, ≥1 Break-even, else Rugi; spend 0 = Organik
