export const WEBGPU_UNSUPPORTED_REASON = '当前浏览器或设备不支持 WebGPU，无法启用超分。';
export const WEBGPU_ADAPTER_UNAVAILABLE_REASON = '未找到可用的 WebGPU 显卡适配器，无法启用超分。';

export function hasWebGpuApi(navigatorObject = globalThis.navigator) {
  return typeof navigatorObject?.gpu?.requestAdapter === 'function';
}

export async function requestHighPerformanceWebGpuAdapter(
  requestAdapter = globalThis.navigator?.gpu?.requestAdapter?.bind(globalThis.navigator.gpu),
) {
  if (typeof requestAdapter !== 'function') return null;
  return requestAdapter({ powerPreference: 'high-performance' });
}
