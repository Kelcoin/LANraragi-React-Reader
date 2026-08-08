import { resolveReaderPreviewDecodeSize } from './cachePolicy.js';

const PREVIEW_CACHE_LIMIT = 12;
const PREVIEW_CACHE_BYTES = 48 * 1024 ** 2;
const previewCache = new Map();
let previewCacheBytes = 0;

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new DOMException('Image decode cancelled', 'AbortError');
}

export async function decodeImageSource(sourceUrl, {
  signal,
  imageFactory = () => new Image(),
} = {}) {
  abortIfNeeded(signal);
  const image = imageFactory();
  image.decoding = 'async';
  image.src = sourceUrl;

  let abortHandler;
  const waitWithAbort = async (promise) => {
    if (!signal) return promise;
    const abortPromise = new Promise((_, reject) => {
      abortHandler = () => {
        image.removeAttribute?.('src');
        reject(new DOMException('Image decode cancelled', 'AbortError'));
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    });
    try {
      return await Promise.race([promise, abortPromise]);
    } finally {
      signal.removeEventListener('abort', abortHandler);
      abortHandler = null;
    }
  };

  if (typeof image.decode === 'function') {
    try {
      await waitWithAbort(image.decode());
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      // decode() rejects on load failure — by now the error event has already
      // fired, so waiting for 'load'/'error' below would hang forever.
      throw new Error('Image decode failed');
    }
  }
  if (image.complete && !image.naturalWidth) throw new Error('Image decode failed');
  if (!image.complete) {
    await waitWithAbort(new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', reject, { once: true });
    }));
  }
  abortIfNeeded(signal);
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('Image decode failed');
  return { width: image.naturalWidth, height: image.naturalHeight, image };
}

function readUint24LE(view, offset) {
  return view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
}

function readAscii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function skipGifSubBlocks(bytes, offset) {
  while (offset < bytes.length) {
    const length = bytes[offset];
    offset += 1;
    if (length === 0) return offset;
    offset += length;
  }
  return bytes.length + 1;
}

function gifHasMultipleFrames(bytes) {
  if (bytes.length < 13) return false;
  let offset = 13;
  const globalColorTable = bytes[10];
  if (globalColorTable & 0x80) offset += 3 * (1 << ((globalColorTable & 0x07) + 1));

  let frames = 0;
  while (offset < bytes.length) {
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x2c) {
      frames += 1;
      if (frames > 1) return true;
      if (offset + 9 > bytes.length) return false;
      const localColorTable = bytes[offset + 8];
      offset += 9;
      if (localColorTable & 0x80) offset += 3 * (1 << ((localColorTable & 0x07) + 1));
      if (offset >= bytes.length) return false;
      offset = skipGifSubBlocks(bytes, offset + 1);
    } else if (marker === 0x21) {
      if (offset >= bytes.length) return false;
      offset = skipGifSubBlocks(bytes, offset + 1);
    } else if (marker === 0x3b) {
      return false;
    } else {
      return false;
    }
  }
  return false;
}

export async function isAnimatedImageBlob(blob, signal) {
  abortIfNeeded(signal);
  const header = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  abortIfNeeded(signal);

  if (readAscii(header, 0, 3) === 'GIF') {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    abortIfNeeded(signal);
    return gifHasMultipleFrames(bytes);
  }

  const isPng = header.length >= 8
    && header[0] === 0x89
    && readAscii(header, 1, 3) === 'PNG'
    && header[4] === 0x0d
    && header[5] === 0x0a
    && header[6] === 0x1a
    && header[7] === 0x0a;
  if (isPng) {
    let offset = 8;
    while (offset + 8 <= blob.size) {
      const chunkHeader = new Uint8Array(await blob.slice(offset, offset + 8).arrayBuffer());
      abortIfNeeded(signal);
      if (chunkHeader.length < 8) return false;
      const length = new DataView(chunkHeader.buffer, chunkHeader.byteOffset, chunkHeader.byteLength).getUint32(0);
      const type = readAscii(chunkHeader, 4, 4);
      if (type === 'acTL') return true;
      if (type === 'IDAT' || type === 'IEND') return false;
      const nextOffset = offset + length + 12;
      if (nextOffset <= offset || nextOffset > blob.size) return false;
      offset = nextOffset;
    }
    return false;
  }

  const isWebp = header.length >= 12
    && readAscii(header, 0, 4) === 'RIFF'
    && readAscii(header, 8, 4) === 'WEBP';
  if (isWebp) {
    if (header.length >= 21 && readAscii(header, 12, 4) === 'VP8X' && (header[20] & 0x02)) return true;
    let offset = 12;
    while (offset + 8 <= blob.size) {
      const chunkHeader = new Uint8Array(await blob.slice(offset, offset + 8).arrayBuffer());
      abortIfNeeded(signal);
      if (chunkHeader.length < 8) return false;
      const type = readAscii(chunkHeader, 0, 4);
      if (type === 'ANIM' || type === 'ANMF') return true;
      const length = new DataView(chunkHeader.buffer, chunkHeader.byteOffset, chunkHeader.byteLength).getUint32(4, true);
      const nextOffset = offset + 8 + length + (length & 1);
      if (nextOffset <= offset || nextOffset > blob.size) return false;
      offset = nextOffset;
    }
  }
  return false;
}

