import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export type ToggleView = 'invoices' | 'rooms' | 'insurance';

const SEGMENTS: { key: ToggleView; label: string }[] = [
  { key: 'invoices', label: '🧾 Invoices' },
  { key: 'rooms', label: '🏠 Rooms' },
  { key: 'insurance', label: '🛡️ Insurance' },
];

interface Props {
  active: ToggleView;
  onSelect: (view: ToggleView) => void;
}

/** iOS-style segmented control to switch between top-level views. */
export default function ViewToggle({ active, onSelect }: Props) {
  return (
    <View style={styles.wrap}>
      {SEGMENTS.map((seg) => (
        <TouchableOpacity
          key={seg.key}
          style={[styles.seg, active === seg.key && styles.segActive]}
          onPress={() => onSelect(seg.key)}
          activeOpacity={0.85}
        >
          <Text
            style={[styles.segText, active === seg.key && styles.segTextActive]}
            numberOfLines={1}
          >
            {seg.label}
          </Text>
        </TouchableOpacity>
      ))}
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
  segText: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  segTextActive: { color: '#0f172a', fontWeight: '700' },
});
