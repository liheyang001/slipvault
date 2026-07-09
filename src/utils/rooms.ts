// Rooms group invoices by physical location (e.g. for insurance claims).
// This is an independent dimension from `category` (which describes item type).

export const DEFAULT_ROOMS = [
  'living room',
  'bedroom',
  'kitchen',
  'bathroom',
  'dining room',
  'garage',
  'office',
  'basement',
  'other',
];

export function normalizeRoom(s: string): string {
  return s.trim().toLowerCase();
}

/** Capitalize each word so "living room" → "Living Room". */
export function capitalizeRoom(s: string): string {
  if (!s) return s;
  return s
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Merge default rooms with custom user rooms, no duplicates, defaults first. */
export function mergeRooms(userRooms: string[]): string[] {
  return [
    ...DEFAULT_ROOMS,
    ...userRooms.filter((r) => !DEFAULT_ROOMS.includes(r)),
  ];
}
