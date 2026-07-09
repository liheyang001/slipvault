import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types/navigation';
import { Invoice } from '../types/invoice';
import { getRoomSummaries, searchInvoices } from '../services/database';
import { exportRoomCSV, exportRoomPDF } from '../services/exporter';
import { capitalizeRoom } from '../utils/rooms';
import InvoiceCard from '../components/InvoiceCard';
import ViewToggle from '../components/ViewToggle';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Rooms'>;
type RoomSummary = { room: string; count: number; total: number };

export default function RoomsScreen() {
  const navigation = useNavigation<Nav>();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  useFocusEffect(
    useCallback(() => {
      const summaries = getRoomSummaries();
      setRooms(summaries);

      // Keep selection if it still exists, otherwise pick the first room.
      const stillExists = summaries.some((s) => s.room === selectedRoom);
      const room = stillExists ? selectedRoom : summaries[0]?.room ?? '';
      setSelectedRoom(room);
      setInvoices(room ? searchInvoices({ room }) : []);
    }, [selectedRoom])
  );

  function handleSelectRoom(room: string) {
    setSelectedRoom(room);
    setInvoices(searchInvoices({ room }));
  }

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

      {/* Summary + export */}
      <View style={styles.summaryRow}>
        <View>
          <Text style={styles.summaryRoom}>{capitalizeRoom(selectedRoom)}</Text>
          <Text style={styles.summarySub}>
            {invoices.length} invoice{invoices.length !== 1 ? 's' : ''} · ${roomTotal.toFixed(2)}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.exportBtn, invoices.length === 0 && styles.exportBtnDisabled]}
          onPress={handleExport}
          disabled={invoices.length === 0}
        >
          <Text style={styles.exportBtnText}>Export for Insurance</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={invoices}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <InvoiceCard
            invoice={item}
            onPress={() => navigation.navigate('InvoiceDetail', { invoiceId: item.id })}
            onDelete={() => {}}
          />
        )}
        contentContainerStyle={styles.list}
      />
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  summaryRoom: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  summarySub: { fontSize: 13, color: '#64748b', marginTop: 2 },
  exportBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 12,
  },
  exportBtnDisabled: { backgroundColor: '#cbd5e1' },
  exportBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  list: { padding: 14, paddingBottom: 40, gap: 10 },

  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40, gap: 10 },
  emptyIcon: { fontSize: 52, marginBottom: 4 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#334155' },
  emptySubtitle: { fontSize: 14, color: '#94a3b8', textAlign: 'center', lineHeight: 20 },
});
