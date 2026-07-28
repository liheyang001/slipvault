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
  const response = await fetch(getProxyUrl(), {
    method: 'POST',
    headers: await buildHeaders(),
    body: JSON.stringify({ action: 'valuate', items }),
  });

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
  const response = await fetch(getProxyUrl(), {
    method: 'POST',
    headers: await buildHeaders(),
    body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg' }),
  });

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

/** Polls until the balance rises above `before`, or gives up. Returns the new
 * balance, or null on timeout. Null means "not landed yet", never "lost" — a
 * purchase credits the ledger server-side and its webhook is retried. */
export async function waitForBalanceIncrease(
  before: number,
  attempts = 5
): Promise<number | null> {
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
