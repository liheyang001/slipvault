# Credit Pack Payments + Worker Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `credits_dev_topup` backdoor with real RevenueCat credit-pack purchases, and close the five security findings from the 2026-07-27 Worker review.

**Architecture:** The Worker gains path dispatch — `POST /` keeps the existing app surface, `POST /rc-webhook` accepts RevenueCat only, authenticated by a separate secret. Purchases credit the ledger server-side and idempotently (deduped on RevenueCat's event id); the app polls its balance to hide the delay. Worker-side work lands first because it is deployable and curl-verifiable on its own; the client half needs a fresh EAS build before it can be tested at all.

**Tech Stack:** Cloudflare Workers + D1, `jose` (already present), `react-native-purchases` (new), Expo SDK 54.

**Spec:** `docs/superpowers/specs/2026-07-27-payments-and-hardening-design.md`

## Ordering constraint

`credits_dev_topup` is the only way to obtain credits today. It is therefore **not** removed until the purchase flow that replaces it works end to end — Task 10, after both the webhook and the Paywall exist. Every intermediate state keeps the app usable.

## Correction to the spec

The spec's dead-code table lists `getInvoiceCount` for removal. **It must be kept** — `HomeScreen` also uses it for the backup nudge (`totalCount >= 5`, `${totalCount} invoices not backed up yet`), which is unrelated to quotas. Only the `setQuota(...)` line that consumes it goes away. A fourth dead generation not in the spec was also found and is removed here: `FREE_SCAN_LIMIT = 15`.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `worker/schema-v2.sql` | migration for `event_id` + `signup_ips` | create |
| `worker/index.js` | routing, webhook, ledger, rate limits | modify |
| `src/services/purchases.ts` | RevenueCat SDK wrapper — configure, login, offerings, buy, poll | create |
| `src/services/claude.ts` | drop `devTopUpCredits` | modify |
| `src/services/database.ts` | drop four dead quota generations | modify |
| `src/screens/PaywallScreen.tsx` | rebuild as credit-pack store | modify |
| `src/screens/HomeScreen.tsx` | drop quota state/banner/gate | modify |
| `src/screens/ManualEntryScreen.tsx` | drop free-limit gate | modify |
| `src/screens/SettingsScreen.tsx` | drop DEV top-up row | modify |
| `App.tsx` | configure Purchases at startup | modify |
| `src/services/auth.ts` | link RevenueCat identity on sign-in | modify |

---

# Phase A — Worker (independently deployable and verifiable)

### Task 1: Database migration

**Files:**
- Create: `worker/schema-v2.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Idempotency key for RevenueCat webhook deliveries. Partial unique index so
-- the existing rows (event_id NULL) don't collide with each other.
ALTER TABLE credit_log ADD COLUMN event_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_log_event
  ON credit_log(event_id) WHERE event_id IS NOT NULL;

-- Signup origin, for capping the free-credit grant per IP.
CREATE TABLE IF NOT EXISTS signup_ips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signup_ips_ip_time ON signup_ips(ip, created_at);
```

- [ ] **Step 2: Apply to the remote database**

Run from `worker/`:
```bash
npx wrangler d1 execute slipvault-credits --remote --file=./schema-v2.sql
```
Expected: reports the statements executed without error.

- [ ] **Step 3: Verify the schema took**

Run from `worker/`:
```bash
npx wrangler d1 execute slipvault-credits --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='signup_ips'"
```
Expected: one row, `signup_ips`.

- [ ] **Step 4: Commit**

```bash
git add worker/schema-v2.sql
git commit -m "Add credit_log event_id and signup_ips tables"
```

---

### Task 2: Product map, rate limits, and signup grant

**Files:**
- Modify: `worker/index.js`

- [ ] **Step 1: Add the constants.** After the existing `const SIGNUP_CREDITS = 20;` line, add:

```js
const MAX_IMAGE_BASE64 = 4 * 1024 * 1024; // ~20x a compressed 800px scan
const SCANS_PER_MINUTE = 10;
const SCANS_PER_HOUR = 100;
const SIGNUPS_PER_IP_PER_DAY = 3;

// Credits are derived from the product ID here, never from the request body,
// so a forged webhook can only ever buy a pack that exists.
const CREDIT_PACKS = {
  credits_30: 30,
  credits_100: 100,
  credits_300: 300,
};
```

- [ ] **Step 2: Add the rate-limit and grant helpers.** Insert directly above `async function addCredits(` :

```js
/** True when this user has scanned too often recently. Counts existing
 * credit_log rows — the ledger is already a request log, so no new table. */
async function scanRateExceeded(env, userId) {
  const now = Date.now();
  const minuteAgo = new Date(now - 60_000).toISOString();
  const hourAgo = new Date(now - 3_600_000).toISOString();
  const row = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS last_minute,
       COUNT(*) AS last_hour
     FROM credit_log
     WHERE user_id = ? AND reason = 'scan' AND created_at > ?`
  )
    .bind(minuteAgo, userId, hourAgo)
    .first();
  return (row?.last_minute ?? 0) >= SCANS_PER_MINUTE || (row?.last_hour ?? 0) >= SCANS_PER_HOUR;
}

