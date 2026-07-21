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

### Task 5: Add a spotlight coach-mark tour after first-run onboarding

**Added after user feedback**, once Tasks 1-4 were built and approved: a follow-up request for a second, more physical layer of onboarding — a "spotlight tour" that highlights the real, live UI elements on the Home screen (a glowing ring/outline around each target, one at a time, with a short explanation), rather than the abstract 3-page pager built in Task 2. Confirmed scope via direct clarifying questions (not a full brainstorming pass, since this extends an already-approved feature area):

- Runs once, automatically, the first time `HomeScreen` mounts after this feature ships (covers both brand-new users right after finishing the Task 2 pager, and existing users who already have `hasSeenOnboarding=true` from before this feature existed — they get the spotlight tour once too, which is a deliberate, acceptable side effect of using a separate, independent `hasSeenSpotlight` settings flag rather than piggy-backing on the pager's own flag or on `Home`'s route params).
- Targets, in this order: the ＋ FAB (a circle, since it's a circular button), the search box, the Invoices/Rooms/Insurance toggle, the category quick-filter chip row.
- **Important edge case:** the category quick-filter row (`catRow` in `HomeScreen.tsx`) only renders when `categoryUsage.length > 0` — a brand-new user with zero invoices will not have this element mounted at all on their first Home visit. The tour must gracefully auto-skip any step whose target ref never mounted or measured to a zero size, rather than getting stuck. For brand-new users this means the tour will typically show only 3 of its 4 steps (FAB, search, toggle) and then finish — this is correct, not a bug: you cannot highlight UI that isn't on screen yet.
- No new dependencies: the "spotlight hole" is built from four opaque `View` panels arranged around the target's measured rect (top/bottom/left/right of it), leaving a transparent gap exactly the size of the target (plus a small padding), with a glowing bordered `View` drawn over that same gap for the ring effect. This avoids needing `react-native-svg` (not currently a dependency) for a true mask.
- Skippable (a "Skip" text link) and self-closing (a "Next"/"Got it" button that advances or finishes), matching the tone of Task 2's pager tutorial.
- Not wired into the Settings "View Tutorial" entry from Task 4 — that entry replays only the conceptual 3-page pager, matching what was actually asked for; this spotlight tour is a one-time physical walkthrough with no manual replay entry point.

**Files:**
- Create: `src/components/SpotlightOverlay.tsx`
- Modify: `src/screens/HomeScreen.tsx`

- [ ] **Step 1: Create the overlay component**

```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const HOLE_PADDING = 8;

export interface SpotlightStep {
  ref: React.RefObject<any>;
  title: string;
  body: string;
}

interface Props {
  steps: SpotlightStep[];
  onDone: () => void;
}

interface Hole {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
}

export default function SpotlightOverlay({ steps, onDone }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [hole, setHole] = useState<Hole | null>(null);

  useEffect(() => {
    measureStep(stepIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  function measureStep(index: number) {
    const step = steps[index];
    if (!step) {
      onDone();
      return;
    }
    const node = step.ref.current;
    if (!node || typeof node.measureInWindow !== 'function') {
      goToStep(index + 1); // target never mounted (e.g. no categories yet) — skip it
      return;
    }
    node.measureInWindow((x: number, y: number, width: number, height: number) => {
      if (!width || !height) {
        goToStep(index + 1); // target not laid out / hidden — skip it
        return;
      }
      const holeWidth = width + HOLE_PADDING * 2;
      const holeHeight = height + HOLE_PADDING * 2;
      setHole({
        left: x - HOLE_PADDING,
        top: y - HOLE_PADDING,
        width: holeWidth,
        height: holeHeight,
        radius: Math.min(holeWidth, holeHeight) / 2,
      });
    });
  }

  function goToStep(index: number) {
    if (index >= steps.length) {
      onDone();
      return;
    }
    setHole(null);
    setStepIndex(index);
  }

  if (!hole) return null;

  const step = steps[stepIndex];
  const holeBottom = hole.top + hole.height;
  const spaceBelow = SCREEN_HEIGHT - holeBottom;
  const tooltipBelow = spaceBelow > 180;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* 4-panel dark mask leaves a hole exactly around the target */}
      <View style={[styles.mask, { top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }]} />
      <View style={[styles.mask, { top: holeBottom, left: 0, right: 0, bottom: 0 }]} />
      <View
        style={[
          styles.mask,
          { top: hole.top, height: hole.height, left: 0, width: Math.max(0, hole.left) },
        ]}
      />
      <View
        style={[
          styles.mask,
          { top: hole.top, height: hole.height, left: hole.left + hole.width, right: 0 },
        ]}
      />

      {/* Glowing outline around the hole */}
      <View
        pointerEvents="none"
        style={[
          styles.ring,
          {
            left: hole.left,
            top: hole.top,
            width: hole.width,
            height: hole.height,
            borderRadius: hole.radius,
          },
        ]}
      />

      {/* Tooltip, anchored below or above the hole depending on available space */}
      <View
        style={[
          styles.tooltip,
          tooltipBelow ? { top: holeBottom + 16 } : { bottom: SCREEN_HEIGHT - hole.top + 16 },
        ]}
      >
        <Text style={styles.stepCount}>
          {stepIndex + 1} / {steps.length}
        </Text>
        <Text style={styles.title}>{step.title}</Text>
        <Text style={styles.body}>{step.body}</Text>
        <View style={styles.actions}>
          <TouchableOpacity onPress={onDone} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.nextBtn}
            onPress={() => goToStep(stepIndex + 1)}
            activeOpacity={0.85}
          >
            <Text style={styles.nextText}>{stepIndex + 1 >= steps.length ? 'Got it' : 'Next'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mask: { position: 'absolute', backgroundColor: 'rgba(15,23,42,0.8)' },
  ring: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: '#facc15',
    shadowColor: '#facc15',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 8,
  },
  tooltip: {
    position: 'absolute',
    left: 24,
    right: 24,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  stepCount: { fontSize: 11, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.5 },
  title: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  body: { fontSize: 13, color: '#64748b', lineHeight: 18 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  skipText: { fontSize: 13, fontWeight: '600', color: '#94a3b8' },
  nextBtn: { backgroundColor: '#2563eb', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  nextText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
```

Note on the hole's `radius`: `Math.min(holeWidth, holeHeight) / 2` naturally produces a perfect circle for square-ish targets (the FAB, since it's roughly as wide as it is tall) and a pill/stadium shape for wide, short targets (the search box, the toggle, the category row) — no per-target special-casing needed.

