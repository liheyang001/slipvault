# First-Launch Onboarding Tutorial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3-page, skippable onboarding tutorial that appears automatically on first launch (and can be replayed from Settings), explaining what Slipvault is for, how to add an item, and how organization/valuation pays off.

**Architecture:** A new standalone `OnboardingScreen` (native `PagerView`, same component the Home screen already uses for its Invoices/Rooms/Insurance tabs) is added as a new Stack route. `App.tsx` reads a `hasSeenOnboarding` flag from the existing settings key-value store (synchronously, before first render) to decide whether the Stack's `initialRouteName` is `Onboarding` or `Home`. Completing or skipping the tutorial writes the flag and exits via `goBack()` (when reached from Settings) or `replace('Home')` (when it was the initial route). No new tables, no new dependencies.

**Tech Stack:** React Native (Expo), `react-native-pager-view` (already a dependency), the existing `getSetting`/`setSetting` settings store (`src/services/database.ts`).

**Note on verification:** This project has no test runner (no jest/testing-library — verified: no `*.test.*` files, no jest config, `package.json` scripts are just `expo start` variants). Every task's "test" step is therefore the project's real verification method, exactly as used throughout this codebase's history: the manual TypeScript check command, plus a manual on-device check via Expo Go for the tasks that change runtime behavior. There is no test-first/red-green cycle here — each task's step order is: write the code, type-check it, (when relevant) verify on-device, commit.

**Type-check command** (used in every task below, only the file list changes):
```
node ./node_modules/typescript/bin/tsc --noEmit --jsx react-jsx --target es2021 --lib es2021,dom --moduleResolution bundler --module esnext --esModuleInterop --skipLibCheck --strict <files> 2>&1 | grep -E "error TS" | grep -v "TS2688"
```
`TS2688` is filtered because this project's global `@types` setup reports harmless "cannot find type definition file" noise unrelated to real errors. Expected output for every passing check in this plan is **no lines at all**.

---

### Task 1: Add the `Onboarding` route to navigation types

**Files:**
- Modify: `src/types/navigation.ts`

- [ ] **Step 1: Add the route**

Current file:
```ts
import { SearchFilters } from './invoice';

export type RootStackParamList = {
  Home: { filters?: SearchFilters } | undefined;
  Camera: { defaultRoom?: string } | undefined;
  Review: { photoUri: string; queue?: string[]; defaultRoom?: string };
  ManualEntry: { defaultRoom?: string } | undefined;
  InvoiceDetail: { invoiceId: string };
  Search: { filters?: SearchFilters } | undefined;
  Paywall: undefined;
  Settings: undefined;
};
```

Replace the `RootStackParamList` block with:
```ts
import { SearchFilters } from './invoice';

export type RootStackParamList = {
  Onboarding: undefined;
  Home: { filters?: SearchFilters } | undefined;
  Camera: { defaultRoom?: string } | undefined;
  Review: { photoUri: string; queue?: string[]; defaultRoom?: string };
  ManualEntry: { defaultRoom?: string } | undefined;
  InvoiceDetail: { invoiceId: string };
  Search: { filters?: SearchFilters } | undefined;
  Paywall: undefined;
  Settings: undefined;
};
```

- [ ] **Step 2: Type-check**

Run:
```
node ./node_modules/typescript/bin/tsc --noEmit --jsx react-jsx --target es2021 --lib es2021,dom --moduleResolution bundler --module esnext --esModuleInterop --skipLibCheck --strict src/types/navigation.ts 2>&1 | grep -E "error TS" | grep -v "TS2688"
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/types/navigation.ts
git commit -m "Add Onboarding route to navigation types"
```

---

### Task 2: Create `OnboardingScreen`

**Files:**
- Create: `src/screens/OnboardingScreen.tsx`

- [ ] **Step 1: Write the file**

