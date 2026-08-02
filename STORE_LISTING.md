# Vesta — Store Listing Assets

## App Info

| Field | Value |
|-------|-------|
| App Name | Vesta |
| Tagline | Your home, documented before you need it. |
| Bundle ID | `nz.co.vesta.app` |
| Version | 1.0.1 |
| Age Rating | 4+ (iOS) / Everyone (Android) |

**Positioning:** a contents-insurance inventory, not a receipt filer. The job it
does is "prove what you owned, and what it was worth" — the thing nobody has
ready on the day their house floods or is broken into.

**Every claim below has been checked against what the app actually does.** The
previous version of this file promised "free forever", "unlimited scans", "no
account" and "data never leaves your device"; all four became false once
credits, sign-in and AI extraction shipped. A pricing claim next to an in-app
product list is a standard Google rejection, and the privacy claim also feeds
the Data Safety form, where a mismatch is a policy violation.

---

## Google Play Store Text

### App title (30 chars max)
```
Vesta: Contents Insurance
```

### Short Description (80 chars max)
```
Photograph belongings and receipts — AI builds your insurance inventory.
```

### Full Description (4000 chars max)
```
Insurers ask two questions after a fire, a flood, or a break-in: what did you
own, and what was it worth? Almost nobody can answer. Vesta answers for you.

Photograph a receipt and AI reads the merchant, date, and every line item. No
receipt? Photograph the item itself — for a gift, a cash purchase, or something
you have owned for years, a photo plus the details you remember is what a claim
actually needs.

──────────────────────────────
BUILT FOR A CLAIM
──────────────────────────────
• Room by room — organise belongings the way an assessor walks through a house
• Estimated contents value — see what your home is worth today, so you can set
  your sum insured with a number instead of a guess
• High-value items — flag the pieces that may need listing separately on your
  policy, at a threshold you choose
• Serial numbers and model details — scan a barcode or type them in; these are
  the fields claim forms ask for
• Warranty tracking — get reminded before cover expires
• Export to PDF or CSV — hand your insurer a complete inventory, per room or in
  full

──────────────────────────────
TWO WAYS TO ADD THINGS
──────────────────────────────
AI scanning reads a receipt photo and fills everything in for you. It uses one
scan credit — 20 are included when you sign in, and packs are available if you
need more.

Adding an item by hand is free and unlimited, forever. Photograph the item, add
what you know, done. Everything Vesta can do with an item works the same either
way.

You only pay for the typing you skip.

──────────────────────────────
WHAT LEAVES YOUR PHONE
──────────────────────────────
Your inventory lives on your device. It is not synced to a server and it is not
shared with anyone.

Two things do leave, and only when you ask:
• A receipt photo, sent to our AI service to be read. It is processed and
  discarded, never stored.
• Your Google account, used to sign in. Scan credits are tied to it so they
  survive a new phone.

No ads. No tracking. No selling your data — not now, not later.

──────────────────────────────
GOOD FOR
──────────────────────────────
• Getting contents cover right instead of guessing the number
• Having proof ready before you need it, not scrambling afterwards
• Documenting a room after a renovation or a big purchase
• Keeping warranties and serial numbers somewhere you can actually find them

Photograph it once. Have it when it matters.
```

### Promotional Text (170 chars, can update without new version)
```
Build the contents inventory your insurer will ask for. AI reads your receipts;
adding items by hand is always free.
```

---

## iOS App Store Text

Not in scope yet — Android ships first. When iOS happens, the description above
carries over; only these need writing.

### Subtitle (30 chars max)
```
Insurance-ready home inventory
```

### Keywords (100 chars max)
```
insurance,contents,inventory,home,receipt,claim,valuables,warranty,serial,proof
```

---

## In-app purchases (declare in Play Console)

| Product ID | Name | Credits | Price (NZD) |
|---|---|---|---|
| `credits_30` | 30 Scan Credits | 30 | 4.99 |
| `credits_100` | 100 Scan Credits | 100 | 12.99 |
| `credits_300` | 300 Scan Credits | 300 | 29.99 |

All consumable, credits do not expire, new accounts receive 20 free.

---

## Data Safety form — what to declare

This must match the privacy policy and the app's actual behaviour. Vesta **does**
collect data; ticking "no data collected" would be false.

| Data type | Collected | Purpose | Notes |
|---|---|---|---|
| Photos | Yes | App functionality | Receipt images sent for AI extraction, discarded after processing |
| Email address | Yes | App functionality, Account management | From Google Sign-In |
| User IDs | Yes | App functionality | Google account id — the key the credit balance is stored under |
| Purchase history | Yes | App functionality | Credit purchases through Google Play |

- Encrypted in transit: **Yes** (HTTPS throughout)
- Users can request deletion: **Yes** (uninstalling removes local data; account deletion on request)
- Data is **not** shared with third parties for advertising

---

## Screenshots

### Recommended scenes (in order)
1. **Insurance view** — estimated contents value, value by room, high-value items
2. **Item detail** — a scanned item with brand, model, serial, warranty
3. **Rooms** — belongings grouped by room, with per-room totals
4. **Home screen** — the inventory list
5. **PDF export** — a room inventory ready to hand an insurer

The first screenshot should carry the insurance story, not the scanning story:
scanning is the method, insurance readiness is the reason to install.

### Android sizes required
- Phone: minimum 2 screenshots, 1080×1920 px or higher (16:9 or 9:16)
- Tablet: optional

### Status
- [ ] All screenshots need retaking — the existing ones predate the rename, the
      rooms and insurance features, and the current UI
- [ ] Feature graphic (1024×500) — required, never made

---

## Google Play Console — App Listing Fields

| Field | Value |
|-------|-------|
| App name | Vesta: Contents Insurance |
| Short description | Photograph belongings and receipts — AI builds your insurance inventory. |
| Category | Finance |
| Content rating | Everyone |
| Privacy policy URL | https://invoice-reader-privacy.pages.dev/privacy-policy.html |
| Contact email | womendemiao@gmail.com |
| App type | App |
| Contains ads | No |
| In-app purchases | Yes — NZ$4.99–NZ$29.99 |

---

## Release Notes (What's New) — v1.0.1

```
Vesta is now a contents-insurance inventory, not just a receipt archive.

• Rooms — organise belongings the way an assessor walks a house
• Estimated contents value, with AI depreciation on high-value items
• Serial numbers, brands, models, and barcode scanning
• Warranty tracking with expiry reminders
• Export a full or per-room inventory as PDF or CSV
• Scan credits: 20 free on sign-in, packs available. Adding items by hand
  stays free and unlimited.
```

---

## Still to do before submitting

- [ ] Retake all screenshots (see above)
- [ ] Create the 1024×500 feature graphic
- [x] Rewrite the privacy policy — done 2026-08-02, now matches this listing and
      the Data Safety table above
- [ ] **Re-deploy the privacy policy** to
      `invoice-reader-privacy.pages.dev` — the rewritten `privacy-policy.html`
      is in the repo but the hosted copy is still the old one
- [ ] Complete the content rating questionnaire
- [ ] Fill in the payments profile (bank + tax) — approval takes time, start early