- [ ] **Step 2: Type-check**

Run:
```
node ./node_modules/typescript/bin/tsc --noEmit --jsx react-jsx --target es2021 --lib es2021,dom --moduleResolution bundler --module esnext --esModuleInterop --skipLibCheck --strict src/components/SpotlightOverlay.tsx 2>&1 | grep -E "error TS" | grep -v "TS2688"
```
Expected: no output.

- [ ] **Step 3: Commit the new component**

```bash
git add src/components/SpotlightOverlay.tsx
git commit -m "Add SpotlightOverlay coach-mark component"
```

- [ ] **Step 4: Wire it into `HomeScreen.tsx`**

Apply these edits in order. Current `HomeScreen.tsx` content for each anchor is shown — if it has drifted slightly, apply the equivalent change (same intent, same insertion point).

**4a — React import:** add `useEffect`.

Current:
```tsx
import React, { useState, useCallback, useRef } from 'react';
```
New:
```tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
```

**4b — database import:** add `setSetting`.

Current:
```tsx
import {
  searchInvoices,
  getPendingInvoices,
  updateInvoice,
  getCategoryUsage,
  bumpCategoryTap,
  isProUser,
  getInvoiceCount,
  countInvoicesCreatedAfter,
  getSetting,
  FREE_INVOICE_LIMIT,
} from '../services/database';
```
New:
```tsx
import {
  searchInvoices,
  getPendingInvoices,
  updateInvoice,
  getCategoryUsage,
  bumpCategoryTap,
  isProUser,
  getInvoiceCount,
  countInvoicesCreatedAfter,
  getSetting,
  setSetting,
  FREE_INVOICE_LIMIT,
} from '../services/database';
```

