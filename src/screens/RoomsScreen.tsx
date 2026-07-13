import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types/navigation';
import { Invoice } from '../types/invoice';
import {
  getRoomSummaries,
  searchInvoices,
  updateInvoice,
  moveRoomInvoices,
  getUserRooms,
} from '../services/database';
import { exportRoomCSV, exportRoomPDF } from '../services/exporter';
import { capitalizeRoom, mergeRooms, normalizeRoom } from '../utils/rooms';
import InvoiceCard from '../components/InvoiceCard';
import ViewToggle from '../components/ViewToggle';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Rooms'>;
type RoomSummary = { room: string; count: number; total: number };

export default function RoomsScreen() {
  const navigation = useNavigation<Nav>();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [moveModal, setMoveModal] = useState<
    { mode: 'one'; invoice: Invoice } | { mode: 'all' } | null
  >(null);

  const refresh = useCallback(
    (preferRoom?: string) => {
      const summaries = getRoomSummaries();
      setRooms(summaries);

      // Keep selection if it still exists, otherwise pick the first room.
      const wanted = preferRoom ?? selectedRoom;
      const room = summaries.some((s) => s.room === wanted)
        ? wanted
        : summaries[0]?.room ?? '';
      setSelectedRoom(room);
      setInvoices(room ? searchInvoices({ room }) : []);
    },
    [selectedRoom]
  );

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  function handleSelectRoom(room: string) {
    setSelectedRoom(room);
    setInvoices(searchInvoices({ room }));
  }

  function handleMove(targetRoom: string) {
    if (!moveModal) return;
    const target = normalizeRoom(targetRoom);
    if (moveModal.mode === 'one') {
      updateInvoice(moveModal.invoice.id, { room: target });
      setMoveModal(null);
      refresh(selectedRoom); // stay in the current room
    } else {
      const moved = moveRoomInvoices(selectedRoom, target);
      setMoveModal(null);
      refresh(target); // follow the contents to their new room
      if (moved > 0) {
        Alert.alert(
          'Moved',
          `${moved} invoice${moved !== 1 ? 's' : ''} moved to ${capitalizeRoom(target)}.`
        );
      }
    }
  }

  // All known rooms (defaults + custom + in-use), excluding the current one.
  const moveTargets = moveModal
    ? [...new Set([...mergeRooms(getUserRooms()), ...rooms.map((r) => r.room)])].filter(
        (r) => r !== selectedRoom
      )
    : [];

  function handleExport() {
    if (invoices.length === 0) return;
    const label = capitalizeRoom(selectedRoom);
    Alert.alert(
      `Export "${label}"`,
      `Insurance inventory for ${invoices.length} invoice${invoices.length !== 1 ? 's' : ''}`,
      [
        {
          text: 'Export as PDF',
          onPress: () =>
            exportRoomPDF(invoices, selectedRoom).catch(() =>
              Alert.alert('Export failed', 'Could not export PDF. Please try again.')
            ),
        },
        {
          text: 'Export as CSV',
          onPress: () =>
            exportRoomCSV(invoices, selectedRoom).catch(() =>
              Alert.alert('Export failed', 'Could not export CSV. Please try again.')
            ),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  const roomTotal = invoices.reduce((sum, inv) => sum + inv.total, 0);

  const toggle = (
    <ViewToggle
      active="rooms"
      onSelect={(v) => {
        if (v === 'invoices') navigation.navigate('Home');
        if (v === 'insurance') navigation.navigate('Insurance');
      }}
    />
  );

  if (rooms.length === 0) {
    return (
      <View style={styles.container}>
        {toggle}
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🏠</Text>
          <Text style={styles.emptyTitle}>No rooms yet</Text>
          <Text style={styles.emptySubtitle}>
            Assign a room when scanning an invoice (or in its detail page) to group your belongings
            by room for insurance.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {toggle}

      {/* Room chip bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.roomBar}
        contentContainerStyle={styles.roomContent}
      >
        {rooms.map((r) => (
          <TouchableOpacity
            key={r.room}
            style={[styles.chip, selectedRoom === r.room && styles.chipActive]}
            onPress={() => handleSelectRoom(r.room)}
          >
            <Text style={[styles.chipText, selectedRoom === r.room && styles.chipTextActive]}>
              {capitalizeRoom(r.room)} ({r.count})
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Summary + actions */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryLeft}>
          <Text style={styles.summaryRoom}>{capitalizeRoom(selectedRoom)}</Text>
          <Text style={styles.summarySub}>
            {invoices.length} invoice{invoices.length !== 1 ? 's' : ''} · ${roomTotal.toFixed(2)}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.moveAllBtn, invoices.length === 0 && styles.btnDisabled]}
          onPress={() => setMoveModal({ mode: 'all' })}
          disabled={invoices.length === 0}
        >
          <Text style={styles.moveAllBtnText}>⇄ Move All</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.exportBtn, invoices.length === 0 && styles.btnDisabled]}
          onPress={handleExport}
          disabled={invoices.length === 0}
        >
          <Text style={styles.exportBtnText}>Export</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.moveHint}>Long-press an invoice to move it to another room</Text>

      <FlatList
        data={invoices}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <InvoiceCard
            invoice={item}
            onPress={() => navigation.navigate('InvoiceDetail', { invoiceId: item.id })}
            onLongPress={() => setMoveModal({ mode: 'one', invoice: item })}
          />
        )}
        contentContainerStyle={styles.list}
      />

      {/* Destination room picker */}
      <Modal
        visible={moveModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setMoveModal(null)}
      >
        <TouchableOpacity
          style={styles.modalBg}
          activeOpacity={1}
          onPress={() => setMoveModal(null)}
        >
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>
              {moveModal?.mode === 'all'
                ? `Move everything in ${capitalizeRoom(selectedRoom)} to…`
                : `Move "${moveModal?.mode === 'one' ? moveModal.invoice.vendor || 'invoice' : ''}" to…`}
            </Text>
            <View style={styles.modalChips}>
              {moveTargets.map((r) => (
                <TouchableOpacity key={r} style={styles.modalChip} onPress={() => handleMove(r)}>
                  <Text style={styles.modalChipText}>{capitalizeRoom(r)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setMoveModal(null)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },

  roomBar: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    maxHeight: 48,
  },
  roomContent: { paddingHorizontal: 14, paddingVertical: 8, gap: 8, flexDirection: 'row' },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f1f5f9' },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { fontSize: 13, color: '#475569', fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '700' },

  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  summaryLeft: { flex: 1 },
  summaryRoom: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  summarySub: { fontSize: 13, color: '#64748b', marginTop: 2 },
  moveAllBtn: {
    backgroundColor: '#eef2f6',
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 12,
  },
  moveAllBtnText: { color: '#334155', fontWeight: '700', fontSize: 13 },
  exportBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
  },
  btnDisabled: { opacity: 0.45 },
  exportBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  moveHint: {
    fontSize: 11,
    color: '#94a3b8',
    paddingHorizontal: 16,
    paddingBottom: 6,
  },

  list: { padding: 14, paddingBottom: 40, gap: 10 },

  // Move modal
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
  modalTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a', lineHeight: 21 },
  modalChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modalChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: '#eef2f6',
  },
  modalChipText: { fontSize: 14, color: '#0f172a', fontWeight: '600' },
  modalCancel: { alignItems: 'center', paddingVertical: 8 },
  modalCancelText: { fontSize: 14, color: '#64748b', fontWeight: '600' },

  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40, gap: 10 },
  emptyIcon: { fontSize: 52, marginBottom: 4 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#334155' },
  emptySubtitle: { fontSize: 14, color: '#94a3b8', textAlign: 'center', lineHeight: 20 },
});
