import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
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
import { capitalizeRoom } from '../utils/rooms';

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
              <Text style={styles.roomName}>
                {r.room ? capitalizeRoom(r.room) : 'Unassigned'}
              </Text>
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
                  {item.vendor || 'Unknown'} · {item.date || 'No date'}
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
  chipText: { fontSize: 13, color: '#475569', fontWeight: '600' },
  chipTextActive: { color: '#fff', fontWeight: '700' },
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
