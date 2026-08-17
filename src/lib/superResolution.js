import { createSuperResolutionRuntime as createRuntime } from './superResolutionRuntime.js';
import { IMAGE_LOAD_PRIORITY } from './imageLoadQueue.js';
import { isAnimatedImageBlob } from './readerPreviewDecode.js';
import {
  hasWebGpuApi,
  requestHighPerformanceWebGpuAdapter,
  WEBGPU_ADAPTER_UNAVAILABLE_REASON,
  WEBGPU_UNSUPPORTED_REASON,
} from './webGpuSupport.js';

const visiblePageJobs = new Map();
const WAIFU2X_FP16_MIN_BINDING_SIZE = 128 * 1024 * 1024;

const WAIFU2X_LICENSE = Object.freeze({
  name: 'MIT',
  url: 'https://github.com/nagadomi/nunif/blob/eab6952c78a27f6d4b73dbfda30d12f349699741/LICENSE',
});

const WAIFU2X_FP32_MANIFEST = Object.freeze({
  value: 'waifu2x',
  label: 'Waifu2x',
  description: '动漫插画通用模型，兼顾去噪、线条和色块，画质与速度较均衡。',
  id: 'waifu2x-cunet-art-scale2x-20250502',
  url: '/models/waifu2x-cunet-art-scale2x/scale2x.onnx',
  scale: 2,
  inputLayout: 'nchw',
  outputLayout: 'nchw',
  inputName: 'x',
  outputName: 'y',
  colorSpace: 'rgb',
  executionProviders: ['webgpu'],
  inputWidth: 224,
  inputHeight: 224,
  tileCore: 152,
  padding: 36,
  outputInset: 18,
  checksum: {
    algorithm: 'SHA-256',
    digest: '0966d74dd0739a20de358de88c8fa4eb6cb8c3489bb0e941da9751ad4dcdf495',
  },
  license: WAIFU2X_LICENSE,
});

const WAIFU2X_FP16_MANIFEST = Object.freeze({
  ...WAIFU2X_FP32_MANIFEST,
  id: 'waifu2x-cunet-art-scale2x-fp16-20260816',
  url: '/models/waifu2x-cunet-art-scale2x/scale2x-fp16.onnx',
  precision: 'fp16',
  inputWidth: 304,
  inputHeight: 304,
  tileCore: 232,
  tileCoreWidth: 232,
  tileCoreHeight: 232,
  checksum: {
    algorithm: 'SHA-256',
    digest: '32b9a5f3b4623e13f29a9f98e0fe03bee69d556df0d33be0a2d8a8d77d3a700d',
  },
});

const WAIFU2X_UPCONV7_MANIFEST = Object.freeze({
  value: 'waifu2x-upconv7',
  label: 'Waifu2x UpConv7',
  description: '轻量快速模型，适合优先处理速度的动漫插画。',
  id: 'waifu2x-upconv7-art-scale2x-fp16-20260816',
  url: '/models/waifu2x-upconv7-art-scale2x/scale2x.onnx',
  precision: 'fp16',
  scale: 2,
  inputLayout: 'nchw',
  outputLayout: 'nchw',
  inputName: 'x',
  outputName: 'y',
  colorSpace: 'rgb',
  executionProviders: ['webgpu'],
  inputWidth: 240,
  inputHeight: 240,
  tileCore: 226,
  padding: 7,
  outputInset: 7,
  checksum: {
    algorithm: 'SHA-256',
    digest: 'd6e851231688b239425e5cb05632a434bdbc58c076686dc69bd7e539d1680961',
  },
  license: {
    name: 'MIT',
    url: 'https://github.com/nagadomi/nunif/blob/eab6952d93e85951ed4e4cff30cd26c09e1dbb63/LICENSE',
  },
});

export function scheduleSuperResolutionUpgrade(queue, key, task, priority = IMAGE_LOAD_PRIORITY.PRELOAD) {
  // 超分永远是原图就绪后的后台升级，不能占用关键原图解码槽位。
  const backgroundPriority = Math.min(priority, IMAGE_LOAD_PRIORITY.ADJACENT);
  return queue.schedule(key, task, backgroundPriority);
}

export function cancelVisibleSuperResolutionJobs(cacheKey) {
  if (typeof cacheKey === 'string' && cacheKey) {
    const entry = visiblePageJobs.get(cacheKey);
    if (entry) {
      entry.controller.abort();
      if (visiblePageJobs.get(cacheKey) === entry) visiblePageJobs.delete(cacheKey);
    }
    return;
  }
  for (const entry of visiblePageJobs.values()) entry.controller.abort();
  visiblePageJobs.clear();
}

