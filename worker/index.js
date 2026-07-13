/**
 * Cloudflare Worker: Gemini API proxy
 *
 * Deploy steps:
 * 1. npm install -g wrangler
 * 2. wrangler login
 * 3. wrangler secret put GEMINI_API_KEY   (paste your Gemini key when prompted)
 * 4. wrangler deploy
 * 5. Copy the deployed URL into the app's .env: EXPO_PUBLIC_AI_PROXY_URL=https://xxx.workers.dev
 */

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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
  "category": "one of: groceries|electronics|restaurant|utilities|healthcare|clothing|transport|other"
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

export default {
  async fetch(request, env) {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
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
      const res = await fetch(`${GEMINI_ENDPOINT}?key=${env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

    // ─── Default action: invoice extraction from photo ──────────────────────
    const { imageBase64, mimeType = 'image/jpeg' } = body;
    if (!imageBase64) {
      return new Response('Missing imageBase64', { status: 400 });
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

    const geminiRes = await fetch(`${GEMINI_ENDPOINT}?key=${env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload),
    });

    if (!geminiRes.ok) {
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
