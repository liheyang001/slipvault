export const DEFAULT_CATEGORIES = [
  'groceries',
  'restaurant',
  'electronics',
  'transport',
  'healthcare',
  'clothing',
  'utilities',
  'other',
];

export function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function normalizeCategory(s: string): string {
  return s.trim().toLowerCase();
}
