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

// Keyword → icon, checked in order so custom names like "master bedroom" still match.
const ROOM_ICONS: [RegExp, string][] = [
  [/living|lounge/, '🛋️'],
  [/bed|guest/, '🛏️'],
  [/kitchen/, '🍳'],
  [/bath|toilet|washroom|ensuite/, '🛁'],
  [/dining/, '🍽️'],
  [/garage|carport|shed/, '🚗'],
  [/office|study/, '💻'],
  [/basement|attic|storage|closet/, '📦'],
  [/laundry/, '🧺'],
  [/garden|yard|outdoor|balcony|patio|deck/, '🌳'],
  [/kid|nursery|play/, '🧸'],
  [/hall|entry|entrance|foyer/, '🚪'],
  [/gym/, '🏋️'],
];

/** Icon matching the room's name; generic house if nothing matches. */
export function roomIcon(room: string): string {
  const r = normalizeRoom(room);
  for (const [re, icon] of ROOM_ICONS) {
    if (re.test(r)) return icon;
  }
  return '🏠';
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
