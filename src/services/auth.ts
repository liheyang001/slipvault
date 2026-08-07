import type * as GoogleSigninModule from '@react-native-google-signin/google-signin';
import { getSetting, setSetting } from './database';
import { linkPurchasesToUser } from './purchases';

/**
 * Lazily require the SDK so importing this file never touches the native
 * TurboModule — on builds without RNGoogleSignin compiled in (e.g. an older
 * dev client), the throw happens inside the caller's try/catch instead of
 * crashing the bundle at load time.
 */
function sdk(): typeof GoogleSigninModule {
  return require('@react-native-google-signin/google-signin');
}

export interface AuthUser {
  id: string; // Google's stable user id (the cross-device identity key)
  email: string;
  name: string;
}

/** Call once at app start. Reads the web client ID from env. */
export function configureAuth(): void {
  const { GoogleSignin } = sdk();
  // Note: configure() stores its native promise internally (fire-and-forget);
  // async failures cannot be caught here — only the synchronous path is
  // guarded by callers.
  GoogleSignin.configure({ webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID });
}

/** The locally persisted signed-in user, or null. */
export function getStoredUser(): AuthUser | null {
  try {
    const raw = getSetting('authUser', '');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === 'string' && typeof parsed.email === 'string') {
      return {
        id: parsed.id,
        email: parsed.email,
        name: typeof parsed.name === 'string' ? parsed.name : '',
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Launches the native account picker.
 * Resolves to the signed-in user (also persisted to settings key 'authUser'),
 * or null if the user cancelled — cancel must NEVER throw.
 * Real failures (no Play Services, network) DO throw.
 */
export async function signInWithGoogle(): Promise<AuthUser | null> {
  const { GoogleSignin, isSuccessResponse } = sdk();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();

  if (!isSuccessResponse(response)) {
    return null;
  }

  const user: AuthUser = {
    id: response.data.user.id,
    email: response.data.user.email,
    name: response.data.user.name ?? '',
  };
  setSetting('authUser', JSON.stringify(user));
  await linkPurchasesToUser(user.id);
  return user;
}

/** Turns a Google Sign-In failure into something a human can act on.
 * The SDK's numeric codes are the only signal that distinguishes a
 * misconfiguration from a network blip, and they are otherwise invisible. */
export function describeSignInError(err: unknown): string {
  const e = err as { code?: string | number; message?: string };
  const code = String(e?.code ?? '');
  switch (code) {
    case '10':
    case 'DEVELOPER_ERROR':
      return 'Configuration mismatch (DEVELOPER_ERROR / 10). The package name or signing certificate does not match an Android OAuth client in Google Cloud.';
    case '7':
    case 'NETWORK_ERROR':
      return 'No network connection reached Google (NETWORK_ERROR / 7).';
    case '12500':
      return 'Sign-in failed inside Play Services (12500). Often a stale Google Play Services install.';
    case '12501':
      return 'Sign-in was cancelled.';
    case '8':
      return 'Internal error in Play Services (8). Try again.';
    default:
      return `Unexpected error${code ? ` (code ${code})` : ''}: ${e?.message ?? String(err)}`;
  }
}

/** Signs out of the SDK (errors swallowed) and clears the stored user. */
export async function signOutGoogle(): Promise<void> {
  try {
    const { GoogleSignin } = sdk();
    await GoogleSignin.signOut();
  } catch {}
  setSetting('authUser', '');
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes base64url to a byte-per-char string. Hand-rolled because atob is
 * not guaranteed present across Hermes versions, and getting this wrong would
 * silently force a re-authentication on every single request. */
function decodeBase64Url(input: string): string {
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
 * Reads a JWT's `exp` without verifying anything — the Worker does the real
 * verification. This only decides whether to bother refreshing.
 * Returns null when the token cannot be parsed, which callers treat as expired.
 */
function expiryOf(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    // Pulled out by regex rather than JSON.parse: the payload carries the
    // user's name, and decoding its UTF-8 bytes one char at a time would
    // mangle any non-ASCII into something JSON.parse could choke on. exp is
    // always a bare integer.
    const match = /"exp"\s*:\s*(\d+)/.exec(decodeBase64Url(part));
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/** True when the token is gone, unreadable, or expires within the minute —
 * the margin keeps a token from dying in flight. */
function needsRefresh(token: string | null): boolean {
  if (!token) return true;
  const exp = expiryOf(token);
  return exp === null || exp * 1000 <= Date.now() + 60_000;
}

/** Re-authenticates from the stored credential, with no UI. */
async function refreshedToken(GoogleSignin: typeof GoogleSigninModule.GoogleSignin) {
  try {
    await GoogleSignin.signInSilently();
    const tokens = await GoogleSignin.getTokens();
    return tokens.idToken ?? null;
  } catch {
    // The credential is genuinely gone; the caller falls back to signed-out
    // behaviour and the user is prompted to sign in again when it matters.
    return null;
  }
}

/**
 * A fresh Google ID token for the currently signed-in user, or null if not
 * signed in. Never throws — mirrors signInWithGoogle's cancel-never-throws
 * contract, since callers use this to silently decide whether to prompt for
 * sign-in rather than to hard-fail.
 */
export async function getIdToken(): Promise<string | null> {
  if (!getStoredUser()) return null;
  const { GoogleSignin } = sdk();

  let token: string | null = null;
  try {
    const tokens = await GoogleSignin.getTokens();
    token = tokens.idToken ?? null;
  } catch {
    // Not the common case — see below. Only reached when there is no cached
    // account at all.
    return refreshedToken(GoogleSignin);
  }

  // Google ID tokens last an hour, and getTokens() does NOT renew them: on
  // Android it hands back whatever was cached at sign-in, expired or not,
  // without raising. Relying on it to throw meant the refresh below never ran
  // — an hour after signing in every request carried a dead token, the server
  // 401'd it, and the app just showed "—" with no way out but signing out and
  // back in. So check the expiry here rather than waiting to be told.
  if (needsRefresh(token)) {
    return (await refreshedToken(GoogleSignin)) ?? token;
  }
  return token;
}

/**
 * Re-authenticates unconditionally and returns the new token. For retrying a
 * request the server answered with 401 — at that point the cached token is
 * known bad regardless of what its `exp` claims.
 */
export async function forceRefreshIdToken(): Promise<string | null> {
  if (!getStoredUser()) return null;
  return refreshedToken(sdk().GoogleSignin);
}
