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

/** Signs out of the SDK (errors swallowed) and clears the stored user. */
export async function signOutGoogle(): Promise<void> {
  try {
    const { GoogleSignin } = sdk();
    await GoogleSignin.signOut();
  } catch {}
  setSetting('authUser', '');
}

/**
 * A fresh Google ID token for the currently signed-in user, or null if not
 * signed in. Never throws — mirrors signInWithGoogle's cancel-never-throws
 * contract, since callers use this to silently decide whether to prompt for
 * sign-in rather than to hard-fail.
 */
export async function getIdToken(): Promise<string | null> {
  if (!getStoredUser()) return null;
  try {
    const { GoogleSignin } = sdk();
    const tokens = await GoogleSignin.getTokens();
    return tokens.idToken ?? null;
  } catch {
    return null;
  }
}
