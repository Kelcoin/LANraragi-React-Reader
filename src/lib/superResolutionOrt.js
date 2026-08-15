const ortWebGpuModuleUrl = new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href;
const ortWebGpuBinaryUrl = new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href;

export async function loadOrtBackend(backend) {
  if (backend !== 'webgpu') throw new Error(`Unsupported ONNX Runtime backend: ${backend}`);
  const ort = await import('onnxruntime-web/webgpu');
  ort.env.wasm.wasmPaths = {
    mjs: ortWebGpuModuleUrl,
    wasm: ortWebGpuBinaryUrl,
  };
  ort.env.webgpu.powerPreference = 'high-performance';
  return ort;
}
