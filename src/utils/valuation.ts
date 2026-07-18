import { Invoice } from '../types/invoice';
import { normalizeCategory } from './categories';

// ─── Contents insurance valuation ────────────────────────────────────────────
// Computes depreciated ("current") value of belongings for contents insurance.
// Consumable categories are excluded — they are spent, not owned.

/** Categories that are consumed rather than owned — excluded from contents value. */
export const CONSUMABLE_CATEGORIES = new Set([
  'groceries',
  'restaurant',
  'utilities',
  'transport',
  'healthcare',
]);

export function isConsumable(category: string): boolean {
  return CONSUMABLE_CATEGORIES.has(normalizeCategory(category || ''));
}

/** Annual depreciation rate + residual floor (fraction of purchase price kept). */
const DEPRECIATION: Record<string, { rate: number; floor: number }> = {
  electronics: { rate: 0.2, floor: 0.1 },
  clothing: { rate: 0.25, floor: 0.1 },
  furniture: { rate: 0.1, floor: 0.2 },
  appliances: { rate: 0.1, floor: 0.2 },
  tools: { rate: 0.1, floor: 0.2 },
  sports: { rate: 0.15, floor: 0.15 },
  jewelry: { rate: 0, floor: 1 }, // jewelry typically holds its value
};
const DEFAULT_DEPRECIATION = { rate: 0.1, floor: 0.2 };

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

/** Depreciated value of a purchase as of `now` (declining balance with residual floor). */
export function currentValue(
  price: number,
  dateISO: string,
  category: string,
  now: number = Date.now()
): number {
  if (!price || price <= 0) return 0;
  const t = Date.parse(dateISO);
  const years = Number.isNaN(t) ? 0 : Math.max(0, (now - t) / YEAR_MS);
  const { rate, floor } =
    DEPRECIATION[normalizeCategory(category || '')] ?? DEFAULT_DEPRECIATION;
  const value = price * Math.pow(1 - rate, years);
  return Math.max(value, price * floor);
}

/** Done, non-consumable invoices — the ones that count as "contents". */
export function getInsurableInvoices(invoices: Invoice[]): Invoice[] {
  return invoices.filter(
    (inv) => (inv.status ?? 'done') === 'done' && !isConsumable(inv.category)
  );
}

// ─── Item-level view ─────────────────────────────────────────────────────────

export interface ValuedItem {
  invoiceId: string;
  itemIndex: number; // index within invoice.items; -1 = whole itemless invoice
  name: string;
  vendor: string;
  date: string;
  room: string;
  category: string;
  quantity: number;
  unitPrice: number; // purchase price per single item
  currentUnitValue: number; // depreciated value per single item
}

/**
 * Flattens insurable invoices into individual items.
 * Invoices without itemized lines become a single pseudo-item (the whole receipt),
 * so a TV receipt with no line items still shows up as one item.
 */
export function getInsurableItems(invoices: Invoice[]): ValuedItem[] {
  const result: ValuedItem[] = [];
  for (const inv of getInsurableInvoices(invoices)) {
    const base = {
      invoiceId: inv.id,
      vendor: inv.vendor,
      date: inv.date,
      room: inv.room ?? '',
      category: inv.category,
    };
    if (inv.items.length === 0) {
      if (inv.total > 0) {
        result.push({
          ...base,
          itemIndex: -1,
          name: inv.vendor || 'Unknown item',
          quantity: 1,
          unitPrice: inv.total,
          currentUnitValue: currentValue(inv.total, inv.date, inv.category),
        });
      }
      continue;
    }
    inv.items.forEach((it, idx) => {
      const qty = it.quantity > 0 ? it.quantity : 1;
      const unit = it.unitPrice > 0 ? it.unitPrice : (it.totalPrice ?? 0) / qty;
      if (unit <= 0) return;
      result.push({
        ...base,
        itemIndex: idx,
        name: it.name || 'Unnamed item',
        quantity: qty,
        unitPrice: unit,
        currentUnitValue: currentValue(unit, inv.date, inv.category),
      });
    });
  }
  return result;
}

/** Items whose per-unit purchase price meets the threshold, most expensive first. */
export function getHighValueItems(invoices: Invoice[], threshold: number): ValuedItem[] {
  return getInsurableItems(invoices)
    .filter((it) => it.unitPrice >= threshold)
    .sort((a, b) => b.unitPrice - a.unitPrice);
}

// ─── Summaries ───────────────────────────────────────────────────────────────

export interface ContentsTotal {
  count: number; // number of insurable invoices
  purchase: number; // sum of purchase prices
  current: number; // sum of depreciated values
}

export function totalContentsValue(invoices: Invoice[]): ContentsTotal {
  const insurable = getInsurableInvoices(invoices);
  let purchase = 0;
  let current = 0;
  for (const inv of insurable) {
    purchase += inv.total;
    current += currentValue(inv.total, inv.date, inv.category);
  }
  return { count: insurable.length, purchase, current };
}

export interface RoomValue extends ContentsTotal {
  room: string; // '' = unassigned
}

/** Contents value grouped by room, highest current value first. */
export function summarizeByRoom(invoices: Invoice[]): RoomValue[] {
  const groups = new Map<string, RoomValue>();
  for (const inv of getInsurableInvoices(invoices)) {
    const key = (inv.room ?? '').trim().toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = { room: key, count: 0, purchase: 0, current: 0 };
      groups.set(key, g);
    }
    g.count += 1;
    g.purchase += inv.total;
    g.current += currentValue(inv.total, inv.date, inv.category);
  }
  return [...groups.values()].sort((a, b) => b.current - a.current);
}
