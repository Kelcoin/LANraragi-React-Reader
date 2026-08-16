import { createTilePlan } from './superResolutionTiling.js';
import { loadOrtBackend } from './superResolutionOrt.js';
import { createProductionRealCuganProcessor } from './realCugan.js';
import {
  READER_SUPER_RESOLUTION_DISPLAY_PIXELS,
  SUPER_RESOLUTION_MAX_INFERENCE_PIXELS,
  resolveBoundedImageSize,
} from './cachePolicy.js';

const WEBGPU_BACKEND = 'webgpu';
const MODEL_CACHE_NAME = 'readoshi-super-resolution-models-v1';
let productionOrt = null;

function createNamedError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

function toErrorDetails(error) {
  return {
    name: typeof error?.name === 'string' && error.name ? error.name : 'Error',
    message: typeof error?.message === 'string' && error.message
      ? error.message
      : String(error),
  };
}

function createErrorResponse(requestId, error) {
  return {
    type: 'error',
    requestId,
    error: toErrorDetails(error),
  };
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchModel(fetcher, url) {
  const response = await fetcher(url);
  if (response?.ok === false) {
    throw createNamedError(
      'FetchError',
      `Failed to fetch super-resolution model (HTTP ${response.status ?? 'unknown'})`,
    );
  }
  if (typeof response?.arrayBuffer !== 'function') {
    throw createNamedError('FetchError', 'Model response does not provide arrayBuffer()');
  }
  return response.arrayBuffer();
}

async function digestWithWebCrypto(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    throw createNamedError('DigestError', 'Web Crypto SHA-256 is unavailable');
  }
  return bytesToHex(await subtle.digest('SHA-256', bytes));
}

async function createProductionSession(modelBytes, backend) {
  const ort = await loadOrtBackend(backend);
  const session = await ort.InferenceSession.create(modelBytes, {
    executionProviders: [{ name: backend, powerPreference: 'high-performance' }],
    graphOptimizationLevel: 'all',
  });
  productionOrt = ort;
  return session;
}

async function createProductionTensor(data, dims) {
  if (!productionOrt) throw createNamedError('NotInitializedError', 'ORT backend is unavailable');
  return new productionOrt.Tensor('float32', data, dims);
}

function getLayout(manifest, key) {
  return manifest?.[`${key}Layout`] ?? manifest?.[key]?.layout;
}

function validateProcessManifest(manifest) {
  const scale = Number(manifest?.scale);
  const inputLayout = getLayout(manifest, 'input');
  const outputLayout = getLayout(manifest, 'output');
  if (!manifest || !Number.isInteger(scale) || scale <= 0) {
    throw createNamedError('ProtocolError', 'process requires a positive integer model scale');
  }
  if (!['nchw', 'nhwc'].includes(inputLayout) || !['nchw', 'nhwc'].includes(outputLayout)) {
    throw createNamedError('ProtocolError', 'process requires NCHW or NHWC tensor layouts');
  }
  return { scale, inputLayout, outputLayout };
}

function clampByte(value) {
  if (!Number.isFinite(value)) {
    throw createNamedError('TensorValueError', 'Model output contains a non-finite value');
  }
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

function disposeTensor(tensor) {
  if (tensor && typeof tensor.dispose === 'function') tensor.dispose();
}

function validateDecodedImage(decoded) {
  const width = Number(decoded?.width);
  const height = Number(decoded?.height);
  const pixels = decoded?.pixels;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0
    || !pixels || pixels.length !== width * height * 4) {
    throw createNamedError('DecodeError', 'Decoded image must provide RGBA pixels and dimensions');
  }
  return { width, height, pixels };
}

