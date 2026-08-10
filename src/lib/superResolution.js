// 超分能力检测与模型选项（UI 框架；wasm 引擎后续接入）
export const SUPER_RESOLUTION_MODELS = Object.freeze([
  { value: 'anime4k', label: 'Anime4K' },
  { value: 'waifu2x', label: 'Waifu2x' },
  { value: 'realcugan', label: 'Real-CUGAN' },
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

function hasLicenseMetadata(manifest) {
  const license = manifest?.license;
  return Boolean(license
    && typeof license === 'object'
    && !Array.isArray(license)
    && hasText(license.name)
    && hasText(license.url));
}

export function validateSuperResolutionManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false;
  return hasText(manifest.id)
    && hasText(manifest.url)
    && Number.isInteger(manifest.scale)
    && manifest.scale > 0
    && ['nchw', 'nhwc'].includes(getLayout(manifest, 'input'))
    && ['nchw', 'nhwc'].includes(getLayout(manifest, 'output'))
    && hasChecksumMetadata(manifest)
    && hasLicenseMetadata(manifest);
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
  const gpu = detectGpuSupport();
  if (!gpu) {
    return { supported: false, reason: '当前设备/浏览器不支持 WebGL，无法运行 GPU 超分。' };
  }
  return { supported: true, reason: '' };
}
