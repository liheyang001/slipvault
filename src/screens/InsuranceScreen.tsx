import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types/navigation';
import {
  searchInvoices,
  getSetting,
  setSetting,
  getAIValuations,
  saveAIValuation,
} from '../services/database';
import { estimateItemValues } from '../services/claude';
import {
  totalContentsValue,
  summarizeByRoom,
  getHighValueItems,
  ContentsTotal,
  RoomValue,
  ValuedItem,
} from '../utils/valuation';
import { capitalizeRoom, roomIcon } from '../utils/rooms';
import { formatNZDate } from '../utils/dates';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>;

const THRESHOLD_OPTIONS = [250, 500, 1000, 2000];

export interface ValuationState {
  enabled: boolean;
  running: boolean;
  trigger: () => void;
}

interface Props {
  /** Search query, owned by the fixed header in HomeScreen. */
  query?: string;
  /** Reports AI-valuation availability so the bottom bar can host the button. */
  onValuationState?: (state: ValuationState) => void;
}

export default function InsuranceScreen({ query = '', onValuationState }: Props) {
  const navigation = useNavigation<Nav>();
  const [totals, setTotals] = useState<ContentsTotal>({ count: 0, purchase: 0, current: 0 });
  const [roomValues, setRoomValues] = useState<RoomValue[]>([]);
  const [threshold, setThreshold] = useState(500);
  const [highValue, setHighValue] = useState<ValuedItem[]>([]);
  const [aiValues, setAIValues] = useState<Map<string, { value: number; note: string }>>(
    new Map()
  );
  const [valuating, setValuating] = useState(false);
  const [customModal, setCustomModal] = useState(false);
  const [customInput, setCustomInput] = useState('');

  function loadAIValues() {
    const map = new Map<string, { value: number; note: string }>();
    for (const row of getAIValuations()) {
      map.set(`${row.invoiceId}:${row.itemIndex}`, { value: row.value, note: row.note });
    }
    setAIValues(map);
  }

  useFocusEffect(
    useCallback(() => {
      const invoices = searchInvoices({});
      const savedThreshold = parseInt(getSetting('hvThreshold', '500'), 10) || 500;
      setThreshold(savedThreshold);
      setTotals(totalContentsValue(invoices));
      setRoomValues(summarizeByRoom(invoices));
      setHighValue(getHighValueItems(invoices, savedThreshold));
      loadAIValues();
    }, [])
  );

  function handleThreshold(value: number) {
    setThreshold(value);
    setSetting('hvThreshold', String(value));
    setHighValue(getHighValueItems(searchInvoices({}), value));
  }

  function openCustomThreshold() {
    setCustomInput(String(threshold));
    setCustomModal(true);
  }

  function applyCustomThreshold() {
    const value = Math.round(parseFloat(customInput));
    if (!Number.isFinite(value) || value < 1) {
      Alert.alert('Invalid amount', 'Enter a whole dollar amount of $1 or more.');
      return;
    }
    handleThreshold(value);
    setCustomModal(false);
  }

  async function handleAIValuate() {
    if (highValue.length === 0 || valuating) return;
    const batch = highValue.slice(0, 40); // worker cap
    setValuating(true);
    try {
      const estimates = await estimateItemValues(
        batch.map((it) => ({
          name: it.name,
          category: it.category,
          date: it.date,
          price: it.unitPrice,
        }))
      );
      estimates.forEach((est, i) => {
        saveAIValuation(batch[i].invoiceId, batch[i].itemIndex, est.value, est.note);
      });
      loadAIValues();
    } catch {
      Alert.alert(
        'AI valuation failed',
        'Could not reach the valuation service. Check your connection (and that the updated worker is deployed), then try again.'
      );
    } finally {
      setValuating(false);
    }
  }

  useEffect(() => {
    onValuationState?.({
      enabled: highValue.length > 0 && !valuating,
      running: valuating,
      trigger: handleAIValuate,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highValue, valuating]);

  const isCustomThreshold = !THRESHOLD_OPTIONS.includes(threshold);

  const header = (
    <View>
      {/* Contents value card */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>ESTIMATED CONTENTS VALUE (DEPRECIATED)</Text>
        <Text style={styles.cardValue}>${totals.current.toFixed(2)}</Text>
        <View style={styles.cardSubRow}>
          <Text style={styles.cardSub}>
            Purchase total ${totals.purchase.toFixed(2)} · {totals.count} invoice
            {totals.count !== 1 ? 's' : ''}
          </Text>
        </View>
        <Text style={styles.cardHint}>
          Consumables (groceries, restaurant, utilities…) excluded. Use this to set your sum
          insured.
        </Text>
      </View>

      {/* By room */}
      {roomValues.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>VALUE BY ROOM</Text>
          {roomValues.map((r) => (
            <View key={r.room || '_none'} style={styles.roomRow}>
              <View style={styles.roomNameRow}>
                {r.room ? <Text style={styles.roomIcon}>{roomIcon(r.room)}</Text> : null}
                <Text style={styles.roomName}>
                  {r.room ? capitalizeRoom(r.room) : 'Unassigned'}
                </Text>
              </View>
              <View style={styles.roomAmounts}>
                <Text style={styles.roomCurrent}>${r.current.toFixed(2)}</Text>
                <Text style={styles.roomPurchase}>was ${r.purchase.toFixed(2)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* High-value header + threshold picker */}
      <View style={styles.hvHeader}>
        <Text style={styles.sectionTitle}>HIGH-VALUE ITEMS</Text>
        <View style={styles.chips}>
          {THRESHOLD_OPTIONS.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.chip, threshold === t && styles.chipActive]}
              onPress={() => handleThreshold(t)}
            >
              <Text style={[styles.chipText, threshold === t && styles.chipTextActive]}>
                ${t}+
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.chip, styles.chipCustom, isCustomThreshold && styles.chipActive]}
            onPress={openCustomThreshold}
          >
            <Text style={[styles.chipText, isCustomThreshold && styles.chipTextActive]}>
              {isCustomThreshold ? `$${threshold}+` : 'Custom'}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hvHint}>
          Single items at or above the threshold — these may need to be listed (specified)
          separately on your policy.
        </Text>
      </View>
    </View>
  );

  const shownItems = query
    ? highValue.filter((it) =>
        `${it.name} ${it.vendor}`.toLowerCase().includes(query.toLowerCase())
      )
    : highValue;

  return (
    <View style={styles.container}>
      <FlatList
        data={shownItems}
        keyExtractor={(item, i) => `${item.invoiceId}_${i}`}
        ListHeaderComponent={header}
        renderItem={({ item }) => {
          const ai = aiValues.get(`${item.invoiceId}:${item.itemIndex}`);
          return (
            <TouchableOpacity
              style={styles.itemRow}
              onPress={() => navigation.navigate('InvoiceDetail', { invoiceId: item.invoiceId })}
              activeOpacity={0.75}
            >
              <View style={styles.itemMain}>
                <Text style={styles.itemName} numberOfLines={1}>
                  {item.name}
                  {item.quantity > 1 ? `  ×${item.quantity}` : ''}
                </Text>
                <Text style={styles.itemMeta} numberOfLines={1}>
                  {item.vendor || 'Unknown'} · {formatNZDate(item.date) || 'No date'}
                  {item.room ? ` · ${capitalizeRoom(item.room)}` : ''}
                </Text>
                {ai?.note ? (
                  <Text style={styles.itemAINote} numberOfLines={1}>
                    ✨ {ai.note}
                  </Text>
                ) : null}
              </View>
              <View style={styles.itemAmounts}>
                <Text style={[styles.itemCurrent, ai && styles.itemCurrentAI]}>
                  {ai ? '✨ ' : ''}${(ai ? ai.value : item.currentUnitValue).toFixed(2)}
                </Text>
                <Text style={styles.itemPurchase}>paid ${item.unitPrice.toFixed(2)}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🛡️</Text>
            <Text style={styles.emptyTitle}>
              {totals.count === 0
                ? 'No contents yet'
                : query && highValue.length > 0
                ? `No matches for "${query}"`
                : `No items over $${threshold}`}
            </Text>
            <Text style={styles.emptySubtitle}>
              {totals.count === 0
                ? 'Scan receipts for your belongings and they will show up here with their depreciated value.'
                : 'Try a lower threshold, or scan more receipts.'}
            </Text>
          </View>
        }
        contentContainerStyle={styles.list}
      />

      {/* Custom threshold */}
      <Modal
        visible={customModal}
        transparent
        animationType="fade"
        onRequestClose={() => setCustomModal(false)}
      >
        <TouchableOpacity
          style={styles.modalBg}
          activeOpacity={1}
          onPress={() => setCustomModal(false)}
        >
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Custom threshold</Text>
            <Text style={styles.modalSub}>
              Items at or above this amount count as high-value.
            </Text>
            <View style={styles.modalInputRow}>
              <Text style={styles.modalCurrency}>$</Text>
              <TextInput
                style={styles.modalInput}
                value={customInput}
                onChangeText={setCustomInput}
                keyboardType="number-pad"
                placeholder="500"
                placeholderTextColor="#cbd5e1"
                autoFocus
                selectTextOnFocus
                onSubmitEditing={applyCustomThreshold}
                returnKeyType="done"
              />
            </View>
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalCancel]}
                onPress={() => setCustomModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalApply]}
                onPress={applyCustomThreshold}
              >
                <Text style={styles.modalApplyText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  list: { padding: 16, paddingBottom: 40 },

  card: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 20,
    gap: 6,
  },
  cardLabel: { fontSize: 11, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.8 },
  cardValue: { fontSize: 34, fontWeight: '800', color: '#ffffff', letterSpacing: -0.5 },
  cardSubRow: { flexDirection: 'row' },
  cardSub: { fontSize: 13, color: '#cbd5e1', fontWeight: '500' },
  cardHint: { fontSize: 11, color: '#64748b', marginTop: 6, lineHeight: 15 },

  section: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginTop: 14,
    gap: 10,
  },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: '#64748b', letterSpacing: 0.6 },

  roomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roomNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  roomIcon: { fontSize: 13 },
  roomName: { fontSize: 14, color: '#0f172a', fontWeight: '600' },
  roomAmounts: { alignItems: 'flex-end' },
  roomCurrent: { fontSize: 14, fontWeight: '700', color: '#2563eb' },
  roomPurchase: { fontSize: 11, color: '#94a3b8' },

  hvHeader: { marginTop: 18, marginBottom: 8, gap: 8 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#eef2f6',
  },
  chipActive: { backgroundColor: '#2563eb' },
  chipCustom: { borderWidth: 1, borderColor: '#cbd5e1', borderStyle: 'dashed' },
  chipText: { fontSize: 13, color: '#475569', fontWeight: '600' },
  chipTextActive: { color: '#fff', fontWeight: '700' },

  // Custom threshold modal
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    padding: 28,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  modalSub: { fontSize: 13, color: '#64748b', lineHeight: 18 },
  modalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalCurrency: { fontSize: 20, fontWeight: '700', color: '#64748b' },
  modalInput: { flex: 1, fontSize: 20, fontWeight: '700', color: '#0f172a', padding: 0 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 2 },
  modalBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 999,
    alignItems: 'center',
  },
  modalCancel: { backgroundColor: '#f1f5f9' },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: '#64748b' },
  modalApply: { backgroundColor: '#2563eb' },
  modalApplyText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  hvHint: { fontSize: 11, color: '#94a3b8', lineHeight: 15 },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 10,
  },
  itemMain: { flex: 1, gap: 3 },
  itemName: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  itemMeta: { fontSize: 12, color: '#94a3b8' },
  itemAINote: { fontSize: 11, color: '#7c3aed', fontStyle: 'italic' },
  itemAmounts: { alignItems: 'flex-end', gap: 2 },
  itemCurrent: { fontSize: 15, fontWeight: '800', color: '#2563eb' },
  itemCurrentAI: { color: '#7c3aed' },
  itemPurchase: { fontSize: 11, color: '#94a3b8' },

  emptyState: { alignItems: 'center', paddingTop: 40, gap: 8, paddingHorizontal: 30 },
  emptyIcon: { fontSize: 44 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#334155' },
  emptySubtitle: { fontSize: 13, color: '#94a3b8', textAlign: 'center', lineHeight: 19 },
});
