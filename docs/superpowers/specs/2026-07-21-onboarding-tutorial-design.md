# First-Launch Onboarding Tutorial — Design

## Purpose

New users land on a single-screen app (Invoices/Rooms/Insurance tabs, a ＋ FAB with
two hidden entry points, room grouping, AI valuation) with no explanation of what
Slipvault is for or how the pieces fit together. A short, skippable onboarding
sequence on first launch should communicate:

1. What the app is for (a contents-insurance record, not just a receipt scanner)
2. How to add an item (scan a receipt, or add manually when there's no receipt)
3. How organization pays off (rooms for insurer reporting, the Insurance dashboard
   for depreciation/high-value items/AI valuation)

## Persistence & First-Launch Detection

Reuses the existing `settings` key-value table (`getSetting`/`setSetting` in
`src/services/database.ts`), the same mechanism already used for `isPro`,
`hvThreshold`, `lastBackupAt`, etc. No new table or migration needed.

- New key: `hasSeenOnboarding` (`'true'` | unset)
- `App.tsx` reads it synchronously before the first render (`getSetting` is a
  synchronous SQLite call, same pattern as `initDatabase()` running before any
  component renders) and picks `Stack.Navigator`'s `initialRouteName`:
  - unset/`'false'` → `'Onboarding'`
  - `'true'` → `'Home'`
- No loading state or flicker: the route is decided once, before mount.

## Navigation

- New route added to `RootStackParamList`: `Onboarding: undefined`
- New screen: `src/screens/OnboardingScreen.tsx`, registered in `App.tsx` with
  `headerShown: false` (same treatment as `Home`/`Camera`)
- Completion handler (fired by both "Get Started" on the last page and "Skip" on
  any page):
  1. `setSetting('hasSeenOnboarding', 'true')`
  2. `navigation.canGoBack() ? navigation.goBack() : navigation.replace('Home')`

  This one handler correctly covers both entry paths without branching on how the
  screen was reached:
  - **First launch**: no back stack exists (Onboarding is the initial route) →
    replaces to Home.
  - **Manual replay from Settings**: Settings is on the back stack → goes back to
    Settings, matching normal "close this screen" expectations.

- **Settings entry point**: a new row in `SettingsScreen.tsx` (placed in the
  existing "Support" section, above "Send Feedback") — title "View Tutorial",
  navigates to `Onboarding` via `navigation.navigate('Onboarding')`. This does not
  touch `hasSeenOnboarding` on entry, only on completion (so backing out via the
  device back button without finishing leaves the flag untouched — acceptable
  since a first-time user backing out of Onboarding entirely would otherwise
  never see it marked seen and would get it again next launch, which is the
  intended "haven't finished it yet" behavior; a manual replay from Settings that
  gets backed out of simply leaves the already-`true` flag as `true`).

## Content — 3 pages

Rendered from a single content array inside `OnboardingScreen.tsx`:

```ts
const PAGES = [
  {
    icon: '📋',
    title: 'Welcome to Slipvault',
    body: 'Turn your receipts into a bulletproof home contents insurance record.',
  },
  {
    icon: '📷',
    title: 'Snap it, or add it by hand',
    body: 'Scan a receipt and Slipvault reads the vendor, date, and amount automatically. Lost the receipt, or it was a gift? Add the item manually — a photo of the item itself is proof enough.',
  },
  {
    icon: '📦',
    title: 'Organize by room, know what it\'s worth',
    body: 'Group items by room so you can export a room\'s contents straight to your insurer. The Insurance tab tracks depreciation, flags high-value items, and can AI-estimate current replacement value.',
  },
];
```

Icons are plain emoji (no image asset), matching the app's existing emoji-icon
visual language (category icons, room icons). Exact wording may be refined
slightly during implementation, but the three beats (what it's for → how to add
→ how organization/value tracking pays off) are fixed.

## Screen structure & components

- Reuses `react-native-pager-view` (already a dependency, already used for the
  Home screen's Invoices/Rooms/Insurance tabs) — no new dependency.
- Layout, top to bottom:
  - Top bar: **Skip** text button, top-right, hidden on the last page (the last
    page's primary button already serves as the exit action)
  - `PagerView` filling the middle, one page per `PAGES` entry: centered icon
    (large emoji or logo), title, body text
  - Bottom: dot page indicator (small filled/outline circles, one per page,
    current page filled) centered above a full-width primary button
    - Pages 0–1: button reads **Next**, advances the pager by one page
      (`pagerRef.current?.setPage(i + 1)`)
    - Page 2 (last): button reads **Get Started**, runs the completion handler
- Current page index tracked via `onPageSelected` on the `PagerView`, same pattern
  already used for the item-photo carousel index tracking in
  `InvoiceDetailScreen.tsx`.
- Single file, ~150–200 lines; no sub-components needed for 3 static pages.

## Out of scope (explicitly deferred)

- No per-page illustrations/animations — icon + text only, matching the app's
  existing emoji-icon visual language (room icons, category icons).
- No A/B-testable copy variants or analytics on onboarding completion/drop-off.
- No "don't show this again" checkbox — Skip already covers that need.
- No interactive/mock walkthrough (e.g. a fake camera capture) — purely
  informational screens.
