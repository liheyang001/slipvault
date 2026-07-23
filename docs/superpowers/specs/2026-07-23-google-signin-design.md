# Google Sign-In (Identity Anchor) — Design

## Purpose

Sub-project 2 of the credit-system effort (sub-project 1, the EAS dev-build
migration, is complete). The future credit ledger needs a user identity that
survives device changes and reinstalls; RevenueCat will also be keyed to it via
`logIn()`. This sub-project adds that identity: native Google Sign-In, surfaced
only as an optional "Account" section in Settings for now.

**Decisions made with the user:**
- **Provider: Google only.** Every Android user has a Google account, and the
  app is Android-only for now. Apple Sign-In is deferred until an iOS release
  (where App Store rules will require it). Email+code and Firebase Auth were
  considered and rejected (own-backend burden / heavyweight dependency,
  respectively).
- **Timing: sign-in on demand, not at launch.** The app stays fully usable
  without an account. In THIS sub-project nothing prompts for sign-in at all —
  the only entry point is a Settings row. Wiring "first scan prompts sign-in"
  happens later, together with the live credit gate (sub-project 4), because
  until credits exist there is nothing to protect.

## Library

`@react-native-google-signin/google-signin` (the standard native SDK wrapper;
no Firebase required). It is a native module — unavailable in Expo Go — which
is exactly why sub-project 1 migrated to an EAS dev build first. Adding it
requires:
- its Expo config plugin entry in `app.json`,
- one new EAS development build (`eas build --profile development --platform
  android`) before the JS can call it on the phone.

## One-time Google Cloud Console setup (user-performed, agent-guided)

1. Create/choose a Google Cloud project; configure the OAuth consent screen
   (external, app name Slipvault, no sensitive scopes — just openid/email/
   profile defaults).
2. Create an **Android OAuth client**: package name `com.slipvault.app`, SHA-1
   fingerprint of the EAS-managed keystore (retrieved via `eas credentials`
   — the agent extracts and provides this value).
3. Create a **Web OAuth client** (no redirect config needed); its client ID is
   passed to the SDK as `webClientId` so `signIn()` returns an ID token
   (`idToken`) that a backend can later verify. The Google user's stable `sub`
   claim (returned as `user.id`) is the cross-device identity key.

## App changes

- **`src/services/auth.ts`** (new): thin wrapper around the SDK —
  `configureAuth()` (called once at app start; sets `webClientId`),
  `signInWithGoogle(): Promise<AuthUser | null>` (null on user cancel),
  `signOutGoogle()`, `getStoredUser(): AuthUser | null`.
  `AuthUser = { id: string; email: string; name: string }` — persisted as one
  JSON value under the existing settings key-value table (`authUser` key),
  same mechanism as every other persisted flag in this app. ID tokens are NOT
  stored — sub-project 3's ledger calls will fetch a fresh token per request
  via the SDK's `getTokens()`.
- **`App.tsx`**: call `configureAuth()` once alongside the existing
  `initDatabase()`/`initNotifications()` guarded startup calls.
- **`SettingsScreen.tsx`**: new "Account" section above "Plan":
  - signed out → row "Sign in with Google" / subtitle "Back up your identity
    for future cross-device features" → triggers `signInWithGoogle()`.
  - signed in → row showing the account email, subtitle "Signed in with
    Google", plus a "Sign out" row (confirm via Alert, then `signOutGoogle()`
    and clear `authUser`).
- **`app.json`**: add the SDK's config plugin.

## Out of scope

- No RevenueCat, no credit ledger, no scan gating, no paywall changes.
- No Apple/other providers.
- No server-side ID-token verification yet (that lands with the Cloudflare
  Worker ledger API in sub-project 3, which will verify `idToken` signatures
  against Google's JWKS before crediting/debiting).
- No UI outside the Settings section.

## Verification

Type-check (project's manual tsc command); new EAS build installs and boots;
on-device: Settings shows "Sign in with Google" → native account picker →
email appears in Settings; survives app restart (settings table persistence);
Sign out returns the row to signed-out state. Sign-in cancel (backing out of
the picker) must not error — it resolves to null and the UI stays signed out.
