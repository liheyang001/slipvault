import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export type ToggleView = 'invoices' | 'rooms';

interface Props {
  active: ToggleView;
  onSelect: (view: ToggleView) => void;
}

/** iOS-style segmented control to switch between the Invoices and Rooms views. */
export default function ViewToggle({ active, onSelect }: Props) {
  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.seg, active === 'invoices' && styles.segActive]}
        onPress={() => onSelect('invoices')}
        activeOpacity={0.85}
      >
        <Text style={[styles.segText, active === 'invoices' && styles.segTextActive]}>
          🧾  Invoices
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.seg, active === 'rooms' && styles.segActive]}
        onPress={() => onSelect('rooms')}
        activeOpacity={0.85}
      >
        <Text style={[styles.segText, active === 'rooms' && styles.segTextActive]}>
          🏠  Rooms
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: '#eef2f6',
    borderRadius: 12,
    padding: 4,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 2,
    gap: 4,
  },
  seg: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
  segText: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  segTextActive: { color: '#0f172a', fontWeight: '700' },
});