// 超分能力检测与模型选项（引擎：onnxruntime-web WebGPU 与 realcugan-tfjs）
export const SUPER_RESOLUTION_MODELS = Object.freeze([
  WAIFU2X_UPCONV7_MANIFEST,
  WAIFU2X_FP32_MANIFEST,
  {
    value: 'realcugan',
    label: 'Real-CUGAN',
    description: '重建能力最强，擅长压缩噪点、模糊线条和低质量原图；模型较重，处理速度和显存占用最高。',
    id: 'realcugan-2x-conservative-64-tfjs',
    engine: 'realcugan-tfjs',
    url: '/models/realcugan-2x-conservative/model.json',
    weightsUrl: '/models/realcugan-2x-conservative/weights.json',
    scale: 2,
    inputLayout: 'nhwc',
    outputLayout: 'nhwc',
    inputName: 'input',
    outputName: 'Identity',
    colorSpace: 'rgb',
    executionProviders: ['webgpu'],
    inputWidth: 64,
    inputHeight: 64,
    tileCore: 64,
    padding: 0,
    checksum: {
      algorithm: 'SHA-256',
      digest: '01bd550f8a4e875355ef248ab380676cc0283e78460459201136559051f7a15e',
    },
    weightsChecksum: {
      algorithm: 'SHA-256',
      digest: '2c383f2d3b8d64bf442ab97ec089980088619451d3793354561c2ce5e677072a',
    },
    license: {
      name: 'Apache-2.0; upstream weight terms apply',
      url: 'https://huggingface.co/shammisw/real-cugan-tensorflowjs/tree/85cea180e8ceb62677abc4e286b5d3ef6d2baa6d',
    },
  },
]);

export function getSuperResolutionModel(value) {
  return SUPER_RESOLUTION_MODELS.find((model) => model.value === value) ?? null;
}

export function selectWaifu2xManifest(adapterInfo, failedProfileIds = new Set()) {
  const maxBindingSize = Number(adapterInfo?.maxStorageBufferBindingSize);
  const fp32Failed = failedProfileIds?.has?.(WAIFU2X_FP32_MANIFEST.id) === true;
  const fp16Failed = failedProfileIds?.has?.(WAIFU2X_FP16_MANIFEST.id) === true;
  if (fp32Failed && adapterInfo?.shaderF16 === true
    && maxBindingSize >= WAIFU2X_FP16_MIN_BINDING_SIZE
    && !fp16Failed) {
    return WAIFU2X_FP16_MANIFEST;
  }
  return WAIFU2X_FP32_MANIFEST;
}

export function shouldFallbackWaifu2xProfile({ modelValue, manifest, adapterInfo } = {}) {
  if (modelValue !== 'waifu2x') return false;
  if (manifest?.precision === 'fp16') return true;
  return manifest?.precision === undefined
    && adapterInfo?.shaderF16 === true
    && Number(adapterInfo?.maxStorageBufferBindingSize) >= WAIFU2X_FP16_MIN_BINDING_SIZE;
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function getLayout(manifest, key) {
  return manifest?.[`${key}Layout`] ?? manifest?.[key]?.layout;
}

function hasChecksumMetadata(manifest) {
  const checksum = manifest?.checksum;
  if (!checksum || typeof checksum !== 'object' || Array.isArray(checksum)) return false;
  return hasText(checksum.algorithm)
    && checksum.algorithm.trim().toLowerCase() === 'sha-256'
    && typeof checksum.digest === 'string'
    && /^[a-f0-9]{64}$/i.test(checksum.digest);
}

function hasValidWeightsMetadata(manifest) {
  if (manifest?.engine !== 'realcugan-tfjs') return true;
  const checksum = manifest.weightsChecksum;
  return hasText(manifest.weightsUrl)
    && checksum && typeof checksum === 'object' && !Array.isArray(checksum)
    && hasText(checksum.algorithm)
    && checksum.algorithm.trim().toLowerCase() === 'sha-256'
    && typeof checksum.digest === 'string'
    && /^[a-f0-9]{64}$/i.test(checksum.digest);
}

function hasLicenseMetadata(manifest) {
  const license = manifest?.license;
  return Boolean(license
    && typeof license === 'object'
    && !Array.isArray(license)
    && hasText(license.name)
    && hasText(license.url));
}

function hasValidFixedInput(manifest) {
  if (manifest?.inputWidth === undefined && manifest?.inputHeight === undefined) return true;
  const width = Number(manifest?.inputWidth);
  const height = Number(manifest?.inputHeight);
  const tileCoreWidth = Number(manifest?.tileCoreWidth ?? manifest?.tileCore);
  const tileCoreHeight = Number(manifest?.tileCoreHeight ?? manifest?.tileCore);
  const padding = Number(manifest?.padding);
  const outputInset = Number(manifest?.outputInset ?? 0);
  return Number.isInteger(width) && width > 0
    && Number.isInteger(height) && height > 0
    && Number.isInteger(tileCoreWidth) && tileCoreWidth > 0
    && Number.isInteger(tileCoreHeight) && tileCoreHeight > 0
    && Number.isInteger(padding) && padding >= 0
    && Number.isInteger(outputInset) && outputInset >= 0 && outputInset <= padding
    && width > outputInset * 2
    && height > outputInset * 2
    && width >= tileCoreWidth + padding * 2
    && height >= tileCoreHeight + padding * 2;
}

function hasValidExecutionProviders(manifest) {
  if (manifest?.executionProviders === undefined) return true;
  const providers = manifest.executionProviders;
  return Array.isArray(providers)
    && providers.length > 0
    && new Set(providers).size === providers.length
    && providers.every((provider) => provider === 'webgpu');
}

export function validateSuperResolutionManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false;
  return Boolean(hasText(manifest.id)
    && hasText(manifest.url)
    && Number.isInteger(manifest.scale)
    && manifest.scale > 0
    && [undefined, 'onnx', 'realcugan-tfjs'].includes(manifest.engine)
    && ['nchw', 'nhwc'].includes(getLayout(manifest, 'input'))
    && ['nchw', 'nhwc'].includes(getLayout(manifest, 'output'))
    && [undefined, 'rgb', 'ycbcr-y'].includes(manifest.colorSpace)
    && hasValidExecutionProviders(manifest)
    && hasValidFixedInput(manifest)
    && hasChecksumMetadata(manifest)
    && hasValidWeightsMetadata(manifest)
    && hasLicenseMetadata(manifest));
}