/** How many credits a brand-new account gets. Accounts beyond the daily
 * per-IP cap are still created and fully usable — they just start at zero. */
async function signupGrantFor(env, ip) {
  if (!ip) return SIGNUP_CREDITS;
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM signup_ips WHERE ip = ? AND created_at > ?'
  )
    .bind(ip, dayAgo)
    .first();
  return (row?.c ?? 0) >= SIGNUPS_PER_IP_PER_DAY ? 0 : SIGNUP_CREDITS;
}
```

- [ ] **Step 3: Make `ensureUser` grant-aware and record the IP.** Replace the whole existing `ensureUser` function with:

```js
/** Ensures a credits row exists, bootstrapping new users with the grant the
 * caller's IP still qualifies for. Records the signup IP for that cap. */
async function ensureUser(env, userId, email, ip) {
  const existing = await env.DB.prepare('SELECT 1 FROM credits WHERE user_id = ?')
    .bind(userId)
    .first();
  if (existing) return;

  const grant = await signupGrantFor(env, ip);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO credits (user_id, email, balance, updated_at) VALUES (?, ?, ?, ?)'
    ).bind(userId, email, grant, now),
    env.DB.prepare(
      "INSERT INTO credit_log (user_id, delta, reason, created_at) SELECT ?, ?, 'signup', ? WHERE changes() = 1"
    ).bind(userId, grant, now),
  ]);
  if (ip) {
    await env.DB.prepare('INSERT INTO signup_ips (ip, created_at) VALUES (?, ?)')
      .bind(ip, now)
      .run();
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add worker/index.js
git commit -m "Add credit pack map, scan rate limits and per-IP signup grant"
```

---

### Task 3: Webhook handler

**Files:**
- Modify: `worker/index.js`

- [ ] **Step 1: Add the idempotent purchase credit.** Insert directly below the existing `addCredits` function:

```js
/** Credits a purchase exactly once. Returns true if this delivery was the one
 * that applied it, false if it was a retry of an event already processed. */
async function addPurchasedCredits(env, userId, amount, eventId) {
  const now = new Date().toISOString();
  const [logResult] = await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO credit_log (user_id, delta, reason, event_id, created_at) VALUES (?, ?, 'purchase', ?, ?)"
    ).bind(userId, amount, eventId, now),
    // changes() refers to the INSERT above: 0 on a duplicate event, so the
    // balance is left alone.
    env.DB.prepare(
      'UPDATE credits SET balance = balance + ?, updated_at = ? WHERE user_id = ? AND changes() = 1'
    ).bind(amount, now, userId),
  ]);
  return logResult.meta.changes === 1;
}
```

- [ ] **Step 2: Add the webhook handler.** Insert directly above `export default {`:

```js
/** RevenueCat webhook. Authenticated by RC_WEBHOOK_SECRET, never by the app's
 * idToken or app key — the two surfaces share no credentials.
 *
 * Returns 200 for anything it deliberately ignores: RevenueCat retries non-2xx
 * on a backoff for hours, so rejecting an event type we will never process
 * would manufacture a retry storm. Only genuine failures return 5xx.
 */
async function handleWebhook(request, env) {
  if (!env.RC_WEBHOOK_SECRET) {
    console.log('rc-webhook: RC_WEBHOOK_SECRET not configured');
    return new Response('Not configured', { status: 503 });
  }
  if (request.headers.get('authorization') !== env.RC_WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const event = body?.event;
  if (!event || typeof event !== 'object') {
    return new Response('Missing event', { status: 400 });
  }

  // Consumables arrive as NON_RENEWING_PURCHASE. TEST, CANCELLATION, REFUND
  // and anything added later are acknowledged and dropped.
  if (event.type !== 'NON_RENEWING_PURCHASE') {
    return new Response('Ignored', { status: 200 });
  }

  const userId = event.app_user_id;
  const eventId = event.id;
  const credits = CREDIT_PACKS[event.product_id];

  if (!userId || !eventId) {
    return new Response('Missing app_user_id or id', { status: 400 });
  }
  if (!credits) {
    // Acknowledged, not retried: an unknown product will never become known.
    console.log(`rc-webhook: unknown product ${event.product_id} for ${userId}`);
    return new Response('Unknown product', { status: 200 });
  }

  try {
    await ensureUser(env, userId, '', null);
    const applied = await addPurchasedCredits(env, userId, credits, eventId);
    const balance = await getBalance(env, userId);
    console.log(
      `rc-webhook: ${userId} ${event.product_id} +${credits} applied=${applied} balance=${balance}`
    );
    return new Response(JSON.stringify({ applied, balance }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    // A real failure — let RevenueCat retry this one.
    console.log(`rc-webhook: crediting failed for ${userId}: ${err.message}`);
    return new Response('Crediting failed', { status: 500 });
  }
}
```

Note: `ensureUser` is called with `ip = null` here deliberately. A webhook comes from RevenueCat's servers, so its IP says nothing about the user; passing it would pollute the signup cap. A user reaching a purchase has already signed in through `POST /`, so their row exists by then anyway.

- [ ] **Step 3: Add path dispatch.** In `export default { async fetch(request, env) {`, immediately after the `if (request.method !== 'POST')` guard, insert:

```js
    // Separate surface, separate credential: RevenueCat only.
    if (new URL(request.url).pathname === '/rc-webhook') {
      return handleWebhook(request, env);
    }
```

- [ ] **Step 4: Commit**

```bash
git add worker/index.js
git commit -m "Accept RevenueCat purchase webhooks with idempotent crediting"
```

---

### Task 4: Security fixes on the app surface

**Files:**
- Modify: `worker/index.js`

- [ ] **Step 1: Require identity for `valuate`.** Replace the opening of the valuate branch:

```js
    // ─── Action: valuate (AI depreciation for contents insurance) ───────────
    // Unchanged: no identity or credit requirement.
    if (body.action === 'valuate') {
      const items = body.items;
```

with:

```js
    // ─── Action: valuate (AI depreciation for contents insurance) ───────────
    // Requires a signed-in user (the app key is shipped in the APK and cannot
    // gate anything), but costs no credits — charging would discourage use.
    if (body.action === 'valuate') {
      try {
        await verifyIdToken(request, env);
      } catch {
        return new Response('Unauthorized', { status: 401 });
      }
      const items = body.items;
```

- [ ] **Step 2: Redact the valuate upstream error.** Replace:

```js
      if (!res.ok) {
        const errText = await res.text();
        return new Response(`Gemini error: ${errText}`, { status: res.status });
      }
```

with:

```js
      if (!res.ok) {
        console.log(`valuate: Gemini ${res.status}: ${await res.text()}`);
        return new Response('Valuation service unavailable', { status: 502 });
      }
```

- [ ] **Step 3: Cap the image size.** Replace:

```js
    const { imageBase64, mimeType = 'image/jpeg' } = body;
    if (!imageBase64) {
      return new Response('Missing imageBase64', { status: 400 });
    }
```

with:

```js
    const { imageBase64, mimeType = 'image/jpeg' } = body;
    if (!imageBase64) {
      return new Response('Missing imageBase64', { status: 400 });
    }
    if (typeof imageBase64 !== 'string' || imageBase64.length > MAX_IMAGE_BASE64) {
      return new Response('Image too large', { status: 413 });
    }
```

- [ ] **Step 4: Rate-limit scans and pass the IP through.** Replace:

```js
    await ensureUser(env, identity.sub, identity.email);
    const spent = await spendCredit(env, identity.sub);
```

with:

```js
    await ensureUser(env, identity.sub, identity.email, request.headers.get('cf-connecting-ip'));

    if (await scanRateExceeded(env, identity.sub)) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const spent = await spendCredit(env, identity.sub);
```

- [ ] **Step 5: Pass the IP in the other two `ensureUser` call sites.** In the `credits_balance` branch, replace `await ensureUser(env, identity.sub, identity.email);` with:

```js
      await ensureUser(env, identity.sub, identity.email, request.headers.get('cf-connecting-ip'));
```

And in the `credits_dev_topup` branch, replace its `await ensureUser(env, identity.sub, identity.email);` with the identical line:

```js
      await ensureUser(env, identity.sub, identity.email, request.headers.get('cf-connecting-ip'));
```

- [ ] **Step 6: Redact the scan upstream errors.** Replace:

```js
    if (!geminiRes.ok) {
      await refundCredit(env, identity.sub);
      const errText = await geminiRes.text();
      return new Response(`Gemini error: ${errText}`, { status: geminiRes.status });
    }
```

with:

```js
    if (!geminiRes.ok) {
      await refundCredit(env, identity.sub);
      console.log(`scan: Gemini ${geminiRes.status}: ${await geminiRes.text()}`);
      return new Response('Extraction service unavailable', { status: 502 });
    }
```

Then replace the two remaining leaky returns — `Gemini request failed: ${err.message}` and `Gemini returned an unreadable response: ${err.message}` — with logged, generic equivalents:

```js
    } catch (err) {
      await refundCredit(env, identity.sub);
      console.log(`scan: Gemini request failed: ${err.message}`);
      return new Response('Extraction service unavailable', { status: 502 });
    }
```

```js
    } catch (err) {
      await refundCredit(env, identity.sub);
      console.log(`scan: unreadable Gemini response: ${err.message}`);
      return new Response('Extraction service unavailable', { status: 502 });
    }
```

- [ ] **Step 7: Commit**

```bash
git add worker/index.js
git commit -m "Require sign-in for valuate, rate-limit scans, cap image size, redact upstream errors"
```

---

### Task 5: Deploy and verify the Worker (human-required secret)

**Files:** none.

- [ ] **Step 1 (human): Generate and store the webhook secret.** Generate a random value and keep a copy — the same string goes into RevenueCat's webhook Authorization field later:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then from `worker/`, with that value piped in (the CLI prompt cannot be answered in this environment):

```bash
echo "<the generated value>" | npx wrangler secret put RC_WEBHOOK_SECRET
```
Expected: `✨ Success! Uploaded secret RC_WEBHOOK_SECRET`

- [ ] **Step 2: Deploy**

Run from `worker/`: `npx wrangler deploy`
Expected: reports a successful upload with a version ID.

- [ ] **Step 3: Verify webhook auth rejects a bad secret**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://invoice-reader-proxy.womendemiao.workers.dev/rc-webhook \
  -H "Authorization: wrong" -H "Content-Type: application/json" \
  -d '{"event":{"type":"NON_RENEWING_PURCHASE","id":"e1","app_user_id":"u1","product_id":"credits_30"}}'
```
Expected: `401`

- [ ] **Step 4: Verify an ignored event type is acknowledged, not retried**

```bash
curl -s -w "\n%{http_code}\n" -X POST \
  https://invoice-reader-proxy.womendemiao.workers.dev/rc-webhook \
  -H "Authorization: <the generated value>" -H "Content-Type: application/json" \
  -d '{"event":{"type":"TEST","id":"t1"}}'
```
Expected: body `Ignored`, status `200`.

- [ ] **Step 5: Verify idempotency with a real credit.** Send the same event twice:

```bash
SECRET="<the generated value>"
URL=https://invoice-reader-proxy.womendemiao.workers.dev/rc-webhook
BODY='{"event":{"type":"NON_RENEWING_PURCHASE","id":"evt-test-1","app_user_id":"curl-test-user","product_id":"credits_30"}}'
curl -s -X POST $URL -H "Authorization: $SECRET" -H "Content-Type: application/json" -d "$BODY"; echo
curl -s -X POST $URL -H "Authorization: $SECRET" -H "Content-Type: application/json" -d "$BODY"; echo
```
Expected: first returns `{"applied":true,"balance":30}` (a fresh user gets 0 signup credits here because `ip` is null → grant applies normally at 20; balance may read 50 if the row was new — what matters is the second call). Second returns `{"applied":false,...}` with the **same balance as the first**.

- [ ] **Step 6: Verify an unknown product is acknowledged but not credited**

```bash
curl -s -w "\n%{http_code}\n" -X POST \
  https://invoice-reader-proxy.womendemiao.workers.dev/rc-webhook \
  -H "Authorization: <the generated value>" -H "Content-Type: application/json" \
  -d '{"event":{"type":"NON_RENEWING_PURCHASE","id":"evt-test-2","app_user_id":"curl-test-user","product_id":"credits_9999"}}'
```
Expected: body `Unknown product`, status `200`.

- [ ] **Step 7: Verify `valuate` now demands identity**

```bash
curl -s -w "\n%{http_code}\n" -X POST \
  https://invoice-reader-proxy.womendemiao.workers.dev \
  -H "Content-Type: application/json" -H "X-App-Key: $(grep EXPO_PUBLIC_APP_KEY ../.env | cut -d= -f2)" \
  -d '{"action":"valuate","items":[{"name":"x","category":"y","date":"2024-01-01","price":10}]}'
```
Expected: `Unauthorized`, status `401` (previously this reached Gemini).

- [ ] **Step 8: Clean up the test rows**

```bash
npx wrangler d1 execute slipvault-credits --remote --command "DELETE FROM credit_log WHERE user_id='curl-test-user'; DELETE FROM credits WHERE user_id='curl-test-user'"
```
Expected: executes without error.

- [ ] **Step 9: Report** which checks passed. Phase A is done; the Worker is hardened and accepting purchases while the app still uses the dev top-up.

---

# Phase B — Client

### Task 6: Remove four generations of dead quota code

**Files:**
- Modify: `src/services/database.ts`, `src/screens/HomeScreen.tsx`, `src/screens/ManualEntryScreen.tsx`

- [ ] **Step 1: Delete the dead exports from `src/services/database.ts`.** Remove this entire block (it starts at the `FREE_SCAN_LIMIT` line and runs through `incrementScanCount`):

```ts
export const FREE_SCAN_LIMIT = 15;

export function isProUser(): boolean {
  return getSetting('isPro', 'false') === 'true';
}

export function setProUser(value: boolean): void {
  setSetting('isPro', value ? 'true' : 'false');
}

export function getScansUsedThisMonth(): number {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const storedMonth = getSetting('scanMonth', '');
  if (storedMonth !== thisMonth) {
    setSetting('scanMonth', thisMonth);
    setSetting('scanCount', '0');
    return 0;
  }
  return parseInt(getSetting('scanCount', '0'), 10);
}

export function incrementScanCount(): void {
  const used = getScansUsedThisMonth();
  setSetting('scanCount', String(used + 1));
}
```

Also delete the `FREE_INVOICE_LIMIT` line:

```ts
export const FREE_INVOICE_LIMIT = 20;
```

**Keep `getInvoiceCount`** — HomeScreen's backup nudge uses it.

- [ ] **Step 2: Strip the quota state from `src/screens/HomeScreen.tsx`.** Remove `isProUser` and `FREE_INVOICE_LIMIT` from the `../services/database` import (keep `getInvoiceCount`), then delete this state line:

```tsx
  const [quota, setQuota] = useState<{ pro: boolean; count: number }>({ pro: true, count: 0 });
```

and delete only the `setQuota` line from the focus effect, keeping the `totalCount` assignment the backup nudge depends on:

```tsx
      setQuota({ pro: isProUser(), count: totalCount });
```

- [ ] **Step 3: Delete the quota banner JSX** (HomeScreen):

```tsx
      {/* Free quota banner (shown when close to the cap) */}
      {!quota.pro && quota.count >= FREE_INVOICE_LIMIT - 5 && (
        <TouchableOpacity
          style={styles.quotaBanner}
          onPress={() => navigation.navigate('Paywall')}
          activeOpacity={0.8}
        >
          <Text style={styles.quotaText}>
            {Math.min(quota.count, FREE_INVOICE_LIMIT)}/{FREE_INVOICE_LIMIT} free invoices used
          </Text>
          <Text style={styles.quotaAction}>Go Pro</Text>
        </TouchableOpacity>
      )}

```

- [ ] **Step 4: Delete the manual-entry gate inside the FAB** (HomeScreen). Replace:

```tsx
                onPress: () => {
                  // Gate here so users never fill in a form they can't save.
                  if (!quota.pro && quota.count >= FREE_INVOICE_LIMIT) {
                    Alert.alert(
                      'Free limit reached',
                      `The free plan stores up to ${FREE_INVOICE_LIMIT} invoices. Upgrade to Pro for unlimited invoices.`,
                      [
                        { text: 'Not now', style: 'cancel' },
                        { text: 'See Pro', onPress: () => navigation.navigate('Paywall') },
                      ]
                    );
                    return;
                  }
                  navigation.navigate('ManualEntry', params);
                },
```

with:

```tsx
                onPress: () => navigation.navigate('ManualEntry', params),
```

- [ ] **Step 5: Delete the now-unused banner styles** (HomeScreen):

```tsx
  quotaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#eff6ff',
    borderBottomWidth: 1,
    borderBottomColor: '#dbeafe',
  },
  quotaText: { fontSize: 13, color: '#1d4ed8', fontWeight: '600' },
  quotaAction: { fontSize: 13, color: '#2563eb', fontWeight: '800' },
```

- [ ] **Step 6: Delete the gate in `src/screens/ManualEntryScreen.tsx`.** Remove `isProUser`, `getInvoiceCount` and `FREE_INVOICE_LIMIT` from its `../services/database` import, then delete:

```tsx
    // Free plan gate (double-check here in case the count changed since the FAB)
    if (!isProUser() && getInvoiceCount() >= FREE_INVOICE_LIMIT) {
      Alert.alert(
        'Free limit reached',
        `The free plan stores up to ${FREE_INVOICE_LIMIT} invoices. Upgrade to Pro for unlimited invoices.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'See Pro', onPress: () => navigation.navigate('Paywall') },
        ]
      );
      return;
    }

```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no output. Errors naming `FREE_INVOICE_LIMIT`, `isProUser` or `quota` mean a call site was missed — PaywallScreen still references them and is rebuilt in Task 8; if its errors appear here, leave them and re-run after Task 8.

- [ ] **Step 8: Commit**

```bash
git add src/services/database.ts src/screens/HomeScreen.tsx src/screens/ManualEntryScreen.tsx
git commit -m "Remove four generations of superseded quota logic"
```

---

### Task 7: RevenueCat service wrapper

**Files:**
- Create: `src/services/purchases.ts`
- Modify: `package.json` (via install), `.env.example`, `App.tsx`, `src/services/auth.ts`

- [ ] **Step 1: Install the SDK**

Run: `npx expo install react-native-purchases`
Expected: `package.json` gains a `react-native-purchases` dependency.

- [ ] **Step 2: Create `src/services/purchases.ts`**

```ts
import Purchases, { PurchasesPackage } from 'react-native-purchases';
import { getCreditBalance } from './claude';

/** Configure once at app start. No-op without a key so dev builds without
 * RevenueCat configured still run. */
export function configurePurchases(): void {
  const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_KEY;
  if (!apiKey) return;
  Purchases.configure({ apiKey });
}

/** Ties purchases to the Google identity the credit ledger is keyed on, so
 * the webhook's app_user_id matches the ledger's user_id. */
export async function linkPurchasesToUser(googleSub: string): Promise<void> {
  if (!process.env.EXPO_PUBLIC_REVENUECAT_KEY) return;
  try {
    await Purchases.logIn(googleSub);
  } catch {
    // Identity linking is best-effort at sign-in; the Paywall retries it.
  }
}

/** The credit packs on offer, cheapest first. Prices come from the store, so
 * they are already localised and reflect any live promotion. */
export async function getCreditPacks(): Promise<PurchasesPackage[]> {
  const offerings = await Purchases.getOfferings();
  const packages = offerings.current?.availablePackages ?? [];
  return [...packages].sort((a, b) => a.product.price - b.product.price);
}

/** Launches the store purchase sheet. Resolves once payment completes —
 * credits arrive separately via the webhook. */
export async function buyPack(pack: PurchasesPackage): Promise<void> {
  await Purchases.purchasePackage(pack);
}

/** True when the user dismissed the store sheet rather than hitting an error. */
export function isUserCancelled(err: unknown): boolean {
  return !!(err as { userCancelled?: boolean })?.userCancelled;
}

/** Polls until the balance rises above `before`, or gives up. Returns the new
 * balance, or null on timeout — the webhook retries, so null means "not yet",
 * never "lost". */
export async function waitForCredits(before: number, attempts = 5): Promise<number | null> {
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const balance = await getCreditBalance();
      if (balance > before) return balance;
    } catch {
      // Transient failure — keep polling.
    }
  }
  return null;
}
```

- [ ] **Step 3: Document the key in `.env.example`.** Append:

```
# RevenueCat public SDK key (Project → API keys → Public app key, starts with
# "goog_"). Safe to ship in the app; purchases are validated server-side.
EXPO_PUBLIC_REVENUECAT_KEY=goog_xxxxxxxxxxxxxxxxxxxxxxxx
```

- [ ] **Step 4: Configure at startup in `App.tsx`.** Next to the existing `try { configureAuth(); } catch {}` line, add the import and the call:

```tsx
import { configurePurchases } from './src/services/purchases';
```
```tsx
try { configurePurchases(); } catch {}
```

- [ ] **Step 5: Link identity on sign-in in `src/services/auth.ts`.** Add the import at the top:

```ts
import { linkPurchasesToUser } from './purchases';
```

Then in `signInWithGoogle`, replace:

```ts
  setSetting('authUser', JSON.stringify(user));
  return user;
