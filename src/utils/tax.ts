// Sales tax on a purchase — called GST here, VAT or Sales Tax elsewhere, at
// rates that range from nothing to well over 20%. Both the rate and its name
// are user-configurable in Settings; NZ GST is the default because that is
// where the app shipped first.
import { getSetting, setSetting } from '../services/database';
import {
  DEFAULT_TAX_PERCENT,
  DEFAULT_TAX_LABEL,
  exclFromInclAt,
  inclFromExclAt,
  taxFromInclAt,
} from './taxMath';

// Arithmetic and presets live in taxMath so they can be tested without a
// database. Re-exported here so callers keep a single import site.
export { TAX_PRESETS, DEFAULT_TAX_PERCENT, DEFAULT_TAX_LABEL } from './taxMath';
export type { TaxPreset } from './taxMath';

export const TAX_RATE_KEY = 'tax_rate_percent';
export const TAX_LABEL_KEY = 'tax_label';

// These are read on every keystroke while amounts are being edited, so keep
// them in memory rather than hitting SQLite each time.
let cachedPercent: number | null = null;
let cachedLabel: string | null = null;

/** The configured rate as a percentage, e.g. 15 for 15%. */
export function getTaxPercent(): number {
  if (cachedPercent === null) {
    const raw = parseFloat(getSetting(TAX_RATE_KEY, ''));
    // A rate outside this range is a corrupt setting, not a jurisdiction —
    // fall back rather than produce nonsense totals.
    cachedPercent = Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : DEFAULT_TAX_PERCENT;
  }
  return cachedPercent;
}

/** What to call it on screen: "GST", "VAT", "Sales Tax". */
export function getTaxLabel(): string {
  if (cachedLabel === null) {
    cachedLabel = getSetting(TAX_LABEL_KEY, '').trim() || DEFAULT_TAX_LABEL;
  }
  return cachedLabel;
}

export function setTaxSettings(percent: number, label: string): void {
  const safePercent = Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : DEFAULT_TAX_PERCENT;
  const safeLabel = label.trim() || DEFAULT_TAX_LABEL;
  setSetting(TAX_RATE_KEY, String(safePercent));
  setSetting(TAX_LABEL_KEY, safeLabel);
  cachedPercent = safePercent;
  cachedLabel = safeLabel;
}

/** Drops the cache so the next read comes from the database — needed after a
    restore, which replaces the settings table underneath us. */
export function refreshTaxSettings(): void {
  cachedPercent = null;
  cachedLabel = null;
}

export function exclFromIncl(incl: number): number {
  return exclFromInclAt(incl, getTaxPercent());
}

export function inclFromExcl(excl: number): number {
  return inclFromExclAt(excl, getTaxPercent());
}

export function taxFromIncl(incl: number): number {
  return taxFromInclAt(incl, getTaxPercent());
}
