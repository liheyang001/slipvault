# Vesta — Product Status & Backlog

> **This file was rewritten on 2026-08-07.** It previously tracked seven sprints
> of a receipt-archiving app, every story marked "Not Started", while the
> product had in fact shipped most of them and then changed shape. The old plan
> is in git history if it is ever wanted; keeping it visible was worse than
> losing it, because it described neither what exists nor what is left.

## What Vesta is now

> As a homeowner, I want a room-by-room record of what I own — with receipts,
> serial numbers, warranties and a defensible value for each item — so that if
> I ever have to make a contents-insurance claim I can produce the evidence
> instead of trying to remember it.

The receipt scanner is still the fastest way to get items in, but it is the
means, not the point. An assessor walks a house room by room, so the app is
organised the same way.

## Delivered

Everything here is implemented and in the build on Play internal testing.

**Capture**
- Camera capture and gallery import, with rotation and quality preprocessing
- AI extraction of vendor, date, line items and totals (Gemini via the
  Cloudflare Worker proxy — the app holds no model key)
- Manual entry for items with no receipt, free and unlimited
- Barcode scanning for serial numbers

**Organise**
- Rooms, with custom rooms remembered for reuse
- Categories, auto-assigned and user-editable
- Brand, model, serial number, item photos
- Warranty tracking with scheduled expiry reminders

**Insurance**
- Estimated contents value across the whole inventory
- AI depreciation on high-value items
- Per-room and whole-inventory export to PDF and CSV

**Find**
- Search by vendor and item name
- Filters for date range, price range and category, stackable

**Data**
- Local SQLite; images stored on device
- Backup and restore to a zip, with an explicit warning that it is unencrypted
- Configurable sales tax rate and name (GST/VAT/…), used to split amounts

**Account & payments**
- Google Sign-In; the credit ledger is keyed on the Google `sub`
- 20 free credits on signup; scanning costs 1, manual entry costs nothing
- Credit packs via RevenueCat → Play Billing, credited server-side by webhook
  with idempotency on the RevenueCat event id

## Before submitting to Play

Tracked in detail in [STORE_LISTING.md](STORE_LISTING.md); repeated here
because these are the only things standing between the current build and a
submission.

- [ ] Retake all screenshots — they show the old receipt-archive UI
- [ ] Create the 1024×500 feature graphic
- [ ] Complete the content rating questionnaire
- [ ] Fill in the payments profile (bank + tax) — approval takes time

## Known gaps

Not bugs, but things a reader of this file should know are missing:

- **No automated tests of any kind.** No framework, no `test` script. Every
  regression so far has been caught by hand on a device, which is how the tax
  split and the expired-token bug both survived into a release.
- **Warranty and valuation logic is untested against edge dates** (leap years,
  month-end rollovers). One such bug — reminders vanishing after the 12th of a
  month — has already shipped and been fixed.
- **iOS has never been built.** The config is present but unexercised.

## Backlog

Roughly in the order they would be worth doing.

| Item | Why |
|---|---|
| Cloud backup & sync | The single most requested thing for an insurance record — a backup that only lives on the phone dies with the phone |
| Multi-device access after sign-in | The identity and ledger already exist server-side; the invoice data does not |
| Monthly spending chart by category | The data is there, the view is not |
| Share a single item as PDF | Export today is all-or-nothing per room |
| Receipt vs. invoice classification | Only matters if the two need different handling |