```

with:

```ts
  setSetting('authUser', JSON.stringify(user));
  await linkPurchasesToUser(user.id);
  return user;
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no output aside from any pre-existing PaywallScreen errors from Task 6, which Task 8 clears.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/services/purchases.ts .env.example App.tsx src/services/auth.ts
git commit -m "Add RevenueCat SDK wrapper and link it to the Google identity"
```

---

### Task 8: Rebuild PaywallScreen as a credit store

**Files:**
- Modify: `src/screens/PaywallScreen.tsx`

- [ ] **Step 1: Replace the entire file**

```tsx
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { PurchasesPackage } from 'react-native-purchases';
import { RootStackParamList } from '../types/navigation';
import { getCreditBalance } from '../services/claude';
import { getCreditPacks, buyPack, isUserCancelled, waitForCredits } from '../services/purchases';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Paywall'>;

/** Credits per pack, keyed by store product ID — used for the display label
 * only; the ledger is credited server-side from the same mapping. */
const PACK_CREDITS: Record<string, number> = {
  credits_30: 30,
  credits_100: 100,
  credits_300: 300,
};
const BEST_VALUE_ID = 'credits_100';

export default function PaywallScreen() {
  const navigation = useNavigation<Nav>();
  const [balance, setBalance] = useState<number | null>(null);
  const [packs, setPacks] = useState<PurchasesPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBalance(await getCreditBalance());
    } catch {
      setBalance(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        await refresh();
        try {
          const available = await getCreditPacks();
          if (!cancelled) setPacks(available);
        } catch {
          if (!cancelled) setPacks([]);
        }
        if (!cancelled) setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [refresh])
  );

  async function handleBuy(pack: PurchasesPackage) {
    if (busyId) return;
    const before = balance ?? 0;
    setBusyId(pack.identifier);
    try {
      await buyPack(pack);
      // Payment is done; the credits arrive via RevenueCat's webhook.
      const updated = await waitForCredits(before);
      if (updated !== null) {
        setBalance(updated);
        Alert.alert('Credits added', `You now have ${updated} scan credits.`);
      } else {
        await refresh();
        Alert.alert(
          'Payment received',
          'Your credits will arrive shortly. Pull up this screen again in a moment to check.'
        );
      }
    } catch (err) {
      if (!isUserCancelled(err)) {
        Alert.alert('Purchase failed', 'No charge was made. Please try again.');
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heroIcon}>🪙</Text>
      <Text style={styles.title}>Scan credits</Text>
      <Text style={styles.subtitle}>
        One credit per AI scan. Adding items by hand is always free.
      </Text>

      <View style={styles.balanceBox}>
        <Text style={styles.balanceLabel}>YOUR BALANCE</Text>
        <Text style={styles.balanceValue}>{balance === null ? '—' : balance}</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loader} color="#60a5fa" />
      ) : packs.length === 0 ? (
        <Text style={styles.unavailable}>
          Credit packs are unavailable right now. Check your connection and try again.
        </Text>
      ) : (
        <View style={styles.packs}>
          {packs.map((pack) => {
            const productId = pack.product.identifier;
            const credits = PACK_CREDITS[productId];
            const isBest = productId === BEST_VALUE_ID;
            return (
              <TouchableOpacity
                key={pack.identifier}
                style={[styles.pack, isBest && styles.packBest]}
                onPress={() => handleBuy(pack)}
                disabled={busyId !== null}
                activeOpacity={0.85}
              >
                <View style={styles.packMain}>
                  <Text style={styles.packCredits}>
                    {credits ? `${credits} credits` : pack.product.title}
                  </Text>
                  {isBest && <Text style={styles.packBadge}>BEST VALUE</Text>}
                </View>
                {busyId === pack.identifier ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.packPrice}>{pack.product.priceString}</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <TouchableOpacity style={styles.refreshBtn} onPress={refresh} disabled={busyId !== null}>
        <Text style={styles.refreshText}>Refresh balance</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.laterBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.laterText}>Maybe later</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 28, paddingTop: 36, alignItems: 'center' },

  heroIcon: { fontSize: 52 },
  title: { fontSize: 26, fontWeight: '800', color: '#fff', marginTop: 10, letterSpacing: -0.5 },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },

  balanceBox: {
    marginTop: 24,
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 40,
  },
  balanceLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#60a5fa',
  },
  balanceValue: { fontSize: 40, fontWeight: '800', color: '#fff', marginTop: 4 },

  loader: { marginTop: 30 },
  unavailable: {
    marginTop: 30,
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 19,
  },

  packs: { width: '100%', marginTop: 26, gap: 12 },
  pack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e293b',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  packBest: { borderColor: '#2563eb' },
  packMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  packCredits: { fontSize: 16, fontWeight: '700', color: '#f1f5f9' },
  packBadge: {
    fontSize: 9,
    fontWeight: '800',
    color: '#93c5fd',
    backgroundColor: '#1d4ed8',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  packPrice: { fontSize: 16, fontWeight: '800', color: '#fff' },

  refreshBtn: { marginTop: 24, padding: 10 },
  refreshText: { color: '#60a5fa', fontSize: 14, fontWeight: '700' },
  laterBtn: { marginTop: 4, padding: 10 },
  laterText: { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no output — this also clears any PaywallScreen errors left over from Task 6.

- [ ] **Step 3: Bundle-compile check** (confirm Metro is running first with `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8081/status` → `200`; if not, skip and note it):

Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8081/index.bundle?platform=android&dev=true&minify=false"`
Expected: `200`

- [ ] **Step 4: Commit**

```bash
git add src/screens/PaywallScreen.tsx
git commit -m "Rebuild the Paywall as a credit pack store"
```

---

# Phase C — Remove the backdoor

### Task 9: Delete `credits_dev_topup` end to end

**Files:**
- Modify: `worker/index.js`, `src/services/claude.ts`, `src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Delete the Worker action.** Remove this whole block from `worker/index.js`:

```js
    // ─── Action: credits_dev_topup ───────────────────────────────────────
    // Interim stand-in for a real purchase (RevenueCat webhook). DELETE THIS
    // ACTION once RevenueCat purchases are wired up — it lets anyone with a
    // valid Google account and the app secret give themselves free credits.
    if (body.action === 'credits_dev_topup') {
```

through the closing brace of that branch (ending with the `}` after its `return new Response(JSON.stringify({ balance }), {...});`). Also delete the now-unused `addCredits` helper, which only this action called:

```js
async function addCredits(env, userId, amount) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE credits SET balance = balance + ?, updated_at = ? WHERE user_id = ?'
    ).bind(amount, now, userId),
    env.DB.prepare(
      "INSERT INTO credit_log (user_id, delta, reason, created_at) VALUES (?, ?, 'dev_topup', ?)"
    ).bind(userId, amount, now),
  ]);
}
```

- [ ] **Step 2: Verify no reference survives**

Run: `grep -n "credits_dev_topup\|addCredits" worker/index.js`
Expected: no output. (`addPurchasedCredits` is a different name and must remain — if it appears, the grep matched a substring; confirm the surviving hits are only `addPurchasedCredits`.)

- [ ] **Step 3: Delete the client function.** Remove from `src/services/claude.ts`:

```ts
export async function devTopUpCredits(amount: number): Promise<number> {
  const response = await fetch(getProxyUrl(), {
    method: 'POST',
    headers: await buildHeaders(),
    body: JSON.stringify({ action: 'credits_dev_topup', amount }),
  });
  if (!response.ok) {
    throw new Error(`Top-up failed (${response.status}).`);
  }
  const data = (await response.json()) as CreditBalance;
  return data.balance;
}
```

- [ ] **Step 4: Delete the Settings DEV row.** In `src/screens/SettingsScreen.tsx`, change the import to drop `devTopUpCredits`:

```tsx
import { getCreditBalance } from '../services/claude';
```

delete the handler:

```tsx
  async function handleDevTopUp() {
    try {
      const newBalance = await devTopUpCredits(20);
      setBalance(newBalance);
    } catch {
      Alert.alert('Top-up failed', 'Please try again.');
    }
  }
