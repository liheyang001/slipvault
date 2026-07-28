import JSZip from 'jszip';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { exportAllData, importBackupData, setSetting, BackupData } from './database';

// Backs up the entire archive (database + all photos) into a single zip the
// user can share to Google Drive / email / anywhere — and restores from it.
// Critical for contents insurance: the phone may be lost in the same event
// that destroys the belongings it documents.

function basename(uri: string): string {
  return uri.split('/').pop() || '';
}

/** Bundle everything into a zip and open the system share sheet. Returns invoice count. */
export async function createBackup(): Promise<number> {
  const data = exportAllData();
  const zip = new JSZip();
  const receipts = zip.folder('receipts')!;
  const itemPhotos = zip.folder('item_photos')!;

  for (const inv of data.invoices) {
    if (inv.photoUri) {
      try {
        const b64 = await FileSystem.readAsStringAsync(inv.photoUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        receipts.file(basename(inv.photoUri), b64, { base64: true });
      } catch {
        // photo file missing — still back up the data row
      }
    }
    for (const p of inv.itemPhotos ?? []) {
      try {
        const b64 = await FileSystem.readAsStringAsync(p, {
          encoding: FileSystem.EncodingType.Base64,
        });
        itemPhotos.file(basename(p), b64, { base64: true });
      } catch {
        // skip missing item photo
      }
    }
  }

  zip.file('data.json', JSON.stringify(data));

  const zipB64 = await zip.generateAsync({ type: 'base64' });
  const fileName = `vesta_backup_${new Date().toISOString().slice(0, 10)}.zip`;
  const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(fileUri, zipB64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  await Sharing.shareAsync(fileUri, { mimeType: 'application/zip' });
  setSetting('lastBackupAt', new Date().toISOString());
  return data.invoices.length;
}

/**
 * Pick a backup zip and restore it. Photos are re-extracted into app storage
 * and invoice photo paths rewritten. Returns null if the user cancelled.
 */
export async function restoreBackup(): Promise<{ invoices: number } | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['application/zip', 'application/octet-stream', '*/*'],
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets?.[0]) return null;

  const zipB64 = await FileSystem.readAsStringAsync(picked.assets[0].uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const zip = await JSZip.loadAsync(zipB64, { base64: true });

  const dataEntry = zip.file('data.json');
  if (!dataEntry) {
    throw new Error('This file is not a Vesta backup (data.json missing).');
  }
  const data = JSON.parse(await dataEntry.async('string')) as BackupData;

  const receiptsDir = `${FileSystem.documentDirectory}invoices/`;
  const itemsDir = `${FileSystem.documentDirectory}item_photos/`;
  await FileSystem.makeDirectoryAsync(receiptsDir, { intermediates: true }).catch(() => {});
  await FileSystem.makeDirectoryAsync(itemsDir, { intermediates: true }).catch(() => {});

  for (const inv of data.invoices ?? []) {
    if (inv.photoUri) {
      const name = basename(inv.photoUri);
      const entry = zip.file(`receipts/${name}`);
      if (entry) {
        const b64 = await entry.async('base64');
        await FileSystem.writeAsStringAsync(receiptsDir + name, b64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        inv.photoUri = receiptsDir + name;
      }
    }
    if (inv.itemPhotos?.length) {
      const rewritten: string[] = [];
      for (const p of inv.itemPhotos) {
        const name = basename(p);
        const entry = zip.file(`item_photos/${name}`);
        if (entry) {
          const b64 = await entry.async('base64');
          await FileSystem.writeAsStringAsync(itemsDir + name, b64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          rewritten.push(itemsDir + name);
        }
      }
      inv.itemPhotos = rewritten;
    }
  }

  return importBackupData(data);
}
