import { createSuperResolutionRuntime as createRuntime } from './superResolutionRuntime.js';
import { isAnimatedImageBlob } from './readerPreviewDecode.js';

const visiblePageJobs = new Map();

// 超分能力检测与模型选项（UI 框架；wasm 引擎后续接入）
export const SUPER_RESOLUTION_MODELS = Object.freeze([
  {
    value: 'anime4k',
    label: 'Anime4K',
    description: '偏重动漫线条锐化，速度最快，适合实时阅读；不会生成新细节，照片类图片可能显得过锐。',
    id: 'anime4k-v4-ultra-x2',
    engine: 'anime4k-webgl',
    url: 'builtin:anime4k-v4-ultra-x2',
    scale: 2,
    inputLayout: 'nhwc',
    outputLayout: 'nhwc',
    colorSpace: 'rgb',
    executionProviders: ['webgl'],
    checksum: {
      algorithm: 'SHA-256',
      digest: '61dc121789f4ed98d2d1a739a1a4ee8a49341474b77de0b3edc20fe18b9588c8',
    },
    license: {
      name: 'MIT',
      url: 'https://github.com/bloc97/Anime4K/blob/2f86fc51a0e28f475e41bbfb8ef861259904abae/LICENSE',
    },
  },
  {
    value: 'waifu2x',
    label: 'Waifu2x',
    description: '动漫插画通用模型，兼顾去噪、线条和色块，画质与速度较均衡。',
    id: 'waifu2x-cunet-art-scale2x-20250502',
    url: 'https://huggingface.co/deepghs/waifu2x_onnx/resolve/333b95cc88a6a9f39abb6426ab580f0d673f1185/20250502/onnx_models/cunet/art/scale2x.onnx',
    scale: 2,
    inputLayout: 'nchw',
    outputLayout: 'nchw',
    inputName: 'x',
    outputName: 'y',
    colorSpace: 'rgb',
    executionProviders: ['wasm'],
    inputWidth: 224,
    inputHeight: 224,
    tileCore: 152,
    padding: 36,
    outputInset: 18,
    checksum: {
      algorithm: 'SHA-256',
      digest: '0966d74dd0739a20de358de88c8fa4eb6cb8c3489bb0e941da9751ad4dcdf495',
    },
    license: {
      name: 'MIT',
      url: 'https://github.com/nagadomi/nunif/blob/eab6952c78a27f6d4b73dbfda30d12f349699741/LICENSE',
    },
  },
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
    executionProviders: ['webgl', 'wasm'],
    inputWidth: 64,
    inputHeight: 64,
    tileCore: 28,
    padding: 18,
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
  const tileCore = Number(manifest?.tileCore);
  const padding = Number(manifest?.padding);
  const outputInset = Number(manifest?.outputInset ?? 0);
  return Number.isInteger(width) && width > 0
    && Number.isInteger(height) && height > 0
    && Number.isInteger(tileCore) && tileCore > 0
    && Number.isInteger(padding) && padding >= 0
    && Number.isInteger(outputInset) && outputInset >= 0 && outputInset <= padding
    && width > outputInset * 2
    && height > outputInset * 2
    && width >= tileCore + padding * 2
    && height >= tileCore + padding * 2;
}

function hasValidExecutionProviders(manifest) {
  if (manifest?.executionProviders === undefined) return true;
  const providers = manifest.executionProviders;
  return Array.isArray(providers)
    && providers.length > 0
    && new Set(providers).size === providers.length
    && providers.every((provider) => ['webgl', 'wasm'].includes(provider));
}

export function validateSuperResolutionManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false;
  return Boolean(hasText(manifest.id)
    && hasText(manifest.url)
    && Number.isInteger(manifest.scale)
    && manifest.scale > 0
    && [undefined, 'onnx', 'anime4k-webgl', 'realcugan-tfjs'].includes(manifest.engine)
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
  return `sr:v1:${manifest.id.trim()}:${manifest.scale}:${manifest.checksum.digest.toLowerCase()}:${sourceUrl.trim()}`;
}

function detectGpuSupport() {
  // WebGL 是当前 wasm 引擎（如 Anime4KCPP/realcugan-wasm）在浏览器端可用的最低公共能力标记。
  try {
    const canvas = globalThis.document?.createElement?.('canvas');
    if (!canvas) return false;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return false;
    if (typeof gl.getParameter === 'function') gl.getParameter(gl.VERSION);
    return true;
  } catch {
    return false;
  }
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
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
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
  const gpu = detectGpuSupport();
  return { supported: true, reason: '', gpu };
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
    let job = visiblePageJobs.get(cacheKey);
    if (!job) {
      job = processSuperResolutionImageSource(sourceUrl, {
        runtime,
        manifest,
        cacheKey,
        getCachedSource,
        cacheResult,
        fetcher,
        createObjectURL,
        revokeObjectURL,
      });
      visiblePageJobs.set(cacheKey, job);
      job.finally(() => {
        if (visiblePageJobs.get(cacheKey) === job) visiblePageJobs.delete(cacheKey);
      }).catch(() => {});
    }
    return waitForJob(job, signal);
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
  const result = await runtime.processBlob(sourceBlob, { manifest, signal });
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
