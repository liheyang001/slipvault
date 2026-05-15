import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
  ScrollView,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types/navigation';
import { processInvoiceImage, isImageBlurry } from '../services/imageProcessor';
import * as FileSystem from 'expo-file-system/legacy';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Camera'>;

export default function CameraScreen() {
  const navigation = useNavigation<Nav>();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const [queue, setQueue] = useState<string[]>([]); // permanent URIs ready to review
  const isFocused = useIsFocused();

  if (!permission) return <View />;

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>
          Camera access is needed to photograph invoices.
        </Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  async function copyToPermanent(uri: string): Promise<string> {
    const fileName = `invoice_${Date.now()}.jpg`;
    const destUri = `${FileSystem.documentDirectory}invoices/${fileName}`;
    await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}invoices/`, {
      intermediates: true,
    });
    await FileSystem.copyAsync({ from: uri, to: destUri });
    return destUri;
  }

  async function addToQueue(uri: string) {
    try {
      const processed = await processInvoiceImage(uri);

      if (isImageBlurry(processed.base64)) {
        const proceed = await new Promise<boolean>((resolve) =>
          Alert.alert(
            'Blurry Photo',
            'This photo looks blurry. Continue anyway?',
            [
              { text: 'Retake', onPress: () => resolve(false) },
              { text: 'Continue', onPress: () => resolve(true) },
            ]
          )
        );
        if (!proceed) return;
      }

      const permanent = await copyToPermanent(processed.uri);
      setQueue((prev) => [...prev, permanent]);
    } catch {
      Alert.alert('Error', 'Failed to process photo. Please try again.');
    }
  }

  async function handleCapture() {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: false });
      if (photo) await addToQueue(photo.uri);
    } catch {
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    } finally {
      setCapturing(false);
    }
  }

  async function handlePickFromGallery() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;
    setCapturing(true);
    try {
      for (const asset of result.assets) {
        await addToQueue(asset.uri);
      }
    } finally {
      setCapturing(false);
    }
  }

  function handleReview() {
    if (queue.length === 0) return;
    navigation.navigate('Review', { photoUri: queue[0], queue: queue.slice(1) });
    setQueue([]);
  }

  function handleRemoveFromQueue(uri: string) {
    setQueue((prev) => prev.filter((u) => u !== uri));
    FileSystem.deleteAsync(uri, { idempotent: true });
  }

  return (
    <View style={styles.container}>
      {/* Camera viewfinder */}
      <View style={styles.cameraWrapper}>
        {isFocused && (
          <CameraView ref={cameraRef} style={styles.camera} facing={'back' as CameraType} />
        )}
        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.frame} />
        </View>
      </View>

      {/* Thumbnail tray */}
      {queue.length > 0 && (
        <View style={styles.tray}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.trayContent}
          >
            {queue.map((uri) => (
              <TouchableOpacity
                key={uri}
                style={styles.thumbWrapper}
                onPress={() => handleRemoveFromQueue(uri)}
              >
                <Image source={{ uri }} style={styles.thumb} />
                <View style={styles.thumbRemove}>
                  <Text style={styles.thumbRemoveText}>×</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={styles.trayHint}>Tap a photo to remove it</Text>
        </View>
      )}

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={styles.sideButton}
          onPress={handlePickFromGallery}
          disabled={capturing}
        >
          <Text style={styles.sideButtonText}>Gallery</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.captureButton, capturing && styles.captureButtonDisabled]}
          onPress={handleCapture}
          disabled={capturing}
        >
          <View style={styles.captureInner} />
        </TouchableOpacity>

        {queue.length > 0 ? (
          <TouchableOpacity style={styles.reviewButton} onPress={handleReview}>
            <Text style={styles.reviewButtonText}>Review{'\n'}({queue.length})</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.sideButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.sideButtonText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  cameraWrapper: { flex: 1 },
  camera: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  frame: {
    width: 300,
    height: 400,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
    borderRadius: 12,
  },

  tray: {
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingVertical: 10,
  },
  trayContent: {
    paddingHorizontal: 12,
    gap: 8,
  },
  thumbWrapper: {
    position: 'relative',
  },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#333',
  },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#ef4444',
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: { color: '#fff', fontSize: 14, lineHeight: 20, fontWeight: '700' },
  trayHint: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 6,
  },

  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    backgroundColor: '#000',
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonDisabled: { borderColor: '#555' },
  captureInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
  sideButton: { padding: 12 },
  sideButtonText: { color: '#fff', fontSize: 16 },
  reviewButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  reviewButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 18,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 16,
    backgroundColor: '#000',
  },
  permissionText: { fontSize: 16, textAlign: 'center', color: '#fff' },
  button: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