function createPaddedRgba(decoded, tile, padding, inputWidth, inputHeight) {
  const width = inputWidth ?? tile.core.width + padding * 2;
  const height = inputHeight ?? tile.core.height + padding * 2;
  if (width < tile.core.width + padding * 2 || height < tile.core.height + padding * 2) {
    throw createNamedError('ProtocolError', 'Fixed model input is smaller than the padded tile core');
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.max(0, Math.min(decoded.height - 1, tile.core.y + y - padding));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.max(0, Math.min(decoded.width - 1, tile.core.x + x - padding));
      const sourceOffset = (sourceY * decoded.width + sourceX) * 4;
      const targetOffset = (y * width + x) * 4;
      pixels[targetOffset] = decoded.pixels[sourceOffset];
      pixels[targetOffset + 1] = decoded.pixels[sourceOffset + 1];
      pixels[targetOffset + 2] = decoded.pixels[sourceOffset + 2];
      pixels[targetOffset + 3] = decoded.pixels[sourceOffset + 3];
    }
  }
  return { width, height, pixels };
}

function createTensorData(rgba, layout, colorSpace = 'rgb') {
  const pixelCount = rgba.width * rgba.height;
  if (colorSpace === 'ycbcr-y') {
    const data = new Float32Array(pixelCount);
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4;
      data[index] = (
        rgba.pixels[offset] * 0.299
        + rgba.pixels[offset + 1] * 0.587
        + rgba.pixels[offset + 2] * 0.114
      ) / 255;
    }
    return {
      data,
      dims: layout === 'nchw' ? [1, 1, rgba.height, rgba.width] : [1, rgba.height, rgba.width, 1],
    };
  }
  const data = new Float32Array(pixelCount * 3);
  if (layout === 'nchw') {
    const planeSize = pixelCount;
    for (let index = 0; index < pixelCount; index += 1) {
      data[index] = rgba.pixels[index * 4] / 255;
      data[planeSize + index] = rgba.pixels[index * 4 + 1] / 255;
      data[planeSize * 2 + index] = rgba.pixels[index * 4 + 2] / 255;
    }
    return { data, dims: [1, 3, rgba.height, rgba.width] };
  }
  for (let index = 0; index < pixelCount; index += 1) {
    data[index * 3] = rgba.pixels[index * 4] / 255;
    data[index * 3 + 1] = rgba.pixels[index * 4 + 1] / 255;
    data[index * 3 + 2] = rgba.pixels[index * 4 + 2] / 255;
  }
  return { data, dims: [1, rgba.height, rgba.width, 3] };
}

function getTensorShape(tensor) {
  if (!Array.isArray(tensor?.dims) || tensor.dims.length !== 4) {
    throw createNamedError('TensorShapeError', 'Model output must have four dimensions');
  }
  const dims = tensor.dims.map(Number);
  if (!dims.every((value) => Number.isInteger(value) && value > 0)) {
    throw createNamedError('TensorShapeError', 'Model output dimensions must be positive integers');
  }
  return dims;
}

function validateOutputTensor(tensor, width, height, scale, layout, colorSpace = 'rgb', outputInset = 0) {
  const dims = getTensorShape(tensor);
  const channels = colorSpace === 'ycbcr-y' ? 1 : 3;
  const outputWidth = (width - outputInset * 2) * scale;
  const outputHeight = (height - outputInset * 2) * scale;
  const expected = layout === 'nchw'
    ? [1, channels, outputHeight, outputWidth]
    : [1, outputHeight, outputWidth, channels];
  if (dims.some((value, index) => value !== expected[index])
    || !tensor.data || tensor.data.length !== expected[1] * expected[2] * expected[3]) {
    throw createNamedError(
      'TensorShapeError',
      `Model output shape ${JSON.stringify(dims)} does not match ${JSON.stringify(expected)}`,
    );
  }
  return { width: outputWidth, height: outputHeight };
}

