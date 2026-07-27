# Credit Pack Payments + Worker Hardening — Design

## Purpose

Sub-project 5 of the credit-system effort, and the one that makes it earn
money. Sub-projects 1–4 (EAS dev-build migration, Google Sign-In, credit
ledger backend, credit UI redesign) are done and verified on device. The
ledger works, scans spend credits, but the only way to *get* credits is
`credits_dev_topup` — a developer backdoor that was always meant to be
temporary.

This sub-project replaces that backdoor with real RevenueCat purchases and
closes the security holes found in a review of the deployed Worker. The two
are deliberately one piece of work: `credits_dev_topup` cannot be deleted
until the webhook that replaces it exists, or there would be no way to obtain
credits at all.

### The security findings this addresses

A review of `worker/index.js` on 2026-07-27 found:

1. **`credits_dev_topup` is a public free-credit endpoint (critical).** Its
   only gate is `X-App-Key`, which mirrors `EXPO_PUBLIC_APP_KEY` in the app.
   Expo inlines `EXPO_PUBLIC_*` values into the JS bundle at build time, so
   anyone who unpacks the APK can read it. Attack chain: extract key → sign in
   with any Google account → `POST {"action":"credits_dev_topup","amount":1000}`
   → unlimited scans on the operator's Gemini bill. **Once payments ship this
   is a paywall bypass.** Verified: with the correct key the request passes the
   app-key check and stops only at `verifyIdToken`, which any Google account
   satisfies.
2. **`valuate` requires no identity (high).** Its branch sits before
   `verifyIdToken`, so any holder of the extractable app key can call Gemini
   without limit, 40 items per call.
3. **No rate limiting anywhere (high).** 20 signup credits × N throwaway Google
   accounts is free AI extraction; nothing caps per-user request frequency
   either.
4. **No image size cap (high).** `imageBase64` is unbounded, so a single
   request can carry an arbitrarily large payload into Gemini.
5. **Upstream errors leak to clients (medium).** `Gemini error: ${errText}`
   returns Google's raw error text, which can expose quota, model, or project
   detail.

Not addressed here (accepted, noted for the record): the local SQLite database
is unencrypted. On a non-rooted device other apps cannot read it, but a lost
or rooted phone exposes vendor names, amounts and serial numbers in plaintext.
Revisit if the privacy claims in the store listing need to be stronger.

**Decisions made with the user:**

- **Consumable credit packs, not subscriptions.** The existing `$2.99/month`
  Paywall is a leftover from a different business model and is replaced.
- **Android only for now.** iOS needs its own Apple Developer account, product
  configuration, and review; RevenueCat can unify them later.
- **Three tiers:** `credits_30` at $2.99, `credits_100` at $6.99,
  `credits_300` at $14.99. Middle tier is the value anchor.
- **Manual entry stays free and unlimited forever.** It makes no AI call and
  costs nothing to serve, so it is not gated, not counted, and does not
  require sign-in. Credits pay for AI extraction only.
- **Signup grant stays at 20 credits.** Conversion matters more than the abuse
  it invites, so the abuse is handled by rate limiting instead.
- **Top-up path: webhook of record + client polling** (option C of three).
  Rejected: webhook-only (correct but the delay is visible to the user);
  client-submitted receipts verified against the Google Play API (instant, but
  adds a second credential set and verification path to maintain).

## Architecture

### Worker routing

`worker/index.js` currently ignores the URL path. It gains path dispatch:

- `POST /` — unchanged app surface: the existing `action` dispatch
  (`valuate`, `credits_balance`, default scan).
- `POST /rc-webhook` — **new**, RevenueCat only.