```tsx
import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import PagerView from 'react-native-pager-view';
import { RootStackParamList } from '../types/navigation';
import { setSetting } from '../services/database';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;

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
    title: "Organize by room, know what it's worth",
    body: "Group items by room so you can export a room's contents straight to your insurer. The Insurance tab tracks depreciation, flags high-value items, and can AI-estimate current replacement value.",
  },
];

export default function OnboardingScreen() {
  const navigation = useNavigation<Nav>();
  const pagerRef = useRef<PagerView>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const isLastPage = currentPage === PAGES.length - 1;

  function handleFinish() {
    setSetting('hasSeenOnboarding', 'true');
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.replace('Home');
    }
  }

  function handleNext() {
    pagerRef.current?.setPage(currentPage + 1);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        {!isLastPage && (
          <TouchableOpacity
            onPress={handleFinish}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>

      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={0}
        onPageSelected={(e) => setCurrentPage(e.nativeEvent.position)}
      >
        {PAGES.map((page) => (
          <View key={page.title} style={styles.page}>
            <Text style={styles.icon}>{page.icon}</Text>
            <Text style={styles.title}>{page.title}</Text>
            <Text style={styles.body}>{page.body}</Text>
          </View>
        ))}
      </PagerView>

      <View style={styles.bottom}>
        <View style={styles.dots}>
          {PAGES.map((page, i) => (
            <View key={page.title} style={[styles.dot, i === currentPage && styles.dotActive]} />
          ))}
        </View>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={isLastPage ? handleFinish : handleNext}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>{isLastPage ? 'Get Started' : 'Next'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },

  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 8,
    height: 40,
  },
  skipText: { fontSize: 14, fontWeight: '600', color: '#64748b' },

  pager: { flex: 1 },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  icon: { fontSize: 72, marginBottom: 24 },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  body: {
    fontSize: 15,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 22,
  },

  bottom: { paddingHorizontal: 28, paddingTop: 20, paddingBottom: 24, gap: 20 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#e2e8f0' },
  dotActive: { width: 20, backgroundColor: '#2563eb' },

  primaryBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
```

- [ ] **Step 2: Type-check**

Run:
```
node ./node_modules/typescript/bin/tsc --noEmit --jsx react-jsx --target es2021 --lib es2021,dom --moduleResolution bundler --module esnext --esModuleInterop --skipLibCheck --strict src/screens/OnboardingScreen.tsx 2>&1 | grep -E "error TS" | grep -v "TS2688"
```
Expected: no output. (This resolves cleanly against Task 1's `Onboarding: undefined` entry.)

- [ ] **Step 3: Commit**

```bash
git add src/screens/OnboardingScreen.tsx
git commit -m "Add OnboardingScreen with 3-page pager, skip, and dot indicator"
```

---

### Task 3: Wire Onboarding into `App.tsx` (first-launch detection + route registration)

**Files:**
- Modify: `App.tsx`

- [ ] **Step 1: Import the screen**

Current (line 11-12):
```tsx
import ReviewScreen from './src/screens/ReviewScreen';
import ManualEntryScreen from './src/screens/ManualEntryScreen';
```

Replace with:
```tsx
import ReviewScreen from './src/screens/ReviewScreen';
import ManualEntryScreen from './src/screens/ManualEntryScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
```

- [ ] **Step 2: Compute the initial route once, before first render**

Current (lines 20-22):
```tsx
// Run before any component renders so DB tables exist when screens query them
try { initDatabase(); } catch {}
try { initNotifications(); } catch {}
```

Replace with:
```tsx
// Run before any component renders so DB tables exist when screens query them
try { initDatabase(); } catch {}
try { initNotifications(); } catch {}

// Decided once, before mount — changing Stack.Navigator's initialRouteName after
// mount has no effect, so this must not be a hook/state value.
const initialRouteName = getSetting('hasSeenOnboarding', 'false') === 'true' ? 'Home' : 'Onboarding';
```

- [ ] **Step 3: Use the computed route and register the screen**

Current (lines 52-64):
```tsx
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: { backgroundColor: '#fff' },
          headerTintColor: '#111827',
          headerTitleStyle: { fontWeight: '700' },
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ headerShown: false }}
        />
```

Replace with:
```tsx
      <Stack.Navigator
        initialRouteName={initialRouteName}
        screenOptions={{
          headerStyle: { backgroundColor: '#fff' },
          headerTintColor: '#111827',
          headerTitleStyle: { fontWeight: '700' },
        }}
      >
        <Stack.Screen
          name="Onboarding"
          component={OnboardingScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ headerShown: false }}
        />
```

- [ ] **Step 4: Type-check**

Run:
```
node ./node_modules/typescript/bin/tsc --noEmit --jsx react-jsx --target es2021 --lib es2021,dom --moduleResolution bundler --module esnext --esModuleInterop --skipLibCheck --strict App.tsx 2>&1 | grep -E "error TS" | grep -v "TS2688"
```
Expected: no output.

- [ ] **Step 5: On-device verification (full reload required — this changes `App.tsx` and adds a route, so Fast Refresh cannot be trusted; do a full reload)**

1. Confirm Metro is up: `curl -s -o /dev/null -w "Metro: HTTP %{http_code}\n" http://localhost:8081/status` → expect `Metro: HTTP 200`. If not running, restart with `npx expo start --tunnel` from the project root.
2. On the phone, fully reload the app (shake → Reload, or close and reopen from Expo Go).
3. **This existing install has never set `hasSeenOnboarding`, so no manual reset is needed** — the very first reload after this change is a real first-launch test. Confirm:
   - The app opens directly into the onboarding tutorial (not Home).
   - Swiping left/right moves between all 3 pages; the dot indicator tracks the current page.
   - "Skip" is visible on pages 1–2, hidden on page 3.
   - Page 3's button reads "Get Started"; tapping it lands on the normal Home screen.
4. Fully reload the app a second time. Confirm it now opens directly to Home (the flag is `true`), proving the flag persists and gates correctly.

- [ ] **Step 6: Commit**

```bash
git add App.tsx
git commit -m "Show onboarding tutorial on first launch"
```

---

### Task 4: Add a "View Tutorial" entry to Settings

**Files:**
- Modify: `src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Add the row to the Support section**

Current (lines 211-221):
```tsx
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Support</Text>

        <TouchableOpacity style={styles.row} onPress={handleFeedback}>
          <View style={styles.rowContent}>
            <Text style={styles.rowTitle}>Send Feedback</Text>
            <Text style={styles.rowSub}>{FEEDBACK_EMAIL}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      </View>
```

Replace with:
```tsx
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Support</Text>

        <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('Onboarding')}>
          <View style={styles.rowContent}>
            <Text style={styles.rowTitle}>View Tutorial</Text>
            <Text style={styles.rowSub}>See the welcome walkthrough again</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.row} onPress={handleFeedback}>
          <View style={styles.rowContent}>
            <Text style={styles.rowTitle}>Send Feedback</Text>
            <Text style={styles.rowSub}>{FEEDBACK_EMAIL}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      </View>
