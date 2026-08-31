// Minimal JWT reading for refresh decisions. The Worker does the real
// verification; nothing here is a security check. Free of native imports so it
// can be unit-tested.

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes base64url to a byte-per-char string. Hand-rolled because atob is
 * not guaranteed present across Hermes versions, and getting this wrong would
 * silently force a re-authentication on every single request. */
export function decodeBase64Url(input: string): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const ch of input) {
    if (ch === '=') break;
    const value = B64_ALPHABET.indexOf(ch === '-' ? '+' : ch === '_' ? '/' : ch);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

/**
 * Reads a JWT's `exp`, or null when it cannot be read — callers treat that as
 * expired.
 *
 * Pulled out by regex rather than JSON.parse: the payload carries the user's
 * name, and decoding its UTF-8 bytes one char at a time would mangle any
 * non-ASCII into something JSON.parse could choke on. exp is always an integer.
 */
export function expiryOf(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const match = /"exp"\s*:\s*(\d+)/.exec(decodeBase64Url(part));
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/** Refresh a minute early so a token cannot expire in flight. */
export const REFRESH_MARGIN_MS = 60_000;

/** True when the token is missing, unreadable, or about to lapse. */
export function needsRefresh(token: string | null, now: number = Date.now()): boolean {
  if (!token) return true;
  const exp = expiryOf(token);
  return exp === null || exp * 1000 <= now + REFRESH_MARGIN_MS;
}