function copyRgbTensorTileToOutput(outputTensor, outputPixels, outputWidth, outputTensorWidth, tile, scale, crop) {
  const data = outputTensor.data;
  const outputTensorHeight = outputTensor.dims[2];
  const planeSize = outputTensorWidth * outputTensorHeight;
  const tileWidth = tile.core.width * scale;
  const tileHeight = tile.core.height * scale;
  const baseTargetX = tile.core.x * scale;
  const baseTargetY = tile.core.y * scale;
  for (let y = 0; y < tileHeight; y += 1) {
    let tensorOffset = (y + crop) * outputTensorWidth + crop;
    let target = ((baseTargetY + y) * outputWidth + baseTargetX) * 4;
    for (let x = 0; x < tileWidth; x += 1) {
      const red = data[tensorOffset];
      const green = data[planeSize + tensorOffset];
      const blue = data[planeSize * 2 + tensorOffset];
      if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) {
        throw createNamedError('TensorValueError', 'Model output contains a non-finite value');
      }
      outputPixels[target] = Math.round(Math.max(0, Math.min(1, red)) * 255);
      outputPixels[target + 1] = Math.round(Math.max(0, Math.min(1, green)) * 255);
      outputPixels[target + 2] = Math.round(Math.max(0, Math.min(1, blue)) * 255);
      tensorOffset += 1;
      target += 4;
    }
  }
}

function blitNchwRgbTile({
  outputTensor,
  outputPixels,
  outputWidth,
  outputTensorWidth,
  tile,
  scale,
  crop,
}) {
  copyRgbTensorTileToOutput(outputTensor, outputPixels, outputWidth, outputTensorWidth, tile, scale, crop);
}

function copyScaledAlphaNearest({
  sourcePixels,
  sourceWidth,
  sourceHeight,
  outputPixels,
  outputWidth,
  outputHeight,
  scale,
}) {
  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor(y / scale));
    let target = (y * outputWidth) * 4 + 3;
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor(x / scale));
      outputPixels[target] = sourcePixels[(sourceY * sourceWidth + sourceX) * 4 + 3];
      target += 4;
    }
  }
}

function readTensorRgb(tensor, layout, width, x, y) {
  if (layout === 'nchw') {
    const planeSize = width * tensor.dims[2];
    const offset = y * width + x;
    return [tensor.data[offset], tensor.data[planeSize + offset], tensor.data[planeSize * 2 + offset]];
  }
  const offset = (y * width + x) * 3;
  return [tensor.data[offset], tensor.data[offset + 1], tensor.data[offset + 2]];
}

function readPixelCbCr(rgba, x, y) {
  const offset = (y * rgba.width + x) * 4;
  const red = rgba.pixels[offset];
  const green = rgba.pixels[offset + 1];
  const blue = rgba.pixels[offset + 2];
  return [
    128 - red * 0.168736 - green * 0.331264 + blue * 0.5,
    128 + red * 0.5 - green * 0.418688 - blue * 0.081312,
  ];
}

function sampleCbCr(rgba, outputX, outputY, scale) {
  const sourceX = Math.max(0, Math.min(rgba.width - 1, (outputX + 0.5) / scale - 0.5));
  const sourceY = Math.max(0, Math.min(rgba.height - 1, (outputY + 0.5) / scale - 0.5));
  const left = Math.floor(sourceX);
  const top = Math.floor(sourceY);
  const right = Math.min(rgba.width - 1, left + 1);
  const bottom = Math.min(rgba.height - 1, top + 1);
  const xWeight = sourceX - left;
  const yWeight = sourceY - top;
  const topLeft = readPixelCbCr(rgba, left, top);
  const topRight = readPixelCbCr(rgba, right, top);
  const bottomLeft = readPixelCbCr(rgba, left, bottom);
  const bottomRight = readPixelCbCr(rgba, right, bottom);
  return [0, 1].map((channel) => {
    const topValue = topLeft[channel] + (topRight[channel] - topLeft[channel]) * xWeight;
    const bottomValue = bottomLeft[channel] + (bottomRight[channel] - bottomLeft[channel]) * xWeight;
    return topValue + (bottomValue - topValue) * yWeight;
  });
}

function yCbCrToRgb(y, cb, cr) {
  if (!Number.isFinite(y)) {
    throw createNamedError('TensorValueError', 'Model output contains a non-finite value');
  }
  const luma = Math.max(0, Math.min(1, y)) * 255;
  const clamp = (value) => Math.round(Math.max(0, Math.min(255, value)));
  return [
    clamp(luma + 1.402 * (cr - 128)),
    clamp(luma - 0.344136 * (cb - 128) - 0.714136 * (cr - 128)),
    clamp(luma + 1.772 * (cb - 128)),
  ];
}