export function readImageDimensions(buffer) {
  const view = buffer instanceof DataView ? buffer : new DataView(buffer);
  if (view.byteLength >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (view.byteLength >= 10 && (view.getUint32(0) === 0x47494638)) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (view.byteLength >= 30 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) {
    const chunk = view.getUint32(12);
    if (chunk === 0x56503858) {
      return { width: readUint24LE(view, 24) + 1, height: readUint24LE(view, 27) + 1 };
    }
    if (chunk === 0x56503820 && view.byteLength >= 30) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (chunk === 0x5650384c && view.byteLength >= 25) {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  if (view.byteLength >= 4 && view.getUint16(0) === 0xffd8) {
    let offset = 2;
    while (offset + 8 < view.byteLength) {
      if (view.getUint8(offset) !== 0xff) { offset += 1; continue; }
      const marker = view.getUint8(offset + 1);
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > view.byteLength) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > view.byteLength) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      }
      offset += length;
    }
  }
  return null;
}

async function canvasToBlob(canvas) {
  if (typeof canvas.convertToBlob === 'function') {
    try { return await canvas.convertToBlob({ type: 'image/webp', quality: 0.98 }); } catch {
      return canvas.convertToBlob({ type: 'image/png' });
    }
  }
  const webp = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.98));
  if (webp) return webp;
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function rememberPreview(key, blob) {
  const objectUrl = URL.createObjectURL(blob);
  const previous = previewCache.get(key);
  if (previous) {
    previewCacheBytes = Math.max(0, previewCacheBytes - (previous.size || 0));
    URL.revokeObjectURL(previous.objectUrl);
  }
  previewCache.set(key, { objectUrl, size: blob.size, lastAccessedAt: Date.now() });
  previewCacheBytes += blob.size;
  while (previewCache.size > PREVIEW_CACHE_LIMIT || previewCacheBytes > PREVIEW_CACHE_BYTES) {
    const [oldestKey, oldest] = [...previewCache.entries()]
      .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt)[0];
    previewCache.delete(oldestKey);
    previewCacheBytes = Math.max(0, previewCacheBytes - oldest.size);
    URL.revokeObjectURL(oldest.objectUrl);
  }
  return objectUrl;
}

export async function getReaderPreviewSource(sourceUrl, {
  enabled = true,
  fullPrecision = false,
  viewportWidth = globalThis.innerWidth,
  viewportHeight = globalThis.innerHeight,
  devicePixelRatio = globalThis.devicePixelRatio,
  sourceSize,
  signal,
} = {}) {
  if (!enabled || fullPrecision || typeof createImageBitmap !== 'function') {
    return { src: sourceUrl, width: sourceSize?.width || 0, height: sourceSize?.height || 0, isPreview: false };
  }
  abortIfNeeded(signal);
  const response = await fetch(sourceUrl, { signal });
  const blob = await response.blob();
  abortIfNeeded(signal);
  const dimensions = sourceSize?.width && sourceSize?.height
    ? sourceSize
    : readImageDimensions(await blob.slice(0, 128 * 1024).arrayBuffer());
  if (!dimensions) return { src: sourceUrl, width: 0, height: 0, isPreview: false };
  const target = resolveReaderPreviewDecodeSize({
    ...dimensions,
    viewportWidth,
    viewportHeight,
    devicePixelRatio,
  });
  if (!target) return { src: sourceUrl, ...dimensions, isPreview: false };
  if (await isAnimatedImageBlob(blob, signal)) return { src: sourceUrl, ...dimensions, isPreview: false };

  const cacheKey = `${sourceUrl}:${target.width}x${target.height}`;
  const cached = previewCache.get(cacheKey);
  if (cached) {
    cached.lastAccessedAt = Date.now();
    return { src: cached.objectUrl, ...dimensions, isPreview: true };
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(blob, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: 'high',
    });
    abortIfNeeded(signal);
    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(target.width, target.height)
      : Object.assign(document.createElement('canvas'), { width: target.width, height: target.height });
    canvas.getContext('2d').drawImage(bitmap, 0, 0, target.width, target.height);
    const previewBlob = await canvasToBlob(canvas);
    abortIfNeeded(signal);
    if (!previewBlob) return { src: sourceUrl, ...dimensions, isPreview: false };
    return { src: rememberPreview(cacheKey, previewBlob), ...dimensions, isPreview: true };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { src: sourceUrl, ...dimensions, isPreview: false };
  } finally {
    bitmap?.close?.();
  }
}