```

and delete the row JSX:

```tsx
            {__DEV__ && (
              <TouchableOpacity style={styles.devRow} onPress={handleDevTopUp} activeOpacity={0.7}>
                <Text style={styles.devText}>+20 credits · testing only</Text>
                <View style={styles.devChip}>
                  <Text style={styles.devChipText}>DEV</Text>
                </View>
              </TouchableOpacity>
            )}
```

plus its now-unused styles:

```tsx
  devRow: {
    marginTop: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  devText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  devChip: {
    backgroundColor: '#f3e8ff',
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  devChipText: { fontSize: 10, fontWeight: '700', color: '#7c3aed' },
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Deploy the Worker**

Run from `worker/`: `npx wrangler deploy`
Expected: successful upload.

- [ ] **Step 7: Verify the backdoor is gone.** The dev top-up now falls through to the scan branch, which requires `imageBase64`:

```bash
curl -s -w "\n%{http_code}\n" -X POST \
  https://invoice-reader-proxy.womendemiao.workers.dev \
  -H "Content-Type: application/json" \
  -H "X-App-Key: $(grep EXPO_PUBLIC_APP_KEY .env | cut -d= -f2)" \
  -d '{"action":"credits_dev_topup","amount":1000}'
```
Expected: `Missing imageBase64`, status `400` — proving the action no longer exists. (Previously: `401` from its app-key gate, or a credit grant with a valid token.)

- [ ] **Step 8: Commit**

```bash
git add worker/index.js src/services/claude.ts src/screens/SettingsScreen.tsx
git commit -m "Remove the dev credit top-up backdoor"
```

---

# Phase D — Build and verify (human-required)

### Task 10: EAS build and end-to-end device verification

**Files:** none.

`react-native-purchases` ships native code, so the installed dev client cannot load any of Phase B. A new build is mandatory, and in-app purchases cannot be tested on an emulator.

- [ ] **Step 1 (human): Confirm external configuration is complete.** All of the following must be done before a test purchase can work — see the spec's "External configuration" section:
  - Play Console: app created, an AAB uploaded to at least internal testing, payment profile filled, three **Consumable** products `credits_30` / `credits_100` / `credits_300` created and active, a License Testing account added, Service Account JSON exported.
  - RevenueCat: project + Android app configured with that Service Account, the three products in one Offering, webhook pointed at `https://invoice-reader-proxy.womendemiao.workers.dev/rc-webhook` with the Authorization value from Task 5 Step 1.
  - `.env` contains `EXPO_PUBLIC_REVENUECAT_KEY` with the RevenueCat **public** SDK key.

- [ ] **Step 2 (human): Build**

Run: `npx eas build --profile development --platform android`
Expected: a cloud build completes and yields an installable APK. Install it on the test device, replacing the old dev client.

- [ ] **Step 3 (human): Sign in with the License Testing Google account**, then open Settings and confirm the account card shows a balance and that the dashed "+20 credits · testing only" row is **gone**.

- [ ] **Step 4 (human): Buy the smallest pack.** Home → any Paywall entry → tap the 30-credit pack. Confirm: the Google Play sheet opens marked as a test purchase, payment completes, a brief wait, then "Credits added — you now have N scan credits" with N exactly 30 higher than before.

- [ ] **Step 5 (human): Verify crediting survives the app dying.** Buy the 100-credit pack and force-kill the app the instant the Play sheet closes. Reopen, go to Settings, and confirm the balance rose by 100 anyway — this proves the webhook, not the client, is what credits the account.

- [ ] **Step 6 (human): Verify no double-credit.** From the RevenueCat dashboard (Customer → Events), re-deliver one of the purchase events. Confirm the balance does **not** change.

- [ ] **Step 7 (human): Verify the quota ghosts are gone.** With 25+ invoices stored, confirm no "free invoices used" banner on Home, no "Free limit reached" alert when adding manually, and that manual entry saves normally.

- [ ] **Step 8 (human): Verify a scan still spends exactly one credit**, and that the Review screen's "Out of scan credits" card appears once the balance reaches 0, with its "Get more credits" button opening the new Paywall.

- [ ] **Step 9: Report** which of Steps 3–8 passed and anything that did not match.

---

## Plan self-review notes

- **Spec coverage:** routing + separate credentials → Task 3 Steps 2–3; product map server-side → Task 2 Step 1; idempotency via `event_id` → Task 1 Step 1 + Task 3 Step 1; event-type filtering with 200-on-ignore → Task 3 Step 2; client polling → Task 7 Step 2 (`waitForCredits`) + Task 8 Step 1; identity linking → Task 7 Step 5; five security fixes → Task 4 (valuate auth, image cap, error redaction), Task 2 + Task 4 Step 4 (rate limits, per-IP grant), Task 9 (backdoor removal); dead-code removal → Task 6; Paywall rebuild with store-supplied prices → Task 8; new dependency and build requirement → Task 7 Step 1, Task 10.
- **Deviation from spec, flagged deliberately:** `getInvoiceCount` is retained (backup nudge depends on it) and a fourth dead constant `FREE_SCAN_LIMIT` is additionally removed. Both are called out at the top of this plan.
- **Placeholder scan:** none — every step carries complete code or an exact command. Values the user must generate (`RC_WEBHOOK_SECRET`, the RevenueCat key) are marked human-required with the command that produces them.
- **Type consistency:** `addPurchasedCredits` (new, kept) is distinct from `addCredits` (deleted in Task 9); `ensureUser` gains a fourth parameter `ip` in Task 2 Step 3 and every call site is updated in Task 4 Steps 4–5 and Task 3 Step 2; `getCreditBalance` returns `Promise<number>`, matching `balance: number | null` state and the `waitForCredits(before: number)` signature; `PurchasesPackage` is imported as a type in both `purchases.ts` and `PaywallScreen.tsx`.
- **Ordering safety:** the backdoor survives until Task 9, so every intermediate commit leaves a working way to obtain credits. Phase A is deployable and verifiable before any client work begins.
