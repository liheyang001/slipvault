import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  SafeAreaView,
  ScrollView,
  Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { searchInvoices, getUserCategories } from '../services/database';
import { Invoice, SearchFilters } from '../types/invoice';
import { RootStackParamList } from '../types/navigation';
import { DEFAULT_CATEGORIES, capitalize } from '../utils/categories';
import { exportCSV, exportPDF } from '../services/exporter';

type Props = NativeStackScreenProps<RootStackParamList, 'Search'>;

// ─── Date preset helpers ──────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const DATE_PRESETS = [
  {
    label: 'This Week',
    getRange: () => {
      const now = new Date();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      return { from: toDateStr(monday), to: toDateStr(now) };
    },
  },
  {
    label: 'This Month',
    getRange: () => {
      const now = new Date();
      return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: toDateStr(now) };
    },
  },
  {
    label: 'Last 3 Months',
    getRange: () => {
      const now = new Date();
      const from = new Date(now);
      from.setMonth(from.getMonth() - 3);
      return { from: toDateStr(from), to: toDateStr(now) };
    },
  },
  {
    label: 'This Year',
    getRange: () => {
      const now = new Date();
      return { from: `${now.getFullYear()}-01-01`, to: toDateStr(now) };
    },
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function SearchScreen({ navigation }: Props) {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categoryList, setCategoryList] = useState<string[]>(DEFAULT_CATEGORIES);
  const [results, setResults] = useState<Invoice[]>([]);

  // Date range state
  const [activePreset, setActivePreset] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    const userCats = getUserCategories();
    const merged = [
      ...DEFAULT_CATEGORIES,
      ...userCats.filter((c) => !DEFAULT_CATEGORIES.includes(c)),
    ];
    setCategoryList(merged);
  }, []);

  function buildFilters(): SearchFilters {
    return {
      query: query.trim() || undefined,
      category: selectedCategory || undefined,
      dateFrom: dateFrom.trim() || undefined,
      dateTo: dateTo.trim() || undefined,
    };
  }

  function runSearch(overrides: Partial<SearchFilters> = {}) {
    const filters = { ...buildFilters(), ...overrides };
    setResults(searchInvoices(filters));
  }

  function handlePreset(preset: (typeof DATE_PRESETS)[number]) {
    if (activePreset === preset.label) {
      // Deselect
      setActivePreset('');
      setDateFrom('');
      setDateTo('');
      setShowCustom(false);
      runSearch({ dateFrom: undefined, dateTo: undefined });
    } else {
      const { from, to } = preset.getRange();
      setActivePreset(preset.label);
      setShowCustom(false);
      setDateFrom(from);
      setDateTo(to);
      runSearch({ dateFrom: from, dateTo: to });
    }
  }

  function handleCustomToggle() {
    if (showCustom) {
      setShowCustom(false);
      setActivePreset('');
      setDateFrom('');
      setDateTo('');
      runSearch({ dateFrom: undefined, dateTo: undefined });
    } else {
      setShowCustom(true);
      setActivePreset('Custom');
    }
  }

  function handleCustomDateChange(from: string, to: string) {
    setDateFrom(from);
    setDateTo(to);
    // Only search when both look like valid dates or are empty
    const fromOk = from.length === 0 || /^\d{4}-\d{2}-\d{2}$/.test(from);
    const toOk = to.length === 0 || /^\d{4}-\d{2}-\d{2}$/.test(to);
    if (fromOk && toOk) {
      runSearch({ dateFrom: from || undefined, dateTo: to || undefined });
    }
  }

  function handleCategorySelect(cat: string) {
    const next = cat === selectedCategory ? '' : cat;
    setSelectedCategory(next);
    runSearch({ category: next || undefined });
  }

  function handleQueryChange(text: string) {
    setQuery(text);
    runSearch({ query: text.trim() || undefined });
  }

  function clearAll() {
    setQuery('');
    setSelectedCategory('');
    setActivePreset('');
    setShowCustom(false);
    setDateFrom('');
    setDateTo('');
    setResults([]);
  }

  const hasAnyFilter = query || selectedCategory || dateFrom || dateTo;

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Search bar ── */}
      <View style={styles.searchBox}>
        <TextInput
          style={styles.input}
          placeholder="Search merchant, items..."
          placeholderTextColor="#9ca3af"
          value={query}
          onChangeText={handleQueryChange}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {hasAnyFilter ? (
          <TouchableOpacity style={styles.clearBtn} onPress={clearAll}>
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView style={styles.filtersScroll} stickyHeaderIndices={[]} keyboardShouldPersistTaps="handled">
        {/* ── Category chips ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Category</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {categoryList.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.chip, selectedCategory === cat && styles.chipActive]}
                onPress={() => handleCategorySelect(cat)}
              >
                <Text style={[styles.chipText, selectedCategory === cat && styles.chipTextActive]}>
                  {capitalize(cat)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* ── Date range ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Date Range</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {DATE_PRESETS.map((preset) => (
              <TouchableOpacity
                key={preset.label}
                style={[styles.chip, activePreset === preset.label && styles.chipActive]}
                onPress={() => handlePreset(preset)}
              >
                <Text style={[styles.chipText, activePreset === preset.label && styles.chipTextActive]}>
                  {preset.label}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.chip, showCustom && styles.chipActive]}
              onPress={handleCustomToggle}
            >
              <Text style={[styles.chipText, showCustom && styles.chipTextActive]}>
                Custom…
              </Text>
            </TouchableOpacity>
          </ScrollView>

          {/* Custom date inputs */}
          {showCustom && (
            <View style={styles.customDateRow}>
              <View style={styles.dateField}>
                <Text style={styles.dateFieldLabel}>From</Text>
                <TextInput
                  style={styles.dateInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#9ca3af"
                  value={dateFrom}
                  onChangeText={(v) => handleCustomDateChange(v, dateTo)}
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                />
              </View>
              <Text style={styles.dateSeparator}>→</Text>
              <View style={styles.dateField}>
                <Text style={styles.dateFieldLabel}>To</Text>
                <TextInput
                  style={styles.dateInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#9ca3af"
                  value={dateTo}
                  onChangeText={(v) => handleCustomDateChange(dateFrom, v)}
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                />
              </View>
            </View>
          )}

          {/* Active date range display */}
          {(dateFrom || dateTo) && !showCustom && (
            <Text style={styles.dateRangeDisplay}>
              {dateFrom || '…'} → {dateTo || '…'}
            </Text>
          )}
        </View>

        {/* ── Results ── */}
        {results.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              {hasAnyFilter ? 'No matching invoices' : 'Set filters above to search'}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.resultHeader}>
              <Text style={styles.resultCount}>{results.length} result{results.length !== 1 ? 's' : ''}</Text>
              <TouchableOpacity
                style={styles.exportBtn}
                onPress={() =>
                  Alert.alert(
                    'Export',
                    `Export ${results.length} invoice${results.length !== 1 ? 's' : ''}`,
                    [
                      {
                        text: 'Export as CSV',
                        onPress: () =>
                          exportCSV(results).catch(() =>
                            Alert.alert('Export failed', 'Could not export CSV.')
                          ),
                      },
                      {
                        text: 'Export as PDF',
                        onPress: () =>
                          exportPDF(results).catch(() =>
                            Alert.alert('Export failed', 'Could not export PDF.')
                          ),
                      },
                      { text: 'Cancel', style: 'cancel' },
                    ]
                  )
                }
              >
                <Text style={styles.exportBtnText}>Export</Text>
              </TouchableOpacity>
            </View>
            {results.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.resultCard}
                onPress={() => navigation.navigate('InvoiceDetail', { invoiceId: item.id })}
              >
                <View style={styles.cardRow}>
                  <Text style={styles.vendor} numberOfLines={1}>{item.vendor || 'Unknown'}</Text>
                  {item.category ? (
                    <View style={styles.categoryBadge}>
                      <Text style={styles.categoryBadgeText}>{capitalize(item.category)}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.cardRow}>
                  <Text style={styles.date}>{item.date}</Text>
                  <Text style={styles.total}>${item.total.toFixed(2)}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },

  // Search bar
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  input: {
    flex: 1,
    height: 42,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#0f172a',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  clearBtnText: { color: '#64748b', fontSize: 14, fontWeight: '600' },

  // Filters scroll area
  filtersScroll: { flex: 1 },

  // Section
  section: {
    backgroundColor: '#fff',
    marginBottom: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  chipRow: { gap: 8, flexDirection: 'row' },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
  },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { fontSize: 13, color: '#475569', fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '700' },

  // Custom date inputs
  customDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  dateField: { flex: 1, gap: 4 },
  dateFieldLabel: { fontSize: 11, color: '#94a3b8', fontWeight: '600' },
  dateInput: {
    height: 40,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#0f172a',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  dateSeparator: { fontSize: 16, color: '#cbd5e1', marginTop: 16 },
  dateRangeDisplay: {
    fontSize: 12,
    color: '#2563eb',
    fontWeight: '600',
    marginTop: 2,
  },

  // Results
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  resultCount: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  exportBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  exportBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  resultCard: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginBottom: 6,
    padding: 14,
    borderRadius: 12,
    gap: 6,
    shadowColor: '#64748b',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  vendor: { fontSize: 15, fontWeight: '700', color: '#0f172a', flex: 1 },
  categoryBadge: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  categoryBadgeText: { fontSize: 11, color: '#2563eb', fontWeight: '600' },
  date: { fontSize: 12, color: '#94a3b8' },
  total: { fontSize: 15, fontWeight: '700', color: '#0f172a' },

  // Empty
  emptyState: {
    paddingTop: 60,
    alignItems: 'center',
  },
  emptyText: { color: '#94a3b8', fontSize: 14 },
});
