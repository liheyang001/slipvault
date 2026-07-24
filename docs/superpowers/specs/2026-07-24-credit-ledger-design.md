# Credit Ledger Backend — Design

## Purpose

Sub-project 3 of the credit-system effort. Sub-project 1 (EAS dev-build
migration) and sub-project 2 (optional Google Sign-In) are done. This
sub-project replaces the spoofable local "20 free invoices" counter
(`FREE_INVOICE_LIMIT` in `src/services/database.ts`) with a real,
server-tracked credit ledger for the one action that actually costs money:
scanning a receipt (an AI/Gemini call). It must be fully testable end-to-end
**before** RevenueCat exists, via a developer-only top-up action that stands
in for RevenueCat's future purchase webhook.

**Decisions made with the user:**
- **Only scans consume a credit.** Manual entry (`ManualEntryScreen`) makes no
  AI call and stays completely free and login-free — untouched by this
  sub-project.
- **Scanning requires sign-in.** A signed-out user attempting to
  capture/import a photo is prompted to sign in with Google right there;
  cancelling aborts the capture. There is no more "free local count" path for
  scanning once this ships — the local counter is not consulted for the scan
  gate anymore (it may still exist in code for now; retiring it fully is a
  later cleanup, out of scope here).
- **Storage: Cloudflare D1**, not KV — a wallet needs atomic
  read-and-decrement (`UPDATE ... WHERE balance >= 1` in one statement); KV has
  no transactions and would allow a race to double-spend under concurrent
  requests.
- **Same Worker, not a new one** — extends the existing
  `worker/index.js`/`invoice-reader-proxy`, reusing its `action`-dispatch
  pattern (already used for `'valuate'`) and its existing `APP_SECRET`/
  `X-App-Key` gate.
- **Spend is integrated into the existing extraction call**, not a separate
  API round-trip — one Worker request does identity check → atomic decrement
  → Gemini call → refund-on-Gemini-failure → response. This avoids a
  window where extraction succeeds but a separate "now spend" call is lost.
- **Existing subscription/Pro code (`isProUser`, `PaywallScreen`,
  `FREE_INVOICE_LIMIT`) is left in place, untouched.** Reconciling/removing it
  is deferred to a later cleanup sub-project (previously slated as
  "sub-project 5: migration + paywall/balance UI rework" in the overall
  roadmap). This sub-project only changes what gates *scanning*.

## Data model (Cloudflare D1)

```sql
CREATE TABLE credits (
  user_id TEXT PRIMARY KEY,       -- Google idToken 'sub' claim
  email TEXT NOT NULL,
  balance INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE credit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,          -- -1 scan, +1 scan_refund, +20 signup, +N dev_topup
  reason TEXT NOT NULL,            -- 'signup' | 'scan' | 'scan_refund' | 'dev_topup'
  created_at TEXT NOT NULL
);
```

`credit_log` is an append-only audit trail (useful for future support/dispute
questions); it is not read on the hot path. The first time a `user_id` is seen
with no `credits` row, the Worker inserts one with `balance = 20` and logs a
`signup +20` entry, atomically with whatever operation triggered the lookup.

## Identity verification

