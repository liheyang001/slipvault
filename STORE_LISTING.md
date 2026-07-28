# Vesta — Store Listing Assets

## App Info

| Field | Value |
|-------|-------|
| App Name | Vesta |
| Tagline | Scan receipts. Archive instantly. |
| Bundle ID | `nz.co.vesta.app` |
| Version | 1.0.0 |
| Age Rating | 4+ (iOS) / Everyone (Android) |

---

## Google Play Store Text

### Short Description (80 chars max)
```
Photograph receipts — AI extracts the data, stored on your device only.
```

### Full Description (4000 chars max)
```
Vesta turns your phone into a receipt archive. Photograph or import any invoice or receipt, and our AI instantly extracts the vendor, date, amounts, and every line item — no typing required.

Everything stays on your device. No account. No cloud. No tracking.

──────────────────────────────
WHAT SLIPVAULT DOES
──────────────────────────────
📸 Scan any receipt — groceries, restaurants, hardware stores, medical bills, and more
🤖 AI extraction — vendor name, date, category, subtotal, tax, total, and individual items
🗂️ Auto-categorization — Dining, Groceries, Transport, Healthcare, Shopping, and more
🔍 Instant search — find receipts by vendor name, item name, date range, or amount
📊 Export — download a CSV or PDF summary of any selection of receipts
🔔 Monthly summary notification — optional reminder showing your spending for the month
📴 Fully offline browsing — no internet needed to view or search your archive

──────────────────────────────
PRIVACY FIRST
──────────────────────────────
Your data never leaves your device. Vesta stores everything in a local SQLite database inside the app's private sandbox — inaccessible to other apps and deleted completely if you uninstall.

The only network request Vesta makes is sending a receipt photo to the AI recognition service to extract text. The image is discarded immediately after processing and is never stored on any server.

No account required. No subscription. No ads. Free forever.

──────────────────────────────
GREAT FOR
──────────────────────────────
• Logging work expenses for reimbursement
• Tracking household spending across grocery and dining receipts
• Archiving medical bills for insurance claims
• Keeping a searchable record before discarding paper receipts

Stop hoarding paper receipts. Vesta is your private digital archive.
```

---

## iOS App Store Text

### Subtitle (30 chars max)
```
Scan, extract, archive receipts
```

### Description
Same as Google Play full description above.

### Keywords (100 chars max)
```
receipt,invoice,expense,scan,OCR,tracker,bill,AI,archive,spending
```

### Promotional Text (170 chars, can update without new version)
```
Vesta is free — scan unlimited receipts, export to CSV or PDF, and keep everything private on your device. No account needed.
```

---

## Screenshots Plan

### Recommended scenes (in order)
1. **Home screen** — invoice list with "Vesta" header, categories, and totals visible
2. **Receipt scan result** — Invoice Detail showing extracted vendor, date, items, and total
3. **PDF export** — clean Invoice Report showing multiple receipts and total spent
4. **Search / Filter** — search results with date range or category filter applied
5. (Optional) **Settings** — monthly notification toggle, emphasizing privacy-first design

### Android sizes required
- Phone: minimum 2 screenshots, 1080×1920 px or higher (16:9 or 9:16)
- Tablet: optional

### Current screenshots taken
- [x] Home screen (Vesta header, 2 invoices, $76.38 total)
- [x] Invoice Detail (Sunson Asian Food Market, $66.41)
- [x] PDF export (2 invoices, Vesta footer)
- [ ] Search / Filter screen
- [ ] Settings screen

---

## What's Already Done

- [x] App renamed to Vesta everywhere in code
- [x] Bundle ID: `nz.co.vesta.app` (iOS + Android)
- [x] Privacy policy hosted: https://invoice-reader-privacy.pages.dev/privacy-policy.html
- [x] Cloudflare Worker proxy deployed
- [x] EAS project configured (projectId: 2acb2ded-2f3e-48c3-920d-df1ef7090c8f)
- [x] First Android AAB built (pre-rename, needs rebuild)
- [ ] Rebuild Android AAB with Vesta name (`eas build --platform android --profile production`)
- [ ] Google Play developer account reinstated (appeal in progress)
- [ ] Create app listing in Google Play Console
- [ ] Upload AAB and screenshots
- [ ] Submit for review

---

## Google Play Console — App Listing Fields

| Field | Value |
|-------|-------|
| App name | Vesta |
| Short description | Photograph receipts — AI extracts the data, stored on your device only. |
| Category | Finance |
| Content rating | Everyone |
| Privacy policy URL | https://invoice-reader-privacy.pages.dev/privacy-policy.html |
| Contact email | womendemiao@gmail.com |
| App type | App |

---

## Release Notes (What's New) — v1.0.0
```
Initial release of Vesta.

• Photograph or import any receipt — AI extracts vendor, date, amounts, and line items automatically
• All data stored locally on your device — no account or internet required to browse
• Search receipts by vendor, item, date range, or amount
• Export your receipt archive as CSV or PDF
• Optional monthly spending summary notification
```
