import { createTilePlan } from './superResolutionTiling.js';

const WEBGL_BACKEND = 'webgl';
const WASM_BACKEND = 'wasm';

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
  const ort = await import('onnxruntime-web');
  return ort.InferenceSession.create(modelBytes, {
    executionProviders: [backend],
  });
}

async function createProductionTensor(data, dims) {
  const ort = await import('onnxruntime-web');
  return new ort.Tensor('float32', data, dims);
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

function createPaddedRgba(decoded, tile, padding) {
  const width = tile.core.width + padding * 2;
  const height = tile.core.height + padding * 2;
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

function createTensorData(rgba, layout) {
  const pixelCount = rgba.width * rgba.height;
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

function validateOutputTensor(tensor, width, height, scale, layout) {
  const dims = getTensorShape(tensor);
  const expected = layout === 'nchw'
    ? [1, 3, height * scale, width * scale]
    : [1, height * scale, width * scale, 3];
  if (dims.some((value, index) => value !== expected[index])
    || !tensor.data || tensor.data.length !== expected[1] * expected[2] * expected[3]) {
    throw createNamedError(
      'TensorShapeError',
      `Model output shape ${JSON.stringify(dims)} does not match ${JSON.stringify(expected)}`,
    );
  }
  return { width: width * scale, height: height * scale };
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
    const tilePlan = createTilePlan(image.width, image.height, {
      tileCore: manifest.tileCore,
      padding: manifest.padding,
    });
    const outputWidth = image.width * scale;
    const outputHeight = image.height * scale;
    const outputPixels = new Uint8ClampedArray(outputWidth * outputHeight * 4);
    const inputName = manifest.inputName ?? session.inputNames?.[0] ?? 'input';
    const outputName = manifest.outputName ?? session.outputNames?.[0] ?? 'output';

    for (const tile of tilePlan.tiles) {
      if (!isCurrent() || isCancelled()) {
        throw createNamedError('AbortError', 'Super-resolution request was cancelled');
      }
      const padded = createPaddedRgba(image, tile, tilePlan.padding);
      const tensorInput = createTensorData(padded, inputLayout);
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
        );
        const crop = tilePlan.padding * scale;
        const outputTensorWidth = output.width;
        for (let y = 0; y < tile.core.height * scale; y += 1) {
          for (let x = 0; x < tile.core.width * scale; x += 1) {
            const rgb = readTensorRgb(outputTensor, outputLayout, outputTensorWidth, x + crop, y + crop);
            const target = ((tile.core.y * scale + y) * outputWidth + tile.core.x * scale + x) * 4;
            outputPixels[target] = clampByte(rgb[0]);
            outputPixels[target + 1] = clampByte(rgb[1]);
            outputPixels[target + 2] = clampByte(rgb[2]);
          }
        }
      } finally {
        disposeTensor(outputTensor);
        disposeTensor(inputTensor);
      }
    }

    for (let y = 0; y < outputHeight; y += 1) {
      const sourceY = Math.min(image.height - 1, Math.floor(y / scale));
      for (let x = 0; x < outputWidth; x += 1) {
        const sourceX = Math.min(image.width - 1, Math.floor(x / scale));
        outputPixels[((y * outputWidth) + x) * 4 + 3] = image.pixels[
          (sourceY * image.width + sourceX) * 4 + 3
        ];
      }
    }
    if (!isCurrent() || isCancelled()) {
      throw createNamedError('AbortError', 'Super-resolution request was cancelled');
    }
    const resultBlob = await encodeImage({
      pixels: outputPixels,
      width: outputWidth,
      height: outputHeight,
      type: 'image/png',
    });
    if (!isCurrent() || isCancelled()) {
      throw createNamedError('AbortError', 'Super-resolution request was cancelled');
    }
    return {
      type: 'result',
      requestId,
      blob: resultBlob,
      width: outputWidth,
      height: outputHeight,
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

function describeSessionAttempt(backend, error) {
  const label = backend === WEBGL_BACKEND ? 'WebGL' : 'WASM';
  if (error) return `${label} session failed: ${toErrorDetails(error).message}`;
  return `${label} session factory returned no session`;
}

export function createSuperResolutionWorkerHandler(dependencies = {}) {
  const fetcher = dependencies.fetcher ?? getDefaultFetcher();
  const digest = dependencies.digest ?? digestWithWebCrypto;
  const sessionFactory = dependencies.sessionFactory ?? createProductionSession;
  const decodeImage = dependencies.decodeImage ?? decodeImageBlob;
  const encodeImage = dependencies.encodeImage ?? encodeImageBlob;
  const tensorFactory = dependencies.tensorFactory ?? createProductionTensor;
  let session = null;
  let backend = null;
  let activeManifest = null;
  let disposed = false;
  let generation = 0;
  const staleRequestIds = new Set();

  function isCurrentGeneration(initGeneration) {
    return !disposed && initGeneration === generation;
  }

  async function ensureCurrentGeneration(initGeneration, candidateSession) {
    if (isCurrentGeneration(initGeneration)) return;
    if (candidateSession && typeof candidateSession.release === 'function') {
      await candidateSession.release();
    }
    throw createNamedError(
      'StaleInitializationError',
      'Super-resolution initialization result became stale',
    );
  }

  async function initialize(requestId, manifest) {
    if (disposed) throw createNamedError('DisposedError', 'Super-resolution worker is disposed');
    const initGeneration = ++generation;
    validateInitManifest(manifest);

    const modelBytes = await fetchModel(fetcher, manifest.url);
    const actualDigest = await digest(modelBytes);
    validateDigest(manifest, actualDigest);

    let nextSession;
    let selectedBackend = WEBGL_BACKEND;
    let webglError;
    try {
      nextSession = await sessionFactory(modelBytes, WEBGL_BACKEND);
    } catch (error) {
      webglError = error;
    }

    await ensureCurrentGeneration(initGeneration, nextSession);

    let wasmError;
    if (!nextSession) {
      selectedBackend = WASM_BACKEND;
      try {
        nextSession = await sessionFactory(modelBytes, WASM_BACKEND);
      } catch (error) {
        wasmError = error;
      }
    }

    await ensureCurrentGeneration(initGeneration, nextSession);
    if (!nextSession) {
      throw createNamedError(
        'SessionInitializationError',
        `${describeSessionAttempt(WEBGL_BACKEND, webglError)}; `
          + describeSessionAttempt(WASM_BACKEND, wasmError),
      );
    }

    if (session && typeof session.release === 'function') await session.release();
    await ensureCurrentGeneration(initGeneration, nextSession);
    session = nextSession;
    backend = selectedBackend;
    activeManifest = manifest;
    staleRequestIds.clear();
    return { type: 'ready', requestId, backend };
  }

  async function dispose(requestId) {
    disposed = true;
    generation += 1;
    const currentSession = session;
    session = null;
    backend = null;
    activeManifest = null;
    staleRequestIds.clear();

    try {
      if (currentSession && typeof currentSession.release === 'function') {
        await currentSession.release();
      }
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
          if (!session) {
            throw createNamedError('NotInitializedError', 'Super-resolution session is not initialized');
          }
          if (!((typeof globalThis.Blob === 'function' && message.blob instanceof globalThis.Blob)
            || typeof message.blob?.arrayBuffer === 'function')) {
            throw createNamedError('NotImplementedError', 'Pixel-buffer processing remains unsupported');
          }
          {
            const processGeneration = generation;
            const processSession = session;
            const processBackend = backend;
            const processManifest = message.manifest ?? activeManifest;
            return await processBlobImage({
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