The app sends `Authorization: Bearer <Google idToken>` on every credit-related
request, fetched fresh per-request via the Google Sign-In SDK (never cached —
matches sub-project 2's design of not persisting ID tokens). The Worker
verifies it using the `jose` library (JWT verification, works in the
Cloudflare Workers runtime, supports remote JWKS fetching with built-in
caching):
- signature verified against Google's public keys
  (`https://www.googleapis.com/oauth2/v3/certs` — `jose`'s
  `createRemoteJWKSet` handles fetching/caching this),
- `aud` claim equals the Web OAuth Client ID (`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`,
  set as a Worker secret too since the Worker needs it independently of the
  app bundle),
- `iss` is `https://accounts.google.com` (or `accounts.google.com`),
- not expired.

The verified `sub` claim is the `user_id` used for every ledger operation —
this is what prevents a client from claiming to be a different user than it
actually authenticated as.

## Worker changes (`worker/index.js`)

**Existing default action (invoice extraction) — behavior change:** now
requires a valid `Authorization: Bearer` idToken. Request flow becomes:
1. Verify idToken → get `user_id`/`email`.
2. Ensure a `credits` row exists (bootstrap to 20 if not).
3. Atomically attempt to spend: `UPDATE credits SET balance = balance - 1,
   updated_at = ? WHERE user_id = ? AND balance >= 1` — if this affects 0 rows,
   respond `402` with a recognizable error body (e.g.
   `{"error":"insufficient_credits","balance":0}`) and stop (no Gemini call,
   no cost incurred).
4. Log `scan -1` to `credit_log`.
5. Call Gemini as today. If the Gemini call throws/fails, refund: `UPDATE
   credits SET balance = balance + 1 WHERE user_id = ?`, log `scan_refund +1`,
   then return the existing error response unchanged.
6. On Gemini success, return the extraction result as today (response shape
   unchanged from the client's perspective, aside from the new possible 402).

**New action `'credits_balance'`:** verify idToken, bootstrap-if-needed,
return `{"balance": <int>}`.

**New action `'credits_dev_topup'`:** verify idToken **and** the existing
`X-App-Key`/`APP_SECRET` header (both required) — an interim stand-in for
RevenueCat's future purchase webhook. Body: `{"amount": <int>}` (must be a positive integer, capped at 1000 per
call — reject with 400 above that, to bound fat-fingering). Atomically adds
`amount` to balance, logs `dev_topup +amount`, returns new balance. **This
action must be deleted once RevenueCat's real webhook lands** — noted here so
it isn't forgotten as permanent surface area.

The `'valuate'` action is unaffected by this sub-project (no credit cost, no
identity requirement) — contents-insurance valuation stays as-is.

## App changes

- **`src/services/auth.ts`:** add `getIdToken(): Promise<string | null>` —
  wraps the SDK's token-retrieval call (e.g. `GoogleSignin.getTokens()`),
  returns null if not signed in, never throws for "not signed in" (mirrors the
  existing `signInWithGoogle` cancel-never-throws contract).
- **`src/services/claude.ts`:** `extractInvoiceData` gains the
  `Authorization` header (via `getIdToken()`) and a new typed error path: a
  `402` response throws a distinct `InsufficientCreditsError` (rather than the
  generic network-failure error it throws today), so callers can show a
  specific message instead of a generic "check your connection" one.
- **`src/screens/CameraScreen.tsx`:** before capture/import proceeds, check
  `getStoredUser()`; if null, call `signInWithGoogle()` inline (system account
  picker) — on success continue, on cancel (null) abort the capture attempt
  silently (matches existing capture-cancel UX), on real error show an alert.
  This replaces the current `checkQuota()` local-count gate for the
  scan-specific flow (manual entry's existing gate, if any, is untouched).
- **`src/screens/SettingsScreen.tsx`:** under `__DEV__` only, a "+20 credits
  (dev)" row in the existing Account section, calling the new
  `credits_dev_topup` action and showing the resulting balance via `Alert`.
- Nothing changes in `ManualEntryScreen.tsx` or the Insurance/Rooms flows.

## Error handling summary

| Scenario | Behavior |
|---|---|
| Not signed in, tries to scan | Google sign-in prompt; cancel aborts capture |
| Signed in, balance = 0 | Worker returns 402 before calling Gemini; app shows "Out of credits" alert (no purchase flow yet — that's RevenueCat's sub-project) |
| Gemini call fails after a successful spend | Worker refunds the credit; client sees the same network-error message as today |
| idToken invalid/expired/wrong audience | Worker returns 401; app treats like "not signed in" (re-prompts sign-in) |
| Dev top-up called without `APP_SECRET` or invalid idToken | 401, no balance change |

## Out of scope

- RevenueCat, real purchases, any purchase UI/paywall rework.
- Removing/migrating `isProUser`, `FREE_INVOICE_LIMIT`, `PaywallScreen`.
- Any change to manual entry, Rooms, Insurance, backup, or valuation flows.
- Rate limiting beyond the balance check itself (e.g. no per-minute throttle);
  the balance itself is the abuse bound for real usage. The dev top-up's cap
  (see above) is the only additional abuse guard added.

## Verification

No test runner in this project (confirmed in earlier sub-projects). Verify
via: `wrangler dev`/deploy + `curl` against the new actions (missing token →
401; valid token, fresh user → balance 20; spend → balance 19 + Gemini call
observed; spend at 0 balance → 402, no Gemini call; dev topup with/without
APP_SECRET). App-side: type-check + Metro bundle compile (this project's
established pattern) plus on-device manual verification of the sign-in-gate
and dev top-up button.
