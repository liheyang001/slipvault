import React, { useState, useEffect, useCallback } from 'react';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Linking,
  Alert,
  ActivityIndicator,
  ScrollView,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types/navigation';
import { getSetting, setSetting, getAllInvoices } from '../services/database';
import { scheduleMonthlyReminder, cancelScheduledNotification } from '../services/notifications';
import { createBackup, restoreBackup } from '../services/backup';
import {
  getStoredUser,
  signInWithGoogle,
  signOutGoogle,
  describeSignInError,
  type AuthUser,
} from '../services/auth';
import { getCreditBalance } from '../services/claude';
import {
  TAX_PRESETS,
  getTaxLabel,
  getTaxPercent,
  setTaxSettings,
  refreshTaxSettings,
  type TaxPreset,
} from '../utils/tax';

const FEEDBACK_EMAIL = 'liheyang001@hotmail.com';

/** Android's versionCode / iOS' buildNumber — the only value that distinguishes
 * two builds of the same version, which matters when diagnosing "am I running
 * the build I think I am".
 *
 * Read from the native package, not from expoConfig: with EAS' remote version
 * source the number in app.json is ignored at build time, yet it is still what
 * expoConfig reports. That made this line answer "1" for every build — exactly
 * the confusion it was added to prevent. */
const buildNumber = Application.nativeBuildVersion ?? '';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

