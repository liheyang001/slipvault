# EAS Development Build Migration (Android) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Slipvault's Android dev workflow from Expo Go to an EAS development build, so native modules unavailable in Expo Go (RevenueCat, sign-in SDKs, in later sub-projects) become usable, while keeping Metro-based JS/asset hot reload working day-to-day.

**Architecture:** Add `expo-dev-client` as a dependency, configure a `development` build profile in the project's existing `eas.json`, run one EAS cloud build to produce an installable APK, install it on the test phone, then switch the daily Metro command from `npx expo start --tunnel` to `npx expo start --dev-client --tunnel`.

**Tech Stack:** Expo SDK 54, EAS Build (cloud), `expo-dev-client`.

---

## Important discovery (read before starting)

This project already has `eas.json` and an EAS project ID in `app.json`
(`extra.eas.projectId`), left over from an earlier, later-reverted attempt at
this same migration (see git history: `f425d1d` added them, `fff6d52` reverted
`expo-dev-client` itself but never removed `eas.json`/the project ID). This
means two things this plan would otherwise need to do are **already done**:

- The project is already linked to an EAS project (no `eas init` needed).
- The user's machine already has a valid EAS CLI login (verified via
  `npx eas-cli whoami` → returns `womendemiao` / `liheyang001@hotmail.com`
  without prompting — the session token is already stored locally).

So Task 1 below **modifies** the existing `eas.json` rather than creating one
from scratch, and there is no separate "log in" task.

## Verification note

This project has no test runner (no jest, no test files — confirmed earlier
this session; `package.json` scripts are just `expo start` variants). Nothing
in this plan is source code either — it's CLI/tooling steps. Each task's
verification is therefore: run the actual command and read its real output.

**Steps only a human can do** (an agent has no phone and can't click "Install"):
physically installing the built APK on the test phone, and visually confirming
a hot-reloaded JS change actually shows up on screen. These are called out
explicitly in Task 3 and Task 4 below — an agent should stop and hand these
back to the user rather than attempting to script around them.

---

### Task 1: Add `expo-dev-client`

**Files:**
- Modify: `package.json` (via the install command, not by hand-editing)

- [ ] **Step 1: Install the package**

Run:
```
npx expo install expo-dev-client
```
This is Expo's own installer (not plain `npm install`) — it picks the exact
version compatible with this project's Expo SDK 54, and updates `package.json`
and the lockfile accordingly.

- [ ] **Step 2: Verify it was added**

Run:
```
grep expo-dev-client package.json
```
Expected: a line like `"expo-dev-client": "~X.Y.Z",` appears.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add expo-dev-client for EAS development builds"
```
(If this project uses a different lockfile — check with `ls package-lock.json
yarn.lock 2>/dev/null` first — add whichever one actually exists instead.)

---

### Task 2: Configure the `development` build profile for Android

**Files:**
- Modify: `eas.json`

Current content of the `development` profile (the rest of the file — `preview`,
`production`, `submit` — is unrelated to this migration and must be left
exactly as-is):
```json
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": {
        "simulator": true
      }
    },
```

Replace just that block with (adds an explicit Android section so the build
produces a directly-installable `.apk` rather than defaulting to an `.aab`,
which Play Store submission needs but a sideloaded test install does not):
```json
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": {
        "simulator": true
      },
      "android": {
        "buildType": "apk"
      }
    },
