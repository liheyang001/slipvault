# Credit UI Redesign (Quiet Card) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the credit-related UI per the approved "Quiet Card" design — a Settings account card with a visible credit balance (replacing the plain rows and the stale Plan section), and a distinct out-of-credits card on the Review screen.

**Architecture:** Pure UI changes to two screens. `SettingsScreen` gets an elevated white card (avatar / balance panel / dev top-up / sign out) that fetches the balance via the existing `getCreditBalance()` on screen focus; the Plan section and its local-counter reads are deleted. `ReviewScreen`'s out-of-credits state gets its own centered card with a "Get more credits" → Paywall CTA, leaving the amber network-error box untouched. No service, Worker, or dependency changes.

**Tech Stack:** React Native (Expo SDK 54), React Navigation (`useFocusEffect`), existing `src/services/claude.ts` helpers.

**Spec:** `docs/superpowers/specs/2026-07-26-credit-ui-redesign-design.md`

---

### Task 1: `src/screens/SettingsScreen.tsx` — account card, delete Plan section

**Files:**
- Modify: `src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Update the imports.** Current (lines 1, 13, 16–23, 27):

```tsx
import React, { useState, useEffect } from 'react';
```
```tsx
import { useNavigation } from '@react-navigation/native';
```
```tsx
import {
  getSetting,
  setSetting,
  getAllInvoices,
  isProUser,
  getInvoiceCount,
  FREE_INVOICE_LIMIT,
} from '../services/database';
```
```tsx
import { devTopUpCredits } from '../services/claude';
```

New:

```tsx
import React, { useState, useEffect, useCallback } from 'react';
```
```tsx
import { useNavigation, useFocusEffect } from '@react-navigation/native';
```
```tsx
import { getSetting, setSetting, getAllInvoices } from '../services/database';
```
```tsx
import { devTopUpCredits, getCreditBalance } from '../services/claude';
```

- [ ] **Step 2: Update state and effects.** Current (lines 35–48):

```tsx
  const [monthlyEnabled, setMonthlyEnabled] = useState(false);
  const [pro, setPro] = useState(false);
  const [invoiceCount, setInvoiceCount] = useState(0);
  const [busy, setBusy] = useState<'backup' | 'restore' | 'signin' | null>(null);
  const [lastBackup, setLastBackup] = useState('');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setMonthlyEnabled(getSetting('monthlyNotif', 'false') === 'true');
    setPro(isProUser());
    setInvoiceCount(getInvoiceCount());
    setLastBackup(getSetting('lastBackupAt', ''));
    setUser(getStoredUser());
  }, []);
```

New (`pro`/`invoiceCount` gone; `balance` added; balance refetch on every focus while signed in — `null` renders as "—" and any fetch failure silently resets to it):

```tsx
  const [monthlyEnabled, setMonthlyEnabled] = useState(false);
  const [busy, setBusy] = useState<'backup' | 'restore' | 'signin' | null>(null);
  const [lastBackup, setLastBackup] = useState('');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    setMonthlyEnabled(getSetting('monthlyNotif', 'false') === 'true');
    setLastBackup(getSetting('lastBackupAt', ''));
    setUser(getStoredUser());
  }, []);

  // Refresh the balance whenever the screen gains focus (e.g. returning from
  // a scan or the Paywall). Balance is auxiliary info: failures show "—", never an alert.
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      getCreditBalance()
        .then((b) => {
          if (!cancelled) setBalance(b);
        })
        .catch(() => {
          if (!cancelled) setBalance(null);
        });
      return () => {
        cancelled = true;
      };
    }, [user])
  );
```

- [ ] **Step 3: Drop the `invoiceCount` refresh inside `handleRestore`.** Current (lines 111–118):

```tsx
              const result = await restoreBackup();
              if (result) {
                setInvoiceCount(getInvoiceCount());
                Alert.alert(
                  'Restore complete',
                  `${result.invoices} invoice${result.invoices !== 1 ? 's' : ''} restored.`
                );
              }
```

New (only the `setInvoiceCount` line is removed):

```tsx
              const result = await restoreBackup();
              if (result) {
                Alert.alert(
                  'Restore complete',
                  `${result.invoices} invoice${result.invoices !== 1 ? 's' : ''} restored.`
                );
              }
