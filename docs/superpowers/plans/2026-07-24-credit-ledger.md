# Credit Ledger Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the spoofable local "20 free invoices" counter with a real, server-tracked, per-user credit ledger that gates scanning (only), verified end-to-end before RevenueCat exists via a developer-only top-up action.

**Architecture:** Extends the existing Cloudflare Worker (`worker/index.js`) with a Cloudflare D1 table pair (`credits`, `credit_log`), Google idToken verification via `jose`, and credit spend/refund logic integrated directly into the existing invoice-extraction request. App side: `src/services/auth.ts` gains `getIdToken()`; `src/services/claude.ts` sends the token and exposes `InsufficientCreditsError`/balance/dev-topup helpers; `CameraScreen.tsx` gates capture on sign-in (not on the old local counter); `SettingsScreen.tsx` gets a `__DEV__`-only top-up button; `ReviewScreen.tsx` shows a distinct "out of credits" message instead of the generic network-error one.

**Tech Stack:** Cloudflare Workers, Cloudflare D1, `jose` (JWT verification), Expo/React Native (existing app).

**Verification note:** no test runner in this project (confirmed across every prior sub-project this session). Backend tasks verify via `wrangler d1 execute` output and `curl` against the deployed Worker. App tasks verify via this project's established manual `tsc --noEmit` command plus a Metro bundle-compile check (`curl "http://localhost:8081/index.ts.bundle?platform=android&dev=true"` → expect HTTP 200 — confirm Metro is running first; if not, the executor should note it and skip that specific check rather than start Metro itself). **A real Google idToken cannot be produced by curl** — the full happy path (valid token → spend → Gemini call) can only be verified once the app itself calls it, in Task 11. Backend tasks (5) verify everything curl *can* prove: missing/invalid token → 401, bad input → 400, D1 state changes as expected when driven with a manually-obtained test token (see Task 5).

**Getting a test idToken for Task 5's curl checks:** the executor cannot obtain one automatically. Task 5 explicitly asks the controller to request one from the user (who can get it by temporarily adding a debug `console.log` of the token in the app, or the controller can defer full happy-path curl checks to Task 11 and only verify the error paths that don't need a valid token in Task 5). Follow Task 5's own instructions on this — don't invent a workaround.

---

### Task 1: Create the D1 database and bind it

**Files:** `worker/wrangler.toml`

- [ ] **Step 1: Create the database**

Run (from `worker/`):
```
npx wrangler d1 create slipvault-credits
```
Expected: success output including a `database_id` (a UUID) and a ready-to-paste
`[[d1_databases]]` TOML block, e.g.:
```
[[d1_databases]]
binding = "DB"
database_name = "slipvault-credits"
database_id = "<uuid>"
```

- [ ] **Step 2: Add that block to `worker/wrangler.toml`**

Current file:
```toml
name = "invoice-reader-proxy"
main = "index.js"
compatibility_date = "2024-01-01"

# 部署后访问: https://invoice-reader-proxy.<your-subdomain>.workers.dev
```

New (append the binding block at the end, using the REAL `database_id` printed in Step 1 — do not invent one):
```toml
name = "invoice-reader-proxy"
main = "index.js"
compatibility_date = "2024-01-01"

# 部署后访问: https://invoice-reader-proxy.<your-subdomain>.workers.dev

[[d1_databases]]
binding = "DB"
database_name = "slipvault-credits"
database_id = "<uuid-from-step-1>"
```

- [ ] **Step 3: Verify**

Run: `npx wrangler d1 list` (from `worker/`) → `slipvault-credits` appears in the list.

- [ ] **Step 4: Commit**

```bash
git add worker/wrangler.toml
git commit -m "Create D1 database for the credit ledger"
```

---

### Task 2: Apply the schema

**Files:** create `worker/schema.sql`

- [ ] **Step 1: Write the schema**

