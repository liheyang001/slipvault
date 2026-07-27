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
  if (!env.GOOGLE_WEB_CLIENT_ID) {
    // Fail closed: without a configured audience, jwtVerify would skip the
    // audience check entirely and accept a token minted for ANY Google OAuth
    // client, not just this app.
    throw new Error('Worker misconfigured: GOOGLE_WEB_CLIENT_ID not set');
  }
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

async function getBalance(env, userId) {
  const row = await env.DB.prepare('SELECT balance FROM credits WHERE user_id = ?')
    .bind(userId)
    .first();
  return row ? row.balance : 0;
}

/** Atomically spends 1 credit. Returns true if it succeeded (balance was >= 1). */
async function spendCredit(env, userId) {
  const now = new Date().toISOString();
  const [updateResult] = await env.DB.batch([
    env.DB.prepare(
      'UPDATE credits SET balance = balance - 1, updated_at = ? WHERE user_id = ? AND balance >= 1'
    ).bind(now, userId),
    env.DB.prepare(
      "INSERT INTO credit_log (user_id, delta, reason, created_at) SELECT ?, -1, 'scan', ? WHERE changes() = 1"
    ).bind(userId, now),
  ]);
  return updateResult.meta.changes === 1;
}

async function refundCredit(env, userId) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE credits SET balance = balance + 1, updated_at = ? WHERE user_id = ?'
    ).bind(now, userId),
    env.DB.prepare(
      "INSERT INTO credit_log (user_id, delta, reason, created_at) VALUES (?, 1, 'scan_refund', ?)"
    ).bind(userId, now),
  ]);
}

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

    let geminiData;
    try {
      geminiData = await geminiRes.json();
    } catch (err) {
      await refundCredit(env, identity.sub);
      return new Response(`Gemini returned an unreadable response: ${err.message}`, { status: 502 });
    }

    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) {
      await refundCredit(env, identity.sub);
      return new Response('Gemini returned no usable content', { status: 502 });
    }
    const json = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

    return new Response(json, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};
