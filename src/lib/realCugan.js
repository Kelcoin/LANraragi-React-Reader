import { createTilePlan } from './superResolutionTiling.js';

const INPUT_SIZE = 64;
// The converted graph performs its own 18px REFLECT pad before the first
// convolution. Feed the full model tile; an outer pad creates block seams.
const PADDING = 0;
const TILE_CORE = INPUT_SIZE - PADDING * 2;
const SCALE = 2;
const OUTPUT_SIZE = INPUT_SIZE * SCALE;

export function reflectIndex(index, size) {
  if (size <= 1) return 0;
  let reflected = index;
  while (reflected < 0 || reflected >= size) {
    if (reflected < 0) reflected = -reflected;
    if (reflected >= size) reflected = size * 2 - reflected - 2;
  }
  return reflected;
}

function createAbortError() {
  if (typeof DOMException === 'function') return new DOMException('Real-CUGAN request cancelled', 'AbortError');
  const error = new Error('Real-CUGAN request cancelled');
  error.name = 'AbortError';
  return error;
}

function throwIfCancelled(isCancelled) {
  if (isCancelled?.()) throw createAbortError();
}

function createTileInput(pixels, width, height, tile) {
  const data = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
  for (let y = 0; y < INPUT_SIZE; y += 1) {
    const sourceY = reflectIndex(tile.core.y + y - PADDING, height);
    for (let x = 0; x < INPUT_SIZE; x += 1) {
      const sourceX = reflectIndex(tile.core.x + x - PADDING, width);
      const source = (sourceY * width + sourceX) * 4;
      const target = (y * INPUT_SIZE + x) * 3;
      data[target] = pixels[source] / 255;
      data[target + 1] = pixels[source + 1] / 255;
      data[target + 2] = pixels[source + 2] / 255;
    }
  }
  return data;
}

function getOutputTensor(output) {
  if (Array.isArray(output)) return output[0];
  if (output && typeof output === 'object' && !Array.isArray(output.shape)) {
    return Object.values(output)[0];
  }
  return output;
}

function disposeOutput(output) {
  if (Array.isArray(output)) output.forEach((tensor) => tensor?.dispose?.());
  else if (output && typeof output === 'object' && !Array.isArray(output.shape)) {
    Object.values(output).forEach((tensor) => tensor?.dispose?.());
  } else output?.dispose?.();
}

function bilinearChannel(pixels, topLeft, topRight, bottomLeft, bottomRight, channel, xWeight, yWeight) {
  const topValue = pixels[topLeft + channel]
    + (pixels[topRight + channel] - pixels[topLeft + channel]) * xWeight;
  const bottomValue = pixels[bottomLeft + channel]
    + (pixels[bottomRight + channel] - pixels[bottomLeft + channel]) * xWeight;
  return topValue + (bottomValue - topValue) * yWeight;
}

function clampByte(value) {
  return Math.round(Math.max(0, Math.min(255, value)));
}