**4c — new component import:**

Current:
```tsx
import InvoiceCard from '../components/InvoiceCard';
import ViewToggle, { ToggleView } from '../components/ViewToggle';
```
New:
```tsx
import InvoiceCard from '../components/InvoiceCard';
import ViewToggle, { ToggleView } from '../components/ViewToggle';
import SpotlightOverlay, { SpotlightStep } from '../components/SpotlightOverlay';
```

**4d — new refs + state**, right after the existing `pagerRef`:

Current:
```tsx
  const pagerRef = useRef<PagerView>(null);
```
New:
```tsx
  const pagerRef = useRef<PagerView>(null);

  // First-run spotlight tour targets
  const fabRef = useRef<any>(null);
  const searchInputRef = useRef<any>(null);
  const toggleWrapRef = useRef<any>(null);
  const catRowRef = useRef<any>(null);
  const [showSpotlight, setShowSpotlight] = useState(false);
```

**4e — mount-once effect + finish handler**, right after `switchView`, before `handleExport`:

Current:
```tsx
  function switchView(next: ToggleView) {
    setView(next); // instant toggle highlight
    pagerRef.current?.setPage(VIEW_ORDER[next]); // native animated slide
  }

  function handleExport() {
```
New:
```tsx
  function switchView(next: ToggleView) {
    setView(next); // instant toggle highlight
    pagerRef.current?.setPage(VIEW_ORDER[next]); // native animated slide
  }

  // One-time spotlight tour: fires on the first Home mount after this flag is
  // unset — covers both brand-new users (right after onboarding) and existing
  // users seeing this feature for the first time after an app update.
  useEffect(() => {
    if (getSetting('hasSeenSpotlight', 'false') === 'true') return;
    const timer = setTimeout(() => setShowSpotlight(true), 400);
    return () => clearTimeout(timer);
  }, []);

  function finishSpotlight() {
    setSetting('hasSeenSpotlight', 'true');
    setShowSpotlight(false);
  }

  function handleExport() {
```

**4f — attach `searchInputRef`** to the search `TextInput`:

Current:
```tsx
        <TextInput
          style={styles.searchInput}
          placeholder="Search vendor, item..."
          placeholderTextColor="#9ca3af"
          value={query}
          onChangeText={handleSearch}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
```
New:
```tsx
        <TextInput
          ref={searchInputRef}
          style={styles.searchInput}
          placeholder="Search vendor, item..."
          placeholderTextColor="#9ca3af"
          value={query}
          onChangeText={handleSearch}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
```

