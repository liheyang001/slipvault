import React, { useEffect, useState, useLayoutEffect } from 'react';
import {
  StyleSheet,
  View,
  Image,
  Text,
  ScrollView,
  FlatList,
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
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { getInvoiceById, deleteInvoice, updateInvoice, getUserCategories, saveUserCategory, getUserRooms, saveUserRoom } from '../services/database';
import { cancelWarrantyReminder, scheduleWarrantyReminder } from '../services/notifications';
import { Invoice } from '../types/invoice';
import { RootStackParamList } from '../types/navigation';
import { DEFAULT_CATEGORIES, capitalize, normalizeCategory } from '../utils/categories';
import { mergeRooms, capitalizeRoom, normalizeRoom, roomIcon } from '../utils/rooms';
import { exclFromIncl, inclFromExcl } from '../utils/tax';
import BarcodeScannerModal from '../components/BarcodeScannerModal';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Photo block: main square takes 70% of the row, thumb column fills the rest exactly.
const PHOTO_ROW_WIDTH = SCREEN_WIDTH - 40; // minus content padding (32) + gap (8)
const MAIN_PHOTO_SIZE = Math.round(PHOTO_ROW_WIDTH * 0.78);
const THUMB_SIZE = PHOTO_ROW_WIDTH - MAIN_PHOTO_SIZE;

const WARRANTY_OPTIONS = [
  { label: 'None', months: 0 },
  { label: '1 Year', months: 12 },
  { label: '2 Years', months: 24 },
  { label: '3 Years', months: 36 },
];

/** Chip label for a warranty span that isn't one of the presets. */
function formatWarranty(months: number): string {
  if (months % 12 === 0) {
    const years = months / 12;
    return `${years} Year${years !== 1 ? 's' : ''}`;
  }
  const years = +(months / 12).toFixed(2);
  return `${years} Years`;
}

type Props = NativeStackScreenProps<RootStackParamList, 'InvoiceDetail'>;

export default function InvoiceDetailScreen({ route, navigation }: Props) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editVendor, setEditVendor] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editRoom, setEditRoom] = useState('');
  const [editBrand, setEditBrand] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editSerial, setEditSerial] = useState('');
  const [roomPresets, setRoomPresets] = useState<string[]>(mergeRooms([]));
  const [editWarrantyMonths, setEditWarrantyMonths] = useState(0);
  const [editSubtotal, setEditSubtotal] = useState('');
  const [editTotal, setEditTotal] = useState('');
  const [categoryPresets, setCategoryPresets] = useState<string[]>(DEFAULT_CATEGORIES);
  const [modalUri, setModalUri] = useState<string | null>(null);
  const [galleryKey, setGalleryKey] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [heroUri, setHeroUri] = useState<string | null>(null);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [warrantyModalVisible, setWarrantyModalVisible] = useState(false);
  const [warrantyYearsInput, setWarrantyYearsInput] = useState('');
  const [scannerVisible, setScannerVisible] = useState(false);

  const scale = React.useRef(new Animated.Value(1)).current;
  const committedScale = React.useRef(1);
  const gestureStartDist = React.useRef<number | null>(null);
  const liveScale = React.useRef(1);

  const getDistance = (touches: React.Touch[]) => {
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Claim the gesture only with two fingers so single-finger swipes page the gallery.
  const pinchResponder = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length >= 2,
      onStartShouldSetPanResponderCapture: (evt) => evt.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponderCapture: (evt) => evt.nativeEvent.touches.length >= 2,
      onPanResponderGrant: (evt) => {
        setZoomed(true); // freeze paging while pinching
        if (evt.nativeEvent.touches.length === 2) {
          gestureStartDist.current = getDistance([...evt.nativeEvent.touches] as any);
        }
      },
      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2 && gestureStartDist.current === null) {
          gestureStartDist.current = getDistance([...touches] as any);
        }
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
        setZoomed(liveScale.current > 1.01);
      },
      onPanResponderTerminate: () => {
        committedScale.current = liveScale.current;
        gestureStartDist.current = null;
        setZoomed(liveScale.current > 1.01);
      },
    })
  ).current;

  const resetZoom = () => {
    scale.setValue(1);
    committedScale.current = 1;
    liveScale.current = 1;
    setZoomed(false);
  };

  const handleCloseModal = () => {
    resetZoom();
    setModalUri(null);
  };

  /** Open the full-screen gallery starting at the given photo. */
  const openGallery = (uri: string) => {
    resetZoom();
    setGalleryKey((k) => k + 1); // remount the list so it starts on the tapped photo
    setModalUri(uri);
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
    setRoomPresets(mergeRooms(getUserRooms()));
    setEditVendor(invoice.vendor ?? '');
    setEditDate(invoice.date ?? '');
    setEditCategory(normalizeCategory(invoice.category ?? ''));
    setEditRoom(normalizeRoom(invoice.room ?? ''));
    setEditBrand(invoice.brand ?? '');
    setEditModel(invoice.model ?? '');
    setEditSerial(invoice.serialNumber ?? '');
    setEditWarrantyMonths(invoice.warrantyMonths ?? 0);
    setEditSubtotal(invoice.subtotal.toFixed(2));
    setEditTotal(invoice.total.toFixed(2));
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
    const normalizedRoom = normalizeRoom(editRoom);
    if (normalizedRoom) {
      saveUserRoom(normalizedRoom);
      setRoomPresets(mergeRooms(getUserRooms()));
    }
    const subtotal = parseFloat(editSubtotal) || 0;
    const total = parseFloat(editTotal) || 0;
    // Tax is no longer entered directly — keep data consistent: tax = total - subtotal
    const tax = Math.max(0, Math.round((total - subtotal) * 100) / 100);
    updateInvoice(invoice.id, {
      vendor: editVendor.trim(),
      date: editDate.trim(),
      category: normalized,
      room: normalizedRoom,
      brand: editBrand.trim(),
      model: editModel.trim(),
      serialNumber: editSerial.trim(),
      warrantyMonths: editWarrantyMonths,
      subtotal,
      tax,
      total,
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
    Alert.alert('Delete Item', 'Are you sure?', [
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
    const sourceUri = modalUri ?? invoice?.photoUri;
    if (!sourceUri) return;
    // Write-only access: enough to add photos, avoids the stricter read permission.
    const perm = await MediaLibrary.requestPermissionsAsync(true);
    if (!perm.granted && perm.accessPrivileges !== 'limited') {
      Alert.alert('Permission needed', 'Please allow photo library access to save the image.');
      return;
    }
    const cacheUri = `${FileSystem.cacheDirectory}save_tmp_${Date.now()}.jpg`;
    try {
      await FileSystem.copyAsync({ from: sourceUri, to: cacheUri });
      const asset = await MediaLibrary.createAssetAsync(cacheUri);
      // Group into a "Slipvault" album so it's easy to find; skip silently if not allowed.
      try {
        const album = await MediaLibrary.getAlbumAsync('Slipvault');
        if (album) await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
        else await MediaLibrary.createAlbumAsync('Slipvault', asset, false);
      } catch {}
      Alert.alert('Saved', 'Photo saved to your gallery (Slipvault album).');
    } catch (e: any) {
      Alert.alert('Save failed', e?.message ?? 'Could not save the photo.');
    } finally {
      FileSystem.deleteAsync(cacheUri, { idempotent: true }).catch(() => {});
    }
  };

  // ─── Item photos (proof of ownership) ──────────────────────────────────────

  async function persistItemPhoto(uri: string): Promise<string> {
    const dir = `${FileSystem.documentDirectory}item_photos/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const dest = `${dir}item_${Date.now()}_${Math.floor(Math.random() * 1e6)}.jpg`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  }

  async function pickItemPhoto(useCamera: boolean) {
    if (!invoice) return;
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

      const saved: string[] = [];
      for (const asset of result.assets) {
        saved.push(await persistItemPhoto(asset.uri));
      }
      updateInvoice(invoice.id, { itemPhotos: [...(invoice.itemPhotos ?? []), ...saved] });
      setInvoice(getInvoiceById(invoice.id));
    } catch {
      Alert.alert('Error', 'Failed to add photo. Please try again.');
    }
  }

  function handleAddItemPhoto() {
    Alert.alert('Add Item Photo', 'Photograph the actual item as proof of ownership.', [
      { text: 'Take Photo', onPress: () => pickItemPhoto(true) },
      { text: 'Choose from Gallery', onPress: () => pickItemPhoto(false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // ─── Attach a receipt after the fact (manual entries have none) ────────────

  async function attachReceipt(useCamera: boolean) {
    if (!invoice) return;
    try {
      let result: ImagePicker.ImagePickerResult;
      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permission needed', 'Camera access is required to photograph the receipt.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      }
      if (result.canceled || result.assets.length === 0) return;

      // Same folder scanned receipts live in, so backups pick it up.
      const dir = `${FileSystem.documentDirectory}invoices/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      const dest = `${dir}receipt_${Date.now()}.jpg`;
      await FileSystem.copyAsync({ from: result.assets[0].uri, to: dest });
      updateInvoice(invoice.id, { photoUri: dest });
      setInvoice(getInvoiceById(invoice.id));
    } catch {
      Alert.alert('Error', 'Failed to attach the proof. Please try again.');
    }
  }

  function handleAddReceipt() {
    Alert.alert('Add proof of purchase', 'A receipt, invoice, or bank statement all work.', [
      { text: 'Take Photo', onPress: () => attachReceipt(true) },
      { text: 'Choose from Gallery', onPress: () => attachReceipt(false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // Keep Excl./Incl. GST in sync while editing (NZ 15% GST); either field can drive the other.
  function handleTotalChange(text: string) {
    setEditTotal(text);
    const n = parseFloat(text);
    if (Number.isFinite(n)) setEditSubtotal(exclFromIncl(n).toFixed(2));
  }

  function handleSubtotalChange(text: string) {
    setEditSubtotal(text);
    const n = parseFloat(text);
    if (Number.isFinite(n)) setEditTotal(inclFromExcl(n).toFixed(2));
  }

  function openCustomWarranty() {
    // Prefill with the current span in years, blank when it's a whole preset.
    setWarrantyYearsInput(
      editWarrantyMonths > 0 ? String(+(editWarrantyMonths / 12).toFixed(2)) : ''
    );
    setWarrantyModalVisible(true);
  }

  function applyCustomWarranty() {
    const years = parseFloat(warrantyYearsInput);
    if (!Number.isFinite(years) || years <= 0 || years > 50) {
      Alert.alert('Invalid length', 'Enter a number of years between 0 and 50.');
      return;
    }
    setEditWarrantyMonths(Math.round(years * 12));
    setWarrantyModalVisible(false);
  }

  function handleRemoveItemPhoto(uri: string) {
    if (!invoice) return;
    Alert.alert('Remove Photo', 'Remove this item photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          updateInvoice(invoice.id, {
            itemPhotos: (invoice.itemPhotos ?? []).filter((u) => u !== uri),
          });
          FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
          setInvoice(getInvoiceById(invoice.id));
        },
      },
    ]);
  }

  if (!invoice) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <Text>Loading...</Text>
      </SafeAreaView>
    );
  }

  // The item is the star: item photos lead, the receipt (if any) rides along at the end.
  const itemPhotos = invoice.itemPhotos ?? [];
  const galleryPhotos = [...itemPhotos, ...(invoice.photoUri ? [invoice.photoUri] : [])];
  const galleryIndex = Math.max(0, galleryPhotos.indexOf(modalUri ?? galleryPhotos[0]));

  // Square main photo: tapped thumb becomes the main; falls back to the first photo.
  const mainPhoto = heroUri && itemPhotos.includes(heroUri) ? heroUri : itemPhotos[0];

  const isCustomWarranty = !WARRANTY_OPTIONS.some((o) => o.months === editWarrantyMonths);

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView>
        <View style={styles.content}>
          {/* Main photo (square) + thumb column on the right; receipt is a row further down */}
          {itemPhotos.length > 0 ? (
            <View style={styles.photoBlock}>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => openGallery(mainPhoto)}
                style={styles.mainPhotoWrap}
              >
                <Image source={{ uri: mainPhoto }} style={styles.mainPhoto} resizeMode="cover" />
              </TouchableOpacity>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.thumbRowContent}
              >
                {itemPhotos.map((uri) => (
                  <TouchableOpacity key={uri} onPress={() => setHeroUri(uri)} activeOpacity={0.8}>
                    <Image
                      source={{ uri }}
                      style={[styles.itemPhoto, uri === mainPhoto && styles.itemPhotoActive]}
                    />
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.addPhotoTile} onPress={handleAddItemPhoto}>
                  <Text style={styles.addPhotoPlus}>＋</Text>
                  <Text style={styles.addPhotoText}>Add</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.heroEmpty}
              onPress={handleAddItemPhoto}
              activeOpacity={0.8}
            >
              <Ionicons name="camera-outline" size={40} color="#94a3b8" />
              <Text style={styles.heroEmptyTitle}>Add a photo of the item</Text>
              <Text style={styles.heroEmptySub}>
                Insurers want to see the item itself — the receipt is saved below
              </Text>
            </TouchableOpacity>
          )}
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
            <Text style={styles.label}>Purchase Date</Text>
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

          {/* Category + Room on one line (view mode) */}
          {!isEditing && (
            <View style={styles.field}>
              <View style={styles.pairRow}>
                <View>
                  <Text style={styles.label}>Category</Text>
                  <Text style={styles.value}>{capitalize(invoice.category) || 'Other'}</Text>
                </View>
                <View style={styles.pairRight}>
                  <Text style={styles.label}>Room</Text>
                  <View style={styles.valueRow}>
                    {invoice.room ? (
                      <Text style={styles.valueIcon}>{roomIcon(invoice.room)}</Text>
                    ) : null}
                    <Text style={styles.valueInRow}>
                      {invoice.room ? capitalizeRoom(invoice.room) : '—'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* Category (edit mode) */}
          {isEditing && (
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
            ) : null}
          </View>
          )}

          {/* Room (edit mode) */}
          {isEditing && (
          <View style={styles.field}>
            <Text style={styles.label}>Room (for insurance)</Text>
            {isEditing ? (
              <View>
                <TextInput
                  style={styles.input}
                  value={editRoom}
                  onChangeText={setEditRoom}
                  placeholder="e.g. Living Room, Kids Room..."
                  autoCapitalize="words"
                />
                <View style={styles.presets}>
                  {roomPresets.map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={[styles.preset, normalizeRoom(editRoom) === r && styles.presetActive]}
                      onPress={() => setEditRoom(r)}
                    >
                      <Text style={styles.presetIcon}>{roomIcon(r)}</Text>
                      <Text style={[styles.presetText, normalizeRoom(editRoom) === r && styles.presetTextActive]}>
                        {capitalizeRoom(r)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.hintText}>Custom rooms are saved automatically for future use.</Text>
              </View>
            ) : null}
          </View>
          )}

          {/* Brand / Model / Serial (for insurance claims) */}
          {isEditing ? (
            <>
              <View style={styles.field}>
                <Text style={styles.label}>Brand</Text>
                <TextInput
                  style={styles.input}
                  value={editBrand}
                  onChangeText={setEditBrand}
                  placeholder="e.g. Apple, IKEA, Samsung..."
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Model</Text>
                <TextInput
                  style={styles.input}
                  value={editModel}
                  onChangeText={setEditModel}
                  placeholder="e.g. MacBook Pro 14, QN65Q80C..."
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Serial Number</Text>
                <View style={styles.serialRow}>
                  <TextInput
                    style={[styles.input, styles.serialInput]}
                    value={editSerial}
                    onChangeText={setEditSerial}
                    placeholder="Usually on the item or its box"
                    autoCapitalize="characters"
                  />
                  <TouchableOpacity
                    style={styles.scanBtn}
                    onPress={() => setScannerVisible(true)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="barcode-outline" size={20} color="#2563eb" />
                    <Text style={styles.scanBtnText}>Scan</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          ) : (
            (invoice.brand || invoice.model || invoice.serialNumber) && (
              <View style={styles.field}>
                <Text style={styles.label}>Item Identification</Text>
                {!!(invoice.brand || invoice.model) && (
                  <Text style={styles.value}>
                    {[invoice.brand, invoice.model].filter(Boolean).join(' ')}
                  </Text>
                )}
                {!!invoice.serialNumber && (
                  <Text style={styles.serialText}>S/N: {invoice.serialNumber}</Text>
                )}
              </View>
            )
          )}

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
                <TouchableOpacity
                  style={[styles.preset, styles.presetCustom, isCustomWarranty && styles.presetActive]}
                  onPress={openCustomWarranty}
                >
                  <Text style={[styles.presetText, isCustomWarranty && styles.presetTextActive]}>
                    {isCustomWarranty ? formatWarranty(editWarrantyMonths) : 'Custom'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Amounts: Total Value (left, aligned with Category) / Excl. GST */}
          <View style={styles.field}>
            <View style={styles.gstRow}>
              <View style={styles.gstCol}>
                <Text style={styles.label}>Total Value</Text>
                {isEditing ? (
                  <TextInput style={[styles.input, styles.gstInput, styles.totalInput]} value={editTotal}
                    onChangeText={handleTotalChange} keyboardType="decimal-pad" placeholder="0.00" />
                ) : (
                  <Text style={[styles.value, styles.gstValue, styles.totalValue]}>
                    ${invoice.total.toFixed(2)}
                  </Text>
                )}
              </View>
              <View style={[styles.gstCol, !isEditing && styles.pairRight]}>
                <Text style={styles.label}>Excl. GST</Text>
                {isEditing ? (
                  <TextInput style={[styles.input, styles.gstInput]} value={editSubtotal} onChangeText={handleSubtotalChange}
                    keyboardType="decimal-pad" placeholder="0.00" />
                ) : (
                  <Text style={[styles.value, styles.gstValue]}>
                    ${invoice.subtotal.toFixed(2)}
                  </Text>
                )}
              </View>
            </View>
          </View>

          {/* Warranty display + note */}
          {!isEditing && (() => {
            const months = invoice.warrantyMonths ?? 0;
            let statusText = 'None';
            let expired = false;
            let expiring = false;
            if (months > 0) {
              const expiry = new Date(invoice.date);
              expiry.setMonth(expiry.getMonth() + months);
              const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / 86400000);
              expired = daysLeft < 0;
              expiring = !expired && daysLeft <= 30;
              statusText = expired
                ? `Expired on ${expiry.toDateString()}`
                : expiring
                ? `Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} (${expiry.toDateString()})`
                : `Valid until ${expiry.toDateString()}`;
            }
            return (
              <View style={[styles.field, expired && styles.fieldExpired, expiring && styles.fieldExpiring]}>
                <View style={styles.warrantyRow}>
                  <View style={styles.warrantyContent}>
                    <Text style={styles.label}>Warranty</Text>
                    <Text style={[styles.value, expired && styles.valueExpired, expiring && styles.valueExpiring]}>
                      {statusText}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.noteIconBtn}
                    onPress={() => {
                      setNoteDraft(invoice.note ?? '');
                      setNoteModalVisible(true);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons
                      name={invoice.note ? 'document-text' : 'document-text-outline'}
                      size={32}
                      color={invoice.note ? '#2563eb' : '#9ca3af'}
                    />
                  </TouchableOpacity>
                </View>
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

          {/* Receipt: proof of purchase, demoted from hero; attachable when missing */}
          {invoice.photoUri ? (
            <TouchableOpacity
              style={styles.receiptRow}
              onPress={() => openGallery(invoice.photoUri)}
              activeOpacity={0.7}
            >
              <Image source={{ uri: invoice.photoUri }} style={styles.receiptThumb} />
              <View style={styles.receiptContent}>
                <Text style={styles.receiptTitle}>Receipt</Text>
                <Text style={styles.receiptSub}>Proof of purchase · tap to view</Text>
              </View>
              <Text style={styles.receiptChevron}>›</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.receiptRow, styles.receiptRowEmpty]}
              onPress={handleAddReceipt}
              activeOpacity={0.7}
            >
              <View style={[styles.receiptThumb, styles.receiptThumbEmpty]}>
                <Ionicons name="receipt-outline" size={20} color="#94a3b8" />
              </View>
              <View style={styles.receiptContent}>
                <Text style={styles.receiptTitle}>No receipt</Text>
                <Text style={styles.receiptSub}>
                  Add proof of purchase — receipt or bank statement
                </Text>
              </View>
              <Text style={styles.receiptChevron}>＋</Text>
            </TouchableOpacity>
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
            <Text style={styles.buttonText}>Delete Item</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Serial number barcode scanner */}
      <BarcodeScannerModal
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScanned={(value) => {
          setEditSerial(value);
          setScannerVisible(false);
        }}
      />

      {/* Custom warranty modal */}
      <Modal
        visible={warrantyModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setWarrantyModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.noteModalBg}
          activeOpacity={1}
          onPress={() => setWarrantyModalVisible(false)}
        >
          <View style={styles.noteCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.noteTitle}>Custom warranty</Text>
            <View style={styles.warrantyInputRow}>
              <TextInput
                style={styles.warrantyInput}
                value={warrantyYearsInput}
                onChangeText={setWarrantyYearsInput}
                keyboardType="decimal-pad"
                placeholder="5"
                placeholderTextColor="#cbd5e1"
                autoFocus
                selectTextOnFocus
                onSubmitEditing={applyCustomWarranty}
                returnKeyType="done"
              />
              <Text style={styles.warrantyUnit}>years</Text>
            </View>
            <Text style={styles.hintText}>
              Decimals are fine — 0.5 is six months. Counts from the purchase date.
            </Text>
            <View style={styles.noteBtnRow}>
              <TouchableOpacity
                style={styles.noteClearBtn}
                onPress={() => setWarrantyModalVisible(false)}
              >
                <Text style={styles.noteClearText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.noteSaveBtn} onPress={applyCustomWarranty}>
                <Text style={styles.noteSaveText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Note modal */}
      <Modal
        visible={noteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNoteModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.noteModalBg}
          activeOpacity={1}
          onPress={() => setNoteModalVisible(false)}
        >
          <View style={styles.noteCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.noteTitle}>Note</Text>
            <TextInput
              style={styles.noteInput}
              value={noteDraft}
              onChangeText={setNoteDraft}
              placeholder="e.g. extended warranty #, claim details, where the receipt box is..."
              placeholderTextColor="#9ca3af"
              multiline
              autoFocus
            />
            <View style={styles.noteBtnRow}>
              <TouchableOpacity
                style={styles.noteClearBtn}
                onPress={() => setNoteModalVisible(false)}
              >
                <Text style={styles.noteClearText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.noteClearBtn} onPress={() => setNoteDraft('')}>
                <Text style={styles.noteClearText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.noteSaveBtn}
                onPress={() => {
                  updateInvoice(invoice.id, { note: noteDraft.trim() });
                  setInvoice(getInvoiceById(invoice.id));
                  setNoteModalVisible(false);
                }}
              >
                <Text style={styles.noteSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Photo zoom modal */}
      <Modal
        visible={modalUri !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={handleCloseModal}
      >
        <View style={styles.modalBg}>
          <FlatList
            key={`gallery-${galleryKey}`}
            style={styles.gallery}
            data={galleryPhotos}
            keyExtractor={(u) => u}
            horizontal
            pagingEnabled
            scrollEnabled={!zoomed}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={galleryIndex}
            getItemLayout={(_, i) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * i, index: i })}
            onMomentumScrollEnd={(e) => {
              const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
              const uri = galleryPhotos[page];
              if (uri && uri !== modalUri) {
                resetZoom();
                setModalUri(uri);
              }
            }}
            renderItem={({ item }) => (
              <View style={styles.galleryPage} {...pinchResponder.panHandlers}>
                <Animated.Image
                  source={{ uri: item }}
                  style={[styles.modalImage, { transform: [{ scale }] }]}
                  resizeMode="contain"
                />
              </View>
            )}
          />

          {galleryPhotos.length > 1 && (
            <View style={styles.galleryCounter}>
              <Text style={styles.galleryCounterText}>
                {galleryIndex + 1} / {galleryPhotos.length} ·{' '}
                {galleryIndex < itemPhotos.length ? 'Item photo' : 'Receipt'}
              </Text>
            </View>
          )}

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalBtn} onPress={handleSavePhoto}>
              <Text style={styles.modalBtnText}>Save to Photos</Text>
            </TouchableOpacity>
            {modalUri !== null && (invoice.itemPhotos ?? []).includes(modalUri) && (
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnDelete]}
                onPress={() => {
                  const uri = modalUri;
                  handleCloseModal();
                  handleRemoveItemPhoto(uri);
                }}
              >
                <Text style={styles.modalBtnText}>Delete</Text>
              </TouchableOpacity>
            )}
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

  // Full-width main square on top, horizontal thumb strip below.
  photoBlock: { gap: 8, marginBottom: 12 },
  mainPhotoWrap: { alignSelf: 'stretch' },
  mainPhoto: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
  },
  thumbRowContent: { gap: 8 },
  heroEmpty: {
    height: 170,
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 32,
    marginBottom: 8,
  },
  heroEmptyTitle: { fontSize: 15, fontWeight: '700', color: '#334155' },
  heroEmptySub: { fontSize: 12, color: '#94a3b8', textAlign: 'center', lineHeight: 17 },

  content: { padding: 16, paddingTop: 20 },
  field: { backgroundColor: '#fff', padding: 12, marginBottom: 8, borderRadius: 8 },
  label: { fontSize: 12, color: '#999', fontWeight: '600' },
  value: { fontSize: 16, color: '#000', marginTop: 4 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  valueIcon: { fontSize: 14 },
  valueInRow: { fontSize: 16, color: '#000' },
  totalValue: { fontSize: 18, fontWeight: 'bold', color: '#4CAF50' },
  fieldExpired: { borderLeftWidth: 3, borderLeftColor: '#ef4444' },
  fieldExpiring: { borderLeftWidth: 3, borderLeftColor: '#f59e0b' },
  valueExpired: { color: '#ef4444' },
  valueExpiring: { color: '#d97706' },
  itemText: { fontSize: 14, color: '#666', marginTop: 4, marginLeft: 8 },
  serialText: { fontSize: 13, color: '#6b7280', marginTop: 4, fontVariant: ['tabular-nums'] },
  serialRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  serialInput: { flex: 1 },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
  },
  scanBtnText: { fontSize: 13, fontWeight: '700', color: '#2563eb' },
  gstRow: { flexDirection: 'row', gap: 24 },
  gstCol: { flex: 1 },
  // Shared line box so the 18px total and the 16px subtotal sit on one baseline.
  gstValue: { lineHeight: 24 },
  // Same idea in edit mode: equal height keeps both underlines on one line.
  gstInput: { height: 34 },
  pairRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  pairRight: { alignItems: 'flex-end' },

  // Warranty note
  warrantyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  warrantyContent: { flex: 1 },
  noteIconBtn: {
    alignSelf: 'center',
    padding: 4,
  },
  noteModalBg: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    padding: 28,
  },
  noteCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  noteTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  noteInput: {
    minHeight: 100,
    maxHeight: 220,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: '#111827',
    textAlignVertical: 'top',
  },
  noteBtnRow: { flexDirection: 'row', gap: 10 },
  noteClearBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
  },
  noteClearText: { color: '#6b7280', fontWeight: '700', fontSize: 14 },
  noteSaveBtn: {
    flex: 2,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    backgroundColor: '#2563eb',
  },
  noteSaveText: { color: '#fff', fontWeight: '700', fontSize: 14 },
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
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
  },
  presetActive: { backgroundColor: '#2563eb' },
  presetCustom: { borderWidth: 1, borderColor: '#cbd5e1', borderStyle: 'dashed' },
  presetIcon: { fontSize: 12 },
  warrantyInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  warrantyInput: { flex: 1, fontSize: 20, fontWeight: '700', color: '#0f172a', padding: 0 },
  warrantyUnit: { fontSize: 15, fontWeight: '600', color: '#64748b' },
  presetText: { fontSize: 13, color: '#475569', fontWeight: '600' },
  presetTextActive: { color: '#fff' },
  hintText: { marginTop: 8, fontSize: 11, color: '#9ca3af', fontStyle: 'italic' },
  totalInput: { fontSize: 18, fontWeight: 'bold', color: '#4CAF50' },

  itemPhotoRow: { gap: 8, paddingTop: 8, paddingBottom: 12 },
  itemPhoto: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
  },
  itemPhotoActive: {
    borderWidth: 2,
    borderColor: '#2563eb',
  },
  addPhotoTile: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#93c5fd',
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addPhotoPlus: { fontSize: 24, color: '#2563eb', lineHeight: 28 },
  addPhotoText: { fontSize: 11, color: '#2563eb', fontWeight: '600' },

  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 10,
  },
  receiptThumb: { width: 44, height: 44, borderRadius: 6, backgroundColor: '#e5e7eb' },
  receiptRowEmpty: { borderStyle: 'dashed', borderColor: '#cbd5e1', backgroundColor: '#fbfdff' },
  receiptThumbEmpty: {
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptContent: { flex: 1, gap: 2 },
  receiptTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  receiptSub: { fontSize: 12, color: '#9ca3af' },
  receiptChevron: { fontSize: 22, color: '#cbd5e1', fontWeight: '300' },

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
  gallery: { flex: 1 },
  galleryPage: {
    width: SCREEN_WIDTH,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  galleryCounter: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  galleryCounterText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
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
  modalBtnDelete: { backgroundColor: '#dc2626' },
  modalBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