function writeWithSourceChroma(output, target, red, green, blue, pixels, width, height, outputX, outputY) {
  if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) {
    throw new Error('Real-CUGAN output contains a non-finite value');
  }
  const sourceX = Math.max(0, Math.min(width - 1, (outputX + 0.5) / SCALE - 0.5));
  const sourceY = Math.max(0, Math.min(height - 1, (outputY + 0.5) / SCALE - 0.5));
  const left = Math.floor(sourceX);
  const top = Math.floor(sourceY);
  const right = Math.min(width - 1, left + 1);
  const bottom = Math.min(height - 1, top + 1);
  const xWeight = sourceX - left;
  const yWeight = sourceY - top;
  const topLeft = (top * width + left) * 4;
  const topRight = (top * width + right) * 4;
  const bottomLeft = (bottom * width + left) * 4;
  const bottomRight = (bottom * width + right) * 4;
  const sourceRed = bilinearChannel(pixels, topLeft, topRight, bottomLeft, bottomRight, 0, xWeight, yWeight);
  const sourceGreen = bilinearChannel(pixels, topLeft, topRight, bottomLeft, bottomRight, 1, xWeight, yWeight);
  const sourceBlue = bilinearChannel(pixels, topLeft, topRight, bottomLeft, bottomRight, 2, xWeight, yWeight);
  const cb = 128 - sourceRed * 0.168736 - sourceGreen * 0.331264 + sourceBlue * 0.5;
  const cr = 128 + sourceRed * 0.5 - sourceGreen * 0.418688 - sourceBlue * 0.081312;
  const luma = (red * 299 + green * 587 + blue * 114) * 0.255;
  const cbDelta = Math.abs(cb - 128) < 1e-6 ? 0 : cb - 128;
  const crDelta = Math.abs(cr - 128) < 1e-6 ? 0 : cr - 128;
  output[target] = clampByte(luma + 1.402 * crDelta);
  output[target + 1] = clampByte(luma - 0.344136 * cbDelta - 0.714136 * crDelta);
  output[target + 2] = clampByte(luma + 1.772 * cbDelta);
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(bytes) {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new Error('Real-CUGAN requires Web Crypto SHA-256');
  }
  return bytesToHex(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

export function createRealCuganModelIOHandler({ manifest, fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
  if (typeof fetcher !== 'function') throw new TypeError('Real-CUGAN requires fetch');
  return {
    async load() {
      const modelResponse = await fetcher(manifest.url);
      if (modelResponse?.ok === false) throw new Error(`Failed to fetch Real-CUGAN topology (HTTP ${modelResponse.status ?? 'unknown'})`);
      const topology = await modelResponse.json();
      const shard = topology?.weightsManifest?.[0];
      const weights = shard?.weights;
      if (!topology?.modelTopology || !Array.isArray(weights) || weights.length === 0) {
        throw new Error('Real-CUGAN topology has no weights manifest');
      }
      const weightResponse = await fetcher(manifest.weightsUrl);
      if (weightResponse?.ok === false) throw new Error(`Failed to fetch Real-CUGAN weights (HTTP ${weightResponse.status ?? 'unknown'})`);
      const weightData = await weightResponse.arrayBuffer();
      if (!weightData.byteLength) throw new Error('Real-CUGAN weights are empty');
      const digest = await sha256(weightData);
      if (digest !== manifest.weightsChecksum?.digest?.trim().toLowerCase()) {
        throw new Error(`Real-CUGAN weights checksum mismatch: expected ${manifest.weightsChecksum?.digest}, got ${digest}`);
      }
      return {
        modelTopology: topology.modelTopology,
        weightSpecs: weights,
        weightData,
        format: topology.format,
        generatedBy: topology.generatedBy,
        convertedBy: topology.convertedBy,
        signature: topology.signature,
        userDefinedMetadata: topology.userDefinedMetadata,
      };
    },
  };
}

export function createRealCuganProcessor({
  tf,
  model,
  yieldControl: defaultYieldControl = () => new Promise((resolve) => setTimeout(resolve, 0)),
} = {}) {
  if (typeof tf?.tensor4d !== 'function') throw new TypeError('Real-CUGAN requires TensorFlow.js');
  if (typeof model?.executeAsync !== 'function' && typeof model?.execute !== 'function') {
    throw new TypeError('Real-CUGAN requires a GraphModel');
  }
  let disposed = false;

  async function process(pixels, width, height, {
    isCancelled,
    yieldControl = defaultYieldControl,
    waitUntilRunnable = async () => {},
  } = {}) {
    if (disposed) throw new Error('Real-CUGAN processor is disposed');
    if (!(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)
      || pixels.length !== width * height * 4) {
      throw new TypeError('Real-CUGAN requires RGBA pixels');
    }
    const outputWidth = width * SCALE;
    const outputHeight = height * SCALE;
    const outputPixels = new Uint8ClampedArray(outputWidth * outputHeight * 4);
    const plan = createTilePlan(width, height, { tileCore: TILE_CORE, padding: PADDING });

    for (const tile of plan.tiles) {
      await waitUntilRunnable(isCancelled);
      throwIfCancelled(isCancelled);
      const input = tf.tensor4d(createTileInput(pixels, width, height, tile), [1, INPUT_SIZE, INPUT_SIZE, 3]);
      let rawOutput;
      try {
        rawOutput = typeof model.executeAsync === 'function'
          ? await model.executeAsync(input)
          : model.execute(input);
        const output = getOutputTensor(rawOutput);
        if (!output || JSON.stringify(output.shape) !== JSON.stringify([1, OUTPUT_SIZE, OUTPUT_SIZE, 3])) {
          throw new Error(`Real-CUGAN returned invalid output shape: ${JSON.stringify(output?.shape)}`);
        }
        const data = await output.data();
        throwIfCancelled(isCancelled);
        for (let y = 0; y < tile.core.height * SCALE; y += 1) {
          for (let x = 0; x < tile.core.width * SCALE; x += 1) {
            const source = ((y * OUTPUT_SIZE) + x) * 3;
            const outputX = tile.core.x * SCALE + x;
            const outputY = tile.core.y * SCALE + y;
            const target = (outputY * outputWidth + outputX) * 4;
            writeWithSourceChroma(
              outputPixels,
              target,
              data[source],
              data[source + 1],
              data[source + 2],
              pixels,
              width,
              height,
              outputX,
              outputY,
            );
          }
        }
      } finally {
        disposeOutput(rawOutput);
        input.dispose?.();
      }
      await yieldControl();
      throwIfCancelled(isCancelled);
    }

    for (let y = 0; y < outputHeight; y += 1) {
      const sourceY = Math.min(height - 1, Math.floor(y / SCALE));
      for (let x = 0; x < outputWidth; x += 1) {
        const sourceX = Math.min(width - 1, Math.floor(x / SCALE));
        outputPixels[(y * outputWidth + x) * 4 + 3] = pixels[(sourceY * width + sourceX) * 4 + 3];
      }
    }
    return { pixels: outputPixels, width: outputWidth, height: outputHeight };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    model.dispose?.();
  }

  return { process, dispose };
}

export async function initializeRealCuganBackend(tf) {
  try {
    if (await tf.setBackend('webgpu')) {
      await tf.ready();
      return tf.getBackend?.() || 'webgpu';
    }
  } catch (error) {
    throw new Error(`Real-CUGAN WebGPU initialization failed: ${error?.message || String(error)}`);
  }
  throw new Error('Real-CUGAN WebGPU initialization failed: backend unavailable');
}

export async function createProductionRealCuganProcessor(manifest) {
  const [tf, converter] = await Promise.all([
    import('@tensorflow/tfjs-core'),
    import('@tensorflow/tfjs-converter'),
    import('@tensorflow/tfjs-backend-webgpu'),
  ]);
  const backend = await initializeRealCuganBackend(tf);
  const resolveUrl = (url) => new URL(url, globalThis.location?.origin ?? import.meta.url).href;
  const model = await converter.loadGraphModel(createRealCuganModelIOHandler({
    manifest: { ...manifest, url: resolveUrl(manifest.url), weightsUrl: resolveUrl(manifest.weightsUrl) },
  }));
  return { processor: createRealCuganProcessor({ tf, model }), backend };
}
