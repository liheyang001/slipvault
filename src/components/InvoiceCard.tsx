import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Invoice } from '../types/invoice';
import { capitalizeRoom, roomIcon } from '../utils/rooms';

interface Props {
  invoice: Invoice;
  onPress: () => void;
  onDelete?: () => void; // omit to hide the delete button
  onLongPress?: () => void;
}

// Category config: accent color + emoji icon
const CATEGORY_CONFIG: Record<string, { color: string; bg: string; icon: string }> = {
  electronics: { color: '#2563eb', bg: '#dbeafe', icon: '💻' },
  furniture:   { color: '#b45309', bg: '#fef3c7', icon: '🛋️' },
  appliances:  { color: '#0d9488', bg: '#ccfbf1', icon: '🔌' },
  jewelry:     { color: '#a21caf', bg: '#fae8ff', icon: '💍' },
  clothing:    { color: '#db2777', bg: '#fce7f3', icon: '👕' },
  tools:       { color: '#57534e', bg: '#f5f5f4', icon: '🔧' },
  sports:      { color: '#059669', bg: '#d1fae5', icon: '⚽' },
  healthcare:  { color: '#dc2626', bg: '#fee2e2', icon: '🏥' },
  transport:   { color: '#0891b2', bg: '#cffafe', icon: '🚗' },
  other:       { color: '#6b7280', bg: '#f3f4f6', icon: '📄' },
  // Legacy categories (still on old invoices; excluded from contents value)
  groceries:   { color: '#16a34a', bg: '#dcfce7', icon: '🛒' },
  restaurant:  { color: '#d97706', bg: '#fef3c7', icon: '🍽️' },
  utilities:   { color: '#7c3aed', bg: '#ede9fe', icon: '⚡' },
};

const DEFAULT_CONFIG = { color: '#6b7280', bg: '#f3f4f6', icon: '📄' };

export default function InvoiceCard({ invoice, onPress, onDelete, onLongPress }: Props) {
  const cfg = CATEGORY_CONFIG[invoice.category?.toLowerCase()] ?? DEFAULT_CONFIG;

  const formattedDate = invoice.date
    ? new Date(invoice.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'No date';

  const warrantyBadge = (() => {
    if (!invoice.warrantyMonths) return null;
    const expiry = new Date(invoice.date);
    expiry.setMonth(expiry.getMonth() + invoice.warrantyMonths);
    const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / 86400000);
    if (daysLeft < 0) return { label: 'Warranty expired', color: '#ef4444', bg: '#fee2e2' };
    if (daysLeft <= 30) return { label: `Warranty: ${daysLeft}d left`, color: '#d97706', bg: '#fef3c7' };
    return null;
  })();

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.75}
    >
      {/* Thumbnail: the actual item, not the receipt; camera placeholder if none */}
      {invoice.itemPhotos?.[0] ? (
        <Image
          source={{ uri: invoice.itemPhotos[0] }}
          style={styles.thumbnail}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
          <Ionicons name="camera-outline" size={26} color="#94a3b8" />
        </View>
      )}

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text style={styles.vendor} numberOfLines={1}>
            {invoice.vendor || 'Unknown Vendor'}
          </Text>
          <Text style={styles.amount}>${invoice.total.toFixed(2)}</Text>
        </View>

        <View style={styles.bottomRow}>
          <Text style={styles.date}>{formattedDate}</Text>
          {warrantyBadge ? (
            <View style={[styles.badge, { backgroundColor: warrantyBadge.bg }]}>
              <Text style={[styles.badgeText, { color: warrantyBadge.color }]}>
                {warrantyBadge.label}
              </Text>
            </View>
          ) : invoice.category ? (
            <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
              <Text style={styles.badgeIcon}>{cfg.icon}</Text>
              <Text style={[styles.badgeText, { color: cfg.color }]}>
                {invoice.category.charAt(0).toUpperCase() + invoice.category.slice(1)}
              </Text>
            </View>
          ) : null}
          {invoice.room ? (
            <View style={[styles.badge, styles.roomBadge]}>
              <Text style={styles.badgeIcon}>{roomIcon(invoice.room)}</Text>
              <Text style={[styles.badgeText, styles.roomBadgeText]} numberOfLines={1}>
                {capitalizeRoom(invoice.room)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Delete */}
      {onDelete && (
        <TouchableOpacity
          style={styles.deleteZone}
          onPress={onDelete}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 4 }}
        >
          <Text style={styles.deleteIcon}>×</Text>
        </TouchableOpacity>
      )}

      {/* Right accent stripe */}
      <View style={[styles.stripe, { backgroundColor: cfg.color }]} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#64748b',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    minHeight: 80,
  },
  stripe: {
    width: 6,
    alignSelf: 'stretch',
  },
  thumbnail: {
    width: 76,
    height: 80,
    backgroundColor: '#f1f5f9',
  },
  thumbnailPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
    justifyContent: 'center',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  vendor: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: -0.2,
  },
  amount: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  date: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '500',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  badgeIcon: { fontSize: 11 },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  roomBadge: { backgroundColor: '#f1f5f9', flexShrink: 1 },
  roomBadgeText: { color: '#475569' },
  deleteZone: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  deleteIcon: {
    fontSize: 22,
    color: '#cbd5e1',
    fontWeight: '300',
    lineHeight: 26,
  },
});
