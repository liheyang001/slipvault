# EAS Development Build Migration (Android) — Design

## Purpose

This is sub-project 1 of a larger effort to replace Slipvault's local-only "20 free
invoices" soft cap with a server-tracked credit system (RevenueCat consumable
credit packs + a lightweight sign-in for cross-device identity + a small custom
backend ledger). Both RevenueCat's SDK and native sign-in SDKs (Sign in with
Apple/Google) are native modules unavailable in Expo Go, so before any of that
work can start, the project's development workflow must move from Expo Go to an
EAS development build. This sub-project covers only that migration — no new
user-facing feature, no RevenueCat/sign-in code yet.

**Scope decision:** Android only, for now. The user's only test device is Android,
already has a Google Play Developer account and an Expo (expo.dev) account, and
does not want to invest in an Apple Developer account ($99/yr) until there's a
concrete need to test on iOS. This sub-project produces no iOS build config.

## Approach

Use `expo-dev-client` + EAS Build's cloud compilation, with EAS auto-managing the
Android signing keystore. This is the standard, Expo-blessed path: it requires no
local Android SDK/Studio setup (the compile happens in Expo's cloud), and —
critically — a "development" build profile keeps Metro-based JS/asset hot reload
working almost exactly as it does today under Expo Go. The only workflow change is
the client app used to open the Metro bundler (a custom-branded dev build instead
of the generic Expo Go app) and the command used to start Metro
(`--dev-client` instead of plain `expo start`).

Rejected alternatives:
- **Local native build via `npx expo prebuild` + Android Studio/gradle**: works,
  but requires installing and maintaining a local Android SDK toolchain on this
  Windows machine for no benefit over EAS's cloud build, which needs nothing
  local.
- **Skip the dev client, build straight to a "preview"/production-style build for
  testing**: would require a full native recompile for every code change (no hot
  reload), destroying the fast edit-reload-test loop this project has relied on
  all along. Explicitly not what "development build" means here.

## Changes

**1. Add `expo-dev-client` as a dependency** (`npx expo install expo-dev-client`).
This is what turns a compiled build into a "development build" — one that still
opens a Metro connection for JS/asset hot reload, rather than bundling a fixed JS
payload like a production build would.

**2. Create `eas.json`** at the project root:
```json
{
  "cli": { "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": { "buildType": "apk" }
    }
  }
}
```
- `developmentClient: true` — build with the dev client (Metro-connectable) rather
  than a production JS bundle.
- `distribution: "internal"` — not submitted to Play Store; distributed via a
  direct download link/QR code EAS generates after the build.
- `android.buildType: "apk"` — a directly-installable APK rather than an `.aab`
  (App Bundle), since `.aab` is only needed for Play Store submission.

No changes to `app.json` — the existing `android.package: "com.slipvault.app"`
identifier is reused as-is.

**3. Build and install:**
```
eas login
eas build --profile development --platform android
```
First run prompts for (or auto-generates, if the user accepts) an Android
keystore, which EAS then stores and reuses for all future builds of this app —
no manual keystore management needed. The cloud build takes roughly 10-20
minutes; EAS provides a download link/QR code for the resulting APK once done.
Install it on the test device (requires allowing "install from unknown sources"
if not already permitted) — this is a one-time step for now.

**4. New day-to-day dev workflow**, replacing the `npx expo start --tunnel`
pattern used throughout this project so far:
```
npx expo start --dev-client --tunnel
```
Open the newly-installed dev-client app (not Expo Go) on the phone and connect to
this Metro instance the same way Expo Go was connected to before (scan / paste
the `exp://` URL). Pure JS/TS/component edits hot-reload exactly as before.

## What does NOT change

- No RevenueCat, no sign-in SDK, no backend code in this sub-project — those are
  separate, later sub-projects that this one unblocks.
- No changes to any app screen, the database schema, or the Cloudflare Worker.
- The existing local "20 free invoices" soft cap (`FREE_INVOICE_LIMIT` in
  `src/services/database.ts`) is untouched; it will be replaced in a later
  sub-project once the credit ledger backend exists.
- iOS is explicitly out of scope; no `ios` build profile is added to `eas.json`.

## Follow-up sub-projects (not designed yet, for context only)

Once this migration is done and verified (a dev build installed, Metro connecting
to it, hot reload working for a trivial test change), the remaining pieces —
each to be brainstormed and planned on its own — are, in dependency order:
1. Sign-in (Apple and/or Google) for a stable cross-device identity.
2. RevenueCat integration: consumable "credit pack" products, purchase flow.
3. Custom backend credit ledger (likely Cloudflare Worker + KV/D1): balance
   tracking, spend-on-scan API, RevenueCat webhook receiver for top-ups.
4. Migration of existing free-tier users + paywall/balance UI rework.
