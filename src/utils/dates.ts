// Dates are stored as ISO (YYYY-MM-DD, optionally with HH:MM) because that
// sorts, compares and de-duplicates correctly in SQLite. These helpers exist
// only to present and accept them in New Zealand's day-first format.

/** Splits an ISO date string into parts, ignoring any time component. */
function isoParts(iso: string): { y: string; m: string; d: string; time: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](.+))?$/.exec(iso.trim());
  if (!match) return null;
  return { y: match[1], m: match[2], d: match[3], time: match[4] ?? '' };
}

/** ISO → NZ display format: 2026-07-26 → 26/07/2026. Time is kept if present.
 * Anything unparseable is returned untouched, so partial user input still shows. */
export function formatNZDate(iso: string | undefined | null): string {
  if (!iso) return '';
  const parts = isoParts(iso);
  if (!parts) return iso;
  const date = `${parts.d}/${parts.m}/${parts.y}`;
  return parts.time ? `${date} ${parts.time}` : date;
}

/** Same as formatNZDate but for a Date object (e.g. a computed warranty expiry). */
export function formatNZDateObject(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${date.getFullYear()}`;
}

/** NZ input → ISO for storage: 26/07/2026 → 2026-07-26.
 * Accepts 1-2 digit day/month and 2- or 4-digit years, and passes ISO through
 * unchanged so existing values keep working. Returns '' when it can't parse. */
export function parseNZDate(input: string): string {
  const text = input.trim();
  if (!text) return '';

  // Already ISO — keep as is.
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text;

  const match = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})(?:[ ](.+))?$/.exec(text);
  if (!match) return '';

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  const time = match[4]?.trim() ?? '';

  if (day < 1 || day > 31 || month < 1 || month > 12) return '';
  if (match[3].length === 2) year += year < 70 ? 2000 : 1900;

  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return time ? `${iso} ${time}` : iso;
}
