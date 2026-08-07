import { InvoiceItem } from '../types/invoice';
import { getIdToken, forceRefreshIdToken } from './auth';

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

/** The Worker throttled this user (10 scans/min, 100/hour). Transient. */
export class RateLimitedError extends Error {
  constructor() {
    super('Too many scans in a short time.');
    this.name = 'RateLimitedError';
  }
}

/** The image exceeded the Worker's 4MB cap. Permanent for this photo —
 * retrying the same file will always fail. */
export class ImageTooLargeError extends Error {
  constructor() {
    super('That photo is too large to process.');
    this.name = 'ImageTooLargeError';
  }
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

async function buildHeaders(forceFreshToken = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Matches the worker's APP_SECRET when configured (light abuse protection).
  if (process.env.EXPO_PUBLIC_APP_KEY) {
    headers['X-App-Key'] = process.env.EXPO_PUBLIC_APP_KEY;
  }
  const idToken = forceFreshToken ? await forceRefreshIdToken() : await getIdToken();
  if (idToken) {
    headers['Authorization'] = `Bearer ${idToken}`;
  }
  return headers;
}

/**
 * POSTs to the proxy, and on a 401 re-authenticates and tries once more.
 *
 * getIdToken() already refreshes an expired token, but that decision rests on
 * the token's own `exp` versus this device's clock. A skewed clock, or an
 * identity revoked server-side, still produces a 401 the client cannot predict
 * — and the failure mode is silent and permanent (the balance reads "—" until
 * the user happens to sign out and back in). One retry on a fresh token turns
 * that into a blip.
 */
async function postToProxy(body: unknown): Promise<Response> {
  const payload = JSON.stringify(body);
  const response = await fetch(getProxyUrl(), {
    method: 'POST',
    headers: await buildHeaders(),
    body: payload,
  });
  if (response.status !== 401) return response;
  return fetch(getProxyUrl(), {
    method: 'POST',
    headers: await buildHeaders(true),
    body: payload,
  });
}

// ─── AI valuation (contents insurance) ───────────────────────────────────────

export interface ValuationInput {
  name: string;
  category: string;
  date: string; // purchase date
  price: number; // purchase price
}

export interface AIEstimate {
  value: number;
  note: string;
}

/** Ask the AI proxy to estimate current market value for each item, same order. */
export async function estimateItemValues(items: ValuationInput[]): Promise<AIEstimate[]> {
  const response = await postToProxy({ action: 'valuate', items });

  if (!response.ok) {
    throw new Error(`Valuation service failed (${response.status}).`);
  }

  const data = (await response.json()) as { estimates?: AIEstimate[] };
  if (!Array.isArray(data.estimates) || data.estimates.length !== items.length) {
    throw new Error('Valuation service returned an unexpected response.');
  }
  return data.estimates.map((e) => ({
    value: Math.max(0, Number(e.value) || 0),
    note: String(e.note ?? '').slice(0, 80),
  }));
}

export async function extractInvoiceData(
  imageBase64: string
): Promise<ExtractedInvoiceData> {
  const response = await postToProxy({ imageBase64, mimeType: 'image/jpeg' });

  if (response.status === 402) {
    const body = await response.json().catch(() => ({ balance: 0 }));
    throw new InsufficientCreditsError(Number(body.balance) || 0);
  }

  if (response.status === 429) {
    throw new RateLimitedError();
  }

  if (response.status === 413) {
    throw new ImageTooLargeError();
  }

  if (!response.ok) {
    throw new Error(`Recognition service failed (${response.status}). Check your network connection and try again.`);
  }

  const data = await response.json() as ExtractedInvoiceData;

  // Ensure subtotal + tax === total (total is ground truth)
  const roundTo2 = (n: number) => Math.round(n * 100) / 100;
  data.total = roundTo2(data.total);
  data.tax = roundTo2(data.tax);
  if (Math.abs(data.subtotal + data.tax - data.total) > 0.005) {
    data.subtotal = roundTo2(data.total - data.tax);
  }

  return data;
}

export interface CreditBalance {
  balance: number;
}

/** Current credit balance for the signed-in user. */
export async function getCreditBalance(): Promise<number> {
  const response = await postToProxy({ action: 'credits_balance' });
  if (!response.ok) {
    throw new Error(`Could not fetch credit balance (${response.status}).`);
  }
  const data = (await response.json()) as CreditBalance;
  return data.balance;
}

/** Polls until the balance reaches at least `before + minIncrease`, or gives
 * up. Returns the new balance, or null on timeout.
 *
 * The threshold is the full expected amount, not merely "went up": a partial
 * or unrelated change must not be reported as this purchase landing. Null
 * means "not landed yet", never "lost" — the ledger is credited server-side
 * and the webhook is retried. */
export async function waitForBalanceIncrease(
  before: number,
  minIncrease: number,
  attempts = 5
): Promise<number | null> {
  const target = before + minIncrease;
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const balance = await getCreditBalance();
      if (balance >= target) return balance;
    } catch {
      // Transient failure — keep polling.
    }
  }
  return null;
}

