import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types/navigation';
import {
  insertInvoice,
  updateInvoice,
  getUserCategories,
  getUserRooms,
  saveUserRoom,
} from '../services/database';
import { scheduleWarrantyReminder } from '../services/notifications';
import { DEFAULT_CATEGORIES, capitalize, normalizeCategory } from '../utils/categories';
import { mergeRooms, capitalizeRoom, normalizeRoom, roomIcon } from '../utils/rooms';
import { formatNZDate, parseNZDate } from '../utils/dates';

const WARRANTY_OPTIONS = [
  { label: 'None', months: 0 },
  { label: '1 Year', months: 12 },
  { label: '2 Years', months: 24 },
  { label: '3 Years', months: 36 },
];

type Props = NativeStackScreenProps<RootStackParamList, 'ManualEntry'>;

/** Add a belonging by hand — for items whose receipt is lost (gifts, cash buys...). */
export default function ManualEntryScreen({ route, navigation }: Props) {
  const defaultRoom = route.params?.defaultRoom ?? '';

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(formatNZDate(new Date().toISOString().slice(0, 10)));
  const [category, setCategory] = useState('');
  const [room, setRoom] = useState(defaultRoom);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [warrantyMonths, setWarrantyMonths] = useState(0);
  const [photos, setPhotos] = useState<string[]>([]); // picker URIs, persisted on save
  const [saving, setSaving] = useState(false);

  const categoryPresets = [
    ...DEFAULT_CATEGORIES,
    ...getUserCategories().filter((c) => !DEFAULT_CATEGORIES.includes(c)),
  ];
  const roomPresets = mergeRooms(getUserRooms());

  async function addPhoto(useCamera: boolean) {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permission needed', 'Camera access is required to photograph items.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          quality: 0.7,
        });
      }
      if (result.canceled || result.assets.length === 0) return;
      setPhotos((prev) => [...prev, ...result.assets.map((a) => a.uri)]);
    } catch {
      Alert.alert('Error', 'Failed to add photo. Please try again.');
    }
  }

  function handleAddPhoto() {
    Alert.alert('Add Item Photo', 'Photograph the item — with no receipt, this is your proof.', [
      { text: 'Take Photo', onPress: () => addPhoto(true) },
      { text: 'Choose from Gallery', onPress: () => addPhoto(false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function removePhoto(uri: string) {
    Alert.alert('Remove Photo', 'Remove this photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => setPhotos((prev) => prev.filter((u) => u !== uri)),
      },
    ]);
  }

  async function persistPhotos(uris: string[]): Promise<string[]> {
    const dir = `${FileSystem.documentDirectory}item_photos/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const saved: string[] = [];
    for (const uri of uris) {
      const dest = `${dir}item_${Date.now()}_${Math.floor(Math.random() * 1e6)}.jpg`;
      await FileSystem.copyAsync({ from: uri, to: dest });
      saved.push(dest);
    }
    return saved;
  }

  async function handleSave() {
    if (saving) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Name required', 'Give the item a name so you can find it later.');
      return;
    }
    const total = parseFloat(amount);
    if (!Number.isFinite(total) || total < 0) {
      Alert.alert('Amount required', 'Enter what the item cost (roughly is fine).');
      return;
    }
    const isoDate = parseNZDate(date);
    if (!isoDate) {
      Alert.alert('Invalid date', 'Use the DD/MM/YYYY format, e.g. 05/11/2024.');
      return;
    }

    const resolvedRoom = normalizeRoom(room);
    if (resolvedRoom) saveUserRoom(resolvedRoom);

    setSaving(true);
    try {
      const itemPhotos = await persistPhotos(photos);
      const invoice = insertInvoice({
        photoUri: '', // no receipt — that's the point
        ocrText: '',
        vendor: trimmedName,
        date: isoDate,
        items: [],
        subtotal: total,
        tax: 0,
        total,
        category: normalizeCategory(category) || 'other',
        room: resolvedRoom,
        itemPhotos,
        brand: brand.trim(),
        model: model.trim(),
        serialNumber: serial.trim(),
        tags: [],
        status: 'done',
        warrantyMonths,
      });

      if (warrantyMonths > 0) {
        scheduleWarrantyReminder(invoice.id, trimmedName, date.trim(), warrantyMonths)
          .then((notifId) => {
            if (notifId) updateInvoice(invoice.id, { warrantyNotifId: notifId });
          })
          .catch(() => {});
      }

      navigation.replace('InvoiceDetail', { invoiceId: invoice.id });
    } catch {
      Alert.alert('Error', 'Failed to save. Please try again.');
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.banner}>
          <Ionicons name="information-circle-outline" size={18} color="#2563eb" />
          <Text style={styles.bannerText}>
            No receipt? No problem — add the item with photos as proof. You can attach a receipt
            or bank statement later from its detail page.
          </Text>
        </View>

        {/* Photos: the key evidence when there's no receipt */}
        <View style={styles.field}>
          <Text style={styles.label}>Item Photos</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.photoRow}
          >
            {photos.map((uri) => (
              <TouchableOpacity key={uri} onPress={() => removePhoto(uri)} activeOpacity={0.8}>
                <Image source={{ uri }} style={styles.photoThumb} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.addPhotoTile} onPress={handleAddPhoto}>
              <Ionicons name="camera-outline" size={22} color="#2563eb" />
              <Text style={styles.addPhotoText}>Add</Text>
            </TouchableOpacity>
          </ScrollView>
          {photos.length > 0 && <Text style={styles.hint}>Tap a photo to remove it</Text>}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Item Name *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder='e.g. MacBook Pro 14" or Leather Sofa'
            placeholderTextColor="#9ca3af"
          />
        </View>

        <View style={styles.rowPair}>
          <View style={[styles.field, styles.rowField]}>
            <Text style={styles.label}>Amount (Incl. GST) *</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor="#9ca3af"
              keyboardType="decimal-pad"
            />
          </View>
          <View style={[styles.field, styles.rowField]}>
            <Text style={styles.label}>Purchase Date</Text>
            <TextInput
              style={styles.input}
              value={date}
              onChangeText={setDate}
              placeholder="DD/MM/YYYY"
              placeholderTextColor="#9ca3af"
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Category</Text>
          <View style={styles.chips}>
            {categoryPresets.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.chip, category === c && styles.chipActive]}
                onPress={() => setCategory(c)}
              >
                <Text style={[styles.chipText, category === c && styles.chipTextActive]}>
                  {capitalize(c)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Room</Text>
          <TextInput
            style={styles.input}
            value={room}
            onChangeText={setRoom}
            placeholder="e.g. Living Room, Kids Room..."
            placeholderTextColor="#9ca3af"
            autoCapitalize="words"
          />
          <View style={styles.chips}>
            {roomPresets.map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.chip, normalizeRoom(room) === r && styles.chipActive]}
                onPress={() => setRoom(r)}
              >
                <Text style={styles.chipIcon}>{roomIcon(r)}</Text>
                <Text style={[styles.chipText, normalizeRoom(room) === r && styles.chipTextActive]}>
                  {capitalizeRoom(r)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Brand / Model / Serial (insurers ask for these)</Text>
          <TextInput
            style={styles.input}
            value={brand}
            onChangeText={setBrand}
            placeholder="Brand, e.g. Apple"
            placeholderTextColor="#9ca3af"
          />
          <TextInput
            style={[styles.input, styles.inputSpaced]}
            value={model}
            onChangeText={setModel}
            placeholder='Model, e.g. MacBook Pro 14"'
            placeholderTextColor="#9ca3af"
          />
          <TextInput
            style={[styles.input, styles.inputSpaced]}
            value={serial}
            onChangeText={setSerial}
            placeholder="Serial number"
            placeholderTextColor="#9ca3af"
            autoCapitalize="characters"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Warranty</Text>
          <View style={styles.chips}>
            {WARRANTY_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.months}
                style={[styles.chip, warrantyMonths === opt.months && styles.chipActive]}
                onPress={() => setWarrantyMonths(opt.months)}
              >
                <Text
                  style={[styles.chipText, warrantyMonths === opt.months && styles.chipTextActive]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Item'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  scroll: { padding: 16, paddingBottom: 24 },

  banner: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  bannerText: { flex: 1, fontSize: 12, color: '#1e40af', lineHeight: 17 },

  field: { backgroundColor: '#fff', padding: 12, marginBottom: 8, borderRadius: 8 },
  rowPair: { flexDirection: 'row', gap: 8 },
  rowField: { flex: 1 },
  label: { fontSize: 12, color: '#999', fontWeight: '600', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#f9fafb',
  },
  inputSpaced: { marginTop: 8 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#f9fafb',
  },
  chipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipIcon: { fontSize: 12 },
  chipText: { fontSize: 13, color: '#374151' },
  chipTextActive: { color: '#fff', fontWeight: '600' },

  photoRow: { gap: 8, paddingTop: 4 },
  photoThumb: { width: 60, height: 60, borderRadius: 8, backgroundColor: '#e5e7eb' },
  addPhotoTile: {
    width: 60,
    height: 60,
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#93c5fd',
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  addPhotoText: { fontSize: 10, color: '#2563eb', fontWeight: '600' },
  hint: { marginTop: 8, fontSize: 11, color: '#9ca3af', fontStyle: 'italic' },

  controls: { padding: 16, borderTopWidth: 1, borderTopColor: '#eee', backgroundColor: '#fff' },
  saveBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
});