export function getSuperResolutionCacheKey(sourceUrl, manifest) {
  if (!hasText(sourceUrl) || !validateSuperResolutionManifest(manifest)) return null;
  return `sr:v4:${manifest.id.trim()}:${manifest.scale}:${manifest.checksum.digest.toLowerCase()}:${sourceUrl.trim()}`;
}

/**
 * 计算归档每页平均体积（KB）。
 * 依据：归档总体积（字节）/ 页数，再换算为 KB。
 * @returns {number|null} 每页平均 KB；数据不足时返回 null。
 */
export function getArchiveAvgPageSizeKb(archive) {
  const bytes = Number(archive?.size ?? archive?.filesize ?? archive?.file_size);
  const pages = Number(archive?.pagecount ?? archive?.total ?? archive?.pages);
  if (!Number.isFinite(bytes) || bytes <= 0 || !Number.isFinite(pages) || pages <= 0) return null;
  return bytes / pages / 1024;
}

/**
 * 判断是否应自动启用超分。
 * 依据：每页平均体积低于阈值（KB）时启用。
 * @returns {boolean} 是否应自动启用。
 */
export function shouldAutoEnableSuperResolution(archive, srAuto, srAutoThresholdKb) {
  if (!srAuto) return false;
  const avgKb = getArchiveAvgPageSizeKb(archive);
  if (avgKb === null) return false;
  const threshold = Number(srAutoThresholdKb);
  if (!Number.isFinite(threshold) || threshold < 0) return false;
  if (threshold === 0) return true;
  return avgKb < threshold;
}
export function detectSuperResolutionSupport() {
  if (typeof globalThis.WebAssembly === 'undefined') {
    return { supported: false, reason: '当前浏览器不支持 WebAssembly，无法运行超分引擎。' };
  }
  if (typeof globalThis.Worker !== 'function'
    || typeof globalThis.createImageBitmap !== 'function'
    || typeof globalThis.OffscreenCanvas !== 'function'
    || typeof globalThis.crypto?.subtle?.digest !== 'function') {
    return { supported: false, reason: '当前浏览器缺少图像解码或 Worker 能力，无法运行超分引擎。' };
  }
  if (!hasWebGpuApi()) return { supported: false, reason: WEBGPU_UNSUPPORTED_REASON };
  return { supported: true, reason: '' };
}

export async function verifySuperResolutionSupport({ requestAdapter } = {}) {
  const initial = detectSuperResolutionSupport();
  if (!initial.supported && typeof requestAdapter !== 'function') return initial;
  try {
    const adapter = await requestHighPerformanceWebGpuAdapter(requestAdapter);
    return adapter
      ? {
        supported: true,
        reason: '',
        adapterInfo: {
          maxStorageBufferBindingSize: Number(adapter.limits?.maxStorageBufferBindingSize) || 0,
          shaderF16: adapter.features?.has?.('shader-f16') === true,
        },
      }
      : { supported: false, reason: WEBGPU_ADAPTER_UNAVAILABLE_REASON };
  } catch {
    return { supported: false, reason: WEBGPU_ADAPTER_UNAVAILABLE_REASON };
  }
}

