import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types/navigation';
import { extractInvoiceData, ExtractedInvoiceData } from '../services/claude';
import { processInvoiceImage } from '../services/imageProcessor';
import { insertInvoice, findDuplicateInvoice, updateInvoice } from '../services/database';
import { scheduleWarrantyReminder } from '../services/notifications';
import { DEFAULT_CATEGORIES, capitalize } from '../utils/categories';

const WARRANTY_OPTIONS = [
  { label: 'None', months: 0 },
  { label: '1 Year', months: 12 },
  { label: '2 Years', months: 24 },
  { label: '3 Years', months: 36 },
];

type Props = NativeStackScreenProps<RootStackParamList, 'Review'>;

export default function ReviewScreen({ route, navigation }: Props) {
  const { photoUri, queue = [] } = route.params;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedInvoiceData | null>(null);
  const [networkError, setNetworkError] = useState(false);

  // Editable fields
  const [vendor, setVendor] = useState('');
  const [date, setDate] = useState('');
  const [category, setCategory] = useState('');
  const [warrantyMonths, setWarrantyMonths] = useState(0);

  useEffect(() => {
    runExtraction();
  }, [photoUri]);

  async function runExtraction() {
    setLoading(true);
    setNetworkError(false);

    try {
      const processed = await processInvoiceImage(photoUri);
      const data = await extractInvoiceData(processed.base64);

      if (!data.isInvoice) {
        Alert.alert(
          'Not an Invoice',
          "This doesn't look like a receipt or invoice. Save it anyway?",
          [
            { text: 'Discard', style: 'cancel', onPress: () => navigation.goBack() },
            {
              text: 'Save Anyway',
              onPress: () => {
                applyExtracted(data);
                setLoading(false);
              },
            },
          ]
        );
        return;
      }

      applyExtracted(data);
    } catch {
      setNetworkError(true);
    } finally {
      setLoading(false);
    }
  }

  function applyExtracted(data: ExtractedInvoiceData) {
    setExtracted(data);
    setVendor(data.vendor || '');
    setDate(data.date || new Date().toISOString().slice(0, 10));
    setCategory(data.category || 'other');
  }

  async function handleSave() {
    const resolvedVendor = vendor.trim() || 'Unknown';
    const resolvedDate = date.trim() || new Date().toISOString().slice(0, 10);
    const resolvedTotal = extracted?.total ?? 0;

    const duplicate = findDuplicateInvoice(resolvedVendor, resolvedDate, resolvedTotal);
    if (duplicate) {
      const confirmed = await new Promise<boolean>((resolve) =>
        Alert.alert(
          'Possible Duplicate',
          `An invoice from "${resolvedVendor}" on ${resolvedDate} for $${resolvedTotal.toFixed(2)} already exists. Add it again?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Add Anyway', onPress: () => resolve(true) },
          ]
        )
      );
      if (!confirmed) return;
    }

    setSaving(true);
    try {
      const invoice = insertInvoice({
        photoUri,
        ocrText: '',
        vendor: resolvedVendor,
        date: resolvedDate,
        items: extracted?.items ?? [],
        subtotal: extracted?.subtotal ?? 0,
        tax: extracted?.tax ?? 0,
        total: resolvedTotal,
        category: category || 'other',
        tags: [],
        status: 'done',
        warrantyMonths,
      });

      if (warrantyMonths > 0) {
        scheduleWarrantyReminder(invoice.id, resolvedVendor, resolvedDate, warrantyMonths)
          .then((notifId) => {
            if (notifId) updateInvoice(invoice.id, { warrantyNotifId: notifId });
          })
          .catch(() => {});
      }

      if (queue.length > 0) {
        navigation.replace('Review', { photoUri: queue[0], queue: queue.slice(1) });
      } else {
        navigation.replace('InvoiceDetail', { invoiceId: invoice.id });
      }
    } catch {
      Alert.alert('Error', 'Failed to save invoice. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleSaveForLater() {
    insertInvoice({
      photoUri,
      ocrText: '',
      vendor: '',
      date: new Date().toISOString().slice(0, 10),
      items: [],
      subtotal: 0,
      tax: 0,
      total: 0,
      category: '',
      tags: [],
      status: 'pending',
    });

    if (queue.length > 0) {
      navigation.replace('Review', { photoUri: queue[0], queue: queue.slice(1) });
    } else {
      navigation.replace('Home');
    }
  }

  const remaining = queue.length;
  const saveLabel = saving
    ? 'Saving...'
    : remaining > 0
    ? `Save & Next (${remaining} left)`
    : 'Save Invoice';

  return (
    <View style={styles.container}>
      {/* Photo */}
      <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />

      {/* Progress badge for batch */}
      {remaining > 0 && (
        <View style={styles.batchBadge}>
          <Text style={styles.batchBadgeText}>{remaining + 1} photos left</Text>
        </View>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Loading */}
        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#2563eb" />
            <Text style={styles.loadingText}>Analyzing invoice...</Text>
          </View>
        )}

        {/* Network error */}
        {!loading && networkError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>No network connection</Text>
            <Text style={styles.errorSub}>
              The photo has been saved locally. You can analyze it later when you're back online.
            </Text>
            <TouchableOpacity style={styles.laterBtn} onPress={handleSaveForLater}>
              <Text style={styles.laterBtnText}>Save for Later</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Extracted fields */}
        {!loading && extracted && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Review & Edit</Text>

              <View style={styles.field}>
                <Text style={styles.label}>Merchant</Text>
                <TextInput
                  style={styles.input}
                  value={vendor}
                  onChangeText={setVendor}
                  placeholder="Merchant name"
                  placeholderTextColor="#9ca3af"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Date</Text>
                <TextInput
                  style={styles.input}
                  value={date}
                  onChangeText={setDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#9ca3af"
                  keyboardType="numbers-and-punctuation"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Category</Text>
                <View style={styles.chips}>
                  {DEFAULT_CATEGORIES.map((cat) => (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.chip, category === cat && styles.chipActive]}
                      onPress={() => setCategory(cat)}
                    >
                      <Text style={[styles.chipText, category === cat && styles.chipTextActive]}>
                        {capitalize(cat)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Warranty</Text>
                <View style={styles.chips}>
                  {WARRANTY_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.months}
                      style={[styles.chip, warrantyMonths === opt.months && styles.chipActive]}
                      onPress={() => setWarrantyMonths(opt.months)}
                    >
                      <Text style={[styles.chipText, warrantyMonths === opt.months && styles.chipTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Amounts</Text>
              <View style={styles.amountRow}>
                <Text style={styles.amountLabel}>Subtotal</Text>
                <Text style={styles.amountValue}>${extracted.subtotal.toFixed(2)}</Text>
              </View>
              <View style={styles.amountRow}>
                <Text style={styles.amountLabel}>Tax</Text>
                <Text style={styles.amountValue}>${extracted.tax.toFixed(2)}</Text>
              </View>
              <View style={[styles.amountRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>${extracted.total.toFixed(2)}</Text>
              </View>
            </View>

            {extracted.items.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Items</Text>
                {extracted.items.map((item, i) => (
                  <View key={i} style={styles.itemRow}>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.itemPrice}>
                      {item.quantity > 1 ? `×${item.quantity}  ` : ''}${item.totalPrice.toFixed(2)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Bottom controls */}
      {!loading && (
        <View style={styles.controls}>
          <TouchableOpacity
            style={styles.retakeBtn}
            onPress={() => navigation.goBack()}
            disabled={saving}
          >
            <Text style={styles.retakeBtnText}>Retake</Text>
          </TouchableOpacity>

          {!networkError && (
            <TouchableOpacity
              style={[styles.saveBtn, (!extracted || saving) && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!extracted || saving}
            >
              <Text style={styles.saveBtnText}>{saveLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  photo: { width: '100%', height: 200, backgroundColor: '#e5e7eb' },
  batchBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  batchBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12 },

  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 20,
    justifyContent: 'center',
  },
  loadingText: { fontSize: 15, color: '#6b7280' },

  errorBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    gap: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
  },
  errorTitle: { fontSize: 16, fontWeight: '700', color: '#92400e' },
  errorSub: { fontSize: 14, color: '#78716c', lineHeight: 20 },
  laterBtn: {
    marginTop: 8,
    backgroundColor: '#f59e0b',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  laterBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#6b7280', letterSpacing: 0.5 },

  field: { gap: 6 },
  label: { fontSize: 12, color: '#9ca3af', fontWeight: '600' },
  input: {
    fontSize: 16,
    color: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingBottom: 6,
  },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#f9fafb',
  },
  chipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipText: { fontSize: 13, color: '#374151' },
  chipTextActive: { color: '#fff', fontWeight: '600' },

  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 10,
    marginTop: 4,
  },
  amountLabel: { fontSize: 14, color: '#6b7280' },
  amountValue: { fontSize: 14, color: '#374151' },
  totalLabel: { fontSize: 16, fontWeight: '700', color: '#111827' },
  totalValue: { fontSize: 16, fontWeight: '700', color: '#2563eb' },

  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  itemName: { flex: 1, fontSize: 13, color: '#374151', marginRight: 8 },
  itemPrice: { fontSize: 13, color: '#6b7280' },

  controls: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  retakeBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
  },
  retakeBtnText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  saveBtn: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#2563eb',
  },
  saveBtnDisabled: { backgroundColor: '#93c5fd' },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