export default function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const [monthlyEnabled, setMonthlyEnabled] = useState(false);
  const [busy, setBusy] = useState<'backup' | 'restore' | 'signin' | null>(null);
  const [lastBackup, setLastBackup] = useState('');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [taxLabel, setTaxLabel] = useState('GST');
  const [taxPercent, setTaxPercent] = useState(15);
  const [taxModalVisible, setTaxModalVisible] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [customPercent, setCustomPercent] = useState('');

  useEffect(() => {
    setMonthlyEnabled(getSetting('monthlyNotif', 'false') === 'true');
    setLastBackup(getSetting('lastBackupAt', ''));
    setUser(getStoredUser());
    setTaxLabel(getTaxLabel());
    setTaxPercent(getTaxPercent());
  }, []);

  function applyTax(label: string, percent: number) {
    setTaxSettings(percent, label);
    setTaxLabel(getTaxLabel());
    setTaxPercent(getTaxPercent());
    setTaxModalVisible(false);
  }

  function applyCustomTax() {
    const percent = parseFloat(customPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      Alert.alert('Enter a rate between 0 and 100', 'For example, 15 for a 15% rate.');
      return;
    }
    applyTax(customLabel.trim() || 'Tax', percent);
  }

  function openTaxModal() {
    // Seed the custom fields with what is in force, so tweaking a rate does not
    // mean retyping its name.
    setCustomLabel(taxLabel);
    setCustomPercent(String(taxPercent));
    setTaxModalVisible(true);
  }

  const isPresetActive = (p: TaxPreset) => p.label === taxLabel && p.percent === taxPercent;

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

  function formatBackupDate(iso: string): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    return new Date(t).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  async function handleMonthlyToggle(value: boolean) {
    setMonthlyEnabled(value);
    setSetting('monthlyNotif', value ? 'true' : 'false');

    const existingId = getSetting('monthlyNotifId', '');
    if (existingId) {
      await cancelScheduledNotification(existingId).catch(() => {});
      setSetting('monthlyNotifId', '');
    }

    if (value) {
      const invoices = getAllInvoices();
      const now = new Date();
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const monthInvoices = invoices.filter((inv) => inv.date?.startsWith(thisMonth));
      const total = monthInvoices.reduce((s, inv) => s + inv.total, 0);

      const id = await scheduleMonthlyReminder(monthInvoices.length, total).catch(() => null);
      if (id) setSetting('monthlyNotifId', id);

      Alert.alert('Monthly Summary On', "You'll receive a summary on the 1st of each month.");
    }
  }

  /** The backup zip is not encrypted, and it carries the most sensitive things
   * the app holds: receipt photos, amounts, and serial numbers. Once the share
   * sheet opens the file is already on its way out, so consent has to be asked
   * for before it is written, not after. */
  function handleBackup() {
    if (busy) return;
    Alert.alert(
      'Back up now',
      'The backup file contains your receipt photos, amounts and serial numbers, and is not password-protected. Keep it somewhere private — treat it like the documents themselves.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: runBackup },
      ]
    );
  }

  async function runBackup() {
    setBusy('backup');
    try {
      const count = await createBackup();
      setLastBackup(getSetting('lastBackupAt', ''));
      // Share sheet handles the rest; nothing to confirm here.
      if (count === 0) Alert.alert('Backup created', 'Note: you have no invoices yet.');
    } catch {
      Alert.alert('Backup failed', 'Could not create the backup. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  function handleRestore() {
    if (busy) return;
    Alert.alert(
      'Restore from backup',
      'Pick a Vesta backup zip. Invoices with the same ID will be overwritten; everything else is merged.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Choose file',
          onPress: async () => {
            setBusy('restore');
            try {
              const result = await restoreBackup();
              if (result) {
                // The restore replaced the settings table, so the cached tax
                // rate is now stale.
                refreshTaxSettings();
                setTaxLabel(getTaxLabel());
                setTaxPercent(getTaxPercent());
                Alert.alert(
                  'Restore complete',
                  `${result.invoices} invoice${result.invoices !== 1 ? 's' : ''} restored.`
                );
              }
            } catch (e: any) {
              Alert.alert('Restore failed', e?.message ?? 'Could not read that backup file.');
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  }

  async function handleFeedback() {
    const url = `mailto:${FEEDBACK_EMAIL}?subject=Invoice%20Reader%20Feedback`;
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      Linking.openURL(url);
    } else {
      Alert.alert(
        'Send Feedback',
        `Please email us at:\n\n${FEEDBACK_EMAIL}`,
        [{ text: 'OK' }]
      );
    }
  }

  async function handleSignIn() {
    if (busy) return; // double-tap guard: a second signIn() rejects with IN_PROGRESS
    setBusy('signin');
    try {
      const signedIn = await signInWithGoogle();
      if (signedIn) setUser(signedIn);
    } catch (err) {
      Alert.alert('Sign-in failed', describeSignInError(err));
    } finally {
      setBusy(null);
    }
  }

  function handleSignOut() {
    Alert.alert('Sign out', 'Your invoices stay on this device. Sign out of Google?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOutGoogle();
          setUser(null);
          setBalance(null);
        },
      },
    ]);
  }


  return (
    <SafeAreaView style={styles.container}>
      {/* Scrolls: the sections outgrew the screen, putting the version line —
          and anything added later — permanently out of reach. */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
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
            <TouchableOpacity onPress={handleSignOut} activeOpacity={0.7}>
              <Text style={styles.signOutText}>Sign out</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Backup */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Backup</Text>
        <TouchableOpacity style={styles.row} onPress={handleBackup} disabled={busy !== null}>
          <View style={styles.rowContent}>
            <Text style={styles.rowTitle}>Back up now</Text>
            <Text style={styles.rowSub}>
              {lastBackup
                ? `Last backup: ${formatBackupDate(lastBackup)}`
                : 'Never backed up — bundle everything into a zip for Google Drive, email, anywhere'}
            </Text>
          </View>
          {busy === 'backup' ? (
            <ActivityIndicator size="small" color="#2563eb" />
          ) : (
            <Text style={styles.chevron}>›</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.row} onPress={handleRestore} disabled={busy !== null}>
          <View style={styles.rowContent}>
            <Text style={styles.rowTitle}>Restore from backup</Text>
            <Text style={styles.rowSub}>Import a previously exported backup zip</Text>
          </View>
          {busy === 'restore' ? (
            <ActivityIndicator size="small" color="#2563eb" />
          ) : (
            <Text style={styles.chevron}>›</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Notifications</Text>

        <View style={styles.row}>
          <View style={styles.rowContent}>
            <Text style={styles.rowTitle}>Monthly Summary</Text>
            <Text style={styles.rowSub}>
              Get a recap of your spending on the 1st of each month
            </Text>
          </View>
          <Switch
            value={monthlyEnabled}
            onValueChange={handleMonthlyToggle}
            trackColor={{ true: '#2563eb' }}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Tax</Text>

        <TouchableOpacity style={styles.row} onPress={openTaxModal}>
          <View style={styles.rowContent}>
            <Text style={styles.rowTitle}>Sales Tax</Text>
            <Text style={styles.rowSub}>
              Splits an amount into excl./incl. figures. Saved items keep the
              values they were stored with.
            </Text>
          </View>
          <Text style={styles.taxBadge}>
            {taxLabel} {taxPercent}%
          </Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={taxModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTaxModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBg}
          activeOpacity={1}
          onPress={() => setTaxModalVisible(false)}
        >
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Sales tax</Text>
            <Text style={styles.modalSub}>
              Rates and names differ by country. Pick one, or set your own.
            </Text>

            <ScrollView style={styles.taxList} keyboardShouldPersistTaps="handled">
              {TAX_PRESETS.map((p) => (
                <TouchableOpacity
                  key={`${p.country}-${p.percent}`}
                  style={[styles.taxRow, isPresetActive(p) && styles.taxRowActive]}
                  onPress={() => applyTax(p.label, p.percent)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.taxCountry}>{p.country}</Text>
                  <Text style={[styles.taxRate, isPresetActive(p) && styles.taxRateActive]}>
                    {p.percent === 0 ? '—' : `${p.label} ${p.percent}%`}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.taxCustom}>
              <Text style={styles.taxCustomLabel}>Custom</Text>
              <View style={styles.taxCustomRow}>
                <TextInput
                  style={[styles.taxInput, styles.taxInputName]}
                  value={customLabel}
                  onChangeText={setCustomLabel}
                  placeholder="VAT"
                  placeholderTextColor="#9ca3af"
                  autoCapitalize="characters"
                  maxLength={12}
                />
                <View style={styles.taxPercentWrap}>
                  <TextInput
                    style={[styles.taxInput, styles.taxInputPercent]}
                    value={customPercent}
                    onChangeText={setCustomPercent}
                    placeholder="0"
                    placeholderTextColor="#9ca3af"
                    keyboardType="decimal-pad"
                    maxLength={5}
                  />
                  <Text style={styles.taxPercentSign}>%</Text>
                </View>
                <TouchableOpacity style={styles.taxApply} onPress={applyCustomTax}>
                  <Text style={styles.taxApplyText}>Set</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={styles.modalClose}
              onPress={() => setTaxModalVisible(false)}
            >
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

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

      {/* Read from the manifest so it can never drift from app.json, and show
          the build number too — version alone cannot tell two builds apart. */}
      <Text style={styles.version}>
        Vesta v{Constants.expoConfig?.version ?? '?'}
        {buildNumber ? ` (${buildNumber})` : ''}
      </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { paddingBottom: 24 },

  section: {
    backgroundColor: '#fff',
    marginTop: 24,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#f1f5f9',
    paddingHorizontal: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingVertical: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    gap: 12,
  },
  rowContent: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  rowSub: { fontSize: 12, color: '#94a3b8', lineHeight: 18 },
  chevron: { fontSize: 22, color: '#cbd5e1', fontWeight: '300' },

  // Tax rate picker
  taxBadge: { fontSize: 14, fontWeight: '700', color: '#2563eb' },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 10 },
  modalTitle: { fontSize: 19, fontWeight: '800', color: '#0f172a' },
  modalSub: { fontSize: 13, color: '#94a3b8', fontWeight: '500', marginTop: -6 },
  // Capped so the custom row stays reachable without scrolling the whole card.
  taxList: { maxHeight: 260 },
  taxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  taxRowActive: { backgroundColor: '#eff6ff' },
  taxCountry: { fontSize: 15, color: '#0f172a', fontWeight: '600' },
  taxRate: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  taxRateActive: { color: '#2563eb', fontWeight: '800' },
  taxCustom: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 14, gap: 8 },
  taxCustomLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  taxCustomRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  taxInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 15,
    color: '#0f172a',
    fontWeight: '600',
  },
  taxInputName: { flex: 1 },
  taxPercentWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  taxInputPercent: { width: 68, textAlign: 'right' },
  taxPercentSign: { fontSize: 15, color: '#64748b', fontWeight: '700' },
  taxApply: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingHorizontal: 18,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taxApplyText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  modalClose: { alignItems: 'center', paddingVertical: 12, marginTop: 2 },
  modalCloseText: { fontSize: 15, fontWeight: '700', color: '#64748b' },

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
  signOutText: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: '#ef4444',
    marginTop: 14,
    paddingVertical: 4,
  },

  version: {
    textAlign: 'center',
    marginTop: 40,
    fontSize: 12,
    color: '#cbd5e1',
  },
});