```

- [ ] **Step 1: Apply the edit above to `eas.json`**

- [ ] **Step 2: Verify the file is still valid JSON**

Run:
```
node -e "console.log(JSON.parse(require('fs').readFileSync('eas.json','utf8')).build.development)"
```
Expected output:
```
{
  developmentClient: true,
  distribution: 'internal',
  ios: { simulator: true },
  android: { buildType: 'apk' }
}
```

- [ ] **Step 3: Commit**

```bash
git add eas.json
git commit -m "Add Android apk build type to the EAS development profile"
```

---

### Task 3: Build the development APK (human-required steps included)

**Files:** none — this task runs CLI commands, no source changes.

- [ ] **Step 1: Confirm EAS login (should already be valid, no action expected)**

Run:
```
npx eas-cli whoami
```
Expected: prints an account name (e.g. `womendemiao`), not a "not logged in"
error. If it DOES say not logged in, run `npx eas-cli login` and follow its
prompts (this one does need the human, since it's an interactive credential
entry) before continuing.

- [ ] **Step 2: Kick off the cloud build**

Run:
```
npx eas-cli build --profile development --platform android --non-interactive
```
`--non-interactive` avoids any prompts that would hang in a non-interactive
shell (e.g. it will use the existing linked project and auto-manage the
Android keystore without asking). This uploads the project and queues a cloud
build; expect the command to take roughly 10-20 minutes and print a build
details URL (`https://expo.dev/accounts/.../builds/...`) plus, on success, a
direct APK download URL.

Expected: command exits 0 and prints a build URL and an artifact/download URL.
If it fails, read the printed error — common causes are an Android version
code conflict (fixed by bumping `android.versionCode` in `app.json`) or a
plugin/config issue reported directly in the log link provided.

- [ ] **Step 3 (human-required): Install the APK on the test phone**

Open the download URL from Step 2 on the phone (or scan the QR code EAS prints)
and install it — Android will likely ask to confirm "install from unknown
sources" for this app the first time, since it isn't from the Play Store.
There is no command for this step; it happens on the physical device.

---

### Task 4: Switch the daily dev workflow to the dev client (human-required verification)

**Files:** none.

- [ ] **Step 1: Start Metro in dev-client mode**

Run (replacing the old `npx expo start --tunnel` used throughout this project
until now):
```
npx expo start --dev-client --tunnel
```
Expected: same kind of output as before (a QR code / `exp://...` tunnel URL),
but the CLI banner now says it's expecting a **development build**, not Expo
Go.

- [ ] **Step 2 (human-required): Connect and verify hot reload**

Open the newly-installed dev-client app (NOT Expo Go) on the phone and
connect it to the Metro instance from Step 1 the same way Expo Go used to be
connected (scan the QR / open the `exp://` URL). Confirm the app loads to the
normal Home screen.

Then make a trivial, throwaway visual change to confirm hot reload still
works end-to-end on the new client — for example, temporarily change the
Settings screen's version text:

In `src/screens/SettingsScreen.tsx`, find:
```tsx
      <Text style={styles.version}>Slipvault v1.0.0</Text>
```
Temporarily change it to:
```tsx
      <Text style={styles.version}>Slipvault v1.0.0 (dev client test)</Text>
```
Save, and confirm the phone updates without a manual reload (or with at most
a fast-refresh flash) — same behavior as Expo Go gave before. Then revert the
change back to the original line and save again (confirming reload works
both directions), and do not commit this throwaway edit.

- [ ] **Step 3: Report results**

Tell the user which of these held true: cloud build succeeded, APK installed,
dev-client connected to Metro, hot reload confirmed working. This closes out
the migration — no commit needed for this task (Step 2's edit is reverted, not
committed).

---

## Plan self-review notes

- **Spec coverage:** `expo-dev-client` dependency → Task 1; `eas.json` development
  profile with `android.buildType: apk` → Task 2; cloud build + install → Task 3;
  new daily workflow command + hot-reload verification → Task 4. All spec
  sections have a task. The spec's "what does NOT change" section (no
  RevenueCat/sign-in/backend/UI changes) is honored — no task touches any of
  those.
- **Discovery correction:** the spec assumed `eas.json` would be created fresh;
  in reality it already exists (with `preview`/`production` profiles too, from
  reverted earlier work) and already has a linked EAS project ID. Task 2 was
  adjusted to modify the existing file's `development` block only, and no
  `eas init` task was added since the project is already linked. This is called
  out explicitly at the top of this plan so whoever executes it isn't surprised.
- **No placeholders:** every step shows the exact command or exact code change;
  no "TBD"/"add appropriate config" language anywhere.
