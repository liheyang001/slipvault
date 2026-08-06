// Sales tax on a purchase — called GST here, VAT or Sales Tax elsewhere, at
// rates that range from nothing to well over 20%. Both the rate and its name
// are user-configurable in Settings; NZ GST is the default because that is
// where the app shipped first.
import { getSetting, setSetting } from '../services/database';

export const TAX_RATE_KEY = 'tax_rate_percent';
export const TAX_LABEL_KEY = 'tax_label';

export const DEFAULT_TAX_PERCENT = 15;
export const DEFAULT_TAX_LABEL = 'GST';

export type TaxPreset = { country: string; label: string; percent: number };

/** Offered in Settings. Custom entry sits alongside these, so the list only
    has to cover the common cases, not every jurisdiction. */
export const TAX_PRESETS: TaxPreset[] = [
  { country: 'New Zealand', label: 'GST', percent: 15 },
  { country: 'Australia', label: 'GST', percent: 10 },
  { country: 'United Kingdom', label: 'VAT', percent: 20 },
  { country: 'Ireland', label: 'VAT', percent: 23 },
  { country: 'Germany', label: 'VAT', percent: 19 },
  { country: 'France', label: 'VAT', percent: 20 },
  { country: 'Singapore', label: 'GST', percent: 9 },
  { country: 'Canada', label: 'GST', percent: 5 },
  { country: 'India', label: 'GST', percent: 18 },
  { country: 'No tax', label: 'Tax', percent: 0 },
];

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

const round2 = (n: number) => Math.round(n * 100) / 100;

export function exclFromIncl(incl: number): number {
  return round2(incl / (1 + getTaxPercent() / 100));
}

export function inclFromExcl(excl: number): number {
  return round2(excl * (1 + getTaxPercent() / 100));
}

/** The tax portion of a tax-inclusive amount. Derived from exclFromIncl so the
    three stored figures always add up after rounding. */
export function taxFromIncl(incl: number): number {
  return round2(incl - exclFromIncl(incl));
}
