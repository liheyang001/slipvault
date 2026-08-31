// Validation for what the AI proxy returns. Kept free of any import that
// reaches a native module, so it can be unit-tested directly.
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

/** Raised when the proxy's payload cannot be trusted as invoice data. */
export class MalformedExtractionError extends Error {
  constructor(public reason: string) {
    super(`The scan came back unreadable (${reason}). Your credit was not used.`);
    this.name = 'MalformedExtractionError';
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Narrows an untrusted payload to ExtractedInvoiceData, or throws.
 *
 * A TypeScript `as` cast is erased at runtime, so the previous version let a
 * malformed response through untouched: a missing `total` became NaN, was
 * stored, and from then on every sum it took part in — the home screen total,
 * the insurance valuation — was NaN too. Numbers are therefore checked rather
 * than assumed, and items are individually coerced since one bad row would
 * poison the same sums.
 *
 * isInvoice:false is valid and returned as-is with zeroed amounts: the user
 * photographed something that is not a receipt and the model correctly said so.
 */
export function asExtractedInvoiceData(raw: unknown): ExtractedInvoiceData {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MalformedExtractionError('not an object');
  }
  const o = raw as Record<string, unknown>;

  if (typeof o.isInvoice !== 'boolean') {
    throw new MalformedExtractionError('isInvoice missing');
  }

  const base = {
    isInvoice: o.isInvoice,
    vendor: str(o.vendor),
    date: str(o.date),
    category: str(o.category),
  };

  if (!o.isInvoice) {
    return { ...base, items: [], subtotal: 0, tax: 0, total: 0 };
  }

  for (const field of ['total', 'subtotal', 'tax'] as const) {
    const value = o[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new MalformedExtractionError(`${field} is not a finite number`);
    }
    if (value < 0) {
      throw new MalformedExtractionError(`${field} is negative`);
    }
  }

  const items: InvoiceItem[] = Array.isArray(o.items)
    ? o.items.filter((it): it is Record<string, unknown> => !!it && typeof it === 'object').map((it) => ({
        name: str(it.name),
        quantity: Number.isFinite(it.quantity as number) ? (it.quantity as number) : 1,
        unitPrice: Number.isFinite(it.unitPrice as number) ? (it.unitPrice as number) : 0,
        totalPrice: Number.isFinite(it.totalPrice as number) ? (it.totalPrice as number) : 0,
      }))
    : [];

  return {
    ...base,
    items,
    subtotal: o.subtotal as number,
    tax: o.tax as number,
    total: o.total as number,
  };
}
