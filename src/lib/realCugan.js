import { createTilePlan } from './superResolutionTiling.js';

const INPUT_SIZE = 64;
const PADDING = 18;
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

function clampByte(value) {
  if (!Number.isFinite(value)) throw new Error('Real-CUGAN output contains a non-finite value');
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
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

export function createRealCuganProcessor({ tf, model } = {}) {
  if (typeof tf?.tensor4d !== 'function') throw new TypeError('Real-CUGAN requires TensorFlow.js');
  if (typeof model?.executeAsync !== 'function' && typeof model?.execute !== 'function') {
    throw new TypeError('Real-CUGAN requires a GraphModel');
  }
  let disposed = false;

  async function process(pixels, width, height, { isCancelled } = {}) {
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
            const source = (((y + PADDING * SCALE) * OUTPUT_SIZE) + x + PADDING * SCALE) * 3;
            const target = (((tile.core.y * SCALE + y) * outputWidth) + tile.core.x * SCALE + x) * 4;
            outputPixels[target] = clampByte(data[source]);
            outputPixels[target + 1] = clampByte(data[source + 1]);
            outputPixels[target + 2] = clampByte(data[source + 2]);
          }
        }
      } finally {
        disposeOutput(rawOutput);
        input.dispose?.();
      }
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
  const errors = [];
  for (const backend of ['webgl', 'wasm']) {
    try {
      if (await tf.setBackend(backend)) {
        await tf.ready();
        return tf.getBackend?.() || backend;
      }
    } catch (error) {
      errors.push(`${backend}: ${error?.message || String(error)}`);
    }
  }
  throw new Error(`Real-CUGAN backend initialization failed${errors.length ? ` (${errors.join('; ')})` : ''}`);
}

export async function createProductionRealCuganProcessor(manifest) {
  const [tf, converter, wasm] = await Promise.all([
    import('@tensorflow/tfjs-core'),
    import('@tensorflow/tfjs-converter'),
    import('@tensorflow/tfjs-backend-wasm'),
    import('@tensorflow/tfjs-backend-webgl'),
  ]);
  wasm.setWasmPaths({
    'tfjs-backend-wasm.wasm': new URL('../../node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm', import.meta.url).href,
    'tfjs-backend-wasm-simd.wasm': new URL('../../node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm', import.meta.url).href,
    'tfjs-backend-wasm-threaded-simd.wasm': new URL('../../node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm', import.meta.url).href,
  });
  const backend = await initializeRealCuganBackend(tf);
  const resolveUrl = (url) => new URL(url, globalThis.location?.origin ?? import.meta.url).href;
  const model = await converter.loadGraphModel(createRealCuganModelIOHandler({
    manifest: { ...manifest, url: resolveUrl(manifest.url), weightsUrl: resolveUrl(manifest.weightsUrl) },
  }));
  return { processor: createRealCuganProcessor({ tf, model }), backend };
}
