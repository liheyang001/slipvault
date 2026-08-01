import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { PurchasesStoreProduct } from 'react-native-purchases';
import { RootStackParamList } from '../types/navigation';
import { getCreditBalance, waitForBalanceIncrease } from '../services/claude';
import {
  getCreditPacks,
  buyPack,
  isUserCancelled,
  linkPurchasesToUser,
  syncPendingPurchases,
} from '../services/purchases';
import { getStoredUser, signInWithGoogle } from '../services/auth';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Paywall'>;

/** Credits per pack, keyed by store product ID. Display only — the ledger is
 * credited server-side from the same mapping, which is the authoritative one. */
const PACK_CREDITS: Record<string, number> = {
  credits_30: 30,
  credits_100: 100,
  credits_300: 300,
};
const BEST_VALUE_ID = 'credits_100';

export default function PaywallScreen() {
  const navigation = useNavigation<Nav>();
  const [balance, setBalance] = useState<number | null>(null);
  const [packs, setPacks] = useState<PurchasesStoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBalance(await getCreditBalance());
    } catch {
      setBalance(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        // Recover any purchase the store completed but RevenueCat never saw.
        // This screen is where someone lands when credits did not arrive, so
        // it is the right place to retry before showing them a balance.
        await syncPendingPurchases();
        await refresh();
        try {
          const available = await getCreditPacks();
          if (!cancelled) setPacks(available);
        } catch {
          if (!cancelled) setPacks([]);
        }
        if (!cancelled) setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [refresh])
  );

  /** Credits are keyed to the Google account, and RevenueCat must be told that
   * same account id before a purchase — otherwise it reports an anonymous
   * buyer and the server refuses to credit it. Linking is idempotent, so this
   * runs on every purchase rather than only at the moment of signing in. */
  async function ensureLinkedIdentity(): Promise<boolean> {
    let user = getStoredUser();
    if (!user) {
      try {
        user = await signInWithGoogle();
      } catch {
        Alert.alert('Sign-in failed', 'Please check your connection and try again.');
        return false;
      }
      if (!user) return false;
    }
    await linkPurchasesToUser(user.id);
    return true;
  }

  async function handleBuy(pack: PurchasesStoreProduct) {
    if (busyId) return;
    // Claimed before the first await: sign-in can take seconds, and the button
    // would otherwise stay live for a second tap.
    setBusyId(pack.identifier);
    try {
      if (!(await ensureLinkedIdentity())) return;

      // A trustworthy baseline is required to tell whether the purchase landed.
      let before = balance;
      if (before === null) {
        try {
          before = await getCreditBalance();
          setBalance(before);
        } catch {
          before = null;
        }
      }

      await buyPack(pack);

      // Payment succeeded. The credits arrive via RevenueCat's webhook, so
      // watch the balance rather than assuming.
      const expected = PACK_CREDITS[pack.identifier] ?? 1;
      const updated =
        before === null ? null : await waitForBalanceIncrease(before, expected);

      if (updated !== null) {
        setBalance(updated);
        Alert.alert('Credits added', `You now have ${updated} scan credits.`);
      } else {
        // Either no baseline to compare against, or they have not landed yet.
        // Both are "check again shortly", never "confirmed".
        await refresh();
        Alert.alert(
          'Payment received',
          'Your credits will arrive shortly. Tap Refresh balance in a moment to check.'
        );
      }
    } catch (err) {
      if (!isUserCancelled(err)) {
        Alert.alert('Purchase failed', 'No charge was made. Please try again.');
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heroIcon}>🪙</Text>
      <Text style={styles.title}>Scan credits</Text>
      <Text style={styles.subtitle}>
        One credit per AI scan. Adding items by hand is always free.
      </Text>

      <View style={styles.balanceBox}>
        <Text style={styles.balanceLabel}>YOUR BALANCE</Text>
        <Text style={styles.balanceValue}>{balance === null ? '—' : balance}</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loader} color="#60a5fa" />
      ) : packs.length === 0 ? (
        <Text style={styles.unavailable}>
          Credit packs are unavailable right now. Check your connection and try again.
        </Text>
      ) : (
        <View style={styles.packs}>
          {packs.map((pack) => {
            const productId = pack.identifier;
            const credits = PACK_CREDITS[productId];
            const isBest = productId === BEST_VALUE_ID;
            return (
              <TouchableOpacity
                key={productId}
                style={[styles.pack, isBest && styles.packBest]}
                onPress={() => handleBuy(pack)}
                disabled={busyId !== null}
                activeOpacity={0.85}
              >
                <View style={styles.packMain}>
                  <Text style={styles.packCredits}>
                    {credits ? `${credits} credits` : pack.title}
                  </Text>
                  {isBest && <Text style={styles.packBadge}>BEST VALUE</Text>}
                </View>
                {busyId === productId ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.packPrice}>{pack.priceString}</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <TouchableOpacity style={styles.refreshBtn} onPress={refresh} disabled={busyId !== null}>
        <Text style={styles.refreshText}>Refresh balance</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.laterBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.laterText}>Maybe later</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 28, paddingTop: 36, alignItems: 'center' },

  heroIcon: { fontSize: 52 },
  title: { fontSize: 26, fontWeight: '800', color: '#fff', marginTop: 10, letterSpacing: -0.5 },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },

  balanceBox: {
    marginTop: 24,
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 40,
  },
  balanceLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#60a5fa',
  },
  balanceValue: { fontSize: 40, fontWeight: '800', color: '#fff', marginTop: 4 },

  loader: { marginTop: 30 },
  unavailable: {
    marginTop: 30,
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 19,
  },

  packs: { width: '100%', marginTop: 26, gap: 12 },
  pack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e293b',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  packBest: { borderColor: '#2563eb' },
  packMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  packCredits: { fontSize: 16, fontWeight: '700', color: '#f1f5f9' },
  packBadge: {
    fontSize: 9,
    fontWeight: '800',
    color: '#93c5fd',
    backgroundColor: '#1d4ed8',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  packPrice: { fontSize: 16, fontWeight: '800', color: '#fff' },

  refreshBtn: { marginTop: 24, padding: 10 },
  refreshText: { color: '#60a5fa', fontSize: 14, fontWeight: '700' },
  laterBtn: { marginTop: 4, padding: 10 },
  laterText: { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
});
