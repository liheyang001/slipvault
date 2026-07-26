import React, { useState } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { CameraView, CameraType, BarcodeType, useCameraPermissions } from 'expo-camera';

/** Symbologies found on product labels and serial-number stickers. */
const BARCODE_TYPES: BarcodeType[] = [
  'code128',
  'code39',
  'code93',
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'itf14',
  'codabar',
  'datamatrix',
  'qr',
];

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Fires once per opening with the decoded barcode text. */
  onScanned: (value: string) => void;
}

export default function BarcodeScannerModal({ visible, onClose, onScanned }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  // Guards against the camera firing repeatedly while the modal closes.
  const [handled, setHandled] = useState(false);

  function handleClose() {
    setHandled(false);
    onClose();
  }

  function handleBarcode(value: string) {
    if (handled) return;
    setHandled(true);
    onScanned(value.trim());
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={handleClose}
      onShow={() => setHandled(false)}
    >
      <View style={styles.container}>
        {!permission ? (
          <View style={styles.center} />
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Text style={styles.permissionText}>
              Camera access is needed to scan a barcode.
            </Text>
            <TouchableOpacity style={styles.grantBtn} onPress={requestPermission}>
              <Text style={styles.grantText}>Grant Permission</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {visible && (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing={'back' as CameraType}
                barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
                onBarcodeScanned={({ data }) => handleBarcode(data)}
              />
            )}
            <View style={styles.overlay} pointerEvents="none">
              <View style={styles.frame} />
              <Text style={styles.hint}>Point at the barcode on the item or its box</Text>
            </View>
          </>
        )}

        <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  permissionText: { color: '#fff', fontSize: 15, textAlign: 'center', lineHeight: 21 },
  grantBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
  },
  grantText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: '78%',
    aspectRatio: 2.2,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: 12,
  },
  hint: { color: '#fff', fontSize: 13, marginTop: 16, textAlign: 'center' },

  cancelBtn: {
    position: 'absolute',
    bottom: 44,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
  },
  cancelText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
