import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Linking,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types/navigation';
import {
  getSetting,
  setSetting,
  getAllInvoices,
  isProUser,
  getInvoiceCount,
  FREE_INVOICE_LIMIT,
} from '../services/database';
import { scheduleMonthlyReminder, cancelScheduledNotification } from '../services/notifications';
import { createBackup, restoreBackup } from '../services/backup';

const FEEDBACK_EMAIL = 'liheyang001@hotmail.com';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

export default function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const [monthlyEnabled, setMonthlyEnabled] = useState(false);
  const [pro, setPro] = useState(false);
  const [invoiceCount, setInvoiceCount] = useState(0);
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [lastBackup, setLastBackup] = useState('');

  useEffect(() => {
    setMonthlyEnabled(getSetting('monthlyNotif', 'false') === 'true');
    setPro(isProUser());
    setInvoiceCount(getInvoiceCount());
    setLastBackup(getSetting('lastBackupAt', ''));
  }, []);

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

  async function handleBackup() {
    if (busy) return;
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
      'Pick a Slipvault backup zip. Invoices with the same ID will be overwritten; everything else is merged.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Choose file',
          onPress: async () => {
            setBusy('restore');
            try {
              const result = await restoreBackup();
              if (result) {
                setInvoiceCount(getInvoiceCount());
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

  return (
    <SafeAreaView style={styles.container}>
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

      <Text style={styles.version}>Slipvault v1.0.0</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },

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

  version: {
    textAlign: 'center',
    marginTop: 40,
    fontSize: 12,
    color: '#cbd5e1',
  },
});