**4g — wrap `ViewToggle`** so it has a measurable container (`ViewToggle` itself doesn't forward a ref):

Current:
```tsx
      {/* Fixed view toggle — content below slides, header stays put */}
      <ViewToggle active={view} onSelect={switchView} />
```
New:
```tsx
      {/* Fixed view toggle — content below slides, header stays put */}
      <View ref={toggleWrapRef} collapsable={false}>
        <ViewToggle active={view} onSelect={switchView} />
      </View>
```

**4h — attach `catRowRef`** to the category quick-filter row (inside the `categoryUsage.length > 0 && (() => { ... })()` block):

Current:
```tsx
        return (
          <View style={styles.catRow}>
            <TouchableOpacity
```
New:
```tsx
        return (
          <View style={styles.catRow} ref={catRowRef} collapsable={false}>
            <TouchableOpacity
```

**4i — attach `fabRef`** to the FAB:

Current:
```tsx
        <TouchableOpacity
          style={styles.fab}
          onPress={() => {
```
New:
```tsx
        <TouchableOpacity
          ref={fabRef}
          style={styles.fab}
          onPress={() => {
```

**4j — define the steps array**, right before the component's `return (`:

Current:
```tsx
  const canExport = view === 'rooms' ? currentRoom !== '' : invoices.length > 0;
  const exportLabel = view === 'rooms' ? 'Export Room' : 'Export';

  return (
```
New:
```tsx
  const canExport = view === 'rooms' ? currentRoom !== '' : invoices.length > 0;
  const exportLabel = view === 'rooms' ? 'Export Room' : 'Export';

  const spotlightSteps: SpotlightStep[] = [
    {
      ref: fabRef,
      title: 'Add an item',
      body: "Tap here to scan a receipt, or add an item by hand if you don't have one.",
    },
    {
      ref: searchInputRef,
      title: 'Search anytime',
      body: 'Find anything by vendor, item name, or price.',
    },
    {
      ref: toggleWrapRef,
      title: 'Three views, one app',
      body: 'Switch between your Invoices list, Rooms, and the Insurance dashboard.',
    },
    {
      ref: catRowRef,
      title: 'Quick category filters',
      body: 'Your most-used categories show up here for one-tap filtering.',
    },
  ];

  return (
```

**4k — render the overlay**, as the topmost layer, right before the closing `</SafeAreaView>` (after the FAB block):

Current:
```tsx
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}
```
New:
```tsx
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      )}

      {showSpotlight && <SpotlightOverlay steps={spotlightSteps} onDone={finishSpotlight} />}
    </SafeAreaView>
  );
}
```

- [ ] **Step 5: Type-check**

Run:
```
node ./node_modules/typescript/bin/tsc --noEmit --jsx react-jsx --target es2021 --lib es2021,dom --moduleResolution bundler --module esnext --esModuleInterop --skipLibCheck --strict src/screens/HomeScreen.tsx 2>&1 | grep -E "error TS" | grep -v "TS2688"
```
Expected: no output.

- [ ] **Step 6: On-device verification (full reload required — new refs/effects on mount, Fast Refresh cannot be trusted)**

1. Confirm Metro is up (see Task 3's verification step for the exact command/restart procedure if needed).
2. Fully reload the app.
3. `hasSeenSpotlight` has never been set on this install, so the tour should start automatically about 400ms after Home appears. Confirm:
   - A dark overlay appears with a glowing circle around the ＋ FAB, plus a tooltip titled "Add an item".
   - Tapping "Next" moves the glow to the search box (a pill/rounded-rectangle shape, not a circle — this is expected given the shape-adapts-to-target design), then to the Invoices/Rooms/Insurance toggle.
   - If you have zero invoices and zero category taps on this test account, the 4th step (category chips) is skipped automatically and the tour ends after the toggle step with no error — this is correct, not a bug (see the Task 5 introduction above for why). If you do have some invoices/taps, confirm the 4th step highlights the category chip row correctly instead.
   - "Skip" at any point immediately dismisses the whole tour.
   - The last step shown has a "Got it" button (not "Next") that dismisses the tour.
4. Fully reload the app again. Confirm the spotlight tour does NOT reappear (the `hasSeenSpotlight` flag now persists it as seen).

- [ ] **Step 7: Commit**

```bash
git add src/screens/HomeScreen.tsx
git commit -m "Add first-run spotlight tour highlighting key Home screen actions"
```

---

## Plan self-review notes

- **Spec coverage:** persistence/first-launch detection → Task 3; new `Onboarding` route → Tasks 1 & 3; 3-page content/pager/skip/dots/buttons → Task 2; Settings replay entry → Task 4; real-UI spotlight coach-mark tour (added after initial approval, per direct follow-up request) → Task 5. All spec sections have a task.
- **Type consistency:** the settings key `hasSeenOnboarding` and route name `Onboarding` are spelled identically across Tasks 1-4 (`navigation.ts`, `OnboardingScreen.tsx`, `App.tsx`, `SettingsScreen.tsx`). Task 5 introduces its own independent settings key, `hasSeenSpotlight`, spelled identically in both places it's used (`HomeScreen.tsx`'s effect and its `finishSpotlight` handler) — deliberately not reusing `hasSeenOnboarding`, since the two flags are allowed to be true/false independently (see Task 5's introduction).
- **No placeholders:** every step shows complete, final code — nothing marked TBD or "similar to above".
