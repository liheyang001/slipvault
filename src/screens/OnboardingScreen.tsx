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
