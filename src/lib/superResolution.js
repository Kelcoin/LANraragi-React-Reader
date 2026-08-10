// 超分能力检测与模型选项（UI 框架；wasm 引擎后续接入）
export const SUPER_RESOLUTION_MODELS = Object.freeze([
  { value: 'anime4k', label: 'Anime4K' },
  { value: 'waifu2x', label: 'Waifu2x' },
  { value: 'realcugan', label: 'Real-CUGAN' },
]);

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
 * 检测当前环境是否支持超分。
 * @returns {{ supported: boolean, reason: string }}
 */
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