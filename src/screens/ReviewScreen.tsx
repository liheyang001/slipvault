import React, { useState, useEffect, useRef } from 'react';
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
  Animated,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types/navigation';
import { extractInvoiceData, ExtractedInvoiceData, InsufficientCreditsError } from '../services/claude';
import { processInvoiceImage } from '../services/imageProcessor';
import { insertInvoice, findDuplicateInvoice, updateInvoice, getUserRooms, saveUserRoom } from '../services/database';
import { scheduleWarrantyReminder } from '../services/notifications';
import { DEFAULT_CATEGORIES, capitalize } from '../utils/categories';
import { mergeRooms, capitalizeRoom, normalizeRoom, roomIcon } from '../utils/rooms';

const WARRANTY_OPTIONS = [
  { label: 'None', months: 0 },
  { label: '1 Year', months: 12 },
  { label: '2 Years', months: 24 },
  { label: '3 Years', months: 36 },
];

type Props = NativeStackScreenProps<RootStackParamList, 'Review'>;

export default function ReviewScreen({ route, navigation }: Props) {
  const { photoUri, queue = [], defaultRoom } = route.params;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedInvoiceData | null>(null);
  const [networkError, setNetworkError] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const [vendor, setVendor] = useState('');
  const [date, setDate] = useState('');
  const [category, setCategory] = useState('');
  const [room, setRoom] = useState(defaultRoom ?? ''); // pre-filled when scanning from a room
  const [roomPresets, setRoomPresets] = useState<string[]>(mergeRooms([]));
  const [warrantyMonths, setWarrantyMonths] = useState(0);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const progressAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    runExtraction();
  }, [photoUri]);

  useEffect(() => {
    setRoomPresets(mergeRooms(getUserRooms()));
  }, []);

  function startProgress() {
    progressAnim.setValue(0);
    progressAnimRef.current = Animated.timing(progressAnim, {
      toValue: 0.88,
      duration: 14000,
      useNativeDriver: false,
    });
    progressAnimRef.current.start();
  }

  function finishProgress() {
    progressAnimRef.current?.stop();
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }

  async function runExtraction() {
    setLoading(true);
    setNetworkError(false);
    setOutOfCredits(false);
    startProgress();

    try {
      const processed = await processInvoiceImage(photoUri);
      const data = await extractInvoiceData(processed.base64);
      finishProgress();

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
    } catch (err) {
      finishProgress();
      if (err instanceof InsufficientCreditsError) {
        setOutOfCredits(true);
      } else {
        setNetworkError(true);
      }
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

    const resolvedRoom = normalizeRoom(room);
    if (resolvedRoom) saveUserRoom(resolvedRoom);

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
        room: resolvedRoom,
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
        navigation.replace('Review', { photoUri: queue[0], queue: queue.slice(1), defaultRoom });
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
      navigation.replace('Review', { photoUri: queue[0], queue: queue.slice(1), defaultRoom });
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

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />

      {remaining > 0 && (
        <View style={styles.batchBadge}>
          <Text style={styles.batchBadgeText}>{remaining + 1} photos left</Text>
        </View>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Progress bar */}
        {loading && (
          <View style={styles.progressContainer}>
            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
            </View>
            <Text style={styles.loadingText}>Analyzing invoice...</Text>
          </View>
        )}

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
                <Text style={styles.label}>Purchase Date</Text>
                <TextInput
                  style={styles.input}
                  value={date}
                  onChangeText={setDate}
                  placeholder="YYYY-MM-DD or YYYY-MM-DD HH:MM"
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
                <Text style={styles.label}>Room (for insurance)</Text>
                <TextInput
                  style={styles.input}
                  value={room}
                  onChangeText={setRoom}
                  placeholder="e.g. Living Room, Kids Room..."
                  placeholderTextColor="#9ca3af"
                  autoCapitalize="words"
                />
                <View style={styles.chips}>
                  {roomPresets.map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={[styles.chip, normalizeRoom(room) === r && styles.chipActive]}
                      onPress={() => setRoom(r)}
                    >
                      <Text style={styles.chipIcon}>{roomIcon(r)}</Text>
                      <Text style={[styles.chipText, normalizeRoom(room) === r && styles.chipTextActive]}>
                        {capitalizeRoom(r)}
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
                <View>
                  <Text style={styles.amountLabel}>Excl. GST</Text>
                  <Text style={styles.amountValue}>${extracted.subtotal.toFixed(2)}</Text>
                </View>
                <View style={styles.amountColRight}>
                  <Text style={styles.amountLabel}>Incl. GST</Text>
                  <Text style={styles.totalValue}>${extracted.total.toFixed(2)}</Text>
                </View>
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

      {!loading && (
        <View style={styles.controls}>
          <TouchableOpacity
            style={styles.retakeBtn}
            onPress={() => navigation.goBack()}
            disabled={saving}
          >
            <Text style={styles.retakeBtnText}>Retake</Text>
          </TouchableOpacity>

          {!networkError && !outOfCredits && (
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

  progressContainer: {
    padding: 20,
    gap: 12,
    alignItems: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 6,
    backgroundColor: '#e5e7eb',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 3,
  },
  loadingText: { fontSize: 14, color: '#6b7280' },

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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#f9fafb',
  },
  chipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipIcon: { fontSize: 12 },
  chipText: { fontSize: 13, color: '#374151' },
  chipTextActive: { color: '#fff', fontWeight: '600' },

  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  amountColRight: { alignItems: 'flex-end' },
  amountLabel: { fontSize: 12, color: '#6b7280', marginBottom: 2 },
  amountValue: { fontSize: 16, color: '#374151', fontWeight: '600' },
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
