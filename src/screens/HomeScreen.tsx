import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../types/navigation';
import { Invoice, SearchFilters } from '../types/invoice';
import {
  searchInvoices,
  getPendingInvoices,
  updateInvoice,
  getCategoryUsage,
  bumpCategoryTap,
  isProUser,
  getInvoiceCount,
  countInvoicesCreatedAfter,
  getSetting,
  setSetting,
  FREE_INVOICE_LIMIT,
} from '../services/database';
import { createBackup } from '../services/backup';
import { processInvoiceImage } from '../services/imageProcessor';
import { extractInvoiceData } from '../services/claude';
import InvoiceCard from '../components/InvoiceCard';
import ViewToggle, { ToggleView } from '../components/ViewToggle';
import SpotlightOverlay, { SpotlightStep } from '../components/SpotlightOverlay';
import RoomsScreen from './RoomsScreen';
import InsuranceScreen, { ValuationState } from './InsuranceScreen';
import { capitalize } from '../utils/categories';
import { capitalizeRoom } from '../utils/rooms';
import { exportCSV, exportPDF, exportRoomCSV, exportRoomPDF } from '../services/exporter';

const VIEW_ORDER: Record<ToggleView, number> = { invoices: 0, rooms: 1, insurance: 2 };
const VIEWS: ToggleView[] = ['invoices', 'rooms', 'insurance'];

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'Home'>>();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [query, setQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<SearchFilters>({});
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categoryUsage, setCategoryUsage] = useState<
    { category: string; count: number; taps: number }[]
  >([]);
  const [catModalVisible, setCatModalVisible] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [quota, setQuota] = useState<{ pro: boolean; count: number }>({ pro: true, count: 0 });
  const [backupNudge, setBackupNudge] = useState('');
  const [backingUp, setBackingUp] = useState(false);

  // View switching: fixed header, native pager below (both pages visible while sliding)
  const [view, setView] = useState<ToggleView>('invoices');
  const [currentRoom, setCurrentRoom] = useState('');
  const [valuation, setValuation] = useState<ValuationState | null>(null);
  const pagerRef = useRef<PagerView>(null);

  // First-run spotlight tour targets
  const fabRef = useRef<any>(null);
  const searchInputRef = useRef<any>(null);
  const toggleWrapRef = useRef<any>(null);
  const catRowRef = useRef<any>(null);
  const [showSpotlight, setShowSpotlight] = useState(false);

  function switchView(next: ToggleView) {
    setView(next); // instant toggle highlight
    pagerRef.current?.setPage(VIEW_ORDER[next]); // native animated slide
  }

  // One-time spotlight tour: fires on the first Home mount after this flag is
  // unset — covers both brand-new users (right after onboarding) and existing
  // users seeing this feature for the first time after an app update.
  useEffect(() => {
    if (getSetting('hasSeenSpotlight', 'false') === 'true') return;
    const timer = setTimeout(() => setShowSpotlight(true), 400);
    return () => clearTimeout(timer);
  }, []);

  function finishSpotlight() {
    setSetting('hasSeenSpotlight', 'true');
    setShowSpotlight(false);
  }

  // Re-triggered explicitly from OnboardingScreen when "View Tutorial" is
  // replayed from Settings — Home is already mounted then, so the mount-once
  // effect above won't fire again; this reacts to the param instead.
  useEffect(() => {
    if (route.params?.showSpotlight) {
      setShowSpotlight(true);
      navigation.setParams({ showSpotlight: undefined }); // consume so it doesn't refire
    }
  }, [route.params?.showSpotlight]);

  function handleExport() {
    // Rooms view: export the currently selected room as an insurance inventory
    if (view === 'rooms') {
      if (!currentRoom) return;
      const roomInvoices = searchInvoices({ room: currentRoom });
      if (roomInvoices.length === 0) return;
      const label = capitalizeRoom(currentRoom);
      Alert.alert(
        `Export "${label}"`,
        `Insurance inventory for ${roomInvoices.length} invoice${roomInvoices.length !== 1 ? 's' : ''}`,
        [
          {
            text: 'Export as PDF',
            onPress: () =>
              exportRoomPDF(roomInvoices, currentRoom).catch(() =>
                Alert.alert('Export failed', 'Could not export PDF. Please try again.')
              ),
          },
          {
            text: 'Export as CSV',
            onPress: () =>
              exportRoomCSV(roomInvoices, currentRoom).catch(() =>
                Alert.alert('Export failed', 'Could not export CSV. Please try again.')
              ),
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

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
      // Categories in use, most-used first (personalized quick filters)
      setCategoryUsage(getCategoryUsage());
      const totalCount = getInvoiceCount();
      setQuota({ pro: isProUser(), count: totalCount });

      // Backup nudge: never backed up (≥5 invoices), stale (>30 days), or 10+ new since
      let nudge = '';
      if (totalCount > 0) {
        const last = getSetting('lastBackupAt', '');
        if (!last) {
          if (totalCount >= 5) nudge = `${totalCount} invoices not backed up yet`;
        } else {
          const newSince = countInvoicesCreatedAfter(last);
          const days = Math.floor((Date.now() - Date.parse(last)) / 86400000);
          if (newSince >= 10) nudge = `${newSince} new invoices since last backup`;
          else if (days > 30) nudge = `Last backup ${days} days ago`;
        }
      }
      setBackupNudge(nudge);

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
        if (!inv.photoUri) continue; // manual entries have no receipt to re-scan
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

  function pickCategory(cat: string) {
    if (cat) bumpCategoryTap(cat); // learn the user's habits (deselect doesn't count)
    setSelectedCategory(cat);
    const filters: SearchFilters = {
      ...activeFilters,
      query: query || undefined,
      category: cat || undefined,
    };
    setInvoices(searchInvoices(filters));
    setCatModalVisible(false);
  }

  const totalAmount = invoices.reduce((sum, inv) => sum + inv.total, 0);
  const hasFilters = Object.keys(activeFilters).some(
    (k) => activeFilters[k as keyof SearchFilters] !== undefined
  );

  const canExport = view === 'rooms' ? currentRoom !== '' : invoices.length > 0;
  const exportLabel = view === 'rooms' ? 'Export Room' : 'Export';

  const spotlightSteps: SpotlightStep[] = [
    {
      ref: fabRef,
      title: 'Add an item',
      body: "Tap here to scan a receipt, or add an item by hand if you don't have one.",
    },
    {
      ref: searchInputRef,
      title: 'Search anytime',
      body: 'Find anything by vendor, item name, or price.',
    },
    {
      ref: toggleWrapRef,
      title: 'Three views, one app',
      body: 'Switch between your Invoices list, Rooms, and the Insurance dashboard.',
    },
    {
      ref: catRowRef,
      title: 'Quick category filters',
      body: 'Your most-used categories show up here for one-tap filtering.',
    },
  ];

  return (
    <>
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Search + filter button */}
      <View style={styles.searchRow}>
        <TextInput
          ref={searchInputRef}
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

      {/* Fixed view toggle — content below slides, header stays put */}
      <View ref={toggleWrapRef} collapsable={false}>
        <ViewToggle active={view} onSelect={switchView} />
      </View>

      <PagerView
        ref={pagerRef}
        style={{ flex: 1 }}
        initialPage={0}
        onPageSelected={(e) => setView(VIEWS[e.nativeEvent.position])}
      >
        <View key="invoices" style={{ flex: 1, backgroundColor: '#f8fafc' }} collapsable={false}>
      {/* Category quick filters: user's most-used + dropdown for the rest */}
      {categoryUsage.length > 0 && (() => {
        const top = categoryUsage.slice(0, 2).map((u) => u.category);
        const displayCats =
          selectedCategory && !top.includes(selectedCategory)
            ? [...top.slice(0, 1), selectedCategory]
            : top;
        return (
          <View style={styles.catRow} ref={catRowRef} collapsable={false}>
            <TouchableOpacity
              style={[styles.catChip, !selectedCategory && styles.catChipActive]}
              onPress={() => pickCategory('')}
            >
              <Text
                style={[styles.catChipText, !selectedCategory && styles.catChipTextActive]}
              >
                All
              </Text>
            </TouchableOpacity>
            {displayCats.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.catChip, selectedCategory === cat && styles.catChipActive]}
                onPress={() => pickCategory(selectedCategory === cat ? '' : cat)}
              >
                <Text
                  style={[
                    styles.catChipText,
                    selectedCategory === cat && styles.catChipTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {capitalize(cat)}
                </Text>
              </TouchableOpacity>
            ))}
            {categoryUsage.length > displayCats.length && (
              <TouchableOpacity
                style={styles.catMore}
                onPress={() => setCatModalVisible(true)}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
              >
                <Text style={styles.catMoreText}>Show All</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })()}

      {/* Free quota banner (shown when close to the cap) */}
      {!quota.pro && quota.count >= FREE_INVOICE_LIMIT - 5 && (
        <TouchableOpacity
          style={styles.quotaBanner}
          onPress={() => navigation.navigate('Paywall')}
          activeOpacity={0.8}
        >
          <Text style={styles.quotaText}>
            {Math.min(quota.count, FREE_INVOICE_LIMIT)}/{FREE_INVOICE_LIMIT} free invoices used
          </Text>
          <Text style={styles.quotaAction}>Go Pro</Text>
        </TouchableOpacity>
      )}

      {/* Backup nudge */}
      {!!backupNudge && (
        <TouchableOpacity
          style={styles.backupBanner}
          onPress={async () => {
            if (backingUp) return;
            setBackingUp(true);
            try {
              await createBackup();
              setBackupNudge('');
            } catch {
              Alert.alert('Backup failed', 'Could not create the backup. Please try again.');
            } finally {
              setBackingUp(false);
            }
          }}
          disabled={backingUp}
          activeOpacity={0.8}
        >
          {backingUp ? (
            <ActivityIndicator size="small" color="#854d0e" />
          ) : (
            <Text style={styles.backupIcon}>☁️</Text>
          )}
          <Text style={styles.backupText}>
            {backingUp ? 'Preparing backup…' : backupNudge}
          </Text>
          {!backingUp && <Text style={styles.backupAction}>Back up</Text>}
        </TouchableOpacity>
      )}

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

        </View>

        <View key="rooms" style={{ flex: 1 }} collapsable={false}>
          <RoomsScreen query={query} onRoomChange={setCurrentRoom} />
        </View>

        <View key="insurance" style={{ flex: 1 }} collapsable={false}>
          <InsuranceScreen query={query} onValuationState={setValuation} />
        </View>
      </PagerView>

      {/* Bottom action bar: Settings + Export */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.barBtn}
          onPress={() => navigation.navigate('Settings')}
          activeOpacity={0.7}
        >
          <Ionicons name="settings-outline" size={20} color="#475569" />
          <Text style={styles.barBtnText}>Settings</Text>
        </TouchableOpacity>
        <View style={styles.barDivider} />
        {view === 'insurance' ? (
          <TouchableOpacity
            style={styles.barBtn}
            onPress={() => valuation?.trigger()}
            disabled={!valuation?.enabled}
            activeOpacity={0.7}
          >
            {valuation?.running ? (
              <ActivityIndicator size="small" color="#7c3aed" />
            ) : (
              <Ionicons
                name="sparkles-outline"
                size={20}
                color={valuation?.enabled ? '#7c3aed' : '#cbd5e1'}
              />
            )}
            <Text
              style={[
                styles.barBtnText,
                { color: valuation?.running || valuation?.enabled ? '#7c3aed' : '#cbd5e1' },
              ]}
            >
              {valuation?.running ? 'Estimating…' : 'AI Valuation'}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.barBtn}
            onPress={handleExport}
            disabled={!canExport}
            activeOpacity={0.7}
          >
            <Ionicons name="share-outline" size={20} color={canExport ? '#2563eb' : '#cbd5e1'} />
            <Text style={[styles.barBtnText, { color: canExport ? '#2563eb' : '#cbd5e1' }]}>
              {exportLabel}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Category picker modal */}
      <Modal
        visible={catModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCatModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBg}
          activeOpacity={1}
          onPress={() => setCatModalVisible(false)}
        >
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Filter by category</Text>
            <View style={styles.modalChips}>
              <TouchableOpacity
                style={[styles.modalChip, !selectedCategory && styles.modalChipActive]}
                onPress={() => pickCategory('')}
              >
                <Text
                  style={[styles.modalChipText, !selectedCategory && styles.modalChipTextActive]}
                >
                  All
                </Text>
              </TouchableOpacity>
              {categoryUsage.map(({ category: cat, count }) => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.modalChip, selectedCategory === cat && styles.modalChipActive]}
                  onPress={() => pickCategory(cat)}
                >
                  <Text
                    style={[
                      styles.modalChipText,
                      selectedCategory === cat && styles.modalChipTextActive,
                    ]}
                  >
                    {capitalize(cat)} ({count})
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Add FAB — floats above the pager on Invoices and Rooms views */}
      {view !== 'insurance' && (
        <TouchableOpacity
          ref={fabRef}
          style={styles.fab}
          onPress={() => {
            // Adding from a room? New entries default to that room.
            const params =
              view === 'rooms' && currentRoom ? { defaultRoom: currentRoom } : undefined;
            Alert.alert('Add to your inventory', undefined, [
              { text: '📷 Scan receipt', onPress: () => navigation.navigate('Camera', params) },
              {
                text: '✍️ Add manually (no receipt)',
                onPress: () => {
                  // Gate here so users never fill in a form they can't save.
                  if (!quota.pro && quota.count >= FREE_INVOICE_LIMIT) {
                    Alert.alert(
                      'Free limit reached',
                      `The free plan stores up to ${FREE_INVOICE_LIMIT} invoices. Upgrade to Pro for unlimited invoices.`,
                      [
                        { text: 'Not now', style: 'cancel' },
                        { text: 'See Pro', onPress: () => navigation.navigate('Paywall') },
                      ]
                    );
                    return;
                  }
                  navigation.navigate('ManualEntry', params);
                },
              },
              { text: 'Cancel', style: 'cancel' },
            ]);
          }}
          activeOpacity={0.85}
        >
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      )}

    </SafeAreaView>
    {showSpotlight && <SpotlightOverlay steps={spotlightSteps} onDone={finishSpotlight} />}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  // Bottom action bar
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingVertical: 6,
  },
  barBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 8,
  },
  barBtnText: { fontSize: 14, fontWeight: '600', color: '#475569' },
  barDivider: { width: 1, height: 24, backgroundColor: '#f1f5f9' },

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

  // Category filter (compact selector + modal)
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  catChip: {
    flexShrink: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
  },
  catChipActive: { backgroundColor: '#2563eb' },
  catChipText: { fontSize: 13, color: '#475569', fontWeight: '600' },
  catChipTextActive: { color: '#fff' },
  catMore: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
  },
  catMoreText: { fontSize: 13, color: '#2563eb', fontWeight: '700' },

  // Category modal
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
    gap: 14,
  },
  modalTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  modalChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modalChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 6,
    backgroundColor: '#eef2f6',
  },
  modalChipActive: { backgroundColor: '#2563eb' },
  modalChipText: { fontSize: 14, color: '#0f172a', fontWeight: '600' },
  modalChipTextActive: { color: '#fff' },

  // Quota banner
  quotaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#eff6ff',
    borderBottomWidth: 1,
    borderBottomColor: '#dbeafe',
  },
  quotaText: { fontSize: 13, color: '#1d4ed8', fontWeight: '600' },
  quotaAction: { fontSize: 13, color: '#2563eb', fontWeight: '800' },

  // Backup nudge banner
  backupBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fefce8',
    borderBottomWidth: 1,
    borderBottomColor: '#fef08a',
  },
  backupIcon: { fontSize: 14 },
  backupText: { flex: 1, fontSize: 13, color: '#854d0e', fontWeight: '500' },
  backupAction: { fontSize: 13, color: '#a16207', fontWeight: '800' },

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
    bottom: 84,
    right: 24,
    width: 53,
    height: 53,
    borderRadius: 26.5,
    backgroundColor: '#2563eb',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  fabText: { color: '#fff', fontSize: 26, lineHeight: 29, fontWeight: '300' },
});