async function decodeImageBlob(blob) {
  if (typeof globalThis.createImageBitmap !== 'function'
    || typeof globalThis.OffscreenCanvas !== 'function') {
    throw createNamedError('DecodeError', 'createImageBitmap and OffscreenCanvas are required');
  }
  const bitmap = await globalThis.createImageBitmap(blob);
  let canvas;
  try {
    canvas = new globalThis.OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw createNamedError('DecodeError', '2D canvas context is unavailable');
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      width: bitmap.width,
      height: bitmap.height,
      pixels: image.data,
      close() {
        bitmap.close();
        canvas.width = 1;
        canvas.height = 1;
      },
    };
  } catch (error) {
    bitmap.close();
    throw error;
  }
}

async function encodeImageBlob(image) {
  if (typeof globalThis.OffscreenCanvas !== 'function') {
    throw createNamedError('EncodeError', 'OffscreenCanvas is required');
  }
  const canvas = new globalThis.OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  if (!context) throw createNamedError('EncodeError', '2D canvas context is unavailable');
  const imageData = context.createImageData(image.width, image.height);
  imageData.data.set(image.pixels);
  context.putImageData(imageData, 0, 0);
  return canvas.convertToBlob({ type: image.type ?? 'image/png' });
}

function resizeRgbaNearest(image, size) {
  if (size.width === image.width && size.height === image.height) return image;
  const pixels = new Uint8ClampedArray(size.width * size.height * 4);
  for (let y = 0; y < size.height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor(y * image.height / size.height));
    for (let x = 0; x < size.width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor(x * image.width / size.width));
      const source = (sourceY * image.width + sourceX) * 4;
      const target = (y * size.width + x) * 4;
      pixels[target] = image.pixels[source];
      pixels[target + 1] = image.pixels[source + 1];
      pixels[target + 2] = image.pixels[source + 2];
      pixels[target + 3] = image.pixels[source + 3];
    }
  }
  return { ...image, ...size, pixels };
}

async function prepareDisplayImage(image) {
  const size = resolveBoundedImageSize(image.width, image.height, READER_SUPER_RESOLUTION_DISPLAY_PIXELS);
  if (size.width === image.width && size.height === image.height) return image;
  if (typeof globalThis.OffscreenCanvas !== 'function') return resizeRgbaNearest(image, size);
  const sourceCanvas = new globalThis.OffscreenCanvas(image.width, image.height);
  const sourceContext = sourceCanvas.getContext('2d');
  const targetCanvas = new globalThis.OffscreenCanvas(size.width, size.height);
  const targetContext = targetCanvas.getContext('2d');
  if (!sourceContext || !targetContext) return resizeRgbaNearest(image, size);
  const imageData = sourceContext.createImageData(image.width, image.height);
  imageData.data.set(image.pixels);
  sourceContext.putImageData(imageData, 0, 0);
  targetContext.imageSmoothingEnabled = true;
  targetContext.drawImage(sourceCanvas, 0, 0, size.width, size.height);
  return { ...image, ...size, pixels: targetContext.getImageData(0, 0, size.width, size.height).data };
}

