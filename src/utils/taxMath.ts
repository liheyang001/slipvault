// Tax arithmetic and the preset table. Deliberately imports nothing: tax.ts
// reads the configured rate from the database, which drags in expo-sqlite and
// makes it untestable outside a device.

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

const round2 = (n: number) => Math.round(n * 100) / 100;

export function exclFromInclAt(incl: number, ratePercent: number): number {
  return round2(incl / (1 + ratePercent / 100));
}

export function inclFromExclAt(excl: number, ratePercent: number): number {
  return round2(excl * (1 + ratePercent / 100));
}

/** The tax portion of a tax-inclusive amount. Derived from exclFromInclAt so
    the three stored figures always add up after rounding. */
export function taxFromInclAt(incl: number, ratePercent: number): number {
  return round2(incl - exclFromInclAt(incl, ratePercent));
}
