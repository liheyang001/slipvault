# Credit UI Redesign (Quiet Card) — Design

## Purpose

Sub-project 4 of the credit-system effort. Sub-projects 1–3 (EAS dev-build
migration, Google Sign-In, credit ledger backend) are done and verified
end-to-end on device. This sub-project redesigns the credit-related UI, which
currently looks like unstyled default settings rows, and fixes two information
problems that came with the ledger:

1. **The balance is invisible.** The only way to see your credit balance is
   the alert shown after tapping the dev top-up button.
2. **Settings still shows the retired counter system.** The "Plan" section
   ("Free plan · X/50 free invoices used · tap to upgrade") reads from the
   local `FREE_INVOICE_LIMIT` counter that the scan gate no longer consults,
   so Settings presents two contradictory quota systems side by side.

**Decisions made with the user:**

- **Scope: credit-related UI only** — the Settings Account area and the
  ReviewScreen "Out of credits" state. No app-wide theme file, no touching the
  other nine screens (option A of the scoping question).
- **Balance lives in the Settings account card** — not on Home, not on the
  Review screen (only location selected from the placement question).
- **The Plan section merges into the account card.** The standalone Plan
  section is deleted; the card's "Get more" button becomes the Settings-side
  entry to `Paywall`. The Paywall screen itself and the three other
  `navigate('Paywall')` call sites (two in HomeScreen, one in
  ManualEntryScreen) are untouched.
- **Visual direction: "Quiet Card"** (option A of three mocked directions —
  see `.superpowers/brainstorm/credit-ui-directions.html`): floating white
  card + light-blue balance panel, staying inside the app's existing
  blue/slate palette. Rejected: gradient hero card (clashes with the rest of
  the app, needs a new dependency), colored icon rows (too small an
  improvement).
- **Pain point being solved: "too plain, looks undesigned"** — cards, avatar,
  and color accents wanted; copy polish and error-box confusion were offered
  as concerns and not selected, but the redesign incidentally separates the
  out-of-credits box from the network-error box.

## Changes

### 1. SettingsScreen — Account card

Replace the current Account section (plain rows) with one elevated white
card:

- **Identity row:** 44×44 circular avatar — `#2563eb` background, white
  bold initial from `user.name`, falling back to `user.email` (uppercased
  first character; `AuthUser` has no photo URL) — next to the email and
  "Signed in with Google".
- **Balance panel:** inset `#eff6ff` rounded panel. Left: "SCAN CREDITS"
  micro-label (`#60a5fa`, uppercase) over the balance number (`#1d4ed8`,
  26px, weight 800) with a small "scans left" unit. Right: solid `#2563eb`
  pill button **Get more** → `navigation.navigate('Paywall')`.
- **Dev top-up row** (rendered only under `__DEV__`): dashed `#cbd5e1`
  border, "+20 credits · testing only" label, purple `DEV` chip
  (`#f3e8ff` bg / `#7c3aed` text). Tapping calls `devTopUpCredits(20)` and
  writes the returned balance straight into the panel — the success alert is
  removed; the failure alert stays.
- **Sign out:** centered red (`#ef4444`) text button at the card's bottom.
- **Signed-out state:** the same card shell showing the existing
  "Sign in with Google" title and subtitle as a tappable row; no balance
  panel, no balance request.
- **Delete the Plan section** and its now-unused imports/state: `isProUser`,
  `FREE_INVOICE_LIMIT`, `pro`, `invoiceCount` (keep anything still used by
  the notifications/backup sections).

### 2. ReviewScreen — Out-of-credits state

Detach the out-of-credits UI from the shared amber `errorBox` style. New
centered white card:

- 52×52 `#eff6ff` circle containing the 🪙 glyph.
- Title **Out of scan credits** (16px, 800, `#0f172a`).
- Body: "Your photo is safe. Get more credits to extract it automatically,
  or save it for later."
- Primary full-width pill **Get more credits** (`#2563eb`) →
  `navigation.navigate('Paywall')`.
- Ghost button **Save for later** (`#64748b` text) → existing
  `handleSaveForLater`.
- The "No network connection" box keeps its current amber styling — the two
  states are now visually distinct.

## Data flow

- Settings fetches the balance with `getCreditBalance()` (already in
  `src/services/claude.ts`) inside `useFocusEffect`, so returning from a scan
  or the Paywall shows a fresh number. No global state/Context — the number
  is screen-local.
- While loading or on any fetch failure the panel shows "—" and no error UI;
  the balance is auxiliary information and must never block or interrupt.
- A successful dev top-up sets the balance from the call's return value
  (saves a second request).

## Visual spec

| Element | Value |
|---|---|
| Card | white, radius 16, padding 16, iOS shadow ≈ opacity 0.06 / Android `elevation: 2` |
| Avatar | 44×44 circle, `#2563eb` bg, white 18px weight-800 initial |
| Balance panel | `#eff6ff` bg, radius 12; label `#60a5fa` 10px uppercase; number `#1d4ed8` 26px/800 |
| Get more | `#2563eb` bg, white text, pill radius |
| DEV chip | `#f3e8ff` bg, `#7c3aed` text, pill |
| Out-of-credits card | white, radius 16, centered layout; icon circle `#eff6ff` 52×52 |

All colors already exist in the codebase's palette; no new dependencies.

## Edge cases

- Signed out in Settings → sign-in card only; `getCreditBalance()` is not
  called (it would 401 without a token).
- Signed in but offline → balance shows "—"; Get more and dev top-up remain
  tappable (top-up failure alerts as today).
- Empty `user.name` → avatar initial falls back to the email's first letter.

## Out of scope

- No app-wide theme/design-token file.
- No changes to the other nine screens, the Paywall screen's own content, or
  the Home/ManualEntry paywall prompts.
- No service-layer or Worker changes — existing `getCreditBalance()` /
  `devTopUpCredits()` suffice.
- No new dependencies.