async function processBlobImage({
  blob,
  manifest,
  session,
  requestId,
  isCurrent,
  isCancelled,
  decodeImage,
  encodeImage,
  tensorFactory,
}) {
  const { scale, inputLayout, outputLayout } = validateProcessManifest(manifest);
  const decoded = await decodeImage(blob);
  try {
    const image = validateDecodedImage(decoded);
    const outputWidth = image.width * scale;
    const outputHeight = image.height * scale;
    const outputPixelCount = outputWidth * outputHeight;
    if (!Number.isSafeInteger(outputPixelCount) || outputPixelCount > SUPER_RESOLUTION_MAX_INFERENCE_PIXELS) {
      throw createNamedError(
        'NotSupportedError',
        `Super-resolution inference exceeds the ${SUPER_RESOLUTION_MAX_INFERENCE_PIXELS} pixel limit`,
      );
    }
    const tilePlan = createTilePlan(image.width, image.height, {
      tileCore: manifest.tileCore,
      padding: manifest.padding,
    });
    const colorSpace = manifest.colorSpace ?? 'rgb';
    const outputPixels = new Uint8ClampedArray(outputWidth * outputHeight * 4);
    const inputName = manifest.inputName ?? session.inputNames?.[0] ?? 'input';
    const outputName = manifest.outputName ?? session.outputNames?.[0] ?? 'output';

    for (const tile of tilePlan.tiles) {
      if (!isCurrent() || isCancelled()) {
        throw createNamedError('AbortError', 'Super-resolution request was cancelled');
      }
      const padded = createPaddedRgba(
        image,
        tile,
        tilePlan.padding,
        manifest.inputWidth,
        manifest.inputHeight,
      );
      const tensorInput = createTensorData(padded, inputLayout, colorSpace);
      const inputTensor = await tensorFactory(tensorInput.data, tensorInput.dims);
      let outputTensor;
      try {
        const results = await session.run({ [inputName]: inputTensor });
        outputTensor = results?.[outputName] ?? Object.values(results ?? {})[0];
        if (!isCurrent() || isCancelled()) {
          throw createNamedError('AbortError', 'Super-resolution request was cancelled');
        }
        const output = validateOutputTensor(
          outputTensor,
          padded.width,
          padded.height,
          scale,
          outputLayout,
          colorSpace,
          manifest.outputInset ?? 0,
        );
        const crop = (tilePlan.padding - (manifest.outputInset ?? 0)) * scale;
        const outputTensorWidth = output.width;
        if (colorSpace === 'rgb' && outputLayout === 'nchw') {
          blitNchwRgbTile({
            outputTensor,
            outputPixels,
            outputWidth,
            outputTensorWidth,
            tile,
            scale,
            crop,
          });
        } else {
          for (let y = 0; y < tile.core.height * scale; y += 1) {
            for (let x = 0; x < tile.core.width * scale; x += 1) {
              const tensorX = x + crop;
              const tensorY = y + crop;
              const rgb = colorSpace === 'ycbcr-y'
                ? yCbCrToRgb(
                  outputTensor.data[tensorY * outputTensorWidth + tensorX],
                  ...sampleCbCr(padded, tensorX, tensorY, scale),
                )
                : readTensorRgb(outputTensor, outputLayout, outputTensorWidth, tensorX, tensorY);
              const target = ((tile.core.y * scale + y) * outputWidth + tile.core.x * scale + x) * 4;
              outputPixels[target] = colorSpace === 'ycbcr-y' ? rgb[0] : clampByte(rgb[0]);
              outputPixels[target + 1] = colorSpace === 'ycbcr-y' ? rgb[1] : clampByte(rgb[1]);
              outputPixels[target + 2] = colorSpace === 'ycbcr-y' ? rgb[2] : clampByte(rgb[2]);
            }
          }
        }
      } finally {
        disposeTensor(outputTensor);
        disposeTensor(inputTensor);
      }
    }

    copyScaledAlphaNearest({
      sourcePixels: image.pixels,
      sourceWidth: image.width,
      sourceHeight: image.height,
      outputPixels,
      outputWidth,
      outputHeight,
      scale,
    });
    if (!isCurrent() || isCancelled()) {
      throw createNamedError('AbortError', 'Super-resolution request was cancelled');
    }
    const encodedImage = await prepareDisplayImage({
      pixels: outputPixels,
      width: outputWidth,
      height: outputHeight,
      type: 'image/png',
    });
    const resultBlob = await encodeImage(encodedImage);
    if (!isCurrent() || isCancelled()) {
      throw createNamedError('AbortError', 'Super-resolution request was cancelled');
    }
    return {
      type: 'result',
      requestId,
      blob: resultBlob,
      width: encodedImage.width,
      height: encodedImage.height,
    };
  } finally {
    decoded.close?.();
  }
}