```

- [ ] **Step 4: Rewrite `handleDevTopUp`** — success updates the visible balance instead of alerting; failure still alerts. Current (lines 171–178):

```tsx
  async function handleDevTopUp() {
    try {
      const balance = await devTopUpCredits(20);
      Alert.alert('Credits added', `New balance: ${balance}`);
    } catch {
      Alert.alert('Top-up failed', 'Please try again.');
    }
  }
```

New:

```tsx
  async function handleDevTopUp() {
    try {
      const newBalance = await devTopUpCredits(20);
      setBalance(newBalance);
    } catch {
      Alert.alert('Top-up failed', 'Please try again.');
    }
  }
```

- [ ] **Step 5: Replace the Account section AND the Plan section with the card.** Current JSX (from `{/* Account */}` through the end of the `{/* Pro / plan */}` section — lines 182–245):

```tsx
      {/* Account */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Account</Text>
        {!user ? (
          <TouchableOpacity
            style={styles.row}
            onPress={handleSignIn}
            disabled={busy !== null}
            activeOpacity={0.7}
          >
            <View style={styles.rowContent}>
              <Text style={styles.rowTitle}>Sign in with Google</Text>
              <Text style={styles.rowSub}>
                Back up your identity for future cross-device features
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ) : (
          <>
            <View style={styles.row}>
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle}>{user.email}</Text>
                <Text style={styles.rowSub}>Signed in with Google</Text>
              </View>
            </View>
            {__DEV__ && (
              <TouchableOpacity style={styles.row} onPress={handleDevTopUp} activeOpacity={0.7}>
                <View style={styles.rowContent}>
                  <Text style={styles.rowTitle}>+20 credits (dev)</Text>
                  <Text style={styles.rowSub}>Testing only — stands in for a real purchase</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.row} onPress={handleSignOut} activeOpacity={0.7}>
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle}>Sign out</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Pro / plan */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Plan</Text>
        <TouchableOpacity
          style={styles.row}
          onPress={() => navigation.navigate('Paywall')}
          activeOpacity={0.7}
        >
          <View style={styles.rowContent}>
            <Text style={styles.rowTitle}>{pro ? 'Slipvault Pro ✓' : 'Free plan'}</Text>
            <Text style={styles.rowSub}>
              {pro
                ? 'Unlimited invoices — thank you for your support!'
                : `${Math.min(invoiceCount, FREE_INVOICE_LIMIT)}/${FREE_INVOICE_LIMIT} free invoices used · tap to upgrade`}
            </Text>
          </View>
          {!pro && <Text style={styles.chevron}>›</Text>}
        </TouchableOpacity>
      </View>
```

New (one wrapped card; the "Get more" button is the Settings-side Paywall entry now that Plan is gone; avatar initial prefers `name`, falls back to `email`):

```tsx
      {/* Account */}
      <View style={styles.accountWrap}>
        <Text style={styles.sectionLabel}>Account</Text>
        {!user ? (
          <TouchableOpacity
            style={styles.card}
            onPress={handleSignIn}
            disabled={busy !== null}
            activeOpacity={0.7}
          >
            <View style={styles.cardIdRow}>
              <View style={[styles.avatar, styles.avatarMuted]}>
                <Text style={[styles.avatarText, styles.avatarTextMuted]}>G</Text>
              </View>
              <View style={styles.cardIdText}>
                <Text style={styles.cardEmail}>Sign in with Google</Text>
                <Text style={styles.rowSub}>
                  Back up your identity for future cross-device features
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.card}>
            <View style={styles.cardIdRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(user.name || user.email).trim().charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.cardIdText}>
                <Text style={styles.cardEmail} numberOfLines={1}>
                  {user.email}
                </Text>
                <Text style={styles.rowSub}>Signed in with Google</Text>
              </View>
            </View>
            <View style={styles.balancePanel}>
              <View>
                <Text style={styles.balanceLabel}>Scan credits</Text>
                <Text style={styles.balanceNum}>
                  {balance === null ? '—' : balance}
                  <Text style={styles.balanceUnit}>  scans left</Text>
                </Text>
              </View>
              <TouchableOpacity
                style={styles.getMoreBtn}
                onPress={() => navigation.navigate('Paywall')}
                activeOpacity={0.8}
              >
                <Text style={styles.getMoreText}>Get more</Text>
              </TouchableOpacity>
            </View>
            {__DEV__ && (
              <TouchableOpacity style={styles.devRow} onPress={handleDevTopUp} activeOpacity={0.7}>
                <Text style={styles.devText}>+20 credits · testing only</Text>
                <View style={styles.devChip}>
                  <Text style={styles.devChipText}>DEV</Text>
                </View>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={handleSignOut} activeOpacity={0.7}>
              <Text style={styles.signOutText}>Sign out</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
```

- [ ] **Step 6: Add the card styles.** In the `StyleSheet.create` block, directly after the existing `chevron` entry (line 351), insert:

```tsx
  accountWrap: { marginTop: 24, paddingHorizontal: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardIdRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIdText: { flex: 1, gap: 2 },
  cardEmail: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarMuted: { backgroundColor: '#e2e8f0' },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  avatarTextMuted: { color: '#64748b' },
  balancePanel: {
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  balanceLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: '#60a5fa',
    textTransform: 'uppercase',
  },
  balanceNum: { fontSize: 26, fontWeight: '800', color: '#1d4ed8', marginTop: 2 },
  balanceUnit: { fontSize: 12, fontWeight: '500', color: '#60a5fa' },
  getMoreBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  getMoreText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  devRow: {
    marginTop: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  devText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  devChip: {
    backgroundColor: '#f3e8ff',
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  devChipText: { fontSize: 10, fontWeight: '700', color: '#7c3aed' },
  signOutText: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: '#ef4444',
    marginTop: 14,
    paddingVertical: 4,
  },
```

(The existing `section`/`row`/`rowTitle` styles stay — Backup/Notifications/Support still use them. `rowSub` and `chevron` are reused by the card.)

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (exit 0). Any `pro`/`invoiceCount`/`FREE_INVOICE_LIMIT` reference error means a leftover from Steps 1–5.

- [ ] **Step 8: Bundle-compile check** (confirm Metro is running first — `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8081/status` should print `200`; if not, skip this step and note it):

Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8081/index.bundle?platform=android&dev=true&minify=false"`
Expected: `200`

- [ ] **Step 9: Commit**

```bash
git add src/screens/SettingsScreen.tsx
git commit -m "Redesign the Settings account area as a card with visible credit balance"
```

---

### Task 2: `src/screens/ReviewScreen.tsx` — out-of-credits card

**Files:**
- Modify: `src/screens/ReviewScreen.tsx`

- [ ] **Step 1: Replace the out-of-credits JSX block.** Current (lines 243–255):

```tsx
        {/* Out of credits */}
        {!loading && outOfCredits && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Out of credits</Text>
            <Text style={styles.errorSub}>
              You're out of scan credits. The photo has been saved locally — analyze it later once
              you have more.
            </Text>
            <TouchableOpacity style={styles.laterBtn} onPress={handleSaveForLater}>
              <Text style={styles.laterBtnText}>Save for Later</Text>
            </TouchableOpacity>
          </View>
        )}
```

New (own card, no shared `errorBox`; primary CTA → Paywall; the `{/* Network error */}` block below it is NOT touched):

```tsx
        {/* Out of credits */}
        {!loading && outOfCredits && (
          <View style={styles.creditsBox}>
            <View style={styles.creditsIcon}>
              <Text style={styles.creditsIconGlyph}>🪙</Text>
            </View>
            <Text style={styles.creditsTitle}>Out of scan credits</Text>
            <Text style={styles.creditsSub}>
              Your photo is safe. Get more credits to extract it automatically, or save it for
              later.
            </Text>
            <TouchableOpacity
              style={styles.creditsPrimaryBtn}
              onPress={() => navigation.navigate('Paywall')}
              activeOpacity={0.8}
            >
              <Text style={styles.creditsPrimaryText}>Get more credits</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.creditsGhostBtn}
              onPress={handleSaveForLater}
              activeOpacity={0.7}
            >
              <Text style={styles.creditsGhostText}>Save for later</Text>
            </TouchableOpacity>
          </View>
        )}
```

- [ ] **Step 2: Add the card styles.** In `StyleSheet.create`, directly after the existing `laterBtnText` entry (line 471), insert:

```tsx
  creditsBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  creditsIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  creditsIconGlyph: { fontSize: 24 },
  creditsTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  creditsSub: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  creditsPrimaryBtn: {
    alignSelf: 'stretch',
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
  },
  creditsPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  creditsGhostBtn: {
    alignSelf: 'stretch',
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  creditsGhostText: { color: '#64748b', fontWeight: '600', fontSize: 13 },
```

(`errorBox`/`errorTitle`/`errorSub`/`laterBtn`/`laterBtnText` stay — the network-error block still uses all of them.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (exit 0).

- [ ] **Step 4: Bundle-compile check** (skip with a note if Metro isn't running — same check as Task 1 Step 8):

Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8081/index.bundle?platform=android&dev=true&minify=false"`
Expected: `200`

- [ ] **Step 5: Commit**

```bash
git add src/screens/ReviewScreen.tsx
git commit -m "Restyle the out-of-credits state as its own card with a Get-more CTA"
```

---

### Task 3: On-device verification (human-required)

**Files:** none. Pure JS/TSX changes — the existing dev-client APK + Metro hot reload covers everything; no EAS build needed.

- [ ] **Step 1:** Confirm Metro is running and reachable (`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8081/status` → `200`; restart if not — detached via `Start-Process`, per the established pattern).

- [ ] **Step 2 (human):** Reload the app. Open Settings while signed in:
  - Account card shows avatar initial, email, and the balance panel with a real number (matches what the dev top-up alert used to report).
  - "Get more" opens the Paywall screen.
  - The old "Plan / Free plan · X/50" section is gone.
  - The dashed "+20 credits · testing only" DEV row shows (dev build); tapping it visibly bumps the balance number in place — no alert.

- [ ] **Step 3 (human):** Sign out from the card (red "Sign out" at the card bottom) → the card flips to the "Sign in with Google" state with the muted G avatar. Sign back in → balance reappears after a moment.

- [ ] **Step 4 (human):** Airplane mode, then open Settings → balance shows "—", no error alert. Disable airplane mode.

- [ ] **Step 5 (human):** Drain the balance to 0 (scan repeatedly, topping up as needed to arrange it), then scan once more → Review screen shows the new white "Out of scan credits" card (coin icon, blue "Get more credits" pill, gray "Save for later"), NOT the amber box. "Get more credits" opens the Paywall; back out, and "Save for later" saves a pending invoice as before.

- [ ] **Step 6:** Report back which of Steps 2–5 passed and anything that didn't match.

---

## Plan self-review notes

- **Spec coverage:** identity row + balance panel + dev row + sign out + signed-out card → Task 1 Step 5; balance fetch on focus with silent failure → Task 1 Step 2; dev top-up sets balance from return value → Task 1 Step 4; Plan section deletion incl. unused imports/state → Task 1 Steps 1–3, 5; out-of-credits card with both CTAs → Task 2 Steps 1–2; network-error box untouched → noted in both Task 2 steps; visual spec values → carried verbatim into the style blocks; edge cases (signed-out no fetch via `if (!user) return`, empty name falls back to email initial) → Task 1 Steps 2, 5.
- **Placeholder scan:** none — every step carries the full code.
- **Type consistency:** `balance: number | null` matches `getCreditBalance(): Promise<number>` and the `—` render; style names referenced in JSX all exist in the corresponding style steps (`accountWrap`, `card`, `cardIdRow`, `cardIdText`, `cardEmail`, `avatar`, `avatarMuted`, `avatarText`, `avatarTextMuted`, `balancePanel`, `balanceLabel`, `balanceNum`, `balanceUnit`, `getMoreBtn`, `getMoreText`, `devRow`, `devText`, `devChip`, `devChipText`, `signOutText`; `creditsBox`, `creditsIcon`, `creditsIconGlyph`, `creditsTitle`, `creditsSub`, `creditsPrimaryBtn`, `creditsPrimaryText`, `creditsGhostBtn`, `creditsGhostText`).
- **Known trade-off:** SettingsScreen has no ScrollView; removing the Plan section roughly offsets the card's extra height, so the layout still fits. If a future section addition overflows small screens, wrapping in a ScrollView is a separate change.
