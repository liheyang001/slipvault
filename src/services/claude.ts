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

export async function extractInvoiceData(
  imageBase64: string
): Promise<ExtractedInvoiceData> {
  const proxyUrl = process.env.EXPO_PUBLIC_AI_PROXY_URL || FALLBACK_PROXY_URL;

  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