async function processPixelProcessorBlob({
  blob,
  manifest,
  processor,
  requestId,
  isCurrent,
  isCancelled,
  decodeImage,
  encodeImage,
}) {
  const decoded = await decodeImage(blob);
  try {
    const image = validateDecodedImage(decoded);
    const expectedWidth = image.width * manifest.scale;
    const expectedHeight = image.height * manifest.scale;
    const outputPixelCount = expectedWidth * expectedHeight;
    if (!Number.isSafeInteger(outputPixelCount) || outputPixelCount > SUPER_RESOLUTION_MAX_INFERENCE_PIXELS) {
      throw createNamedError(
        'NotSupportedError',
        `Super-resolution inference exceeds the ${SUPER_RESOLUTION_MAX_INFERENCE_PIXELS} pixel limit`,
      );
    }
    if (!isCurrent() || isCancelled()) {
      throw createNamedError('AbortError', 'Super-resolution request was cancelled');
    }
    const output = await processor.process(image.pixels, image.width, image.height, { isCancelled });
    if (!isCurrent() || isCancelled()) {
      throw createNamedError('AbortError', 'Super-resolution request was cancelled');
    }
    if (output?.width !== expectedWidth || output?.height !== expectedHeight
      || !output.pixels || output.pixels.length !== outputPixelCount * 4) {
      throw createNamedError('TensorShapeError', 'Super-resolution processor returned invalid RGBA output');
    }
    const encodedImage = await prepareDisplayImage({
      pixels: output.pixels,
      width: output.width,
      height: output.height,
      type: 'image/png',
    });
    const resultBlob = await encodeImage(encodedImage);
    if (!isCurrent() || isCancelled()) {
      throw createNamedError('AbortError', 'Super-resolution request was cancelled');
    }
    return {
      type: 'result',
      requestId,
      blob: resultBlob,
      width: encodedImage.width,
      height: encodedImage.height,
    };
  } finally {
    decoded.close?.();
  }
}

function normalizeDigest(value) {
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return bytesToHex(value);
  return String(value).trim().toLowerCase();
}

function validateInitManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw createNamedError('ProtocolError', 'init requires a model manifest');
  }
  if (typeof manifest.url !== 'string' || !manifest.url) {
    throw createNamedError('ProtocolError', 'init requires a model URL');
  }
  const checksum = manifest.checksum;
  if (typeof checksum?.algorithm !== 'string'
    || checksum.algorithm.trim().toLowerCase() !== 'sha-256'
    || typeof checksum.digest !== 'string'
    || !/^[a-f0-9]{64}$/i.test(checksum.digest)) {
    throw createNamedError('ProtocolError', 'init requires a SHA-256 model checksum');
  }
  if (manifest.executionProviders !== undefined
    && (!Array.isArray(manifest.executionProviders)
      || manifest.executionProviders.length === 0
      || new Set(manifest.executionProviders).size !== manifest.executionProviders.length
      || manifest.executionProviders.some((provider) => provider !== WEBGPU_BACKEND))) {
    throw createNamedError('ProtocolError', 'init executionProviders must contain only the WebGPU backend');
  }
}

function validateDigest(manifest, actualDigest) {
  const expectedDigest = manifest.checksum.digest.toLowerCase();
  if (normalizeDigest(actualDigest) !== expectedDigest) {
    throw createNamedError(
      'ChecksumError',
      `SHA-256 checksum mismatch: expected ${expectedDigest}, received ${normalizeDigest(actualDigest)}`,
    );
  }
}

function getDefaultFetcher() {
  if (typeof globalThis.fetch !== 'function') {
    throw createNamedError('FetchError', 'fetch is unavailable in this worker');
  }
  return globalThis.fetch.bind(globalThis);
}

function getDefaultCacheStorage() {
  return typeof globalThis.caches?.open === 'function' ? globalThis.caches : null;
}

async function openModelCache(cacheStorage) {
  if (!cacheStorage || typeof cacheStorage.open !== 'function') return null;
  try {
    return await cacheStorage.open(MODEL_CACHE_NAME);
  } catch {
    return null;
  }
}

async function readCachedModel(cache, url) {
  const response = await cache.match(url);
  if (!response) return null;
  if (response.ok === false || typeof response.arrayBuffer !== 'function') {
    throw createNamedError('CacheError', 'Cached model response is unreadable');
  }
  return response.arrayBuffer();
}