export function createSuperResolutionRuntime(options = {}) {
  return createRuntime({
    ...options,
    manifestValidator: validateSuperResolutionManifest,
  });
}

function abortIfNeeded(signal) {
  if (!signal?.aborted) return;
  if (typeof DOMException === 'function') {
    throw new DOMException('Super-resolution request was cancelled', 'AbortError');
  }
  const error = new Error('Super-resolution request was cancelled');
  error.name = 'AbortError';
  throw error;
}

function waitForJob(promise, signal) {
  abortIfNeeded(signal);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      try {
        abortIfNeeded(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', handleAbort);
    });
  });
}

export async function processSuperResolutionImageSource(sourceUrl, {
  runtime,
  manifest,
  signal,
  cacheKey,
  getCachedSource,
  cacheResult,
  keepAlive = false,
  fetcher = globalThis.fetch?.bind(globalThis),
  createObjectURL = globalThis.URL?.createObjectURL?.bind(globalThis.URL),
  revokeObjectURL = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL),
} = {}) {
  if (keepAlive && hasText(cacheKey) && typeof cacheResult === 'function') {
    let entry = visiblePageJobs.get(cacheKey);
    if (!entry) {
      const controller = new AbortController();
      const job = processSuperResolutionImageSource(sourceUrl, {
        runtime,
        manifest,
        cacheKey,
        getCachedSource,
        cacheResult,
        signal: controller.signal,
        fetcher,
        createObjectURL,
        revokeObjectURL,
      });
      entry = { job, controller };
      visiblePageJobs.set(cacheKey, entry);
      job.finally(() => {
        if (visiblePageJobs.get(cacheKey) === entry) visiblePageJobs.delete(cacheKey);
      }).catch(() => {});
    }
    return waitForJob(entry.job, signal);
  }
  if (!hasText(sourceUrl)) throw new TypeError('sourceUrl must be a non-empty string');
  if (typeof runtime?.processBlob !== 'function') throw new TypeError('runtime must provide processBlob()');
  if (!validateSuperResolutionManifest(manifest)) throw new TypeError('Invalid super-resolution manifest');
  if (typeof fetcher !== 'function') throw new TypeError('fetch is unavailable');

  abortIfNeeded(signal);
  if (hasText(cacheKey) && typeof getCachedSource === 'function') {
    try {
      const cachedSrc = await getCachedSource(cacheKey);
      abortIfNeeded(signal);
      if (hasText(cachedSrc)) {
        return { src: cachedSrc, width: 0, height: 0, backend: 'cache', dispose() {} };
      }
    } catch {
      abortIfNeeded(signal);
    }
  }
  const response = await fetcher(sourceUrl, { signal });
  if (response?.ok === false) throw new Error(`Failed to read image source (HTTP ${response.status ?? 'unknown'})`);
  if (typeof response?.blob !== 'function') throw new TypeError('Image response does not provide blob()');
  const sourceBlob = await response.blob();
  abortIfNeeded(signal);
  if (await isAnimatedImageBlob(sourceBlob, signal)) {
    const error = new Error('Animated images are not supported by super-resolution');
    error.name = 'NotSupportedError';
    throw error;
  }
  const result = await runtime.processBlob(sourceBlob, { manifest, signal, resumeKey: cacheKey });
  abortIfNeeded(signal);
  if (!result?.blob) throw new TypeError('Super-resolution runtime returned no image Blob');

  if (hasText(cacheKey) && typeof cacheResult === 'function') {
    try {
      const cachedSrc = await cacheResult(cacheKey, result.blob);
      abortIfNeeded(signal);
      if (hasText(cachedSrc)) {
        return {
          src: cachedSrc,
          width: result.width,
          height: result.height,
          backend: result.backend,
          dispose() {},
        };
      }
    } catch {
      abortIfNeeded(signal);
    }
  }

  if (typeof createObjectURL !== 'function' || typeof revokeObjectURL !== 'function') {
    throw new TypeError('Object URL APIs are unavailable');
  }

  const src = createObjectURL(result.blob);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    revokeObjectURL(src);
  };
  try {
    abortIfNeeded(signal);
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    src,
    width: result.width,
    height: result.height,
    backend: result.backend,
    dispose,
  };
}
