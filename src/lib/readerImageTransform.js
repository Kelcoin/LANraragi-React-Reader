export function findContentBounds(data, width, height, threshold = 245) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  }
  if (right < left) return { top: 0, right: 0, bottom: 0, left: 0 };
  return { top: top / height, right: (width - 1 - right) / width, bottom: (height - 1 - bottom) / height, left: left / width };
}

export function getBorderCropCenterTranslation({ top = 0, right = 0, bottom = 0, left = 0 } = {}) {
  return {
    xPercent: (right - left) * 50,
    yPercent: (bottom - top) * 50,
  };
}

export function getBorderCropClipPath({ top = 0, right = 0, bottom = 0, left = 0 } = {}) {
  const percent = (value) => Math.max(0, Math.min(1, Number(value) || 0)) * 100;
  return `inset(${percent(top)}% ${percent(right)}% ${percent(bottom)}% ${percent(left)}%)`;
}

export function detectImageBorderInsets(image, size = 96) {
  const canvas = document.createElement('canvas');
  const ratio = image.naturalWidth / image.naturalHeight;
  canvas.width = ratio >= 1 ? size : Math.max(16, Math.round(size * ratio));
  canvas.height = ratio >= 1 ? Math.max(16, Math.round(size / ratio)) : size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return findContentBounds(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}