async function writeCachedModel(cache, url, bytes) {
  if (typeof globalThis.Response !== 'function') return;
  await cache.put(url, new globalThis.Response(bytes.slice(0)));
}

function describeSessionAttempt(error) {
  if (error) return `WebGPU session failed: ${toErrorDetails(error).message}`;
  return 'WebGPU session factory returned no session';
}

export function createSuperResolutionWorkerHandler(dependencies = {}) {
  const fetcher = dependencies.fetcher ?? getDefaultFetcher();
  const digest = dependencies.digest ?? digestWithWebCrypto;
  const sessionFactory = dependencies.sessionFactory ?? createProductionSession;
  const cacheStorage = dependencies.cacheStorage ?? getDefaultCacheStorage();
  const decodeImage = dependencies.decodeImage ?? decodeImageBlob;
  const encodeImage = dependencies.encodeImage ?? encodeImageBlob;
  const tensorFactory = dependencies.tensorFactory ?? createProductionTensor;
  const realCuganFactory = dependencies.realCuganFactory ?? createProductionRealCuganProcessor;
  let session = null;
  let processor = null;
  let backend = null;
  let activeManifest = null;
  let disposed = false;
  let generation = 0;
  let inferenceChain = Promise.resolve();
  const staleRequestIds = new Set();

  function isCurrentGeneration(initGeneration) {
    return !disposed && initGeneration === generation;
  }

  async function ensureCurrentGeneration(initGeneration, candidateSession) {
    if (isCurrentGeneration(initGeneration)) return;
    if (candidateSession && typeof candidateSession.release === 'function') await candidateSession.release();
    else candidateSession?.dispose?.();
    throw createNamedError(
      'StaleInitializationError',
      'Super-resolution initialization result became stale',
    );
  }

  async function initialize(requestId, manifest) {
    if (disposed) throw createNamedError('DisposedError', 'Super-resolution worker is disposed');
    const initGeneration = ++generation;
    validateInitManifest(manifest);

    if (manifest.engine === 'realcugan-tfjs') {
      const initialized = await realCuganFactory(manifest);
      const nextProcessor = initialized?.processor;
      await ensureCurrentGeneration(initGeneration, nextProcessor);
      if (!nextProcessor || typeof nextProcessor.process !== 'function') {
        throw createNamedError('SessionInitializationError', 'Real-CUGAN processor is unavailable');
      }
      if (session && typeof session.release === 'function') await session.release();
      processor?.dispose?.();
      session = null;
      processor = nextProcessor;
      backend = initialized.backend;
      activeManifest = manifest;
      staleRequestIds.clear();
      return { type: 'ready', requestId, backend };
    }

    let cache = await openModelCache(cacheStorage);
    let modelBytes;
    if (cache) {
      try {
        const cachedBytes = await readCachedModel(cache, manifest.url);
        if (cachedBytes) {
          try {
            validateDigest(manifest, await digest(cachedBytes));
            modelBytes = cachedBytes;
          } catch {
            try {
              await cache.delete(manifest.url);
            } catch {
              // Cache failures must not block a verified network fallback.
            }
          }
        }
      } catch {
        cache = null;
      }
    }

    if (!modelBytes) {
      modelBytes = await fetchModel(fetcher, manifest.url);
      validateDigest(manifest, await digest(modelBytes));
      if (cache) {
        try {
          await writeCachedModel(cache, manifest.url, modelBytes);
        } catch {
          // Inference can proceed even when persistent model caching is unavailable.
        }
      }
    }

    const providers = manifest.executionProviders ?? [WEBGPU_BACKEND];
    const sessionErrors = new Map();
    let nextSession = null;
    let selectedBackend = null;
    for (const provider of providers) {
      try {
        nextSession = await sessionFactory(modelBytes, provider);
      } catch (error) {
        sessionErrors.set(provider, error);
      }
      await ensureCurrentGeneration(initGeneration, nextSession);
      if (nextSession) {
        selectedBackend = provider;
        break;
      }
    }

    if (!nextSession) {
      throw createNamedError(
        'SessionInitializationError',
        providers.map((provider) => describeSessionAttempt(sessionErrors.get(provider))).join('; '),
      );
    }

    if (session && typeof session.release === 'function') await session.release();
    processor?.dispose?.();
    await ensureCurrentGeneration(initGeneration, nextSession);
    session = nextSession;
    processor = null;
    backend = selectedBackend;
    activeManifest = manifest;
    staleRequestIds.clear();
    return { type: 'ready', requestId, backend };
  }

  async function dispose(requestId) {
    disposed = true;
    generation += 1;
    const currentSession = session;
    const currentProcessor = processor;
    session = null;
    processor = null;
    backend = null;
    activeManifest = null;
    staleRequestIds.clear();

    try {
      if (currentSession && typeof currentSession.release === 'function') {
        await currentSession.release();
      }
      currentProcessor?.dispose?.();
    } catch (error) {
      throw createNamedError('DisposeError', `Failed to release super-resolution session: ${toErrorDetails(error).message}`);
    }

    return { type: 'disposed', requestId };
  }

  async function handleMessage(message) {
    const requestId = message?.requestId;

    try {
      switch (message?.type) {
        case 'init':
          return await initialize(requestId, message.manifest);
        case 'process':
          if (disposed) throw createNamedError('DisposedError', 'Super-resolution worker is disposed');
          if (staleRequestIds.delete(requestId)) {
            throw createNamedError('AbortError', 'Super-resolution request was cancelled');
          }
          if (!session && !processor) {
            throw createNamedError('NotInitializedError', 'Super-resolution session is not initialized');
          }
          if (!((typeof globalThis.Blob === 'function' && message.blob instanceof globalThis.Blob)
            || typeof message.blob?.arrayBuffer === 'function')) {
            throw createNamedError('NotImplementedError', 'Pixel-buffer processing remains unsupported');
          }
          {
            const processGeneration = generation;
            const processSession = session;
            const processProcessor = processor;
            const processBackend = backend;
            const processManifest = message.manifest ?? activeManifest;
            const runInference = processManifest?.engine === 'realcugan-tfjs'
              ? () => processPixelProcessorBlob({
                blob: message.blob,
                manifest: processManifest,
                processor: processProcessor,
                requestId,
                isCurrent: () => !disposed
                  && generation === processGeneration
                  && processor === processProcessor
                  && backend === processBackend,
                isCancelled: () => staleRequestIds.delete(requestId),
                decodeImage,
                encodeImage,
              }).then((result) => ({ ...result, backend: processBackend }))
              : () => processBlobImage({
                blob: message.blob,
                manifest: processManifest,
                session: processSession,
                requestId,
                isCurrent: () => !disposed
                  && generation === processGeneration
                  && session === processSession
                  && backend === processBackend,
                isCancelled: () => staleRequestIds.delete(requestId),
                decodeImage,
                encodeImage,
                tensorFactory,
              }).then((result) => ({ ...result, backend: processBackend }));
            const result = inferenceChain.then(runInference, runInference);
            inferenceChain = result.catch(() => {});
            return await result;
          }
        case 'cancel':
          if (disposed) throw createNamedError('DisposedError', 'Super-resolution worker is disposed');
          staleRequestIds.add(requestId);
          return { type: 'cancelled', requestId };
        case 'dispose':
          return await dispose(requestId);
        default:
          throw createNamedError('ProtocolError', `Unknown message type: ${String(message?.type)}`);
      }
    } catch (error) {
      return createErrorResponse(requestId, error);
    }
  }

  return { handleMessage };
}

function isWorkerGlobal(scope) {
  if (!scope?.self) return false;
  if (typeof scope.WorkerGlobalScope === 'function') {
    return scope.self instanceof scope.WorkerGlobalScope;
  }
  return typeof scope.window === 'undefined'
    && typeof scope.self.addEventListener === 'function'
    && typeof scope.self.postMessage === 'function';
}

function installWorkerGlobal() {
  if (!isWorkerGlobal(globalThis)) return;

  const workerScope = globalThis.self;
  const handler = createSuperResolutionWorkerHandler();
  workerScope.addEventListener('message', async (event) => {
    workerScope.postMessage(await handler.handleMessage(event.data));
  });
}

installWorkerGlobal();