```sql
CREATE TABLE credits (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  balance INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE credit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

- [ ] **Step 2: Apply it to the REMOTE (live) database** — this project always tests against the deployed Worker, not local `wrangler dev` (established pattern from prior sub-projects), so apply remotely:

Run (from `worker/`):
```
npx wrangler d1 execute slipvault-credits --remote --file=./schema.sql
```
Expected: success output showing 2 queries executed, 0 rows returned (DDL).

- [ ] **Step 3: Verify the tables exist**

Run:
```
npx wrangler d1 execute slipvault-credits --remote --command="SELECT name FROM sqlite_master WHERE type='table'"
```
Expected: output includes both `credits` and `credit_log` (plus D1's own internal tables — ignore those).

- [ ] **Step 4: Commit**

```bash
git add worker/schema.sql
git commit -m "Add credit ledger schema (credits, credit_log tables)"
```

---

### Task 3: Install `jose` in the Worker

**Files:** create `worker/package.json`; creates `worker/package-lock.json` and `worker/node_modules/` (gitignored — see step 3)

- [ ] **Step 1: Create `worker/package.json`**

```json
{
  "name": "invoice-reader-proxy",
  "private": true,
  "dependencies": {
    "jose": "^5.9.6"
  }
}
```

- [ ] **Step 2: Install**

Run (from `worker/`):
```
npm install
```
Expected: `jose` and its (zero, it's dependency-free) transitive deps install cleanly into `worker/node_modules`.

- [ ] **Step 3: Ignore the Worker's own node_modules** — check the repo root `.gitignore` already ignores `node_modules` generally (it does, for the main app); if `worker/node_modules` isn't already covered, add it:

Run: `git check-ignore worker/node_modules` — if this prints `worker/node_modules` (or similar), it's already ignored, skip to Step 4. If it prints nothing (not ignored), append `worker/node_modules` as a new line to the root `.gitignore`.

- [ ] **Step 4: Verify jose resolves**

Run (from `worker/`):
```
node -e "console.log(Object.keys(require('jose')).slice(0,3))"
```
Expected: prints an array of exported names (no error) — e.g. `[ 'compactDecrypt', 'CompactEncrypt', ... ]` (exact names don't matter, just that it doesn't throw).

- [ ] **Step 5: Commit**

```bash
git add worker/package.json worker/package-lock.json .gitignore
git commit -m "Add jose dependency to the Worker for JWT verification"
```
(Only add `.gitignore` to this commit if Step 3 actually changed it.)

---

### Task 4: Rewrite `worker/index.js` — identity verification + credit ledger + gate extraction

**Files:** modify `worker/index.js`

This replaces the entire file. The `valuate` action and the Gemini-calling structure for the default action are preserved; the default action gains credit gating, and two new actions are added.

- [ ] **Step 1: Replace the full file with:**

```js
/**
 * Cloudflare Worker: Gemini API proxy + credit ledger
 *
 * Deploy steps:
 * 1. npm install -g wrangler
 * 2. wrangler login
 * 3. wrangler secret put GEMINI_API_KEY        (paste your Gemini key when prompted)
 * 4. wrangler secret put GOOGLE_WEB_CLIENT_ID  (the Web OAuth client ID from Google Cloud Console)
 * 5. wrangler deploy
 * 6. Copy the deployed URL into the app's .env: EXPO_PUBLIC_AI_PROXY_URL=https://xxx.workers.dev
 *
 * D1 setup (one-time, see docs/superpowers/plans/2026-07-24-credit-ledger.md
 * Tasks 1-2): wrangler d1 create + bind in wrangler.toml + apply schema.sql.
 */

import { jwtVerify, createRemoteJWKSet } from 'jose';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const SIGNUP_CREDITS = 20;

const PROMPT = `Analyze this image and extract invoice/receipt data.

Return JSON with this exact structure (no markdown, no explanation, just JSON):
{
  "isInvoice": boolean,
  "vendor": "store or merchant name",
  "date": "YYYY-MM-DD HH:MM if time is printed on receipt, otherwise YYYY-MM-DD, or empty string",
  "items": [
    { "name": "item name", "quantity": 1, "unitPrice": 0.00, "totalPrice": 0.00 }
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "total": 0.00,
  "category": "one of: electronics|furniture|appliances|jewelry|clothing|tools|sports|transport|healthcare|groceries|restaurant|utilities|other"
}

Rules:
- "total" is the final amount paid — read it directly from the receipt, do not calculate it.
- "tax" is only non-zero if the receipt shows a separate tax line (e.g. GST, VAT, Sales Tax). If tax is already included in item prices (tax-inclusive), set tax to 0.
- "subtotal" must equal total minus tax exactly. If the receipt shows a subtotal line, verify it equals total - tax; if not, ignore the printed subtotal and compute subtotal = total - tax yourself.
- subtotal + tax must always equal total.
If this is not an invoice or receipt, set isInvoice to false and leave other fields empty/zero.`;

function buildValuationPrompt(items) {
  const today = new Date().toISOString().slice(0, 10);
  return `You are a contents-insurance valuation assistant. Today is ${today}.
For each purchased item below, estimate its CURRENT market value: what it would
realistically cost to buy the same item second-hand today, in the same currency
as its purchase price. Consider typical depreciation for the product type, the
brand tier implied by the name and price, and realistic resale markets. Items
that hold value (e.g. jewelry, quality watches) may be close to or above the
purchase price; fast-depreciating electronics should drop accordingly.

Return JSON only (no markdown, no explanation), exact structure:
{"estimates":[{"value": 0.00, "note": "short reason, max 8 words"}]}
The estimates array must have exactly ${items.length} entries, in the same
order as the input items.

Items:
${JSON.stringify(items)}`;
}

// ─── Identity ────────────────────────────────────────────────────────────

/** Verifies the Authorization: Bearer <Google idToken> header. Returns {sub, email} or throws. */
async function verifyIdToken(request, env) {
  const auth = request.headers.get('authorization') || '';
  const match = auth.match(/^Bearer (.+)$/i);
  if (!match) {
    throw new Error('Missing bearer token');
  }
  const { payload } = await jwtVerify(match[1], GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: env.GOOGLE_WEB_CLIENT_ID,
  });
  if (!payload.sub || !payload.email) {
    throw new Error('Token missing sub/email');
  }
  return { sub: payload.sub, email: payload.email };
}

// ─── Credit ledger (D1) ──────────────────────────────────────────────────

/** Ensures a credits row exists for this user, bootstrapping to SIGNUP_CREDITS if new. */
async function ensureUser(env, userId, email) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    'INSERT OR IGNORE INTO credits (user_id, email, balance, updated_at) VALUES (?, ?, ?, ?)'
  )
    .bind(userId, email, SIGNUP_CREDITS, now)
    .run();
  if (result.meta.changes === 1) {
    await env.DB.prepare(
      'INSERT INTO credit_log (user_id, delta, reason, created_at) VALUES (?, ?, ?, ?)'
    )
      .bind(userId, SIGNUP_CREDITS, 'signup', now)
      .run();
  }
}

