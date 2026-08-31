import type * as GoogleSigninModule from '@react-native-google-signin/google-signin';
import { getSetting, setSetting } from './database';
import { linkPurchasesToUser } from './purchases';
import { needsRefresh } from '../utils/jwt';
import { logSwallowed } from '../utils/log';

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
  } catch (err) {
    // The local user is cleared either way, so sign-out always appears to
    // work — but an SDK that refuses to sign out explains a later sign-in
    // returning the same account unexpectedly.
    logSwallowed('Google sign-out', err);
  }
  setSetting('authUser', '');
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
