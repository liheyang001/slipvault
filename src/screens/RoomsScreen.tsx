import React, { useCallback, useEffect, useState } from 'react';
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
  deleteInvoice,
  getUserRooms,
} from '../services/database';
import { capitalizeRoom, mergeRooms, normalizeRoom } from '../utils/rooms';
import InvoiceCard from '../components/InvoiceCard';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>;
type RoomSummary = { room: string; count: number; total: number };

interface Props {
  /** Search query, owned by the fixed header in HomeScreen. */
  query?: string;
  /** Reports the currently selected room so the bottom bar can export it. */
  onRoomChange?: (room: string) => void;
}

export default function RoomsScreen({ query = '', onRoomChange }: Props) {
  const navigation = useNavigation<Nav>();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [moveModal, setMoveModal] = useState<
    { mode: 'one'; invoice: Invoice } | { mode: 'selected' } | null
  >(null);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
      setInvoices(room ? searchInvoices({ room, query: query || undefined }) : []);
    },
    [selectedRoom, query]
  );

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  useEffect(() => {
    onRoomChange?.(selectedRoom);
  }, [selectedRoom, onRoomChange]);

  function handleSelectRoom(room: string) {
    setSelectedRoom(room);
    setInvoices(searchInvoices({ room, query: query || undefined }));
    // Selection belongs to the previous room's list — leave edit mode
    setEditing(false);
    setSelected(new Set());
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelectAll() {
    setSelected((prev) =>
      prev.size === invoices.length ? new Set() : new Set(invoices.map((i) => i.id))
    );
  }

  function exitEdit() {
    setEditing(false);
    setSelected(new Set());
  }

  function handleDeleteSelected() {
    const count = selected.size;
    if (count === 0) return;
    Alert.alert(
      'Delete Invoices',
      `Delete ${count} invoice${count !== 1 ? 's' : ''}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            selected.forEach((id) => deleteInvoice(id));
            exitEdit();
            refresh(selectedRoom);
          },
        },
      ]
    );
  }

  function handleMove(targetRoom: string) {
    if (!moveModal) return;
    const target = normalizeRoom(targetRoom);
    if (moveModal.mode === 'one') {
      updateInvoice(moveModal.invoice.id, { room: target });
      setMoveModal(null);
      refresh(selectedRoom); // stay in the current room
    } else {
      const ids = [...selected];
      ids.forEach((id) => updateInvoice(id, { room: target }));
      setMoveModal(null);
      exitEdit();
      refresh(selectedRoom); // stay to see what's left
      if (ids.length > 0) {
        Alert.alert(
          'Moved',
          `${ids.length} invoice${ids.length !== 1 ? 's' : ''} moved to ${capitalizeRoom(target)}.`
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

  const roomTotal = invoices.reduce((sum, inv) => sum + inv.total, 0);

  if (rooms.length === 0) {
    return (
      <View style={styles.container}>
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
        {!editing ? (
          <>
            <View style={styles.summaryLeft}>
              <Text style={styles.summaryRoom}>{capitalizeRoom(selectedRoom)}</Text>
              <Text style={styles.summarySub}>
                {invoices.length} invoice{invoices.length !== 1 ? 's' : ''} · $
                {roomTotal.toFixed(2)}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.editBtn, invoices.length === 0 && styles.btnDisabled]}
              onPress={() => setEditing(true)}
              disabled={invoices.length === 0}
            >
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={styles.summaryLeft}>
              <Text style={styles.summaryRoom}>{selected.size} selected</Text>
            </View>
            <TouchableOpacity style={styles.editBtn} onPress={exitEdit}>
              <Text style={styles.editBtnText}>Cancel</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Edit mode actions: Select All · Move to · Delete in one row */}
      {editing && (
        <View style={styles.editActions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.selectAllBtn]}
            onPress={handleSelectAll}
          >
            <Text style={styles.selectAllBtnText}>
              {selected.size === invoices.length ? 'Deselect All' : 'Select All'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.moveBtn, selected.size === 0 && styles.btnDisabled]}
            onPress={() => setMoveModal({ mode: 'selected' })}
            disabled={selected.size === 0}
          >
            <Text style={styles.actionBtnText}>⇄ Move to…</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.deleteBtn, selected.size === 0 && styles.btnDisabled]}
            onPress={handleDeleteSelected}
            disabled={selected.size === 0}
          >
            <Text style={styles.actionBtnText}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}

      {!editing && (
        <Text style={styles.moveHint}>Long-press an invoice to move it to another room</Text>
      )}

      <FlatList
        data={invoices}
        keyExtractor={(item) => item.id}
        extraData={[editing, selected]}
        renderItem={({ item }) => {
          if (!editing) {
            return (
              <InvoiceCard
                invoice={item}
                onPress={() => navigation.navigate('InvoiceDetail', { invoiceId: item.id })}
                onLongPress={() => setMoveModal({ mode: 'one', invoice: item })}
              />
            );
          }
          const isSelected = selected.has(item.id);
          return (
            // Whole row is one tap target; the card itself is non-interactive here
            <TouchableOpacity
              style={styles.selectableRow}
              onPress={() => toggleSelect(item.id)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkCircle, isSelected && styles.checkCircleOn]}>
                {isSelected && <Text style={styles.checkMark}>✓</Text>}
              </View>
              <View style={{ flex: 1 }} pointerEvents="none">
                <InvoiceCard invoice={item} onPress={() => {}} />
              </View>
            </TouchableOpacity>
          );
        }}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          query ? (
            <View style={styles.noMatch}>
              <Text style={styles.noMatchText}>
                No matches for "{query}" in {capitalizeRoom(selectedRoom)}
              </Text>
            </View>
          ) : null
        }
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
              {moveModal?.mode === 'selected'
                ? `Move ${selected.size} invoice${selected.size !== 1 ? 's' : ''} to…`
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

  noMatch: { alignItems: 'center', paddingTop: 40 },
  noMatchText: { fontSize: 13, color: '#94a3b8' },

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
  editBtn: {
    backgroundColor: '#eef2f6',
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtnText: { color: '#334155', fontWeight: '700', fontSize: 13 },
  btnDisabled: { opacity: 0.45 },

  // Edit mode
  editActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectAllBtn: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#2563eb',
  },
  selectAllBtnText: { color: '#2563eb', fontWeight: '700', fontSize: 13 },
  moveBtn: { backgroundColor: '#2563eb' },
  deleteBtn: { backgroundColor: '#ef4444' },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  selectableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '800', lineHeight: 16 },

  moveHint: {
    fontSize: 13,
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