async function getBalance(env, userId) {
  const row = await env.DB.prepare('SELECT balance FROM credits WHERE user_id = ?')
    .bind(userId)
    .first();
  return row ? row.balance : 0;
}

/** Atomically spends 1 credit. Returns true if it succeeded (balance was >= 1). */
async function spendCredit(env, userId) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    'UPDATE credits SET balance = balance - 1, updated_at = ? WHERE user_id = ? AND balance >= 1'
  )
    .bind(now, userId)
    .run();
  if (result.meta.changes === 1) {
    await env.DB.prepare(
      'INSERT INTO credit_log (user_id, delta, reason, created_at) VALUES (?, -1, ?, ?)'
    )
      .bind(userId, 'scan', now)
      .run();
    return true;
  }
  return false;
}

async function refundCredit(env, userId) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE credits SET balance = balance + 1, updated_at = ? WHERE user_id = ?'
  )
    .bind(now, userId)
    .run();
  await env.DB.prepare(
    'INSERT INTO credit_log (user_id, delta, reason, created_at) VALUES (?, 1, ?, ?)'
  )
    .bind(userId, 'scan_refund', now)
    .run();
}

async function addCredits(env, userId, amount) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE credits SET balance = balance + ?, updated_at = ? WHERE user_id = ?'
  )
    .bind(amount, now, userId)
    .run();
  await env.DB.prepare(
    'INSERT INTO credit_log (user_id, delta, reason, created_at) VALUES (?, ?, ?, ?)'
  )
    .bind(userId, amount, 'dev_topup', now)
    .run();
}