The two paths authenticate differently and neither accepts the other's
credential. App requests carry a Google idToken; the webhook carries
`RC_WEBHOOK_SECRET` in its `Authorization` header (a new Worker secret,
matching the value configured in RevenueCat's webhook settings).

### Purchase flow

```
User taps a pack
  → RevenueCat SDK opens Google Play billing
  → payment succeeds
  → RevenueCat's servers POST /rc-webhook
  → Worker verifies secret, maps product ID → credits, adds them idempotently
  → client polls credits_balance until the balance rises
  → "credits added" shown
```

**Credit amounts are mapped server-side from the product ID.** The Worker
never trusts a quantity field from the request body:

```js
const CREDIT_PACKS = { credits_30: 30, credits_100: 100, credits_300: 300 };
```

Unknown product IDs are rejected and logged. A forged webhook body therefore
cannot mint an arbitrary number of credits — only a pack that exists.

**Idempotency.** RevenueCat retries webhooks on timeout or network failure, so
a naive handler would double-credit a single purchase. `credit_log` gains an
`event_id` column with a partial unique index, and top-ups use the
insert-then-conditional-update pattern already used by `ensureUser`:

```sql
INSERT OR IGNORE INTO credit_log (user_id, delta, reason, event_id, created_at)
  VALUES (?, ?, 'purchase', ?, ?);
UPDATE credits SET balance = balance + ?, updated_at = ?
  WHERE user_id = ? AND changes() = 1;
```

On a repeat delivery the insert is ignored, `changes()` is 0, and the balance
is untouched.

**Identity matching.** RevenueCat's app user ID is set to the Google `sub` by
calling `Purchases.logIn(sub)` after Google sign-in, so the webhook's
`app_user_id` is the same key the ledger uses. A webhook for an unknown user
calls `ensureUser` first, then credits.

**Event types.** Consumable purchases arrive as `NON_RENEWING_PURCHASE`; only
that type credits an account. Every other type — `TEST` (fired by RevenueCat's
"send test webhook" button), `CANCELLATION`, `REFUND`, and any type added in
future — is acknowledged and ignored.

Acknowledgement means **HTTP 200 even for ignored events**. A non-2xx reply
makes RevenueCat retry on a backoff for hours, so responding 400 to an
unrecognised type would manufacture a retry storm against a request that will
never succeed. Only genuine processing failures (a malformed body, or a
database error that prevented crediting) return 5xx, because those *should* be
retried.

### Client polling

After a successful purchase callback the app polls `getCreditBalance()` every
2 seconds, up to 5 times. A rise ends the poll with a success message. If the
balance has not moved after ~10 seconds the user sees "Payment received —
your credits will arrive shortly", which is accurate: the webhook retries, so
the credits land regardless of whether the app is still open.

## Security fixes

1. **Delete `credits_dev_topup`** — the action, the client's
   `devTopUpCredits()`, and the Settings DEV row. Development top-ups are
   replaced by Play Console License Testing accounts, which purchase for free
   through the real billing → webhook chain. Emergency manual adjustment
   remains available via `wrangler d1 execute`, which needs local credentials
   an attacker does not have.
2. **`valuate` requires a verified idToken** — its branch moves below
   `verifyIdToken`. It still costs no credits (valuation supports the
   insurance inventory; charging would discourage use), but the caller must be
   a signed-in user rather than anyone holding the extractable app key.
3. **Rate limiting, two layers:**
   - *Per-user frequency:* at most 10 scans/minute and 100 scans/hour,
     counted from existing `credit_log` rows (`reason = 'scan'`) — no new
     table. Over the limit returns 429 without calling Gemini or spending a
     credit.
   - *Signup by IP:* a new `signup_ips` table records the `CF-Connecting-IP`
     of each new account. Past 3 new accounts from one IP in 24 hours, further
     accounts are created with a **0 balance instead of the 20-credit grant**.
     The account still works; it just isn't subsidised. This is the layer that
     actually stops bulk-account farming — per-user limits cannot, since each
     farmed account sits within its own quota.
4. **Image size cap** — reject `imageBase64` longer than 4 MB with 413 before
   calling Gemini. Scans are pre-compressed to 800px-wide JPEG at quality
   0.65 (typically 70–200 KB base64), so this is roughly 20× headroom and no
   legitimate scan can hit it.
5. **Error redaction** — upstream failures return a generic message; the
   detail goes to the Worker log (visible in the Cloudflare dashboard).

`APP_SECRET` / `X-App-Key` is kept as a speed bump for casual scraping but is
explicitly **not** a security boundary — a client-shipped secret cannot be. The
real boundaries are the Google idToken and the rate limits.

## App changes

### Dead code removal

Three generations of superseded quota logic are removed. All of it is dead or
actively misleading — the scan gate has consulted none of it since
sub-project 3, yet HomeScreen still blocks users at 20 invoices with an
"upgrade to Pro" prompt, which a paying credit-pack customer would hit.

| Removed from `database.ts` | Generation |
|---|---|
| `getScansUsedThisMonth`, `incrementScanCount` | monthly scan quota (already uncalled) |
| `FREE_SCAN_LIMIT` | free scan count (already uncalled) |
| `FREE_INVOICE_LIMIT` | 20 free invoices |
| `isProUser`, `setProUser` | Pro flag (a local boolean — trivially spoofable) |

`getInvoiceCount` is **kept**: HomeScreen's backup nudge uses the same total
(`${totalCount} invoices not backed up yet`), which has nothing to do with
quotas. Only the `setQuota(...)` line consuming it is removed.

Call sites removed: HomeScreen's `quota` state, quota banner and add-invoice
block; ManualEntry's free-limit block; PaywallScreen's usage meter. Afterwards
exactly one quota concept remains app-wide: server-side credits, spent only by
scanning.

### PaywallScreen rebuild

Keeps the current dark treatment (a distinct purchase surface is conventional
and it already matches). New structure: coin icon → current balance as the
hero number → three pack cards with the middle one badged "best value" →
`Refresh balance` → `Maybe later`.

**Prices are read from RevenueCat's offering at runtime**, not hardcoded, so
they render in the user's local currency and price changes, promotions and new
regions need no app release.

Four purchase states get explicit feedback: billing sheet open → "processing"
(polling) → success (balance animates to the new value) → timeout ("payment
received, credits arriving shortly").

`Refresh balance` is the consumable-product equivalent of "restore purchases".
Because the balance lives in a server ledger keyed to the Google account, a new
device that signs in already sees it; the only real need is a manual re-check
for the rare case where a webhook was slow.

### New dependency

`react-native-purchases` (RevenueCat SDK). It contains native code, so **a new
EAS build is required** — the installed dev client cannot load it and Fast
Refresh cannot substitute. In-app purchases also cannot be tested on an
emulator, and test purchases require the APK signature to match the one
uploaded to Play Console.

## External configuration (user-performed)

**Hard prerequisite:** Play Console does not allow configuring in-app products
for an app that has never had a build uploaded. A build must reach at least the
internal testing track first, which requires app signing, store listing,
content rating and the data safety form. The privacy policy is already hosted
and screenshots are taken (see `STORE_LISTING.md`); the AAB upload is not done.

**Play Console:** developer account → create `com.slipvault.app` → upload first
AAB to internal testing → payment profile (bank + tax; approval takes time, do
it early) → three **Consumable** products `credits_30` / `credits_100` /
`credits_300` → License Testing accounts → Service Account JSON for RevenueCat.

**RevenueCat:** project → Android app (`com.slipvault.app`) → upload the
Service Account JSON → configure the three products into one Offering → copy
the Public SDK Key into `.env` as `EXPO_PUBLIC_REVENUECAT_KEY` → configure the
webhook to `https://invoice-reader-proxy.womendemiao.workers.dev/rc-webhook`
with a generated Authorization secret, stored in the Worker via
`wrangler secret put RC_WEBHOOK_SECRET`.

Code work does not depend on any of this and proceeds in parallel; only the
final device verification needs both sides ready.

## Testing

- **Idempotency:** deliver the same webhook event twice; balance rises once.
- **Forged webhook:** wrong/missing `Authorization` → 401; unknown product ID
  → rejected, no credit change.
- **Event filtering:** RevenueCat's "send test webhook" button → 200 with no
  credit change; a `CANCELLATION` body → 200, balance untouched.
- **Rate limit:** 11 scans inside a minute → the 11th returns 429 and spends
  no credit.
- **Signup IP cap:** the 4th account from one IP within 24 hours starts at 0
  credits, and can still sign in and scan once topped up.
- **Image cap:** a >4 MB base64 payload → 413, Gemini not called.
- **`valuate` gate:** no idToken → 401.
- **Purchase happy path (device, License Testing account):** buy each of the
  three packs; balance rises by exactly 30/100/300.
- **Purchase with the app backgrounded:** kill the app right after paying;
  reopen and confirm the credits arrived anyway.
- **Dead-code sweep:** with 25+ invoices stored, no quota banner or upgrade
  prompt appears anywhere, and manual entry is never blocked.

## Out of scope

- iOS / App Store Connect.
- Subscriptions of any kind.
- Encrypting the local SQLite database.
- Refund and chargeback handling (RevenueCat sends `CANCELLATION` and `REFUND`
  events; this sub-project ignores them — credits already spent are not
  clawed back. Revisit if refund abuse appears).
- Changing the 20-credit signup grant or the 1-credit scan price.
