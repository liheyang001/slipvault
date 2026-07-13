import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types/navigation';
import {
  isProUser,
  setProUser,
  getInvoiceCount,
  FREE_INVOICE_LIMIT,
} from '../services/database';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Paywall'>;

// Display only — the real price is configured in Play Console (Phase 2 / RevenueCat).
const PRICE_LABEL = '$2.99 / month';

const BENEFITS: [string, string, string][] = [
  ['∞', 'Unlimited invoices', `Free plan stores up to ${FREE_INVOICE_LIMIT} — Pro removes the cap`],
  ['🛡️', 'Full insurance archive', 'Document every room without limits'],
  ['☁️', 'Cloud backup', 'Coming soon — survive a lost or broken phone'],
  ['❤️', 'Support development', 'Keep Slipvault independent and privacy-first'],
];

export default function PaywallScreen() {
  const navigation = useNavigation<Nav>();
  const [pro, setPro] = useState(false);
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setPro(isProUser());
      setCount(getInvoiceCount());
    }, [])
  );

  function handleSubscribe() {
    // Phase 2 will launch the real purchase flow (RevenueCat / Play Billing).
    Alert.alert(
      'Almost there',
      'Payments are being set up and will arrive in the next update. Thanks for your interest!'
    );
  }

  /** Dev-only escape hatch: long-press the button to toggle Pro for testing gates. */
  function handleDevToggle() {
    if (!__DEV__) return;
    const next = !isProUser();
    setProUser(next);
    setPro(next);
    Alert.alert('DEV', `Pro is now ${next ? 'ON' : 'OFF'}`);
  }

  const used = Math.min(count, FREE_INVOICE_LIMIT);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heroIcon}>🛡️</Text>
      <Text style={styles.title}>Slipvault Pro</Text>
      <Text style={styles.subtitle}>
        Your whole home, documented and insurance-ready.
      </Text>

      {/* Usage meter (free users) */}
      {!pro && (
        <View style={styles.usageBox}>
          <View style={styles.usageTrack}>
            <View
              style={[styles.usageFill, { width: `${(used / FREE_INVOICE_LIMIT) * 100}%` }]}
            />
          </View>
          <Text style={styles.usageText}>
            {count} of {FREE_INVOICE_LIMIT} free invoices used
          </Text>
        </View>
      )}

      {pro && (
        <View style={styles.proBadge}>
          <Text style={styles.proBadgeText}>✓ You're Pro — thank you!</Text>
        </View>
      )}

      {/* Benefits */}
      <View style={styles.benefits}>
        {BENEFITS.map(([icon, title, sub]) => (
          <View key={title} style={styles.benefitRow}>
            <Text style={styles.benefitIcon}>{icon}</Text>
            <View style={styles.benefitText}>
              <Text style={styles.benefitTitle}>{title}</Text>
              <Text style={styles.benefitSub}>{sub}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* CTA */}
      {!pro && (
        <>
          <TouchableOpacity
            style={styles.cta}
            onPress={handleSubscribe}
            onLongPress={handleDevToggle}
            activeOpacity={0.85}
          >
            <Text style={styles.ctaText}>Subscribe · {PRICE_LABEL}</Text>
          </TouchableOpacity>
          <Text style={styles.finePrint}>
            Cancel anytime in Google Play. Your existing invoices always stay accessible, even
            without Pro.
          </Text>
        </>
      )}

      <TouchableOpacity style={styles.laterBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.laterText}>{pro ? 'Close' : 'Maybe later'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 28, paddingTop: 36, alignItems: 'center', gap: 0 },

  heroIcon: { fontSize: 56 },
  title: { fontSize: 28, fontWeight: '800', color: '#fff', marginTop: 10, letterSpacing: -0.5 },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },

  usageBox: { width: '100%', marginTop: 24, gap: 8 },
  usageTrack: {
    height: 8,
    backgroundColor: '#1e293b',
    borderRadius: 4,
    overflow: 'hidden',
  },
  usageFill: { height: '100%', backgroundColor: '#f59e0b', borderRadius: 4 },
  usageText: { fontSize: 12, color: '#cbd5e1', textAlign: 'center', fontWeight: '600' },

  proBadge: {
    marginTop: 24,
    backgroundColor: '#065f46',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  proBadgeText: { color: '#6ee7b7', fontWeight: '700', fontSize: 14 },

  benefits: { width: '100%', marginTop: 28, gap: 18 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  benefitIcon: { fontSize: 24, width: 34, textAlign: 'center' },
  benefitText: { flex: 1, gap: 2 },
  benefitTitle: { fontSize: 15, fontWeight: '700', color: '#f1f5f9' },
  benefitSub: { fontSize: 12, color: '#94a3b8', lineHeight: 17 },

  cta: {
    width: '100%',
    backgroundColor: '#2563eb',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 30,
  },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  finePrint: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 16,
  },

  laterBtn: { marginTop: 18, padding: 10 },
  laterText: { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
});
