import { expiryOf, needsRefresh } from '../src/utils/jwt';

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (payload: Record<string, unknown>) => `header.${b64url(payload)}.signature`;
const NOW = 1_786_000_000_000;
const nowSec = Math.floor(NOW / 1000);

describe('expiryOf', () => {
  it('reads exp', () => {
    expect(expiryOf(token({ sub: '1', exp: 1786092611 }))).toBe(1786092611);
  });

  // Regression: decoding UTF-8 a byte at a time mangles non-ASCII, which is why
  // exp is extracted by regex rather than JSON.parse.
  it('survives a non-ASCII name in the payload', () => {
    expect(expiryOf(token({ name: '李和洋', exp: 1786092611 }))).toBe(1786092611);
    expect(expiryOf(token({ name: 'A 🏠 B', exp: 1786092611 }))).toBe(1786092611);
  });

  it('returns null for unreadable input', () => {
    expect(expiryOf('not-a-jwt')).toBeNull();
    expect(expiryOf('')).toBeNull();
    expect(expiryOf(token({ sub: '1' }))).toBeNull();
  });
});

describe('needsRefresh', () => {
  // The shipped bug: getTokens() hands back an expired token without raising,
  // so nothing refreshed and every request 401'd for an hour at a time.
  it('is true for an expired token', () => {
    expect(needsRefresh(token({ exp: nowSec - 3600 }), NOW)).toBe(true);
  });

  it('is true inside the one-minute margin, so a token cannot die in flight', () => {
    expect(needsRefresh(token({ exp: nowSec + 30 }), NOW)).toBe(true);
  });

  it('is false for a token with real time left', () => {
    expect(needsRefresh(token({ exp: nowSec + 3000 }), NOW)).toBe(false);
  });

  it('is true when there is no token or it cannot be parsed', () => {
    expect(needsRefresh(null, NOW)).toBe(true);
    expect(needsRefresh('garbage', NOW)).toBe(true);
    expect(needsRefresh(token({ sub: 'no-exp' }), NOW)).toBe(true);
  });
});