```

No new imports needed — `navigation` (typed `NativeStackNavigationProp<RootStackParamList, 'Settings'>`) is already in scope via the existing `useNavigation<Nav>()` call, and `.navigate` accepts any route in `RootStackParamList`, including the new `Onboarding` entry from Task 1.

- [ ] **Step 2: Type-check**

Run:
```
node ./node_modules/typescript/bin/tsc --noEmit --jsx react-jsx --target es2021 --lib es2021,dom --moduleResolution bundler --module esnext --esModuleInterop --skipLibCheck --strict src/screens/SettingsScreen.tsx 2>&1 | grep -E "error TS" | grep -v "TS2688"
```
Expected: no output.

- [ ] **Step 3: On-device verification**

Hot reload is sufficient here (no new route wiring in `App.tsx` this time). On the phone:
1. Open Settings → confirm a new "View Tutorial" row appears above "Send Feedback" in the Support section.
2. Tap it → confirm the onboarding tutorial opens.
3. Tap "Skip" (or finish via "Get Started") → confirm it returns to the Settings screen (not Home) — this exercises the `navigation.canGoBack()` branch in `OnboardingScreen`'s `handleFinish`, since Settings is on the back stack this time.

- [ ] **Step 4: Commit**

```bash
git add src/screens/SettingsScreen.tsx
git commit -m "Add View Tutorial entry to Settings"
```

---

## Plan self-review notes

- **Spec coverage:** persistence/first-launch detection → Task 3; new `Onboarding` route → Tasks 1 & 3; 3-page content/pager/skip/dots/buttons → Task 2; Settings replay entry → Task 4. All spec sections have a task.
- **Type consistency:** the settings key `hasSeenOnboarding` and route name `Onboarding` are spelled identically across all four tasks (`navigation.ts`, `OnboardingScreen.tsx`, `App.tsx`, `SettingsScreen.tsx`).
- **No placeholders:** every step shows complete, final code — nothing marked TBD or "similar to above".
