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
    headers: buildHeaders(),
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
    headers: buildHeaders(),
    body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg' }),
  });

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
