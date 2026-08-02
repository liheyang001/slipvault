import React, { useState, useEffect, useCallback } from 'react';
import Constants from 'expo-constants';
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

const FEEDBACK_EMAIL = 'liheyang001@hotmail.com';

/** Android's versionCode / iOS' buildNumber — the only value that distinguishes
 * two builds of the same version, which matters when diagnosing "am I running
 * the build I think I am". */
const buildNumber =
  Constants.expoConfig?.android?.versionCode ?? Constants.expoConfig?.ios?.buildNumber ?? '';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

export default function SettingsScreen() {
  const navigation = useNavigation<Nav>();
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
