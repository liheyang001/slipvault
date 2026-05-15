import React, { useEffect, useState, useLayoutEffect } from 'react';
import {
  StyleSheet,
  View,
  Image,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
  Dimensions,
  StatusBar,
  Animated,
  PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { getInvoiceById, deleteInvoice, updateInvoice, getUserCategories, saveUserCategory } from '../services/database';
import { cancelWarrantyReminder, scheduleWarrantyReminder } from '../services/notifications';
import { Invoice } from '../types/invoice';
import { RootStackParamList } from '../types/navigation';
import { DEFAULT_CATEGORIES, capitalize, normalizeCategory } from '../utils/categories';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const WARRANTY_OPTIONS = [
  { label: 'None', months: 0 },
  { label: '1 Year', months: 12 },
  { label: '2 Years', months: 24 },
  { label: '3 Years', months: 36 },
];

type Props = NativeStackScreenProps<RootStackParamList, 'InvoiceDetail'>;

export default function InvoiceDetailScreen({ route, navigation }: Props) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editVendor, setEditVendor] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editWarrantyMonths, setEditWarrantyMonths] = useState(0);
  const [categoryPresets, setCategoryPresets] = useState<string[]>(DEFAULT_CATEGORIES);
  const [photoModalVisible, setPhotoModalVisible] = useState(false);

  const scale = React.useRef(new Animated.Value(1)).current;
  const committedScale = React.useRef(1);
  const gestureStartDist = React.useRef<number | null>(null);
  const liveScale = React.useRef(1);

  const getDistance = (touches: React.Touch[]) => {
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const pinchResponder = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        if (evt.nativeEvent.touches.length === 2) {
          gestureStartDist.current = getDistance([...evt.nativeEvent.touches] as any);
        }
      },
      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2 && gestureStartDist.current !== null) {
          const dist = getDistance([...touches] as any);
          const next = Math.min(Math.max(committedScale.current * (dist / gestureStartDist.current), 1), 4);
          liveScale.current = next;
          scale.setValue(next);
        }
      },
      onPanResponderRelease: () => {
        committedScale.current = liveScale.current;
        gestureStartDist.current = null;
      },
    })
  ).current;

  const handleCloseModal = () => {
    scale.setValue(1);
    committedScale.current = 1;
    liveScale.current = 1;
    setPhotoModalVisible(false);
  };

  useEffect(() => {
    const { invoiceId } = route.params;
    const inv = getInvoiceById(invoiceId);
    setInvoice(inv);
  }, [route.params]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={isEditing ? handleCancel : handleStartEdit} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>{isEditing ? 'Cancel' : 'Edit'}</Text>
        </TouchableOpacity>
      ),
    });
  }, [isEditing, invoice]);

  const handleStartEdit = () => {
    if (!invoice) return;
    const userCats = getUserCategories();
    const merged = [
      ...DEFAULT_CATEGORIES,
      ...userCats.filter((c) => !DEFAULT_CATEGORIES.includes(c)),
    ];
    setCategoryPresets(merged);
    setEditVendor(invoice.vendor ?? '');
    setEditDate(invoice.date ?? '');
    setEditCategory(normalizeCategory(invoice.category ?? ''));
    setEditWarrantyMonths(invoice.warrantyMonths ?? 0);
    setIsEditing(true);
  };

  const handleCancel = () => setIsEditing(false);

  const handleSave = () => {
    if (!invoice) return;
    const normalized = normalizeCategory(editCategory);
    if (normalized) {
      saveUserCategory(normalized);
      const userCats = getUserCategories();
      const merged = [
        ...DEFAULT_CATEGORIES,
        ...userCats.filter((c) => !DEFAULT_CATEGORIES.includes(c)),
      ];
      setCategoryPresets(merged);
    }
    updateInvoice(invoice.id, {
      vendor: editVendor.trim(),
      date: editDate.trim(),
      category: normalized,
      warrantyMonths: editWarrantyMonths,
    });

    if (invoice.warrantyNotifId) {
      cancelWarrantyReminder(invoice.warrantyNotifId).catch(() => {});
    }
    if (editWarrantyMonths > 0) {
      scheduleWarrantyReminder(
        invoice.id,
        editVendor.trim() || invoice.vendor,
        editDate.trim() || invoice.date,
        editWarrantyMonths
      ).then((notifId) => {
        if (notifId) updateInvoice(invoice.id, { warrantyNotifId: notifId });
      }).catch(() => {});
    } else {
      updateInvoice(invoice.id, { warrantyNotifId: '' });
    }

    const updated = getInvoiceById(invoice.id);
    setInvoice(updated);
    setIsEditing(false);
  };

  const handleDelete = () => {
    Alert.alert('Delete Invoice', 'Are you sure?', [
      { text: 'Cancel' },
      {
        text: 'Delete',
        onPress: () => {
          if (invoice) {
            if (invoice.warrantyNotifId) {
              cancelWarrantyReminder(invoice.warrantyNotifId).catch(() => {});
            }
            deleteInvoice(invoice.id);
            navigation.goBack();
          }
        },
        style: 'destructive',
      },
    ]);
  };

  const handleSavePhoto = async () => {
    if (!invoice) return;
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access to save the image.');
      return;
    }
    const cacheUri = `${FileSystem.cacheDirectory}save_tmp_${Date.now()}.jpg`;
    try {
      await FileSystem.copyAsync({ from: invoice.photoUri, to: cacheUri });
      await MediaLibrary.saveToLibraryAsync(cacheUri);
      Alert.alert('Saved', 'Photo saved to your gallery.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save photo.');
    } finally {
      FileSystem.deleteAsync(cacheUri, { idempotent: true }).catch(() => {});
    }
  };

  if (!invoice) {
    return (
      <SafeAreaView style={styles.container}>
        <Text>Loading...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        {/* Tappable photo */}
        <TouchableOpacity onPress={() => setPhotoModalVisible(true)} activeOpacity={0.9}>
          <Image source={{ uri: invoice.photoUri }} style={styles.image} />
          <View style={styles.photoHint}>
            <Text style={styles.photoHintText}>Tap to enlarge</Text>
          </View>
        </TouchableOpacity>

        <View style={styles.content}>
          {/* Merchant */}
          <View style={styles.field}>
            <Text style={styles.label}>Merchant</Text>
            {isEditing ? (
              <TextInput style={styles.input} value={editVendor} onChangeText={setEditVendor} placeholder="Merchant name" />
            ) : (
              <Text style={styles.value}>{invoice.vendor}</Text>
            )}
          </View>

          {/* Date */}
          <View style={styles.field}>
            <Text style={styles.label}>Date</Text>
            {isEditing ? (
              <TextInput
                style={styles.input}
                value={editDate}
                onChangeText={setEditDate}
                placeholder="YYYY-MM-DD or YYYY-MM-DD HH:MM"
              />
            ) : (
              <Text style={styles.value}>{invoice.date}</Text>
            )}
          </View>

          {/* Category */}
          <View style={styles.field}>
            <Text style={styles.label}>Category</Text>
            {isEditing ? (
              <View>
                <TextInput
                  style={styles.input}
                  value={editCategory}
                  onChangeText={setEditCategory}
                  placeholder="Type any category, e.g. toy..."
                  autoCapitalize="none"
                />
                <View style={styles.presets}>
                  {categoryPresets.map((cat) => (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.preset, editCategory === cat && styles.presetActive]}
                      onPress={() => setEditCategory(cat)}
                    >
                      <Text style={[styles.presetText, editCategory === cat && styles.presetTextActive]}>
                        {capitalize(cat)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.hintText}>Custom categories are saved automatically for future use.</Text>
              </View>
            ) : (
              <Text style={styles.value}>{capitalize(invoice.category) || 'Other'}</Text>
            )}
          </View>

          {/* Warranty selector (edit mode) */}
          {isEditing && (
            <View style={styles.field}>
              <Text style={styles.label}>Warranty</Text>
              <View style={styles.presets}>
                {WARRANTY_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.months}
                    style={[styles.preset, editWarrantyMonths === opt.months && styles.presetActive]}
                    onPress={() => setEditWarrantyMonths(opt.months)}
                  >
                    <Text style={[styles.presetText, editWarrantyMonths === opt.months && styles.presetTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Subtotal */}
          <View style={styles.field}>
            <Text style={styles.label}>Subtotal</Text>
            <Text style={styles.value}>${invoice.subtotal.toFixed(2)}</Text>
          </View>

          {/* Tax */}
          <View style={styles.field}>
            <Text style={styles.label}>Tax</Text>
            <Text style={styles.value}>${invoice.tax.toFixed(2)}</Text>
          </View>

          {/* Total */}
          <View style={styles.field}>
            <Text style={styles.label}>Total</Text>
            <Text style={[styles.value, styles.totalValue]}>${invoice.total.toFixed(2)}</Text>
          </View>

          {/* Warranty display */}
          {(invoice.warrantyMonths ?? 0) > 0 && (() => {
            const expiry = new Date(invoice.date);
            expiry.setMonth(expiry.getMonth() + (invoice.warrantyMonths ?? 0));
            const now = new Date();
            const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / 86400000);
            const expired = daysLeft < 0;
            const expiring = !expired && daysLeft <= 30;
            return (
              <View style={[styles.field, expired && styles.fieldExpired, expiring && styles.fieldExpiring]}>
                <Text style={styles.label}>Warranty</Text>
                <Text style={[styles.value, expired && styles.valueExpired, expiring && styles.valueExpiring]}>
                  {expired
                    ? `Expired on ${expiry.toDateString()}`
                    : expiring
                    ? `Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} (${expiry.toDateString()})`
                    : `Valid until ${expiry.toDateString()}`}
                </Text>
              </View>
            );
          })()}

          {/* Items */}
          {invoice.items && invoice.items.length > 0 && (
            <View style={styles.field}>
              <Text style={styles.label}>Items</Text>
              {invoice.items.map((item, idx) => (
                <Text key={idx} style={styles.itemText}>
                  {item.name} x{item.quantity} = ${item.totalPrice?.toFixed(2)}
                </Text>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <View style={styles.controls}>
        {isEditing ? (
          <TouchableOpacity style={[styles.button, styles.saveButton]} onPress={handleSave}>
            <Text style={styles.buttonText}>Save Changes</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.button, styles.deleteButton]} onPress={handleDelete}>
            <Text style={styles.buttonText}>Delete</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Photo zoom modal */}
      <Modal
        visible={photoModalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={handleCloseModal}
      >
        <View style={styles.modalBg}>
          <View style={styles.modalImageContainer} {...pinchResponder.panHandlers}>
            <Animated.Image
              source={{ uri: invoice.photoUri }}
              style={[styles.modalImage, { transform: [{ scale }] }]}
              resizeMode="contain"
            />
          </View>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalBtn} onPress={handleSavePhoto}>
              <Text style={styles.modalBtnText}>Save to Photos</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modalBtn, styles.modalBtnClose]} onPress={handleCloseModal}>
              <Text style={styles.modalBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  headerBtn: { paddingHorizontal: 4 },
  headerBtnText: { color: '#2563EB', fontSize: 16, fontWeight: '600' },

  image: { width: '100%', height: 250 },
  photoHint: {
    position: 'absolute',
    bottom: 8,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  photoHintText: { color: '#fff', fontSize: 11 },

  content: { padding: 16 },
  field: { backgroundColor: '#fff', padding: 12, marginBottom: 8, borderRadius: 8 },
  label: { fontSize: 12, color: '#999', fontWeight: '600' },
  value: { fontSize: 16, color: '#000', marginTop: 4 },
  totalValue: { fontSize: 18, fontWeight: 'bold', color: '#4CAF50' },
  fieldExpired: { borderLeftWidth: 3, borderLeftColor: '#ef4444' },
  fieldExpiring: { borderLeftWidth: 3, borderLeftColor: '#f59e0b' },
  valueExpired: { color: '#ef4444' },
  valueExpiring: { color: '#d97706' },
  itemText: { fontSize: 14, color: '#666', marginTop: 4, marginLeft: 8 },
  input: {
    marginTop: 6,
    fontSize: 16,
    color: '#000',
    borderBottomWidth: 1,
    borderBottomColor: '#2563EB',
    paddingBottom: 4,
  },
  presets: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 8 },
  preset: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#f9fafb',
  },
  presetActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  presetText: { fontSize: 13, color: '#374151' },
  presetTextActive: { color: '#fff', fontWeight: '600' },
  hintText: { marginTop: 8, fontSize: 11, color: '#9ca3af', fontStyle: 'italic' },

  controls: { padding: 16, borderTopWidth: 1, borderTopColor: '#eee' },
  button: { paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  saveButton: { backgroundColor: '#2563EB' },
  deleteButton: { backgroundColor: '#f44336' },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  // Modal
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  modalImageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  modalImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.82,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    paddingBottom: 32,
  },
  modalBtn: {
    flex: 1,
    backgroundColor: '#2563eb',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalBtnClose: { backgroundColor: '#374151' },
  modalBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
