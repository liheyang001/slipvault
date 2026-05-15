import * as ImageManipulator from 'expo-image-manipulator';

export interface ProcessedImage {
  uri: string;
  width: number;
  height: number;
  base64: string;
}

// Resize and compress image for storage and OCR
export async function processInvoiceImage(uri: string): Promise<ProcessedImage> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 800 } }],
    {
      compress: 0.65,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    }
  );

  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
    base64: result.base64!,
  };
}

// Estimate blur level via average edge contrast (simple heuristic)
export function isImageBlurry(base64: string): boolean {
  // Heuristic: very small file size relative to dimensions suggests low detail (blurry)
  const sizeKB = (base64.length * 0.75) / 1024;
  return sizeKB < 30; // JPEG < 30KB at 1200px wide is likely very blurry
}
