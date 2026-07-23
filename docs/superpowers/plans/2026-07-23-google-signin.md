# Google Sign-In (Identity Anchor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional native Google Sign-In (Settings-only entry point) so the app has a stable cross-device user identity for the upcoming credit ledger and RevenueCat integration.

**Architecture:** `@react-native-google-signin/google-signin` (native SDK, no Firebase) + a thin `src/services/auth.ts` wrapper persisting `{id, email, name}` in the existing settings key-value table + an "Account" section in Settings. Requires one new EAS dev build (new native module) and one-time user-performed Google Cloud Console OAuth setup.

**Tech Stack:** Expo SDK 54 dev build, `@react-native-google-signin/google-signin`, existing `getSetting`/`setSetting` store.

**Verification note:** no test runner in this project. Code tasks verify via the manual tsc command (see any earlier plan in this folder) + Metro bundle compile (`curl "http://localhost:8081/index.ts.bundle?platform=android&dev=true"` → HTTP 200). Native/on-device steps are human-performed and marked as such. **Lesson from sub-project 1:** after installing the package, check for nested/mismatched native deps (`npm ls expo-modules-core` + a scan for duplicate expo/google-signin packages) BEFORE burning a 15-minute cloud build.

---

### Task 1: Install the SDK + config plugin

**Files:** `package.json`, `package-lock.json`, `app.json`

- [ ] Step 1: `npm install @react-native-google-signin/google-signin`
- [ ] Step 2: sanity-check the tree: `npm ls expo-modules-core react-native` shows single, SDK-54-consistent versions; `npm ls @react-native-google-signin/google-signin` shows one copy. Check the package's `peerDependencies` for react-native compatibility with 0.81.
- [ ] Step 3: add the plugin to `app.json`'s existing `plugins` array (last entry): `"@react-native-google-signin/google-signin"`
- [ ] Step 4: `node -e "JSON.parse(require('fs').readFileSync('app.json','utf8'))"` exits clean.
- [ ] Step 5: commit `package.json package-lock.json app.json` — "Add Google Sign-In SDK and config plugin"

### Task 2: `src/services/auth.ts` + startup configure

**Files:** create `src/services/auth.ts`; modify `App.tsx`

- [ ] Step 1: write `auth.ts` with: `AuthUser {id,email,name}`, `configureAuth()` calling `GoogleSignin.configure({ webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID })`, `getStoredUser()` (JSON from settings key `authUser`, null-safe), `signInWithGoogle()` (Play Services check; returns `AuthUser|null` — null on user cancel, never throws for cancel; persists to `authUser`), `signOutGoogle()` (SDK signOut, swallow errors, clear `authUser`). **The exact signIn response shape varies by SDK version — the implementer must read `node_modules/@react-native-google-signin/google-signin`'s TypeScript types and use the installed version's actual API** (v13+: `signIn()` returns a `{type, data}` response; older: throws `SIGN_IN_CANCELLED` coded errors — handle whichever the installed types show, keeping the `AuthUser|null` contract).
- [ ] Step 2: in `App.tsx`, add `import { configureAuth } from './src/services/auth';` and `try { configureAuth(); } catch {}` alongside the existing guarded `initDatabase()`/`initNotifications()` startup calls.
- [ ] Step 3: type-check `src/services/auth.ts App.tsx` (standard command) → no errors.
- [ ] Step 4: commit — "Add Google auth service and startup configuration"

### Task 3: Settings "Account" section

**Files:** `src/screens/SettingsScreen.tsx`

- [ ] Step 1: add an "Account" section rendered ABOVE the existing "Plan" section, using the file's existing section/row/style idioms. State: `const [user, setUser] = useState<AuthUser | null>(getStoredUser)`. Signed out → row title "Sign in with Google", sub "Back up your identity for future cross-device features"; onPress: `signInWithGoogle()` in try/catch — on success `setUser(...)`; on null (cancel) do nothing; on error `Alert.alert('Sign-in failed', 'Please try again.')`. Signed in → row title = user.email, sub "Signed in with Google" (non-tappable), plus row "Sign out" → confirm Alert → `signOutGoogle()` + `setUser(null)`.
- [ ] Step 2: type-check → clean; bundle compile via curl → HTTP 200.
- [ ] Step 3: commit — "Add Account section with Google sign-in to Settings"

### Task 4: Credentials, rebuild, on-device verification (controller + human)

No file changes except `.env` (uncommitted).

- [ ] Step 1 (controller): extract the EAS keystore's SHA-1 from the already-built dev APK: download the latest dev-build APK, then `unzip -p app.apk "META-INF/*.RSA" | openssl pkcs7 -inform DER -print_certs | openssl x509 -noout -fingerprint -sha1` (adjust for .DSA/.EC extension if needed). Give the SHA-1 to the user.
- [ ] Step 2 (human, agent-guided): in Google Cloud Console — create/select project, configure OAuth consent screen (External, app name "Slipvault", default scopes), create **Android OAuth client** (package `com.slipvault.app`, the SHA-1 from Step 1), create **Web OAuth client**; paste the Web client ID back to the agent.
- [ ] Step 3 (controller): append `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<web client id>` to `.env` (which is gitignored; also update `.env.example` with a placeholder line and commit that).
- [ ] Step 4 (controller): kick off `npx eas-cli build --profile development --platform android --non-interactive` (~15 min, background), then give the user the artifact URL.
- [ ] Step 5 (human): install the new APK over the old one; reconnect to Metro.
- [ ] Step 6 (human): verify — Settings shows "Sign in with Google" → native account picker appears → after choosing an account the row shows the email; kill and reopen the app → still signed in; Sign out → row reverts; starting sign-in and backing out (cancel) → no error shown, stays signed out.

---

## Plan self-review notes

- Spec coverage: library+plugin → T1; auth service+configure → T2; Settings UI → T3; Console setup, SHA-1, .env, rebuild, device verification → T4. "Out of scope" items untouched by any task.
- The SDK's response-shape variance is explicitly delegated to the implementer with the installed types as source of truth (safer than baking in an API guess).
- No placeholders; exact commands or exact behavioral contracts given for every step.
