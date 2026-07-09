import React, { useState, useCallback, useLayoutEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../types/navigation';
import { Invoice, SearchFilters } from '../types/invoice';
import {
  searchInvoices,
  deleteInvoice,
  getPendingInvoices,
  updateInvoice,
  getUsedCategories,
} from '../services/database';
import { processInvoiceImage } from '../services/imageProcessor';
import { extractInvoiceData } from '../services/claude';
import InvoiceCard from '../components/InvoiceCard';
import ViewToggle from '../components/ViewToggle';
import { capitalize } from '../utils/categories';
import { exportCSV, exportPDF } from '../services/exporter';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [query, setQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<SearchFilters>({});
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categoryList, setCategoryList] = useState<string[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [retrying, setRetrying] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
            <Ionicons name="settings-outline" size={22} color="#64748b" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleExport()}
            style={{ paddingHorizontal: 4 }}
            disabled={invoices.length === 0}
          >
            <Text style={[styles.exportBtn, invoices.length === 0 && styles.exportBtnDisabled]}>
              Export
            </Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [invoices]);

  function handleExport() {
    if (invoices.length === 0) return;
    Alert.alert(
      'Export Invoices',
      `Export ${invoices.length} invoice${invoices.length !== 1 ? 's' : ''}`,
      [
        {
          text: 'Export as CSV',
          onPress: () =>
            exportCSV(invoices).catch(() =>
              Alert.alert('Export failed', 'Could not export CSV. Please try again.')
            ),
        },
        {
          text: 'Export as PDF',
          onPress: () =>
            exportPDF(invoices).catch(() =>
              Alert.alert('Export failed', 'Could not export PDF. Please try again.')
            ),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  useFocusEffect(
    useCallback(() => {
      // Show only categories that actually exist in invoices
      setCategoryList(getUsedCategories());

      const filters: SearchFilters = {
        ...activeFilters,
        query: query || undefined,
        category: selectedCategory || undefined,
      };
      const results = searchInvoices(filters);
      setInvoices(results);

      const pending = getPendingInvoices();
      setPendingCount(pending.length);
      if (pending.length > 0) {
        retryPending(pending, false);
      }
    }, [activeFilters, query, selectedCategory])
  );

  async function retryPending(pending?: Invoice[], showLoader = true) {
    const toProcess = pending ?? getPendingInvoices();
    if (toProcess.length === 0) return;
    if (showLoader) setRetrying(true);
    let successCount = 0;
    for (const inv of toProcess) {
      try {
        const processed = await processInvoiceImage(inv.photoUri);
        const extracted = await extractInvoiceData(processed.base64);
        updateInvoice(inv.id, {
          vendor: extracted.vendor,
          date: extracted.date || inv.date,
          items: extracted.items,
          subtotal: extracted.subtotal,
          tax: extracted.tax,
          total: extracted.total,
          category: extracted.category,
          status: 'done',
        });
        successCount++;
      } catch {
        // Still offline — leave as pending
      }
    }
    if (successCount > 0) {
      const filters: SearchFilters = {
        ...activeFilters,
        query: query || undefined,
        category: selectedCategory || undefined,
      };
      setInvoices(searchInvoices(filters));
      setPendingCount(getPendingInvoices().length);
    }
    if (showLoader) setRetrying(false);
  }

  function handleSearch(text: string) {
    setQuery(text);
    const filters: SearchFilters = {
      ...activeFilters,
      query: text || undefined,
      category: selectedCategory || undefined,
    };
    setInvoices(searchInvoices(filters));
  }

  function handleCategorySelect(cat: string) {
    const next = cat === selectedCategory ? '' : cat;
    setSelectedCategory(next);
    const filters: SearchFilters = {
      ...activeFilters,
      query: query || undefined,
      category: next || undefined,
    };
    setInvoices(searchInvoices(filters));
  }

  function handleDelete(id: string) {
    Alert.alert('Delete Invoice', 'Are you sure you want to delete this invoice?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteInvoice(id);
          const filters: SearchFilters = {
            ...activeFilters,
            query: query || undefined,
            category: selectedCategory || undefined,
          };
          setInvoices(searchInvoices(filters));
        },
      },
    ]);
  }

  const totalAmount = invoices.reduce((sum, inv) => sum + inv.total, 0);
  const hasFilters = Object.keys(activeFilters).some(
    (k) => activeFilters[k as keyof SearchFilters] !== undefined
  );

  return (
    <View style={styles.container}>
      {/* Search + filter button */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search vendor, item..."
          placeholderTextColor="#9ca3af"
          value={query}
          onChangeText={handleSearch}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        <TouchableOpacity
          style={[styles.filterButton, hasFilters && styles.filterButtonActive]}
          onPress={() => navigation.navigate('Search', { filters: activeFilters })}
        >
          <Text style={styles.filterButtonText}>{hasFilters ? 'Filtered' : 'Filter'}</Text>
        </TouchableOpacity>
      </View>

      {/* Invoices / Rooms toggle */}
      <ViewToggle
        active="invoices"
        onSelect={(v) => {
          if (v === 'rooms') navigation.navigate('Rooms');
        }}
      />

      {/* Category chip bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categoryBar}
        contentContainerStyle={styles.categoryContent}
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

      {/* Pending invoices banner */}
      {pendingCount > 0 && (
        <TouchableOpacity
          style={styles.pendingBanner}
          onPress={() => retryPending(undefined, true)}
          disabled={retrying}
          activeOpacity={0.8}
        >
          {retrying ? (
            <>
              <ActivityIndicator color="#92400e" size="small" />
              <Text style={styles.pendingText}>Analyzing photos...</Text>
            </>
          ) : (
            <>
              <Text style={styles.pendingIcon}>⏳</Text>
              <Text style={styles.pendingText}>
                {pendingCount} photo{pendingCount > 1 ? 's' : ''} waiting to be analyzed
              </Text>
              <Text style={styles.pendingAction}>Retry now</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      <FlatList
        data={invoices}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          invoices.length > 0 ? (
            <View style={styles.statsStrip}>
              <Text style={styles.statsStripText}>
                {invoices.length} {selectedCategory ? capitalize(selectedCategory) : 'invoice'}{invoices.length !== 1 ? 's' : ''}
              </Text>
              <Text style={styles.statsStripTotal}>${totalAmount.toFixed(2)}</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <InvoiceCard
            invoice={item}
            onPress={() => navigation.navigate('InvoiceDetail', { invoiceId: item.id })}
            onDelete={() => handleDelete(item.id)}
          />
        )}
        contentContainerStyle={invoices.length === 0 ? styles.emptyContainer : styles.list}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🧾</Text>
            <Text style={styles.emptyTitle}>
              {selectedCategory ? `No ${capitalize(selectedCategory)} invoices` : 'No invoices yet'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {selectedCategory
                ? 'Try a different category or clear the filter.'
                : 'Photograph a receipt and AI will extract the data automatically.'}
            </Text>
            {!selectedCategory && (
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={() => navigation.navigate('Camera')}
              >
                <Text style={styles.emptyBtnText}>Photograph an Invoice</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('Camera')}
        activeOpacity={0.85}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },

  // Search bar
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  searchInput: {
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
  filterButton: {
    height: 42,
    paddingHorizontal: 16,
    backgroundColor: '#2563eb',
    borderRadius: 12,
    justifyContent: 'center',
  },
  filterButtonActive: { backgroundColor: '#d97706' },
  filterButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Category chips
  categoryBar: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    maxHeight: 44,
  },
  categoryContent: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    gap: 8,
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
  },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { fontSize: 13, color: '#475569', fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '700' },

  // Pending banner
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fffbeb',
    borderBottomWidth: 1,
    borderBottomColor: '#fef3c7',
  },
  pendingIcon: { fontSize: 15 },
  pendingText: { flex: 1, fontSize: 13, color: '#92400e', fontWeight: '500' },
  pendingAction: { fontSize: 13, color: '#b45309', fontWeight: '700' },

  // Stats strip (inside list header)
  statsStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 6,
    marginBottom: 8,
  },
  statsStripText: { fontSize: 12, color: '#94a3b8', fontWeight: '600' },
  statsStripTotal: { fontSize: 12, color: '#64748b', fontWeight: '700' },

  // List
  list: { padding: 14, paddingBottom: 100, gap: 10 },
  emptyContainer: { flex: 1 },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
    gap: 10,
  },
  emptyIcon: { fontSize: 52, marginBottom: 4 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#334155' },
  emptySubtitle: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    paddingHorizontal: 48,
    lineHeight: 20,
  },
  emptyBtn: {
    marginTop: 20,
    backgroundColor: '#2563eb',
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 12,
  },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 36,
    right: 24,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#2563eb',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  fabText: { color: '#fff', fontSize: 30, lineHeight: 34, fontWeight: '300' },

  exportBtn: { color: '#2563eb', fontSize: 16, fontWeight: '600' },
  exportBtnDisabled: { color: '#cbd5e1' },
});