export default {
  async fetch(request, env) {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Key',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Optional app key check. Enable with: wrangler secret put APP_SECRET
    // (and set the same value as EXPO_PUBLIC_APP_KEY in the app's .env).
    if (env.APP_SECRET && request.headers.get('x-app-key') !== env.APP_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    // ─── Action: valuate (AI depreciation for contents insurance) ───────────
    // Unchanged: no identity or credit requirement.
    if (body.action === 'valuate') {
      const items = body.items;
      if (!Array.isArray(items) || items.length === 0 || items.length > 40) {
        return new Response('items must be a non-empty array (max 40)', { status: 400 });
      }
      const cleaned = items.map((it) => ({
        name: String(it.name ?? '').slice(0, 120),
        category: String(it.category ?? '').slice(0, 40),
        purchaseDate: String(it.date ?? '').slice(0, 20),
        purchasePrice: Number(it.price) || 0,
      }));
      const valuationPayload = {
        contents: [{ parts: [{ text: buildValuationPrompt(cleaned) }] }],
      };
      const res = await fetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(valuationPayload),
      });
      if (!res.ok) {
        const errText = await res.text();
        return new Response(`Gemini error: ${errText}`, { status: res.status });
      }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const json = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      return new Response(json, {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // ─── Action: credits_balance ─────────────────────────────────────────
    if (body.action === 'credits_balance') {
      let identity;
      try {
        identity = await verifyIdToken(request, env);
      } catch {
        return new Response('Unauthorized', { status: 401 });
      }
      await ensureUser(env, identity.sub, identity.email);
      const balance = await getBalance(env, identity.sub);
      return new Response(JSON.stringify({ balance }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // ─── Action: credits_dev_topup ───────────────────────────────────────
    // Interim stand-in for a real purchase (RevenueCat webhook). DELETE THIS
    // ACTION once RevenueCat purchases are wired up — it lets anyone with a
    // valid Google account and the app secret give themselves free credits.
    if (body.action === 'credits_dev_topup') {
      if (!env.APP_SECRET || request.headers.get('x-app-key') !== env.APP_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }
      let identity;
      try {
        identity = await verifyIdToken(request, env);
      } catch {
        return new Response('Unauthorized', { status: 401 });
      }
      const amount = Number(body.amount);
      if (!Number.isInteger(amount) || amount <= 0 || amount > 1000) {
        return new Response('amount must be an integer between 1 and 1000', { status: 400 });
      }
      await ensureUser(env, identity.sub, identity.email);
      await addCredits(env, identity.sub, amount);
      const balance = await getBalance(env, identity.sub);
      return new Response(JSON.stringify({ balance }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // ─── Default action: invoice extraction from photo (credit-gated) ─────
    const { imageBase64, mimeType = 'image/jpeg' } = body;
    if (!imageBase64) {
      return new Response('Missing imageBase64', { status: 400 });
    }

    let identity;
    try {
      identity = await verifyIdToken(request, env);
    } catch {
      return new Response('Unauthorized', { status: 401 });
    }

    await ensureUser(env, identity.sub, identity.email);
    const spent = await spendCredit(env, identity.sub);
    if (!spent) {
      const balance = await getBalance(env, identity.sub);
      return new Response(JSON.stringify({ error: 'insufficient_credits', balance }), {
        status: 402,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const geminiPayload = {
      contents: [
        {
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ],
        },
      ],
    };

    let geminiRes;
    try {
      geminiRes = await fetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(geminiPayload),
      });
    } catch (err) {
      await refundCredit(env, identity.sub);
      return new Response(`Gemini request failed: ${err.message}`, { status: 502 });
    }

    if (!geminiRes.ok) {
      await refundCredit(env, identity.sub);
      const errText = await geminiRes.text();
      return new Response(`Gemini error: ${errText}`, { status: geminiRes.status });
    }

    const geminiData = await geminiRes.json();
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const json = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

    return new Response(json, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};
```

- [ ] **Step 2: Sanity-check the file parses** (Workers use plain JS, no project-wide tsc coverage — just confirm no syntax errors):

Run (from `worker/`):
```
node --check index.js
```
Expected: no output (exit 0). Note: this only checks syntax, not that `import` resolution works at deploy time — that's verified in Task 5's actual deploy.

- [ ] **Step 3: Commit**

```bash
git add worker/index.js
git commit -m "Add Google idToken verification and credit ledger to the Worker"
```

---

### Task 5: Set the new secret, deploy, and verify error paths

**Files:** none (deployment + curl verification only)

- [ ] **Step 1: Set the new secret**

Run (from `worker/`):
```
npx wrangler secret put GOOGLE_WEB_CLIENT_ID
```
When prompted, paste the Web OAuth Client ID from Google Cloud Console (the same value already in the app's `.env` as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`).

- [ ] **Step 2: Deploy**

Run (from `worker/`):
```
npx wrangler deploy
```
Expected: success, prints the deployed URL (should match `EXPO_PUBLIC_AI_PROXY_URL` in the app's `.env`, e.g. `https://invoice-reader-proxy.womendemiao.workers.dev`).

- [ ] **Step 3: Verify auth/validation error paths with curl** (these don't need a real Google token):

```bash
# Missing Authorization header on the (now-gated) default action → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://invoice-reader-proxy.womendemiao.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"imageBase64":"Zm9vYmFy"}'
```
Expected: `401`

```bash
# Garbage bearer token → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://invoice-reader-proxy.womendemiao.workers.dev \
  -H "Content-Type: application/json" -H "Authorization: Bearer not-a-real-token" \
  -d '{"imageBase64":"Zm9vYmFy"}'
```
Expected: `401`

```bash
# credits_balance with no token → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://invoice-reader-proxy.womendemiao.workers.dev \
  -H "Content-Type: application/json" -d '{"action":"credits_balance"}'
```
Expected: `401`

```bash
# valuate action still works unauthenticated (unchanged behavior) — expect it to
# reach Gemini, not 401 (a 400 for bad input is fine too; the point is it's not 401)
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://invoice-reader-proxy.womendemiao.workers.dev \
  -H "Content-Type: application/json" -d '{"action":"valuate","items":[]}'
```
Expected: `400` (empty items array — proves the request reached the `valuate` handler and was NOT rejected by the identity check, since `valuate` doesn't call `verifyIdToken` at all)

- [ ] **Step 4: Verify a full happy path using a real idToken**

This step needs one real Google idToken, which curl cannot generate. Ask the user: "打开 App，去 Settings 点一下已登录状态（或者临时在 Settings 的 handleSignIn 里加一行 `console.log` 打印 `await getIdToken()` 的结果，从 Metro 终端日志里复制出来）" — i.e. request a token via a temporary debug log in the running dev-client app, copy it from the Metro log output, then run:

```bash
TOKEN="<paste the idToken here>"
curl -s -X POST https://invoice-reader-proxy.womendemiao.workers.dev \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"action":"credits_balance"}'
```
Expected: `{"balance":20}` for a brand-new user (or their current balance if already bootstrapped from a prior test).

If getting a real token this way is inconvenient, it is acceptable to defer full happy-path verification to Task 11 (the on-device test) instead — note in your report which path was taken.

- [ ] **Step 5:** No commit for this task (deployment + verification only, no file changes).

---

### Task 6: `src/services/auth.ts` — add `getIdToken()`

**Files:** modify `src/services/auth.ts`

Current file ends with `signOutGoogle`. Read the full current file first (it uses a lazy `sdk()` helper returning the SDK module — reuse that same pattern, do NOT add a top-level import of the SDK).

- [ ] **Step 1: First, read the installed SDK's actual `getTokens()` return shape.** Check `node_modules/@react-native-google-signin/google-signin`'s TypeScript definitions for the `getTokens()` method's return type (should resolve to something like `{ idToken: string; accessToken: string }` — confirm the exact field name for the ID token before writing code that reads it).

- [ ] **Step 2: Add this function** to `src/services/auth.ts` (after `signOutGoogle`):

```ts
/**
 * A fresh Google ID token for the currently signed-in user, or null if not
 * signed in. Never throws — mirrors signInWithGoogle's cancel-never-throws
 * contract, since callers use this to silently decide whether to prompt for
 * sign-in rather than to hard-fail.
 */
export async function getIdToken(): Promise<string | null> {
  if (!getStoredUser()) return null;
  try {
    const { GoogleSignin } = sdk();
    const tokens = await GoogleSignin.getTokens();
    return tokens.idToken ?? null;
  } catch {
    return null;
  }
}
```
(Adjust `tokens.idToken` to whatever field name Step 1 actually found, if different.)

- [ ] **Step 3: Type-check**

```
node ./node_modules/typescript/bin/tsc --noEmit --jsx react-jsx --target es2021 --lib es2021,dom --moduleResolution bundler --module esnext --esModuleInterop --skipLibCheck --strict src/services/auth.ts 2>&1 | grep -E "error TS" | grep -v "TS2688"
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/services/auth.ts
git commit -m "Add getIdToken() to the Google auth service"
```

---

### Task 7: `src/services/claude.ts` — send the token, add `InsufficientCreditsError`, credit helpers

**Files:** modify `src/services/claude.ts`

- [ ] **Step 1: Apply these edits.**

Current top of file:
```ts
import { InvoiceItem } from '../types/invoice';

export interface ExtractedInvoiceData {
  isInvoice: boolean;
  vendor: string;
  date: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  category: string;
}

const FALLBACK_PROXY_URL = 'https://invoice-reader-proxy.womendemiao.workers.dev';

function getProxyUrl(): string {
  return process.env.EXPO_PUBLIC_AI_PROXY_URL || FALLBACK_PROXY_URL;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Matches the worker's APP_SECRET when configured (light abuse protection).
  if (process.env.EXPO_PUBLIC_APP_KEY) {
    headers['X-App-Key'] = process.env.EXPO_PUBLIC_APP_KEY;
  }
  return headers;
}
```

New:
```ts
import { InvoiceItem } from '../types/invoice';
import { getIdToken } from './auth';

export interface ExtractedInvoiceData {
  isInvoice: boolean;
  vendor: string;
  date: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  category: string;
}

/** Thrown by extractInvoiceData when the Worker reports a 402 (out of credits). */
export class InsufficientCreditsError extends Error {
  constructor(public balance: number) {
    super('Out of scan credits.');
    this.name = 'InsufficientCreditsError';
  }
}

const FALLBACK_PROXY_URL = 'https://invoice-reader-proxy.womendemiao.workers.dev';

function getProxyUrl(): string {
  return process.env.EXPO_PUBLIC_AI_PROXY_URL || FALLBACK_PROXY_URL;
}

async function buildHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Matches the worker's APP_SECRET when configured (light abuse protection).
  if (process.env.EXPO_PUBLIC_APP_KEY) {
    headers['X-App-Key'] = process.env.EXPO_PUBLIC_APP_KEY;
  }
  const idToken = await getIdToken();
  if (idToken) {
    headers['Authorization'] = `Bearer ${idToken}`;
  }
  return headers;
}
```

Current `estimateItemValues` body (only the `buildHeaders()` call site changes — add `await`):
```ts
export async function estimateItemValues(items: ValuationInput[]): Promise<AIEstimate[]> {
  const response = await fetch(getProxyUrl(), {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ action: 'valuate', items }),
  });
```
New:
```ts
export async function estimateItemValues(items: ValuationInput[]): Promise<AIEstimate[]> {
  const response = await fetch(getProxyUrl(), {
    method: 'POST',
    headers: await buildHeaders(),
    body: JSON.stringify({ action: 'valuate', items }),
  });
```

Current `extractInvoiceData`:
```ts
export async function extractInvoiceData(
  imageBase64: string
): Promise<ExtractedInvoiceData> {
  const response = await fetch(getProxyUrl(), {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg' }),
  });

  if (!response.ok) {
    throw new Error(`Recognition service failed (${response.status}). Check your network connection and try again.`);
  }

  const data = await response.json() as ExtractedInvoiceData;
```
New:
```ts
export async function extractInvoiceData(
  imageBase64: string
): Promise<ExtractedInvoiceData> {
  const response = await fetch(getProxyUrl(), {
    method: 'POST',
    headers: await buildHeaders(),
    body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg' }),
  });

  if (response.status === 402) {
    const body = await response.json().catch(() => ({ balance: 0 }));
    throw new InsufficientCreditsError(Number(body.balance) || 0);
  }

  if (!response.ok) {
    throw new Error(`Recognition service failed (${response.status}). Check your network connection and try again.`);
  }

  const data = await response.json() as ExtractedInvoiceData;
```
(The rest of the function — rounding logic and `return data;` — is unchanged.)

- [ ] **Step 2: Append these two new functions** at the end of the file:

```ts
export interface CreditBalance {
  balance: number;
}

/** Current credit balance for the signed-in user. */
export async function getCreditBalance(): Promise<number> {
  const response = await fetch(getProxyUrl(), {
    method: 'POST',
    headers: await buildHeaders(),
    body: JSON.stringify({ action: 'credits_balance' }),
  });
  if (!response.ok) {
    throw new Error(`Could not fetch credit balance (${response.status}).`);
  }
  const data = (await response.json()) as CreditBalance;
  return data.balance;
}

/**
 * Dev-only stand-in for a real purchase — adds credits directly via the
 * Worker's credits_dev_topup action. Delete this once RevenueCat ships.
 */
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

- [ ] **Step 3: Type-check**

```
node ./node_modules/typescript/bin/tsc --noEmit --jsx react-jsx --target es2021 --lib es2021,dom --moduleResolution bundler --module esnext --esModuleInterop --skipLibCheck --strict src/services/claude.ts 2>&1 | grep -E "error TS" | grep -v "TS2688"
```
Expected: no output.

- [ ] **Step 4: Bundle-compile check** (confirm Metro is running first — `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8081/status` should print `200`; if not, skip this step and note it):
```
curl -s "http://localhost:8081/index.ts.bundle?platform=android&dev=true" -o /dev/null -w "%{http_code}\n"
```
Expected: `200`.

- [ ] **Step 5: Commit**

```bash
git add src/services/claude.ts
git commit -m "Send idToken with AI proxy requests; add credit balance/top-up helpers"
```

---

### Task 8: `src/screens/CameraScreen.tsx` — gate scanning on sign-in, not the local counter

**Files:** modify `src/screens/CameraScreen.tsx`

- [ ] **Step 1: Apply these edits.**

Current imports:
```tsx
import { processInvoiceImage, isImageBlurry } from '../services/imageProcessor';
import { isProUser, getInvoiceCount, FREE_INVOICE_LIMIT } from '../services/database';
import * as FileSystem from 'expo-file-system/legacy';
```
New:
```tsx
import { processInvoiceImage, isImageBlurry } from '../services/imageProcessor';
import { getStoredUser, signInWithGoogle } from '../services/auth';
import * as FileSystem from 'expo-file-system/legacy';
```

Current `checkQuota`:
```tsx
  /** Free plan gate. Returns true when another invoice may be added. */
  function checkQuota(pendingInQueue: number): boolean {
    if (isProUser()) return true;
    if (getInvoiceCount() + pendingInQueue < FREE_INVOICE_LIMIT) return true;
    Alert.alert(
      'Free limit reached',
      `The free plan stores up to ${FREE_INVOICE_LIMIT} invoices. Upgrade to Pro for unlimited invoices — your existing ones always stay accessible.`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'See Pro', onPress: () => navigation.navigate('Paywall') },
      ]
    );
    return false;
  }
```
Replace with (scanning now requires sign-in; the actual credit balance is checked server-side per-scan in `extractInvoiceData`, not here):
```tsx
  /** Scanning requires a signed-in identity (the credit ledger is keyed to it).
   * Prompts inline if not signed in; returns false if the user cancels or the
   * sign-in attempt fails, in which case the caller must not proceed. */
  async function ensureSignedIn(): Promise<boolean> {
    if (getStoredUser()) return true;
    try {
      const user = await signInWithGoogle();
      return user !== null;
    } catch {
      Alert.alert('Sign-in failed', 'Please check your connection and try again.');
      return false;
    }
  }
```

Current `handleCapture`:
```tsx
  async function handleCapture() {
    if (!cameraRef.current || capturing) return;
    if (!checkQuota(queue.length)) return;
    setCapturing(true);
```
New:
```tsx
  async function handleCapture() {
    if (!cameraRef.current || capturing) return;
    if (!(await ensureSignedIn())) return;
    setCapturing(true);
```

Current `handlePickFromGallery`:
```tsx
  async function handlePickFromGallery() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;

    // Free plan: only take as many as the remaining slots allow.
    let assets = result.assets;
    if (!isProUser()) {
      const remaining = Math.max(0, FREE_INVOICE_LIMIT - getInvoiceCount() - queue.length);
      if (!checkQuota(queue.length)) return; // 0 slots → paywall prompt
      if (assets.length > remaining) {
        Alert.alert(
          'Free limit',
          `Only ${remaining} free slot${remaining !== 1 ? 's' : ''} left — importing the first ${remaining} photo${remaining !== 1 ? 's' : ''}. Upgrade to Pro for unlimited invoices.`
        );
        assets = assets.slice(0, remaining);
      }
    }

    setCapturing(true);
    try {
      for (const asset of assets) {
        await addToQueue(asset.uri);
      }
    } finally {
      setCapturing(false);
    }
  }
```
New (no more slot-limiting — every scan is checked/spent individually server-side when it's actually processed):
```tsx
  async function handlePickFromGallery() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;
    if (!(await ensureSignedIn())) return;

    setCapturing(true);
    try {
      for (const asset of result.assets) {
        await addToQueue(asset.uri);
      }
    } finally {
      setCapturing(false);
    }
  }
```

- [ ] **Step 2: Type-check**

```
node ./node_modules/typescript/bin/tsc --noEmit --jsx react-jsx --target es2021 --lib es2021,dom --moduleResolution bundler --module esnext --esModuleInterop --skipLibCheck --strict src/screens/CameraScreen.tsx 2>&1 | grep -E "error TS" | grep -v "TS2688"
```
Expected: no output. (This will also surface it if `isProUser`/`getInvoiceCount`/`FREE_INVOICE_LIMIT`/`navigation` become unused imports — remove any the compiler flags, EXCEPT `navigation`, which is still used elsewhere in this file for `Review`/`goBack` navigation.)

- [ ] **Step 3: Bundle-compile check** (same as Task 7 Step 4 — skip with a note if Metro isn't running):
```
curl -s "http://localhost:8081/index.ts.bundle?platform=android&dev=true" -o /dev/null -w "%{http_code}\n"
```
Expected: `200`.

- [ ] **Step 4: Commit**

```bash
git add src/screens/CameraScreen.tsx
git commit -m "Gate scanning on Google sign-in instead of the local invoice counter"
```

---

### Task 9: `src/screens/SettingsScreen.tsx` — dev-only top-up button

**Files:** modify `src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Add the import** — current imports include:
```tsx
import { getStoredUser, signInWithGoogle, signOutGoogle, type AuthUser } from '../services/auth';
```
Change to also import the top-up helper from claude.ts:
```tsx
import { getStoredUser, signInWithGoogle, signOutGoogle, type AuthUser } from '../services/auth';
import { devTopUpCredits } from '../services/claude';
```

- [ ] **Step 2: Add a handler**, placed near the existing `handleSignOut` function:
```tsx
  async function handleDevTopUp() {
    try {
      const balance = await devTopUpCredits(20);
      Alert.alert('Credits added', `New balance: ${balance}`);
    } catch {
      Alert.alert('Top-up failed', 'Please try again.');
    }
  }
```

- [ ] **Step 3: Add the button** inside the Account section's signed-in branch. Current:
```tsx
        ) : (
          <>
            <View style={styles.row}>
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle}>{user.email}</Text>
                <Text style={styles.rowSub}>Signed in with Google</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.row} onPress={handleSignOut} activeOpacity={0.7}>
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle}>Sign out</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          </>
```
New (dev button between the email row and Sign out):
```tsx
        ) : (
          <>
            <View style={styles.row}>
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle}>{user.email}</Text>
                <Text style={styles.rowSub}>Signed in with Google</Text>
              </View>
            </View>
            {__DEV__ && (
              <TouchableOpacity style={styles.row} onPress={handleDevTopUp} activeOpacity={0.7}>
                <View style={styles.rowContent}>
                  <Text style={styles.rowTitle}>+20 credits (dev)</Text>
                  <Text style={styles.rowSub}>Testing only — stands in for a real purchase</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.row} onPress={handleSignOut} activeOpacity={0.7}>
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle}>Sign out</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          </>
```

- [ ] **Step 4: Type-check**

```
node ./node_modules/typescript/bin/tsc --noEmit --jsx react-jsx --target es2021 --lib es2021,dom --moduleResolution bundler --module esnext --esModuleInterop --skipLibCheck --strict src/screens/SettingsScreen.tsx 2>&1 | grep -E "error TS" | grep -v "TS2688"
```
Expected: no output.

- [ ] **Step 5: Bundle-compile check** (skip with a note if Metro isn't running):
```
curl -s "http://localhost:8081/index.ts.bundle?platform=android&dev=true" -o /dev/null -w "%{http_code}\n"
```
Expected: `200`.

- [ ] **Step 6: Commit**

```bash
git add src/screens/SettingsScreen.tsx
git commit -m "Add a dev-only credit top-up button to Settings"
```

---

### Task 10: `src/screens/ReviewScreen.tsx` — distinct "out of credits" message

**Files:** modify `src/screens/ReviewScreen.tsx`

- [ ] **Step 1: Import the error type.** Current:
```tsx
import { extractInvoiceData, ExtractedInvoiceData } from '../services/claude';
```
New:
```tsx
import { extractInvoiceData, ExtractedInvoiceData, InsufficientCreditsError } from '../services/claude';
```

- [ ] **Step 2: Add state.** Current:
```tsx
  const [networkError, setNetworkError] = useState(false);
```
New:
```tsx
  const [networkError, setNetworkError] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(false);
```

- [ ] **Step 3: Update `runExtraction`.** Current:
```tsx
  async function runExtraction() {
    setLoading(true);
    setNetworkError(false);
    startProgress();

    try {
      const processed = await processInvoiceImage(photoUri);
      const data = await extractInvoiceData(processed.base64);
      finishProgress();

      if (!data.isInvoice) {
        Alert.alert(
          'Not an Invoice',
          "This doesn't look like a receipt or invoice. Save it anyway?",
          [
            { text: 'Discard', style: 'cancel', onPress: () => navigation.goBack() },
            {
              text: 'Save Anyway',
              onPress: () => {
                applyExtracted(data);
                setLoading(false);
              },
            },
          ]
        );
        return;
      }

      applyExtracted(data);
    } catch {
      finishProgress();
      setNetworkError(true);
    } finally {
```
New:
```tsx
  async function runExtraction() {
    setLoading(true);
    setNetworkError(false);
    setOutOfCredits(false);
    startProgress();

    try {
      const processed = await processInvoiceImage(photoUri);
      const data = await extractInvoiceData(processed.base64);
      finishProgress();

      if (!data.isInvoice) {
        Alert.alert(
          'Not an Invoice',
          "This doesn't look like a receipt or invoice. Save it anyway?",
          [
            { text: 'Discard', style: 'cancel', onPress: () => navigation.goBack() },
            {
              text: 'Save Anyway',
              onPress: () => {
                applyExtracted(data);
                setLoading(false);
              },
            },
          ]
        );
        return;
      }

      applyExtracted(data);
    } catch (err) {
      finishProgress();
      if (err instanceof InsufficientCreditsError) {
        setOutOfCredits(true);
      } else {
        setNetworkError(true);
      }
    } finally {
```
(The rest of the function/`finally` block is unchanged.)

- [ ] **Step 4: Add the render block**, immediately before the existing network-error block. Current:
```tsx
        {/* Network error */}
        {!loading && networkError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>No network connection</Text>
            <Text style={styles.errorSub}>
              The photo has been saved locally. You can analyze it later when you're back online.
            </Text>
            <TouchableOpacity style={styles.laterBtn} onPress={handleSaveForLater}>
              <Text style={styles.laterBtnText}>Save for Later</Text>
            </TouchableOpacity>
          </View>
        )}
```
New:
```tsx
        {/* Out of credits */}
        {!loading && outOfCredits && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Out of credits</Text>
            <Text style={styles.errorSub}>
              You're out of scan credits. The photo has been saved locally — analyze it later once
              you have more.
            </Text>
            <TouchableOpacity style={styles.laterBtn} onPress={handleSaveForLater}>
              <Text style={styles.laterBtnText}>Save for Later</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Network error */}
        {!loading && networkError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>No network connection</Text>
            <Text style={styles.errorSub}>
              The photo has been saved locally. You can analyze it later when you're back online.
            </Text>
            <TouchableOpacity style={styles.laterBtn} onPress={handleSaveForLater}>
              <Text style={styles.laterBtnText}>Save for Later</Text>
            </TouchableOpacity>
          </View>
        )}
```

- [ ] **Step 5: Type-check**

```
node ./node_modules/typescript/bin/tsc --noEmit --jsx react-jsx --target es2021 --lib es2021,dom --moduleResolution bundler --module esnext --esModuleInterop --skipLibCheck --strict src/screens/ReviewScreen.tsx 2>&1 | grep -E "error TS" | grep -v "TS2688"
```
Expected: no output.

- [ ] **Step 6: Bundle-compile check** (skip with a note if Metro isn't running):
```
curl -s "http://localhost:8081/index.ts.bundle?platform=android&dev=true" -o /dev/null -w "%{http_code}\n"
```
Expected: `200`.

- [ ] **Step 7: Commit**

```bash
git add src/screens/ReviewScreen.tsx
git commit -m "Show a distinct message when out of scan credits"
```

---

### Task 11: On-device end-to-end verification (human-required)

**Files:** none.

No new native module was added in this sub-project (`getIdToken`/`devTopUpCredits`/etc. all call the Google Sign-In SDK already compiled into the dev-client APK from sub-project 2) — **no new EAS build is needed.** Everything here is testable via the existing dev-client APK + Metro hot reload.

- [ ] **Step 1:** Confirm Metro is running and reachable (`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8081/status` → `200`; restart if not, per the pattern established in prior sub-projects — a detached process via `Start-Process`, not a plain backgrounded shell command, since those have been observed to die on session/tool-call boundaries in this project).

- [ ] **Step 2 (human):** Fully reload the app (this changed multiple files including a service-layer behavior change to `extractInvoiceData` — don't rely on Fast Refresh for this one).

- [ ] **Step 3 (human):** Sign out if currently signed in (Settings → Sign out), then attempt to scan a receipt (Camera → capture or gallery import). Confirm the native Google account picker appears before the camera/gallery flow proceeds. Cancel the picker — confirm the capture attempt is silently aborted (no crash, no error alert).

- [ ] **Step 4 (human):** Sign in for real. Go to Settings → confirm the "+20 credits (dev)" row is visible (only because this is a `__DEV__` build) → tap it → confirm an alert shows a balance (20 if this is a first-time user for this Google account, or 20 more than whatever it was).

- [ ] **Step 5 (human):** Scan a receipt. Confirm it processes normally (this is the full happy path: idToken sent → Worker spends 1 credit → Gemini call → extraction shown). Go back to Settings, tap "+20 credits (dev)" again just to read the current balance via the resulting alert, and confirm it went down by 1 from before the scan (e.g. 20 → 19 before this tap's own +20 lands, i.e. compare pre-scan and post-scan balances by tapping the dev button before and after the scan, since tapping it also changes the balance — or simpler: tap it once first to learn the current balance, note it, scan once, tap it again, confirm the balance right before this second tap's own +20 was applied is exactly 1 lower than noted. Whichever bookkeeping is clearer, the point is: confirm a scan visibly decrements balance by exactly 1).

- [ ] **Step 6 (human, optional but recommended):** Drain the balance to 0 (repeat dev top-ups/scans as needed, or directly reason about it), then attempt one more scan. Confirm the Review screen shows the new "Out of credits" box (not the generic "No network connection" one) with a working "Save for Later" button.

- [ ] **Step 7:** Report back which of Steps 3-6 passed, and flag anything that didn't match expectations.

---

## Plan self-review notes

- **Spec coverage:** D1 storage → Tasks 1-2; Worker identity/ledger/gating → Tasks 3-5; `auth.ts`/`claude.ts` app plumbing → Tasks 6-7; sign-in gate replacing the local counter → Task 8; dev top-up UI → Task 9; distinct out-of-credits UI → Task 10; end-to-end device verification → Task 11. Every section of the approved spec maps to a task. `isProUser`/`FREE_INVOICE_LIMIT`/`PaywallScreen` are correctly left untouched (spec's explicit "out of scope").
- **Type/name consistency checked:** `InsufficientCreditsError` (Task 7) is the exact name imported and used in Task 10; `getIdToken` (Task 6) is the exact name imported in Task 7; `getStoredUser`/`signInWithGoogle` (already existing) are the exact names used in Task 8; `devTopUpCredits` (Task 7) is the exact name imported in Task 9; the Worker's D1 binding name `DB` (Task 1's `binding = "DB"`) matches every `env.DB` reference in Task 4.
- **No placeholders:** every task shows complete code or exact commands; the one genuinely irreducible gap (Task 5 Step 4 needing a real Google idToken, which no tool in this environment can produce) is called out explicitly with a concrete workaround and an explicit "defer to Task 11" fallback, not glossed over.
