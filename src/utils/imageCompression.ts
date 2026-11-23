// Compress & normalize any image (including 12MP mobile camera photos / PNG / WEBP / HEIC) into JPEG
export function compressAndNormalizeImage(
  file: File | Blob,
  maxDim = 1600,
  quality = 0.88
): Promise<{
  dataUrl: string;
  mimeType: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error('Не удалось прочитать выбранный файл изображения'));
    reader.onload = () => {
      const rawDataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        try {
          let width = img.naturalWidth || img.width || 1200;
          let height = img.naturalHeight || img.height || 900;

          if (width > maxDim || height > maxDim) {
            if (width >= height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({
              dataUrl: rawDataUrl,
              mimeType: file.type || 'image/jpeg',
            });
            return;
          }
          // Fill white background in case of transparent PNG
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve({
            dataUrl: jpegDataUrl,
            mimeType: 'image/jpeg',
          });
        } catch {
          resolve({
            dataUrl: rawDataUrl,
            mimeType: file.type || 'image/jpeg',
          });
        }
      };
      img.onerror = () => {
        resolve({
          dataUrl: rawDataUrl,
          mimeType: file.type || 'image/jpeg',
        });
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error('Не удалось прочитать изображение'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });
}
