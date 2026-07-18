// Contents-insurance oriented: durable belongings you'd claim, not consumables.
export const DEFAULT_CATEGORIES = [
  'electronics',
  'furniture',
  'appliances',
  'jewelry',
  'clothing',
  'tools',
  'sports',
  'transport',
  'healthcare',
  'other',
];

export function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function normalizeCategory(s: string): string {
  return s.trim().toLowerCase();
}
